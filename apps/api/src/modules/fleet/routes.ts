/** Operators, buses, availability and GPS device keys. */
import { Router } from 'express';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { busCreateSchema, busUnavailabilitySchema, busUpdateSchema, isoDate, operatorSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { allocationBuses, busUnavailability, buses, operators } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { encrypt, randomToken } from '../../lib/crypto.js';
import { conflict, notFound, parse } from '../../lib/errors.js';
import { actorId, unavailableBusIds } from '../common.js';

const busColumns = {
  id: buses.id, code: buses.code, operatorId: buses.operatorId, operatorCode: operators.code, operatorName: operators.name,
  seatCapacity: buses.seatCapacity, registrationNumber: buses.registrationNumber, driverName: buses.driverName,
  driverPhone: buses.driverPhone, gpsDeviceId: buses.gpsDeviceId, pool: buses.pool, isActive: buses.isActive,
};

export function fleetRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/fleet/operators', requirePermission('fleet.view'), async (_req, res) => {
    res.json(await db.select().from(operators).orderBy(asc(operators.code)));
  });

  r.post('/fleet/operators', requirePermission('fleet.manage'), async (req, res) => {
    const body = parse(operatorSchema, req.body);
    const [row] = await db.insert(operators).values(body).onConflictDoNothing().returning();
    if (!row) throw conflict(`Operator ${body.code} already exists`);
    await audit(db, { actorId: actorId(req), action: 'fleet.operator_created', entity: 'operator', entityId: row.id, after: row, req });
    res.status(201).json(row);
  });

  r.get('/fleet/buses', requirePermission('fleet.view'), async (_req, res) => {
    res.json(await db.select(busColumns).from(buses).innerJoin(operators, eq(operators.id, buses.operatorId)).orderBy(asc(buses.code)));
  });

  r.post('/fleet/buses', requirePermission('fleet.manage'), async (req, res) => {
    const body = parse(busCreateSchema, req.body);
    const [row] = await db.insert(buses).values(body).onConflictDoNothing().returning();
    if (!row) throw conflict(`Bus ${body.code} already exists`);
    await audit(db, { actorId: actorId(req), action: 'fleet.bus_created', entity: 'bus', entityId: row.id, after: row, req });
    res.status(201).json(row);
  });

  r.patch('/fleet/buses/:id', requirePermission('fleet.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(busUpdateSchema, req.body);
    const [before] = await db.select().from(buses).where(eq(buses.id, id));
    if (!before) throw notFound('Bus');
    const [after] = await db.update(buses).set(body).where(eq(buses.id, id)).returning();
    await audit(db, { actorId: actorId(req), action: 'fleet.bus_updated', entity: 'bus', entityId: id, before, after, req });
    res.json(after);
  });

  /** Issues a new signing key for the bus's GPS tracker. Shown once; stored encrypted. */
  r.post('/fleet/buses/:id/device-key', requirePermission('fleet.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(z.object({ gpsDeviceId: z.string().trim().min(3).max(64) }), req.body);
    const key = randomToken(32);
    const [row] = await db.update(buses).set({ gpsDeviceId: body.gpsDeviceId, deviceKeyEnc: encrypt(ctx.config.dataKey, key) }).where(eq(buses.id, id)).returning({ id: buses.id });
    if (!row) throw notFound('Bus');
    await audit(db, { actorId: actorId(req), action: 'fleet.device_key_rotated', entity: 'bus', entityId: id, req });
    res.json({ gpsDeviceId: body.gpsDeviceId, deviceKey: key, note: 'Copy this key into the tracker now. It will not be shown again.' });
  });

  r.post('/fleet/buses/:id/unavailability', requirePermission('fleet.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(busUnavailabilitySchema, req.body);
    const clash = await db.select({ date: allocationBuses.serviceDate }).from(allocationBuses)
      .where(and(eq(allocationBuses.busId, id), gte(allocationBuses.serviceDate, body.fromDate), lte(allocationBuses.serviceDate, body.toDate)));
    const [row] = await db.insert(busUnavailability).values({ busId: id, ...body, createdBy: actorId(req) }).returning();
    await audit(db, { actorId: actorId(req), action: 'fleet.bus_unavailable', entity: 'bus', entityId: id, after: row, req });
    res.status(201).json({ ...row, warning: clash.length ? `This bus is allocated on ${[...new Set(clash.map((c) => c.date))].join(', ')}. Replace it in those allocations.` : null });
  });

  r.delete('/fleet/unavailability/:id', requirePermission('fleet.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [row] = await db.delete(busUnavailability).where(eq(busUnavailability.id, id)).returning();
    if (!row) throw notFound('Unavailability');
    await audit(db, { actorId: actorId(req), action: 'fleet.bus_available_again', entity: 'bus', entityId: row.busId, before: row, req });
    res.json({ ok: true });
  });

  /** Available = active and not marked unavailable, per day. */
  r.get('/fleet/availability', requirePermission('fleet.view'), async (req, res) => {
    const q = parse(z.object({ from: isoDate, days: z.coerce.number().int().min(1).max(14).default(7) }), req.query);
    const all = await db.select({ id: buses.id, code: buses.code, isActive: buses.isActive }).from(buses);
    const active = all.filter((b) => b.isActive);
    const out = [];
    for (let i = 0; i < q.days; i++) {
      const date = new Date(Date.parse(`${q.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
      const un = await unavailableBusIds(db, date);
      const allocated = new Set((await db.select({ busId: allocationBuses.busId }).from(allocationBuses).where(eq(allocationBuses.serviceDate, date))).map((x) => x.busId));
      out.push({
        date,
        total: active.length,
        unavailable: active.filter((b) => un.has(b.id)).map((b) => ({ code: b.code, reason: un.get(b.id) })),
        available: active.filter((b) => !un.has(b.id)).length,
        allocated: allocated.size,
      });
    }
    res.json(out);
  });

  return r;
}
