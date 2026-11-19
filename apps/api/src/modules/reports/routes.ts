/** Aggregated reports. Never lists individual riders. */
import { Router } from 'express';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { allocationBuses, allocations, boardingEvents, buses, predictions, routes, timeSlots } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { parse } from '../../lib/errors.js';

export function reportsRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/reports/summary', requirePermission('reports.view'), async (req, res) => {
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);

    const ridership = await db.select({ routeCode: routes.code, routeName: routes.name, rides: sql<number>`count(*)::int` })
      .from(boardingEvents).innerJoin(timeSlots, eq(timeSlots.id, boardingEvents.timeSlotId)).innerJoin(routes, eq(routes.id, timeSlots.routeId))
      .where(and(gte(boardingEvents.serviceDate, q.from), lte(boardingEvents.serviceDate, q.to), eq(boardingEvents.valid, true)))
      .groupBy(routes.code, routes.name);

    // Predicted vs actual per slot-day, where both exist.
    const actual = await db.select({ date: boardingEvents.serviceDate, timeSlotId: boardingEvents.timeSlotId, boarded: sql<number>`count(*)::int` })
      .from(boardingEvents).where(and(gte(boardingEvents.serviceDate, q.from), lte(boardingEvents.serviceDate, q.to), eq(boardingEvents.valid, true)))
      .groupBy(boardingEvents.serviceDate, boardingEvents.timeSlotId);
    const preds = await db.select().from(predictions).where(and(gte(predictions.serviceDate, q.from), lte(predictions.serviceDate, q.to)));
    const seats = await db.select({ date: allocations.serviceDate, timeSlotId: allocations.timeSlotId, seats: sql<number>`sum(${buses.seatCapacity})::int` })
      .from(allocations).innerJoin(allocationBuses, eq(allocationBuses.allocationId, allocations.id)).innerJoin(buses, eq(buses.id, allocationBuses.busId))
      .where(and(gte(allocations.serviceDate, q.from), lte(allocations.serviceDate, q.to), eq(allocations.status, 'published')))
      .groupBy(allocations.serviceDate, allocations.timeSlotId);

    const pairs = actual.flatMap((a) => {
      const p = preds.find((x) => x.serviceDate === a.date && x.timeSlotId === a.timeSlotId);
      const s = seats.find((x) => x.date === a.date && x.timeSlotId === a.timeSlotId);
      return p ? [{ actual: Number(a.boarded), predicted: p.predicted, p90: p.p90, seats: s ? Number(s.seats) : null }] : [];
    });
    const absErr = pairs.reduce((t, x) => t + Math.abs(x.actual - x.predicted), 0);
    const totalActual = pairs.reduce((t, x) => t + x.actual, 0);
    res.json({
      from: q.from, to: q.to,
      ridership,
      accuracy: {
        slotDays: pairs.length,
        mae: pairs.length ? +(absErr / pairs.length).toFixed(2) : null,
        wape: totalActual ? +(absErr / totalActual).toFixed(3) : null,
        p90Coverage: pairs.length ? +(pairs.filter((x) => x.actual <= x.p90).length / pairs.length).toFixed(3) : null,
        overcrowdedTrips: pairs.filter((x) => x.seats !== null && x.actual > x.seats!).length,
        loadFactor: pairs.some((x) => x.seats) ? +(pairs.reduce((t, x) => t + x.actual, 0) / pairs.reduce((t, x) => t + (x.seats ?? 0), 0)).toFixed(3) : null,
      },
    });
  });

  return r;
}
