/** Routes, stops and time slots (authority side). Riders read them through the public router. */
import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { parseHHMM, routeCreateSchema, routeUpdateSchema, timeSlotCreateSchema, timeSlotUpdateSchema, toHHMM } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { routeStops, routes, timeSlots } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound, parse } from '../../lib/errors.js';
import { actorId } from '../common.js';

export async function listRoutesWithStops(db: DB, onlyActive = false) {
  const rs = await db.select().from(routes).orderBy(asc(routes.code));
  const stops = await db.select().from(routeStops).orderBy(asc(routeStops.routeId), asc(routeStops.seq));
  return rs.filter((r) => !onlyActive || r.isActive).map((r) => ({
    ...r,
    stops: stops.filter((s) => s.routeId === r.id).map(({ name, lat, lng, seq }) => ({ seq, name, lat, lng })),
  }));
}

export async function listSlots(db: DB) {
  const rows = await db.select().from(timeSlots).orderBy(asc(timeSlots.departureMinutes));
  return rows.map((s) => ({ ...s, departureTime: toHHMM(s.departureMinutes) }));
}

export function routesAdminRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/routes', requirePermission('fleet.view'), async (_req, res) => { res.json(await listRoutesWithStops(db)); });

  r.post('/routes', requirePermission('routes.manage'), async (req, res) => {
    const { stops, ...route } = parse(routeCreateSchema, req.body);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(routes).values(route).onConflictDoNothing().returning();
      if (!row) throw conflict(`Route ${route.code} already exists`);
      await tx.insert(routeStops).values(stops.map((s, i) => ({ routeId: row.id, seq: i + 1, ...s })));
      return row;
    });
    await audit(db, { actorId: actorId(req), action: 'routes.created', entity: 'route', entityId: created.id, after: { ...created, stops }, req });
    res.status(201).json(created);
  });

  r.patch('/routes/:id', requirePermission('routes.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const { stops, ...patch } = parse(routeUpdateSchema, req.body);
    const [before] = await db.select().from(routes).where(eq(routes.id, id));
    if (!before) throw notFound('Route');
    await db.transaction(async (tx) => {
      if (Object.keys(patch).length) await tx.update(routes).set(patch).where(eq(routes.id, id));
      if (stops) {
        await tx.delete(routeStops).where(eq(routeStops.routeId, id));
        await tx.insert(routeStops).values(stops.map((s, i) => ({ routeId: id, seq: i + 1, ...s })));
      }
    });
    await audit(db, { actorId: actorId(req), action: 'routes.updated', entity: 'route', entityId: id, before, after: { ...patch, stops }, req });
    res.json((await listRoutesWithStops(db)).find((x) => x.id === id));
  });

  r.get('/slots', requirePermission('fleet.view'), async (_req, res) => { res.json(await listSlots(db)); });

  r.post('/slots', requirePermission('routes.manage'), async (req, res) => {
    const { departureTime, ...body } = parse(timeSlotCreateSchema, req.body);
    const [row] = await db.insert(timeSlots).values({ ...body, departureMinutes: parseHHMM(departureTime) }).returning();
    await audit(db, { actorId: actorId(req), action: 'slots.created', entity: 'time_slot', entityId: row!.id, after: row, req });
    res.status(201).json({ ...row, departureTime });
  });

  r.patch('/slots/:id', requirePermission('routes.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const { departureTime, ...body } = parse(timeSlotUpdateSchema, req.body);
    const [before] = await db.select().from(timeSlots).where(eq(timeSlots.id, id));
    if (!before) throw notFound('Time slot');
    const [after] = await db.update(timeSlots).set({ ...body, ...(departureTime ? { departureMinutes: parseHHMM(departureTime) } : {}) })
      .where(eq(timeSlots.id, id)).returning();
    await audit(db, { actorId: actorId(req), action: 'slots.updated', entity: 'time_slot', entityId: id, before, after, req });
    res.json({ ...after, departureTime: toHHMM(after!.departureMinutes) });
  });

  return r;
}
