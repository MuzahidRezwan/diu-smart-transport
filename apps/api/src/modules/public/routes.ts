/** Public information: routes, stops and departure times (no bus numbers). */
import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AUDIENCES, isoDate, toHHMM, weekdayOf } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { calendarEvents, routes, timeSlots } from '../../db/schema.js';
import { parse } from '../../lib/errors.js';
import { listRoutesWithStops } from '../routes/routes.js';
import { today } from '../common.js';

export async function slotsForDay(db: DB, date: string, filter: { routeId?: string; audience?: 'student' | 'faculty' } = {}) {
  const [closed] = await db.select().from(calendarEvents).where(and(eq(calendarEvents.date, date), eq(calendarEvents.cancelsService, true)));
  if (closed) return { closed: closed.title, slots: [] };
  const wd = weekdayOf(date);
  const rows = await db.select({ slot: timeSlots, routeCode: routes.code, routeName: routes.name, routeKind: routes.kind }).from(timeSlots)
    .innerJoin(routes, eq(routes.id, timeSlots.routeId))
    .where(and(eq(timeSlots.isActive, true), eq(routes.isActive, true), ...(filter.routeId ? [eq(timeSlots.routeId, filter.routeId)] : []), ...(filter.audience ? [eq(timeSlots.audience, filter.audience)] : [])))
    .orderBy(asc(timeSlots.departureMinutes));
  return {
    closed: null,
    slots: rows.filter((r) => r.slot.weekdays.includes(wd)).map((r) => ({
      timeSlotId: r.slot.id, routeId: r.slot.routeId, routeCode: r.routeCode, routeName: r.routeName, routeKind: r.routeKind,
      direction: r.slot.direction, audience: r.slot.audience, departure: toHHMM(r.slot.departureMinutes), departureMinutes: r.slot.departureMinutes,
    })),
  };
}

export function publicRouter(ctx: AppContext): Router {
  const r = Router();
  r.get('/routes', async (_req, res) => {
    res.set('cache-control', 'public, max-age=300');
    res.json((await listRoutesWithStops(ctx.db, true)).map(({ id, code, name, kind, durationMinutes, stops }) => ({ id, code, name, kind, durationMinutes, stops })));
  });
  r.get('/schedule', async (req, res) => {
    const q = parse(z.object({ routeId: z.string().uuid().optional(), date: isoDate.default(today()), audience: z.enum(AUDIENCES).optional() }), req.query);
    res.set('cache-control', 'public, max-age=60');
    res.json({ date: q.date, ...(await slotsForDay(ctx.db, q.date, q)) });
  });
  return r;
}
