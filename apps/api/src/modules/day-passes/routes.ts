/**
 * One Day Pass. Riders without a card get N passes per semester (default 1)
 * approved automatically. Requests over the limit are rejected, or wait for
 * the authority when "manual" is chosen in settings.
 */
import { Router } from 'express';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { dayPassDecisionSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { dayPasses, routes, transportCards, users } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { encrypt, randomToken } from '../../lib/crypto.js';
import { HttpError, badRequest, conflict, notFound, parse, unprocessable } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { notify } from '../../notifications/push.js';
import { actorId, currentSemester, today } from '../common.js';

export async function requestDayPass(ctx: AppContext, db: DB, userId: string, input: { travelDate: string; routeId: string }) {
  const sem = await currentSemester(db);
  if (input.travelDate < today()) throw badRequest('Choose today or a later date');
  if (input.travelDate > sem.endsOn) throw badRequest('That date is after this semester ends');
  const [route] = await db.select().from(routes).where(eq(routes.id, input.routeId));
  if (!route || !route.isActive) throw notFound('Route');
  const [card] = await db.select().from(transportCards).where(and(eq(transportCards.userId, userId), eq(transportCards.semesterId, sem.id), eq(transportCards.status, 'active')));
  if (card) throw conflict('You already have an active transport card, so you do not need a pass');
  const [dup] = await db.select().from(dayPasses).where(and(eq(dayPasses.userId, userId), eq(dayPasses.travelDate, input.travelDate)));
  if (dup) throw conflict('You already asked for a pass on that date');

  const settings = await getSettings(db);
  const used = await db.select({ id: dayPasses.id }).from(dayPasses)
    .where(and(eq(dayPasses.userId, userId), eq(dayPasses.semesterId, sem.id), ne(dayPasses.status, 'rejected')));
  const withinLimit = used.length < settings.dayPassLimitPerSemester;
  if (!withinLimit && settings.dayPassOverLimit === 'reject') {
    throw new HttpError(422, 'day_pass_limit', `You have used your ${settings.dayPassLimitPerSemester} day pass${settings.dayPassLimitPerSemester === 1 ? '' : 'es'} for ${sem.name}. Get a transport card or ask the transport office.`);
  }
  const [pass] = await db.insert(dayPasses).values({
    userId, semesterId: sem.id, routeId: route.id, travelDate: input.travelDate,
    status: withinLimit ? 'approved' : 'pending',
    autoApproved: withinLimit,
    qrSecretEnc: encrypt(ctx.config.dataKey, randomToken(32)),
  }).returning();
  return { pass: pass!, left: Math.max(0, settings.dayPassLimitPerSemester - used.length - 1) };
}

export function dayPassAdminRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/day-passes', requirePermission('daypass.approve'), async (req, res) => {
    const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'used']).default('pending') }), req.query);
    const sem = await currentSemester(db);
    res.json(await db.select({
      id: dayPasses.id, universityId: users.universityId, name: users.name, travelDate: dayPasses.travelDate, route: routes.name,
      status: dayPasses.status, autoApproved: dayPasses.autoApproved, requestedAt: dayPasses.createdAt,
    }).from(dayPasses).innerJoin(users, eq(users.id, dayPasses.userId)).innerJoin(routes, eq(routes.id, dayPasses.routeId))
      .where(and(eq(dayPasses.semesterId, sem.id), eq(dayPasses.status, q.status))).orderBy(asc(dayPasses.travelDate)));
  });

  r.post('/day-passes/:id/decision', requirePermission('daypass.approve'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(dayPassDecisionSchema, req.body);
    if (!body.reason) throw badRequest('Write a reason');
    const [pass] = await db.select().from(dayPasses).where(eq(dayPasses.id, id));
    if (!pass) throw notFound('Day pass');
    if (pass.status !== 'pending') throw unprocessable(`This pass is already ${pass.status}`);
    const status = body.decision === 'approve' ? 'approved' : 'rejected';
    const [after] = await db.update(dayPasses).set({ status, reason: body.reason, decidedBy: actorId(req) }).where(eq(dayPasses.id, id)).returning();
    await audit(db, { actorId: actorId(req), action: `daypass.${status}`, entity: 'day_pass', entityId: id, subjectUserId: pass.userId, before: pass, after, reason: body.reason, req });
    await notify(ctx.db, ctx.push, { kind: 'users', userIds: [pass.userId] }, { title: status === 'approved' ? `Day pass approved for ${pass.travelDate}` : 'Day pass not approved', body: body.reason });
    res.json(after);
  });

  return r;
}
