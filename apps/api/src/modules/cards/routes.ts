/**
 * Authority side of transport cards: request queue, decisions, and the
 * access lookup (full ID only, transport data only, every lookup audited).
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { cardDecisionSchema, grantAccessSchema, revokeAccessSchema, universityId } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { payments, routes, semesters, transportCards, users } from '../../db/schema.js';
import { can, requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors.js';
import { notify } from '../../notifications/push.js';
import { actorId, currentSemester } from '../common.js';
import { activateCard, riderHistory, riderView } from './service.js';

export function cardsAdminRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;
  const lookupLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: ctx.config.NODE_ENV === 'test' ? 1000 : 30,
    keyGenerator: (req) => req.auth?.userId ?? 'anon',
    message: { error: { code: 'rate_limited', message: 'Too many lookups this hour. This limit stops anyone from browsing riders.' } },
  });

  r.get('/cards/requests', requirePermission('cards.approve'), async (req, res) => {
    const q = parse(z.object({ status: z.enum(['pending_approval', 'pending_payment']).optional() }), req.query);
    const sem = await currentSemester(db);
    const rows = await db.select({
      cardId: transportCards.id, universityId: users.universityId, name: users.name, category: users.category, route: routes.name,
      status: transportCards.status, note: transportCards.reason, requestedAt: transportCards.createdAt,
    }).from(transportCards).innerJoin(users, eq(users.id, transportCards.userId)).innerJoin(routes, eq(routes.id, transportCards.routeId))
      .where(and(eq(transportCards.semesterId, sem.id), q.status ? eq(transportCards.status, q.status) : inArray(transportCards.status, ['pending_approval', 'pending_payment'])))
      .orderBy(desc(transportCards.createdAt));
    const pays = rows.length ? await db.select({ cardId: payments.cardId, status: payments.status, createdAt: payments.createdAt }).from(payments)
      .where(inArray(payments.cardId, rows.map((x) => x.cardId))).orderBy(desc(payments.createdAt)) : [];
    res.json(rows.map((x) => ({ ...x, lastPayment: pays.find((p) => p.cardId === x.cardId) ?? null })));
  });

  r.get('/cards/auto-approved', requirePermission('cards.approve'), async (req, res) => {
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
    const rows = await db.select({
      universityId: users.universityId, name: users.name, route: routes.name, amountBdt: payments.amountBdt, method: payments.method, paidAt: payments.paidAt,
    }).from(payments).innerJoin(transportCards, eq(transportCards.id, payments.cardId)).innerJoin(users, eq(users.id, payments.userId)).innerJoin(routes, eq(routes.id, transportCards.routeId))
      .where(and(eq(payments.status, 'success'), eq(transportCards.source, 'payment')))
      .orderBy(desc(payments.paidAt));
    res.json(rows.filter((x) => x.paidAt && x.paidAt.toISOString().slice(0, 10) === q.date));
  });

  r.post('/cards/:id/decision', requirePermission('cards.approve'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(cardDecisionSchema, req.body);
    const [card] = await db.select().from(transportCards).where(eq(transportCards.id, id));
    if (!card) throw notFound('Card request');
    if (!['pending_approval', 'pending_payment'].includes(card.status)) throw conflict(`This request is already ${card.status.replace('_', ' ')}`);
    if (body.decision === 'reject') {
      if (!body.reason) throw badRequest('Write a reason for rejecting');
      const [after] = await db.update(transportCards).set({ status: 'rejected', reason: body.reason, decidedBy: actorId(req), updatedAt: new Date() }).where(eq(transportCards.id, id)).returning();
      await audit(db, { actorId: actorId(req), action: 'cards.rejected', entity: 'transport_card', entityId: id, subjectUserId: card.userId, before: card, after, reason: body.reason, req });
      await notify(ctx.db, ctx.push, { kind: 'users', userIds: [card.userId] }, { title: 'Transport card request not approved', body: body.reason });
      res.json(after);
      return;
    }
    const [paid] = await db.select().from(payments).where(and(eq(payments.cardId, id), eq(payments.status, 'success')));
    if (!paid) {
      if (!can(req, 'cards.grant_free')) throw forbidden('Approving without payment needs permission: cards.grant_free');
      if (!body.reason) throw badRequest('Write a reason for approving without payment');
    }
    const { before, after } = await activateCard(ctx, db, id, paid ? 'payment' : 'manual_approval', actorId(req), body.reason);
    await audit(db, { actorId: actorId(req), action: paid ? 'cards.approved' : 'cards.approved_without_payment', entity: 'transport_card', entityId: id, subjectUserId: card.userId, before, after, reason: body.reason, req });
    await notify(ctx.db, ctx.push, { kind: 'users', userIds: [card.userId] }, { title: 'Your transport card is active', body: 'Open My Card to see your boarding QR.' });
    res.json(after);
  });

  /* ---------- access lookup: full university ID only ---------- */

  r.get('/access/:universityId', requirePermission('access.lookup'), lookupLimiter, async (req, res) => {
    const uid = parse(universityId, req.params.universityId);
    const rider = await riderView(db, uid);
    await audit(db, { actorId: actorId(req), action: 'access.lookup', entity: 'rider', entityId: uid, subjectUserId: rider?.userId ?? null, req });
    if (!rider) throw notFound('Transport record for this ID');
    const { userId, ...view } = rider;
    res.json({ rider: view, history: await riderHistory(db, userId) });
  });

  r.post('/access/:universityId/grant', requirePermission('access.grant_revoke'), async (req, res) => {
    const uid = parse(universityId, req.params.universityId);
    const body = parse(grantAccessSchema, req.body);
    const sem = await currentSemester(db);
    let [user] = await db.select({ id: users.id, role: users.role, homeRouteId: users.homeRouteId }).from(users).where(eq(users.universityId, uid));
    if (!user) {
      // First time we hear of this person: store identity only. Their profile arrives when they sign in themselves.
      const person = await ctx.directory.lookup(uid);
      if (!person) throw notFound('This ID in the university directory');
      [user] = await db.insert(users).values({ universityId: uid, name: person.name, role: person.role, category: person.category }).returning({ id: users.id, role: users.role, homeRouteId: users.homeRouteId });
    }
    if (user!.role === 'authority' || user!.role === 'supervisor') throw badRequest('Transport access is for riders');
    const routeId = body.routeId ?? user!.homeRouteId;
    if (!routeId) throw badRequest('Choose a route for this rider');
    const [route] = await db.select({ id: routes.id }).from(routes).where(eq(routes.id, routeId));
    if (!route) throw notFound('Route');
    let [card] = await db.select().from(transportCards).where(and(eq(transportCards.userId, user!.id), eq(transportCards.semesterId, sem.id)));
    if (card?.status === 'active') throw conflict('This rider already has an active card this semester');
    if (!card) {
      [card] = await db.insert(transportCards).values({ userId: user!.id, semesterId: sem.id, routeId, status: 'pending_approval', reason: body.reason }).returning();
    } else {
      await db.update(transportCards).set({ routeId }).where(eq(transportCards.id, card.id));
    }
    if (!user!.homeRouteId) await db.update(users).set({ homeRouteId: routeId }).where(eq(users.id, user!.id));
    const { before, after } = await activateCard(ctx, db, card!.id, 'authority_grant', actorId(req), body.reason);
    await audit(db, { actorId: actorId(req), action: 'access.granted', entity: 'transport_card', entityId: card!.id, subjectUserId: user!.id, before, after, reason: body.reason, req });
    await notify(ctx.db, ctx.push, { kind: 'users', userIds: [user!.id] }, { title: 'Transport access given', body: 'You can ride the university bus this semester.' });
    res.json({ status: after.status, expiresOn: after.expiresOn });
  });

  r.post('/access/:universityId/revoke', requirePermission('access.grant_revoke'), async (req, res) => {
    const uid = parse(universityId, req.params.universityId);
    const body = parse(revokeAccessSchema, req.body);
    const [row] = await db.select({ card: transportCards }).from(transportCards)
      .innerJoin(users, eq(users.id, transportCards.userId)).innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
      .where(and(eq(users.universityId, uid), eq(semesters.isCurrent, true)));
    if (!row || row.card.status !== 'active') throw conflict('No active card to revoke');
    const [after] = await db.update(transportCards).set({ status: 'revoked', reason: body.reason, decidedBy: actorId(req), updatedAt: new Date() }).where(eq(transportCards.id, row.card.id)).returning();
    await audit(db, { actorId: actorId(req), action: 'access.revoked', entity: 'transport_card', entityId: row.card.id, subjectUserId: row.card.userId, before: row.card, after, reason: body.reason, req });
    await notify(ctx.db, ctx.push, { kind: 'users', userIds: [row.card.userId] }, { title: 'Transport access revoked', body: 'Contact the transport office if you think this is a mistake.' });
    res.json({ status: 'revoked' });
  });

  return r;
}
