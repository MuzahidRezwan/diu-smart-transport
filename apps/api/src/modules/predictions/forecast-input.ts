/**
 * Builds the ML forecast request.
 *
 * This runs as a system process on the rider-side connection because matching
 * riders to routines needs department/batch/section. What leaves the API is
 * pseudonymous (riderKey = salted hash) and what comes back is only counts per
 * slot, so no personal data ever reaches the authority dashboard.
 */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { addDays } from '@diu/shared';
import type { DB } from '../../db/client.js';
import {
  boardingEvents, calendarEvents, classSessions, routes, routineVersions, semesters, timeSlots, transportCards, userProfiles, users,
} from '../../db/schema.js';
import { hmacHex } from '../../lib/crypto.js';
import type { ForecastRequest } from './ml-client.js';

export async function buildForecastRequest(db: DB, dates: string[], salt: Buffer, attendanceFactorColdStart: number): Promise<ForecastRequest> {
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;

  const riderRows = await db.select({
    userId: users.id, role: users.role, routeId: transportCards.routeId,
    department: userProfiles.department, batch: userProfiles.batch, section: userProfiles.section, teacherInitial: userProfiles.teacherInitial,
  }).from(transportCards)
    .innerJoin(semesters, and(eq(semesters.id, transportCards.semesterId), sql`${semesters.isCurrent}`))
    .innerJoin(users, eq(users.id, transportCards.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(transportCards.status, 'active'));

  const active = await db.select({ id: routineVersions.id }).from(routineVersions).where(eq(routineVersions.status, 'active'));
  const sessions = active.length
    ? await db.select().from(classSessions).where(inArray(classSessions.routineVersionId, active.map((a) => a.id)))
    : [];

  const slotRows = await db.select({ slot: timeSlots, route: routes }).from(timeSlots)
    .innerJoin(routes, eq(routes.id, timeSlots.routeId))
    .where(and(eq(timeSlots.isActive, true), eq(routes.isActive, true))).orderBy(asc(timeSlots.departureMinutes));

  const calendar = await db.select().from(calendarEvents).where(and(gte(calendarEvents.date, addDays(from, -120)), lte(calendarEvents.date, to)));

  const history = await db.select({
    date: boardingEvents.serviceDate, timeSlotId: boardingEvents.timeSlotId, boarded: sql<number>`count(*)::int`,
  }).from(boardingEvents)
    .where(and(gte(boardingEvents.serviceDate, addDays(from, -120)), eq(boardingEvents.valid, true)))
    .groupBy(boardingEvents.serviceDate, boardingEvents.timeSlotId);

  return {
    dates,
    riders: riderRows.map((r) => ({
      riderKey: hmacHex(salt, r.userId).slice(0, 16),
      audience: r.role === 'student' ? 'student' : 'faculty',
      routeId: r.routeId,
      department: r.department,
      batch: r.batch,
      section: r.section,
      teacherInitial: r.teacherInitial,
    })),
    sessions: sessions.map((s) => ({ department: s.department, batch: s.batch, section: s.section, teacherInitial: s.teacherInitial, weekday: s.weekday, startMinutes: s.startMinutes, endMinutes: s.endMinutes })),
    slots: slotRows.map(({ slot, route }) => ({
      timeSlotId: slot.id, routeId: route.id, direction: slot.direction, audience: slot.audience,
      departureMinutes: slot.departureMinutes, durationMinutes: route.durationMinutes, weekdays: slot.weekdays,
    })),
    calendar: calendar.map((c) => ({ date: c.date, kind: c.kind, cancelsService: c.cancelsService })),
    history: history.filter((h) => h.timeSlotId).map((h) => ({ date: h.date, timeSlotId: h.timeSlotId!, boarded: Number(h.boarded) })),
    attendanceFactorColdStart,
  };
}
