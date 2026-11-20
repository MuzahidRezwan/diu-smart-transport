/**
 * Live bus tracking. GPS trackers sign each request with their own key:
 *   x-device-id, x-timestamp (unix seconds), x-signature = HMAC-SHA256(key, "<timestamp>.<raw body>")
 * Only buses are tracked, never riders.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte } from 'drizzle-orm';
import { dhakaDate, dhakaMinutes, gpsPingSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { allocationBuses, allocations, buses, gpsPings, operators, routes, timeSlots } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { decrypt, hmacHex, safeEqual } from '../../lib/crypto.js';
import { HttpError, parse, unauthorized } from '../../lib/errors.js';

export interface LivePosition {
  busId: string;
  code: string;
  operatorCode: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  recordedAt: string;
  trip: { routeId: string; routeCode: string; routeName: string; direction: string; departureMinutes: number } | null;
}

/** Last known position per bus (in-process cache; use Redis when running several API instances). */
const latest = new Map<string, LivePosition>();

/** The trip a bus is on right now, from today's published allocations. */
export async function currentTrip(db: DB, busId: string, at = new Date()) {
  const now = dhakaMinutes(at);
  const rows = await db.select({ routeId: routes.id, routeCode: routes.code, routeName: routes.name, routeKind: routes.kind, direction: timeSlots.direction, departureMinutes: timeSlots.departureMinutes, start: allocationBuses.windowStart, end: allocationBuses.windowEnd, timeSlotId: timeSlots.id })
    .from(allocationBuses)
    .innerJoin(allocations, eq(allocations.id, allocationBuses.allocationId))
    .innerJoin(timeSlots, eq(timeSlots.id, allocations.timeSlotId))
    .innerJoin(routes, eq(routes.id, timeSlots.routeId))
    .where(and(eq(allocationBuses.busId, busId), eq(allocationBuses.serviceDate, dhakaDate(at)), eq(allocations.status, 'published')));
  return rows.find((r) => r.start - 15 <= now && now <= r.end) ?? null;
}

/**
 * Demo only: the trip a simulated bus is replaying. When no bus is on the road, the
 * demo's GPS simulator (deploy/demo/gps-sim.mjs) replays upcoming trips and names
 * the time slot in the x-demo-trip header. Ignored unless DEMO_MODE is on, which
 * the API refuses in production.
 */
async function demoTrip(ctx: AppContext, req: Request) {
  const slotId = ctx.config.DEMO_MODE ? req.get('x-demo-trip') : undefined;
  if (!slotId || !z.string().uuid().safeParse(slotId).success) return null;
  const [row] = await ctx.db.select({ routeId: routes.id, routeCode: routes.code, routeName: routes.name, direction: timeSlots.direction, departureMinutes: timeSlots.departureMinutes })
    .from(timeSlots).innerJoin(routes, eq(routes.id, timeSlots.routeId)).where(eq(timeSlots.id, slotId));
  return row ?? null;
}

async function verifyDevice(ctx: AppContext, req: Request) {
  const deviceId = req.get('x-device-id') ?? '';
  const ts = Number(req.get('x-timestamp') ?? 0);
  const sig = req.get('x-signature') ?? '';
  if (!deviceId || !ts || !sig) throw unauthorized('Missing device signature');
  if (Math.abs(Date.now() / 1000 - ts) > 60) throw unauthorized('Stale request');
  const [bus] = await ctx.db.select({ id: buses.id, code: buses.code, operatorCode: operators.code, keyEnc: buses.deviceKeyEnc })
    .from(buses).innerJoin(operators, eq(operators.id, buses.operatorId)).where(eq(buses.gpsDeviceId, deviceId));
  if (!bus?.keyEnc) throw unauthorized('Unknown device');
  const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
  const expected = hmacHex(decrypt(ctx.config.dataKey, bus.keyEnc), `${ts}.${raw}`);
  if (!safeEqual(expected, sig)) throw unauthorized('Bad signature');
  return bus;
}

export function trackingRouter(ctx: AppContext) {
  const devices = Router();
  devices.post('/gps', async (req, res) => {
    const bus = await verifyDevice(ctx, req);
    const body = parse(gpsPingSchema, req.body);
    const recordedAt = new Date(body.recordedAt);
    if (recordedAt.getTime() > Date.now() + 120_000) throw new HttpError(400, 'bad_time', 'recordedAt is in the future');
    await ctx.db.insert(gpsPings).values({ busId: bus.id, lat: body.lat, lng: body.lng, speedKmh: body.speedKmh ?? null, heading: body.heading ?? null, recordedAt });
    const trip = (await demoTrip(ctx, req)) ?? await currentTrip(ctx.db, bus.id, recordedAt);
    const pos: LivePosition = {
      busId: bus.id, code: bus.code, operatorCode: bus.operatorCode, lat: body.lat, lng: body.lng, speedKmh: body.speedKmh ?? null, heading: body.heading ?? null,
      recordedAt: recordedAt.toISOString(),
      trip: trip ? { routeId: trip.routeId, routeCode: trip.routeCode, routeName: trip.routeName, direction: trip.direction, departureMinutes: trip.departureMinutes } : null,
    };
    latest.set(bus.id, pos);
    ctx.realtime.emit('authority', 'bus.position', pos);
    if (trip) ctx.realtime.emit(`route:${trip.routeId}`, 'bus.position', pos); // riders see buses only while on a trip
    res.status(204).end();
  });

  const admin = Router();
  admin.get('/tracking/live', requirePermission('tracking.view'), async (_req, res) => {
    const cutoff = new Date(Date.now() - 10 * 60_000);
    if (!latest.size) {
      // Warm the cache after a restart from the last 10 minutes of pings.
      const rows = await ctx.adminDb.select({ p: gpsPings, code: buses.code, operatorCode: operators.code }).from(gpsPings)
        .innerJoin(buses, eq(buses.id, gpsPings.busId)).innerJoin(operators, eq(operators.id, buses.operatorId))
        .where(gte(gpsPings.recordedAt, cutoff)).orderBy(desc(gpsPings.recordedAt));
      for (const r of rows) {
        if (latest.has(r.p.busId)) continue;
        const trip = await currentTrip(ctx.adminDb, r.p.busId, r.p.recordedAt);
        latest.set(r.p.busId, { busId: r.p.busId, code: r.code, operatorCode: r.operatorCode, lat: r.p.lat, lng: r.p.lng, speedKmh: r.p.speedKmh, heading: r.p.heading, recordedAt: r.p.recordedAt.toISOString(), trip: trip ? { routeId: trip.routeId, routeCode: trip.routeCode, routeName: trip.routeName, direction: trip.direction, departureMinutes: trip.departureMinutes } : null });
      }
    }
    res.json([...latest.values()].filter((p) => new Date(p.recordedAt) >= cutoff));
  });

  return { devices, admin };
}

/** Positions for one route's buses that are on a trip now (rider view). */
export function livePositionsForRoute(routeId: string): LivePosition[] {
  const cutoff = Date.now() - 10 * 60_000;
  return [...latest.values()].filter((p) => p.trip?.routeId === routeId && Date.parse(p.recordedAt) >= cutoff);
}
