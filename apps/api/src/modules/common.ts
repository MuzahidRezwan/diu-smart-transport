import { and, eq, gte, lte } from 'drizzle-orm';
import type { Request } from 'express';
import { busyWindow, dhakaDate } from '@diu/shared';
import type { DB } from '../db/client.js';
import { busUnavailability, routes, semesters, timeSlots } from '../db/schema.js';
import { notFound, unprocessable } from '../lib/errors.js';

export const actorId = (req: Request): string => req.auth!.userId;
export const today = (): string => dhakaDate();

export async function currentSemester(db: DB) {
  const [s] = await db.select().from(semesters).where(eq(semesters.isCurrent, true));
  if (!s) throw unprocessable('No current semester is set. The transport office needs to set one.');
  return s;
}

export async function semesterForDate(db: DB, date: string) {
  const [s] = await db.select().from(semesters).where(and(lte(semesters.startsOn, date), gte(semesters.endsOn, date)));
  return s ?? null;
}

export async function getSlotWithRoute(db: DB, timeSlotId: string) {
  const [row] = await db.select({ slot: timeSlots, route: routes }).from(timeSlots)
    .innerJoin(routes, eq(routes.id, timeSlots.routeId)).where(eq(timeSlots.id, timeSlotId));
  if (!row) throw notFound('Time slot');
  return row;
}

/** Minutes during which a bus serving this slot cannot serve another one. */
export function windowFor(slot: { direction: 'to_campus' | 'from_campus'; departureMinutes: number }, route: { durationMinutes: number; turnaroundMinutes: number }) {
  return busyWindow(slot.direction, slot.departureMinutes, route.durationMinutes, route.turnaroundMinutes);
}

/** Bus IDs out of service on a date. */
export async function unavailableBusIds(db: DB, date: string): Promise<Map<string, string>> {
  const rows = await db.select({ busId: busUnavailability.busId, reason: busUnavailability.reason }).from(busUnavailability)
    .where(and(lte(busUnavailability.fromDate, date), gte(busUnavailability.toDate, date)));
  return new Map(rows.map((r) => [r.busId, r.reason]));
}

export function makeTranId(now = new Date()): string {
  const d = dhakaDate(now).slice(2).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `DIU-TC-${d}-${rand}`;
}
