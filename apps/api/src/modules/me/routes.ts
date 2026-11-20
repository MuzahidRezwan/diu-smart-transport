/**
 * The signed-in person's own data. The only place profile fields are returned,
 * and only to their owner. Everything is scoped to req.auth.userId.
 */
import { Router } from 'express';
import { and, asc, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { AUDIENCES, addDays, cardApplySchema, complaintCreateSchema, dayPassRequestSchema, dhakaMinutes, helpCreateSchema, isoDate } from '@diu/shared';
import type { AppContext } from '../../context.js';
import {
  dayPasses, deviceTokens, notices, payments, routes, semesters, ticketMessages, tickets, transportCards, userProfiles, users,
} from '../../db/schema.js';
import { authenticate, requireRider } from '../../auth/middleware.js';
import { decrypt } from '../../lib/crypto.js';
import { conflict, notFound, parse } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { currentSemester, today } from '../common.js';
import { requestDayPass } from '../day-passes/routes.js';
import { startCardPayment } from '../payments/service.js';
import { slotsForDay } from '../public/routes.js';
import { listAllocations } from '../allocations/service.js';
import { livePositionsForRoute } from '../tracking/routes.js';
import { nextTicketNumber } from '../tickets/routes.js';

export function meRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.db;
  r.use(authenticate(ctx));

  r.get('/', async (req, res) => {
    const me = req.auth!;
    const [user] = await db.select().from(users).where(eq(users.id, me.userId));
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, me.userId));
    const [card] = await db.select({ status: transportCards.status, semester: semesters.name, expiresOn: transportCards.expiresOn })
      .from(transportCards).innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
      .where(and(eq(transportCards.userId, me.userId), eq(semesters.isCurrent, true)));
    const { userId: _u, syncedAt: _s, ...p } = profile ?? ({} as Record<string, unknown>);
    res.json({
      id: user!.id, universityId: user!.universityId, role: user!.role, category: user!.category, name: user!.name,
      profile: Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null)),
      homeRouteId: user!.homeRouteId, card: card ?? null,
      ...(req.admin ? { admin: { isMainAdmin: req.admin.isMainAdmin, permissions: req.admin.permissions, designation: req.admin.designation } } : {}),
    });
  });

  r.post('/devices', async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(300), platform: z.enum(['android', 'ios', 'web']) }), req.body);
    await db.insert(deviceTokens).values({ userId: req.auth!.userId, ...body }).onConflictDoUpdate({ target: deviceTokens.token, set: { userId: req.auth!.userId, platform: body.platform } });
    res.status(204).end();
  });

  r.delete('/devices', async (req, res) => {
    const body = parse(z.object({ token: z.string() }), req.body);
    await db.delete(deviceTokens).where(and(eq(deviceTokens.token, body.token), eq(deviceTokens.userId, req.auth!.userId)));
    res.status(204).end();
  });

  /* ---------- rider-only below ---------- */
  r.use(requireRider);

  /** Card plus QR secrets for offline rotating QR codes. Only ever sent to the owner. */
  r.get('/card', async (req, res) => {
    const me = req.auth!.userId;
    const [row] = await db.select({ card: transportCards, semester: semesters, route: routes }).from(transportCards)
      .innerJoin(semesters, eq(semesters.id, transportCards.semesterId)).innerJoin(routes, eq(routes.id, transportCards.routeId))
      .where(and(eq(transportCards.userId, me), eq(semesters.isCurrent, true)));
    const passes = await db.select({ pass: dayPasses, route: routes.name }).from(dayPasses).innerJoin(routes, eq(routes.id, dayPasses.routeId))
      .where(and(eq(dayPasses.userId, me), gte(dayPasses.travelDate, today()), inArray(dayPasses.status, ['approved', 'used'])));
    const settings = await getSettings(db);
    const sem = row?.semester ?? (await currentSemester(db));
    const usedPasses = (await db.select({ id: dayPasses.id }).from(dayPasses).where(and(eq(dayPasses.userId, me), eq(dayPasses.semesterId, sem.id), inArray(dayPasses.status, ['approved', 'used', 'pending'])))).length;
    res.set('cache-control', 'no-store');
    res.json({
      card: row ? {
        id: row.card.id, status: row.card.status, source: row.card.source, semester: row.semester.name, route: { id: row.route.id, name: row.route.name },
        issuedAt: row.card.issuedAt, expiresOn: row.card.expiresOn,
        qrSecret: row.card.status === 'active' && row.card.qrSecretEnc ? decrypt(ctx.config.dataKey, row.card.qrSecretEnc) : null,
      } : null,
      dayPasses: passes.map(({ pass, route }) => ({
        id: pass.id, travelDate: pass.travelDate, route, status: pass.status,
        qrSecret: pass.status === 'approved' && pass.qrSecretEnc ? decrypt(ctx.config.dataKey, pass.qrSecretEnc) : null,
      })),
      dayPassesLeft: Math.max(0, settings.dayPassLimitPerSemester - usedPasses),
    });
  });

  r.post('/card', async (req, res) => {
    const body = parse(cardApplySchema, req.body);
    res.status(201).json(await startCardPayment(ctx, req.auth!.userId, body.routeId));
  });

  r.post('/card/free-request', async (req, res) => {
    const body = parse(z.object({ routeId: z.string().uuid(), note: z.string().trim().min(10).max(500) }), req.body);
    const sem = await currentSemester(db);
    const [existing] = await db.select().from(transportCards).where(and(eq(transportCards.userId, req.auth!.userId), eq(transportCards.semesterId, sem.id)));
    if (existing && !['rejected', 'pending_payment'].includes(existing.status)) throw conflict(`You already have a ${existing.status.replace('_', ' ')} card this semester`);
    const values = { routeId: body.routeId, status: 'pending_approval' as const, reason: body.note, updatedAt: new Date() };
    const [card] = existing
      ? await db.update(transportCards).set(values).where(eq(transportCards.id, existing.id)).returning()
      : await db.insert(transportCards).values({ userId: req.auth!.userId, semesterId: sem.id, ...values }).returning();
    res.status(201).json({ id: card!.id, status: card!.status });
  });

  r.get('/payments', async (req, res) => {
    res.json(await db.select({ tranId: payments.tranId, amountBdt: payments.amountBdt, method: payments.method, status: payments.status, createdAt: payments.createdAt, paidAt: payments.paidAt, semester: semesters.name })
      .from(payments).innerJoin(semesters, eq(semesters.id, payments.semesterId)).where(eq(payments.userId, req.auth!.userId)).orderBy(desc(payments.createdAt)));
  });

  r.get('/day-passes', async (req, res) => {
    res.json(await db.select({ id: dayPasses.id, travelDate: dayPasses.travelDate, route: routes.name, status: dayPasses.status, autoApproved: dayPasses.autoApproved })
      .from(dayPasses).innerJoin(routes, eq(routes.id, dayPasses.routeId)).where(eq(dayPasses.userId, req.auth!.userId)).orderBy(desc(dayPasses.travelDate)));
  });

  r.post('/day-passes', async (req, res) => {
    const body = parse(dayPassRequestSchema, req.body);
    const { pass, left } = await requestDayPass(ctx, db, req.auth!.userId, body);
    res.status(201).json({ id: pass.id, status: pass.status, travelDate: pass.travelDate, autoApproved: pass.autoApproved, passesLeft: left });
  });

  /** Schedule for a day. Bus numbers only for riders with an active card or a pass for that date. */
  r.get('/schedule', async (req, res) => {
    const q = parse(z.object({ date: isoDate.default(today()), routeId: z.string().uuid().optional(), audience: z.enum(AUDIENCES).optional() }), req.query);
    const me = req.auth!;
    const [user] = await db.select().from(users).where(eq(users.id, me.userId));
    const routeId = q.routeId ?? user!.homeRouteId ?? undefined;
    const aud = q.audience ?? (me.role === 'student' ? 'student' : 'faculty');
    if (aud === 'faculty' && me.role === 'student') throw notFound('Schedule');
    // The staff schedule lists the regular trips too (staff ride them), plus staff-only trips.
    const day = await slotsForDay(db, q.date, { routeId, ...(aud === 'student' ? { audience: 'student' as const } : {}) });
    const [card] = await db.select({ id: transportCards.id }).from(transportCards).innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
      .where(and(eq(transportCards.userId, me.userId), eq(semesters.isCurrent, true), eq(transportCards.status, 'active')));
    const [pass] = await db.select({ id: dayPasses.id }).from(dayPasses)
      .where(and(eq(dayPasses.userId, me.userId), eq(dayPasses.travelDate, q.date), inArray(dayPasses.status, ['approved', 'used'])));
    const canSeeBuses = Boolean(card || pass);
    const published = canSeeBuses ? await listAllocations(db, q.date, true) : [];
    res.json({
      date: q.date, closed: day.closed, canSeeBuses,
      slots: day.slots.map((s) => {
        const a = published.find((x) => x.timeSlotId === s.timeSlotId);
        return { ...s, published: Boolean(a), buses: a ? a.buses.map(({ id, code, operatorCode, capacity }) => ({ id, code, operatorCode, capacity })) : [] };
      }),
    });
  });

  /** "Your bus": the next departure on the rider's route, switching direction around midday. */
  r.get('/my-bus', async (req, res) => {
    const q = parse(z.object({ direction: z.enum(['to_campus', 'from_campus']).optional(), audience: z.enum(AUDIENCES).optional() }), req.query);
    const me = req.auth!;
    const [user] = await db.select().from(users).where(eq(users.id, me.userId));
    if (!user!.homeRouteId) { res.json({ next: null, reason: 'Choose your route first' }); return; }
    const now = dhakaMinutes();
    const direction = q.direction ?? (now < 12 * 60 ? 'to_campus' : 'from_campus');
    const aud = q.audience ?? (me.role === 'student' ? 'student' : 'faculty');
    const todayIso = today();
    // Students take the regular trips. Staff take those too, plus staff-only trips
    // (DIU's 4:20 PM "only for employees" buses), so for them both kinds count.
    const filter = { routeId: user!.homeRouteId, ...(aud === 'student' ? { audience: 'student' as const } : {}) };
    const day = await slotsForDay(db, todayIso, filter);
    let next = day.slots.find((s) => s.direction === direction && s.departureMinutes >= now - 5) ?? null;
    let serviceDate = todayIso;
    // Nothing left today (evening, a day without trips, a holiday): the first trip this way on a later day.
    for (let i = 1; !next && i <= 7; i++) {
      const date = addDays(todayIso, i);
      const later = (await slotsForDay(db, date, filter)).slots.filter((s) => s.direction === direction)
        .sort((a, b) => a.departureMinutes - b.departureMinutes);
      if (later[0]) { next = later[0]; serviceDate = date; }
    }
    const isToday = serviceDate === todayIso;
    let buses: { code: string; operatorCode: string; capacity: number }[] = [];
    const [card] = await db.select({ id: transportCards.id }).from(transportCards).innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
      .where(and(eq(transportCards.userId, me.userId), eq(semesters.isCurrent, true), eq(transportCards.status, 'active')));
    if (next && card) {
      const a = (await listAllocations(db, serviceDate, true)).find((x) => x.timeSlotId === next!.timeSlotId);
      buses = a ? a.buses.map(({ code, operatorCode, capacity }) => ({ code, operatorCode, capacity })) : [];
    }
    res.json({ closed: day.closed, direction, next, serviceDate, isToday, minutesUntil: next && isToday ? next.departureMinutes - now : null, buses, canSeeBuses: Boolean(card) });
  });

  r.get('/live', async (req, res) => {
    const me = req.auth!;
    const [row] = await db.select({ routeId: transportCards.routeId }).from(transportCards).innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
      .where(and(eq(transportCards.userId, me.userId), eq(semesters.isCurrent, true), eq(transportCards.status, 'active')));
    if (!row) { res.json({ allowed: false, positions: [] }); return; }
    res.json({ allowed: true, routeId: row.routeId, positions: livePositionsForRoute(row.routeId) });
  });

  r.get('/notices', async (req, res) => {
    const me = req.auth!;
    const [user] = await db.select({ homeRouteId: users.homeRouteId }).from(users).where(eq(users.id, me.userId));
    const group = me.role === 'student' ? 'students' : 'faculty';
    const conds = [eq(notices.audience, 'all'), eq(notices.audience, group)];
    if (user?.homeRouteId) conds.push(and(eq(notices.audience, 'route'), eq(notices.routeId, user.homeRouteId))!);
    res.json(await db.select({ id: notices.id, title: notices.title, body: notices.body, audience: notices.audience, publishedAt: notices.publishedAt })
      .from(notices).where(or(...conds)).orderBy(desc(notices.publishedAt)).limit(50));
  });

  /* ---------- tickets ---------- */

  r.post('/tickets', async (req, res) => {
    const kind = parse(z.enum(['complaint', 'suggestion', 'help']), req.body?.kind);
    const values = kind === 'help'
      ? (() => { const b = parse(helpCreateSchema, req.body); return { subject: b.subject, body: b.body }; })()
      : (() => { const b = parse(complaintCreateSchema, req.body); return { category: b.category, body: b.body, routeId: b.routeId ?? null, busCode: b.busCode ?? null, hideIdentityFromDriver: b.hideIdentityFromDriver }; })();
    const number = await nextTicketNumber(db, kind);
    const [t] = await db.insert(tickets).values({ number, kind, userId: req.auth!.userId, ...values }).returning({ id: tickets.id, number: tickets.number, status: tickets.status });
    ctx.realtime.emit('authority', 'ticket.created', { number: t!.number, kind });
    res.status(201).json(t);
  });

  r.get('/tickets', async (req, res) => {
    res.json(await db.select({ id: tickets.id, number: tickets.number, kind: tickets.kind, status: tickets.status, body: tickets.body, updatedAt: tickets.updatedAt })
      .from(tickets).where(eq(tickets.userId, req.auth!.userId)).orderBy(desc(tickets.updatedAt)));
  });

  r.get('/tickets/:id', async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [t] = await db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.userId, req.auth!.userId)));
    if (!t) throw notFound('Ticket');
    const messages = await db.select({ authorType: ticketMessages.authorType, body: ticketMessages.body, createdAt: ticketMessages.createdAt })
      .from(ticketMessages).where(eq(ticketMessages.ticketId, id)).orderBy(asc(ticketMessages.createdAt));
    res.json({ id: t.id, number: t.number, kind: t.kind, category: t.category, body: t.body, status: t.status, createdAt: t.createdAt, messages });
  });

  r.post('/tickets/:id/messages', async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(z.object({ body: z.string().trim().min(2).max(2000) }), req.body);
    const [t] = await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.id, id), eq(tickets.userId, req.auth!.userId)));
    if (!t) throw notFound('Ticket');
    await db.insert(ticketMessages).values({ ticketId: id, authorType: 'rider', authorId: req.auth!.userId, body: body.body });
    await db.update(tickets).set({ readByStaff: false, updatedAt: new Date() }).where(eq(tickets.id, id));
    res.status(201).json({ ok: true });
  });

  return r;
}
