import { Router } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { allocationUpsertSchema, formatClock, isoDate, publishDaySchema, suggestAllocationSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { allocations, buses, operators, predictions, routes, timeSlots } from '../../db/schema.js';
import { can, requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound, parse } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { notify } from '../../notifications/push.js';
import { actorId, getSlotWithRoute, unavailableBusIds, windowFor } from '../common.js';
import { busOptions, deleteAllocation, greedyPlan, listAllocations, upsertAllocation } from './service.js';

export function allocationsRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/allocations', requirePermission('dashboard.view'), async (req, res) => {
    const q = parse(z.object({ date: isoDate }), req.query);
    res.json(await listAllocations(db, q.date));
  });

  r.get('/allocations/options', requirePermission('allocation.manage'), async (req, res) => {
    const q = parse(z.object({ date: isoDate, timeSlotId: z.string().uuid() }), req.query);
    res.json(await busOptions(db, q.date, q.timeSlotId));
  });

  r.put('/allocations', requirePermission('allocation.manage'), async (req, res) => {
    const body = parse(allocationUpsertSchema, req.body);
    if (body.status === 'published' && !can(req, 'allocation.publish')) throw forbidden('Needs permission: allocation.publish');
    const result = await upsertAllocation(db, body, actorId(req));
    await audit(db, { actorId: actorId(req), action: `allocation.${body.status === 'published' ? 'published' : 'saved_draft'}`, entity: 'allocation', entityId: result.allocationId, before: result.before, after: body, req });
    if (body.status === 'published') {
      const codes = (await db.select({ code: buses.code }).from(buses).where(inArray(buses.id, body.busIds))).map((b) => b.code);
      const where = result.direction === 'to_campus' ? `${result.routeName} → DSC` : `DSC → ${result.routeName}`;
      await notify(ctx.db, ctx.push, { kind: 'route', routeId: result.routeId }, {
        title: `Buses for ${formatClock(result.departure)} (${body.serviceDate})`,
        body: `${where}: ${codes.join(', ')}`,
        data: { type: 'allocation', date: body.serviceDate, timeSlotId: body.timeSlotId },
      });
      ctx.realtime.emit(`route:${result.routeId}`, 'allocation.published', { date: body.serviceDate, timeSlotId: body.timeSlotId, buses: codes });
    }
    const [view] = (await listAllocations(db, body.serviceDate)).filter((a) => a.id === result.allocationId);
    res.json(view);
  });

  r.post('/allocations/publish-day', requirePermission('allocation.publish'), async (req, res) => {
    const body = parse(publishDaySchema, req.body);
    const drafts = await db.update(allocations).set({ status: 'published', publishedAt: new Date(), updatedBy: actorId(req), updatedAt: new Date() })
      .where(and(eq(allocations.serviceDate, body.serviceDate), eq(allocations.status, 'draft'))).returning({ id: allocations.id, timeSlotId: allocations.timeSlotId });
    await audit(db, { actorId: actorId(req), action: 'allocation.published_day', entity: 'allocation', entityId: body.serviceDate, after: { count: drafts.length }, req });
    if (drafts.length) {
      const routeIds = new Set((await db.select({ routeId: timeSlots.routeId }).from(timeSlots).where(inArray(timeSlots.id, drafts.map((d) => d.timeSlotId)))).map((x) => x.routeId));
      for (const routeId of routeIds) {
        await notify(ctx.db, ctx.push, { kind: 'route', routeId }, { title: `Bus allocation published for ${body.serviceDate}`, body: 'Open the app to see your buses.', data: { type: 'allocation', date: body.serviceDate } });
        ctx.realtime.emit(`route:${routeId}`, 'allocation.published', { date: body.serviceDate });
      }
    }
    res.json({ published: drafts.length });
  });

  /** Fills slots with the optimizer's plan as drafts. The authority reviews, then publishes. */
  r.post('/allocations/suggest', requirePermission('allocation.manage'), async (req, res) => {
    const body = parse(suggestAllocationSchema, req.body);
    const settings = await getSettings(db);
    const preds = await db.select({ p: predictions, slot: timeSlots, route: routes }).from(predictions)
      .innerJoin(timeSlots, eq(timeSlots.id, predictions.timeSlotId)).innerJoin(routes, eq(routes.id, timeSlots.routeId))
      .where(eq(predictions.serviceDate, body.serviceDate));
    if (!preds.length) {
      res.status(422).json({ error: { code: 'no_prediction', message: 'No prediction for this date yet. Run the forecast first.' } });
      return;
    }
    const existing = await listAllocations(db, body.serviceDate);
    const filled = new Set(existing.filter((a) => a.buses.length).map((a) => a.timeSlotId));
    const todo = preds.filter((x) => !body.onlyEmpty || !filled.has(x.p.timeSlotId));
    const target = (p90: number) => Math.ceil(p90 * (1 + settings.allocationBufferPct));

    let plan: { timeSlotId: string; busIds: string[]; seats: number; shortfall: number }[];
    let source: string;
    try {
      const fleet = await db.select({ busId: buses.id, code: buses.code, operatorCode: operators.code, capacity: buses.seatCapacity, pool: buses.pool })
        .from(buses).innerJoin(operators, eq(operators.id, buses.operatorId)).where(eq(buses.isActive, true));
      const out = await unavailableBusIds(db, body.serviceDate);
      const result = await ctx.ml.plan({
        date: body.serviceDate,
        slots: todo.map((x) => { const w = windowFor(x.slot, x.route); return { timeSlotId: x.p.timeSlotId, demand: x.p.p90, windowStart: w.start, windowEnd: w.end, audience: x.slot.audience }; }),
        buses: fleet.filter((b) => !out.has(b.busId)),
        fixed: existing.filter((a) => a.buses.length).map((a) => ({ timeSlotId: a.timeSlotId, busIds: a.buses.map((b) => b.id) })),
        bufferPct: settings.allocationBufferPct,
      });
      plan = result.assignments;
      source = `ml:${result.status}`;
    } catch (err) {
      req.log?.warn({ err }, 'ML optimizer unavailable, using greedy plan');
      plan = await greedyPlan(db, body.serviceDate, todo.map((x) => ({ timeSlotId: x.p.timeSlotId, target: target(x.p.p90) })));
      source = 'greedy';
    }

    let saved = 0;
    const shortfalls: { timeSlotId: string; shortfall: number }[] = [];
    for (const a of plan) {
      if (a.shortfall > 0) shortfalls.push({ timeSlotId: a.timeSlotId, shortfall: a.shortfall });
      if (!a.busIds.length) continue;
      try {
        await upsertAllocation(db, { serviceDate: body.serviceDate, timeSlotId: a.timeSlotId, busIds: a.busIds, status: 'draft' }, actorId(req));
        saved++;
      } catch {
        shortfalls.push({ timeSlotId: a.timeSlotId, shortfall: -1 });
      }
    }
    await audit(db, { actorId: actorId(req), action: 'allocation.suggested', entity: 'allocation', entityId: body.serviceDate, after: { saved, source }, req });
    res.json({ saved, source, shortfalls });
  });

  r.delete('/allocations/:id', requirePermission('allocation.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const before = await deleteAllocation(db, id);
    if (!before) throw notFound('Allocation');
    await audit(db, { actorId: actorId(req), action: 'allocation.deleted', entity: 'allocation', entityId: id, before, req });
    if (before.status === 'published') {
      const { route, slot } = await getSlotWithRoute(db, before.timeSlotId);
      await notify(ctx.db, ctx.push, { kind: 'route', routeId: route.id }, { title: `Bus change for ${formatClock(slot.departureMinutes)}`, body: 'The buses for this trip were withdrawn. Check the app for updates.', data: { type: 'allocation', date: before.serviceDate } });
      ctx.realtime.emit(`route:${route.id}`, 'allocation.withdrawn', { date: before.serviceDate, timeSlotId: before.timeSlotId });
    }
    res.json({ ok: true });
  });

  return r;
}
