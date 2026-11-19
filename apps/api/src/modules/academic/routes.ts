/** Semesters, academic calendar (holidays, exams, closures) and fee rules. */
import { Router } from 'express';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { calendarEventSchema, feeRuleSchema, isoDate, semesterSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { calendarEvents, feeRules, semesters } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound, parse } from '../../lib/errors.js';
import { actorId } from '../common.js';

export function academicRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/semesters', requirePermission('dashboard.view'), async (_req, res) => {
    res.json(await db.select().from(semesters).orderBy(asc(semesters.startsOn)));
  });

  r.post('/semesters', requirePermission('semesters.manage'), async (req, res) => {
    const body = parse(semesterSchema, req.body);
    const row = await db.transaction(async (tx) => {
      if (body.isCurrent) await tx.update(semesters).set({ isCurrent: false });
      const [created] = await tx.insert(semesters).values(body).onConflictDoNothing().returning();
      if (!created) throw conflict(`Semester ${body.code} already exists`);
      return created;
    });
    await audit(db, { actorId: actorId(req), action: 'semesters.created', entity: 'semester', entityId: row.id, after: row, req });
    res.status(201).json(row);
  });

  r.post('/semesters/:id/make-current', requirePermission('semesters.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [exists] = await db.select().from(semesters).where(eq(semesters.id, id));
    if (!exists) throw notFound('Semester');
    await db.transaction(async (tx) => {
      await tx.update(semesters).set({ isCurrent: false });
      await tx.update(semesters).set({ isCurrent: true }).where(eq(semesters.id, id));
    });
    await audit(db, { actorId: actorId(req), action: 'semesters.made_current', entity: 'semester', entityId: id, req });
    res.json({ ok: true });
  });

  r.get('/calendar', requirePermission('dashboard.view'), async (req, res) => {
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    res.json(await db.select().from(calendarEvents).where(and(gte(calendarEvents.date, q.from), lte(calendarEvents.date, q.to))).orderBy(asc(calendarEvents.date)));
  });

  r.post('/calendar', requirePermission('semesters.manage'), async (req, res) => {
    const body = parse(calendarEventSchema, req.body);
    const [row] = await db.insert(calendarEvents).values(body).returning();
    await audit(db, { actorId: actorId(req), action: 'calendar.added', entity: 'calendar_event', entityId: row!.id, after: row, req });
    res.status(201).json(row);
  });

  r.delete('/calendar/:id', requirePermission('semesters.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [row] = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning();
    if (!row) throw notFound('Calendar event');
    await audit(db, { actorId: actorId(req), action: 'calendar.removed', entity: 'calendar_event', entityId: id, before: row, req });
    res.json({ ok: true });
  });

  r.get('/fees', requirePermission('payments.view'), async (req, res) => {
    const q = parse(z.object({ semesterId: z.string().uuid() }), req.query);
    res.json(await db.select().from(feeRules).where(eq(feeRules.semesterId, q.semesterId)));
  });

  /** Creates or replaces the fee for one semester × category. */
  r.put('/fees', requirePermission('fees.manage'), async (req, res) => {
    const body = parse(feeRuleSchema, req.body);
    const [before] = await db.select().from(feeRules).where(and(eq(feeRules.semesterId, body.semesterId), eq(feeRules.category, body.category)));
    const [row] = await db.insert(feeRules).values(body)
      .onConflictDoUpdate({ target: [feeRules.semesterId, feeRules.category], set: { amountBdt: body.amountBdt, isActive: body.isActive } }).returning();
    await audit(db, { actorId: actorId(req), action: 'fees.set', entity: 'fee_rule', entityId: row!.id, before: before ?? null, after: row, req });
    res.json(row);
  });

  return r;
}
