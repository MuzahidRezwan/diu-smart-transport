/**
 * Boarding scans by bus supervisors. Each scan is ground truth for the
 * prediction model (who actually rode which trip) and marks day passes used.
 */
import { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { boardingScanSchema, dhakaDate } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { boardingEvents, buses, dayPasses, semesters, transportCards, users } from '../../db/schema.js';
import { authenticate, requireRoles } from '../../auth/middleware.js';
import { decrypt } from '../../lib/crypto.js';
import { notFound, parse } from '../../lib/errors.js';
import { parseQrToken, verifyQrToken } from '../../lib/qr.js';
import { currentTrip } from '../tracking/routes.js';

export function boardingRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.db;
  r.use(authenticate(ctx), requireRoles('supervisor'));

  /** Buses a supervisor can pick for their trip (codes only). */
  r.get('/buses', async (_req, res) => {
    res.json(await db.select({ id: buses.id, code: buses.code }).from(buses).where(eq(buses.isActive, true)).orderBy(asc(buses.code)));
  });

  r.post('/scan', async (req, res) => {
    const body = parse(boardingScanSchema, req.body);
    const scannedAt = new Date(body.scannedAt);
    const serviceDate = dhakaDate(scannedAt);
    const [bus] = await db.select({ id: buses.id }).from(buses).where(eq(buses.id, body.busId));
    if (!bus) throw notFound('Bus');
    const trip = await currentTrip(db, bus.id, scannedAt);
    const record = async (valid: boolean, reason: string | null, ids: { userId?: string; cardId?: string; dayPassId?: string; name?: string }) => {
      await db.insert(boardingEvents).values({
        userId: ids.userId ?? null, cardId: ids.cardId ?? null, dayPassId: ids.dayPassId ?? null, busId: bus.id,
        timeSlotId: body.timeSlotId ?? trip?.timeSlotId ?? null, serviceDate, scannedAt, method: body.method, scannedBy: req.auth!.userId, valid, rejectReason: reason,
      });
      // The supervisor sees only what is needed at the door: valid or not, and the rider's name to match the card photo.
      res.json({ valid, reason, name: ids.name ?? null });
    };

    const parsed = parseQrToken(body.qrToken);
    if (!parsed) return record(false, 'Not a DIU transport QR', {});

    if (parsed.kind === 'c') {
      const [row] = await db.select({ card: transportCards, name: users.name, current: semesters.isCurrent })
        .from(transportCards).innerJoin(users, eq(users.id, transportCards.userId)).innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
        .where(eq(transportCards.id, parsed.id));
      if (!row?.card.qrSecretEnc) return record(false, 'Unknown card', {});
      if (!verifyQrToken(body.qrToken, decrypt(ctx.config.dataKey, row.card.qrSecretEnc), scannedAt)) return record(false, 'QR expired or copied: ask the rider to open the app again', { userId: row.card.userId });
      const ids = { userId: row.card.userId, cardId: row.card.id, name: row.name };
      if (row.card.status !== 'active' || !row.current) return record(false, `Card is ${row.card.status}`, ids);
      if (row.card.expiresOn && row.card.expiresOn < serviceDate) return record(false, 'Card expired', ids);
      return record(true, null, ids);
    }

    const [row] = await db.select({ pass: dayPasses, name: users.name }).from(dayPasses).innerJoin(users, eq(users.id, dayPasses.userId)).where(eq(dayPasses.id, parsed.id));
    if (!row?.pass.qrSecretEnc) return record(false, 'Unknown pass', {});
    if (!verifyQrToken(body.qrToken, decrypt(ctx.config.dataKey, row.pass.qrSecretEnc), scannedAt)) return record(false, 'QR expired or copied', { userId: row.pass.userId });
    const ids = { userId: row.pass.userId, dayPassId: row.pass.id, name: row.name };
    if (!['approved', 'used'].includes(row.pass.status)) return record(false, `Pass is ${row.pass.status}`, ids);
    if (row.pass.travelDate !== serviceDate) return record(false, `Pass is for ${row.pass.travelDate}`, ids);
    if (trip && trip.routeId !== row.pass.routeId) return record(false, 'Pass is for another route', ids);
    if (row.pass.status === 'approved') await db.update(dayPasses).set({ status: 'used', usedAt: scannedAt }).where(and(eq(dayPasses.id, row.pass.id), sql`${dayPasses.usedAt} is null`));
    return record(true, null, ids);
  });

  return r;
}
