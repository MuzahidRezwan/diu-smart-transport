/**
 * Class routines. A new routine (uploaded, or found by the daily scraper)
 * waits as "pending_review" until someone checks it, because one wrong routine
 * silently breaks every prediction.
 */
import { Router } from 'express';
import multer from 'multer';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { classSessions, routineSources, routineVersions } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound, parse, unprocessable } from '../../lib/errors.js';
import { actorId } from '../common.js';
import type { ParsedRoutine } from '../predictions/ml-client.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(pdf|xlsx|csv|html?)$/i.test(file.originalname)),
});

export async function storeParsedRoutine(ctx: AppContext, parsed: ParsedRoutine, meta: { sourceId?: string; fileName?: string; uploadedBy?: string }) {
  const db = ctx.adminDb;
  const [dup] = await db.select({ id: routineVersions.id }).from(routineVersions).where(and(eq(routineVersions.contentHash, parsed.contentHash), eq(routineVersions.department, parsed.department)));
  if (dup) return { id: dup.id, duplicate: true };
  const version = await db.transaction(async (tx) => {
    const [v] = await tx.insert(routineVersions).values({
      sourceId: meta.sourceId ?? null, department: parsed.department, fileName: meta.fileName ?? null, contentHash: parsed.contentHash,
      sessionCount: parsed.sessions.length, warnings: parsed.warnings, uploadedBy: meta.uploadedBy ?? null,
    }).returning({ id: routineVersions.id });
    if (parsed.sessions.length) {
      await tx.insert(classSessions).values(parsed.sessions.map((s) => ({ routineVersionId: v!.id, department: s.department, batch: s.batch, section: s.section, teacherInitial: s.teacherInitial, weekday: s.weekday, startMinutes: s.startMinutes, endMinutes: s.endMinutes, courseCode: s.courseCode ?? null, room: s.room ?? null })));
    }
    return v!;
  });
  return { id: version.id, duplicate: false };
}

/** Daily job: check every routine source, store anything new for review. */
export async function syncRoutineSources(ctx: AppContext) {
  const db = ctx.adminDb;
  const sources = await db.select().from(routineSources).where(eq(routineSources.isActive, true));
  const results: { department: string; status: string }[] = [];
  for (const s of sources) {
    try {
      const parsed = await ctx.ml.fetchRoutine(s.url, s.department);
      await db.update(routineSources).set({ lastCheckedAt: new Date(), lastHash: parsed.contentHash }).where(eq(routineSources.id, s.id));
      if (parsed.contentHash === s.lastHash) { results.push({ department: s.department, status: 'unchanged' }); continue; }
      const stored = await storeParsedRoutine(ctx, parsed, { sourceId: s.id, fileName: s.url });
      if (!stored.duplicate) await audit(db, { actorId: null, action: 'routines.uploaded', entity: 'routine_version', entityId: stored.id, after: { department: s.department, sessions: parsed.sessions.length } });
      results.push({ department: s.department, status: stored.duplicate ? 'unchanged' : 'new_version' });
    } catch (err) {
      results.push({ department: s.department, status: `error: ${(err as Error).message.slice(0, 120)}` });
    }
  }
  return results;
}

export function routinesRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/routines', requirePermission('routines.manage'), async (_req, res) => {
    res.json(await db.select().from(routineVersions).orderBy(desc(routineVersions.createdAt)).limit(100));
  });

  r.get('/routines/:id/sessions', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    res.json(await db.select().from(classSessions).where(eq(classSessions.routineVersionId, id)));
  });

  r.post('/routines/upload', requirePermission('routines.manage'), upload.single('file'), async (req, res) => {
    const department = parse(z.string().trim().min(2).max(80), req.body?.department);
    if (!req.file) throw badRequest('Attach a routine file (PDF, XLSX, CSV or HTML, up to 5 MB)');
    const parsed = await ctx.ml.parseRoutine({ name: req.file.originalname, bytes: req.file.buffer }, department);
    if (!parsed.sessions.length) throw unprocessable('No classes were found in this file. Use the CSV template in docs/routine-template.csv.', parsed.warnings);
    const stored = await storeParsedRoutine(ctx, parsed, { fileName: req.file.originalname, uploadedBy: actorId(req) });
    await audit(db, { actorId: actorId(req), action: 'routines.uploaded', entity: 'routine_version', entityId: stored.id, after: { department, sessions: parsed.sessions.length, warnings: parsed.warnings.length }, req });
    res.status(stored.duplicate ? 200 : 201).json({ id: stored.id, duplicate: stored.duplicate, sessions: parsed.sessions.length, warnings: parsed.warnings });
  });

  r.post('/routines/:id/activate', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [v] = await db.select().from(routineVersions).where(eq(routineVersions.id, id));
    if (!v) throw notFound('Routine');
    await db.transaction(async (tx) => {
      await tx.update(routineVersions).set({ status: 'superseded' }).where(and(eq(routineVersions.department, v.department), eq(routineVersions.status, 'active'), ne(routineVersions.id, id)));
      await tx.update(routineVersions).set({ status: 'active', reviewedBy: actorId(req), activatedAt: new Date() }).where(eq(routineVersions.id, id));
    });
    await audit(db, { actorId: actorId(req), action: 'routines.activated', entity: 'routine_version', entityId: id, after: { department: v.department }, req });
    res.json({ ok: true, note: 'Re-run the forecast to use this routine.' });
  });

  r.post('/routines/:id/reject', requirePermission('routines.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [v] = await db.update(routineVersions).set({ status: 'rejected', reviewedBy: actorId(req) }).where(eq(routineVersions.id, id)).returning();
    if (!v) throw notFound('Routine');
    await audit(db, { actorId: actorId(req), action: 'routines.rejected', entity: 'routine_version', entityId: id, req });
    res.json({ ok: true });
  });

  r.get('/routines/sources', requirePermission('routines.manage'), async (_req, res) => { res.json(await db.select().from(routineSources)); });

  r.post('/routines/sources', requirePermission('routines.manage'), async (req, res) => {
    const body = parse(z.object({ department: z.string().trim().min(2).max(80), url: z.string().url().startsWith('https://'), kind: z.enum(['html', 'pdf', 'xlsx', 'csv']) }), req.body);
    const [row] = await db.insert(routineSources).values(body).returning();
    await audit(db, { actorId: actorId(req), action: 'routines.source_added', entity: 'routine_source', entityId: row!.id, after: row, req });
    res.status(201).json(row);
  });

  return r;
}
