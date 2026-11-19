/**
 * Bus allocation rules:
 *  - a slot gets buses for one date, as a draft or published;
 *  - a bus cannot be in two slots whose busy windows overlap on the same date;
 *  - out-of-service buses cannot be allocated;
 *  - riders only ever see published allocations.
 */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { formatClock, pickBuses, weekdayOf } from '@diu/shared';
import type { DB } from '../../db/client.js';
import { allocationBuses, allocations, buses, calendarEvents, operators, routes, timeSlots } from '../../db/schema.js';
import { HttpError, unprocessable } from '../../lib/errors.js';
import { getSlotWithRoute, unavailableBusIds, windowFor } from '../common.js';

export interface AllocationInput {
  serviceDate: string;
  timeSlotId: string;
  busIds: string[];
  status: 'draft' | 'published';
  notes?: string;
}

export async function assertServiceRuns(db: DB, date: string, slot: { weekdays: number[]; isActive: boolean }) {
  if (!slot.isActive) throw unprocessable('This time slot is switched off');
  if (!slot.weekdays.includes(weekdayOf(date))) throw unprocessable('This slot does not run on that weekday');
  const [closed] = await db.select().from(calendarEvents).where(and(eq(calendarEvents.date, date), eq(calendarEvents.cancelsService, true)));
  if (closed) throw unprocessable(`No service on ${date}: ${closed.title}`);
}

/** Returns the conflicting slot for each bus that is busy elsewhere during this slot's window. */
export async function findConflicts(db: DB, date: string, busIds: string[], window: { start: number; end: number }, exceptAllocationId?: string) {
  if (!busIds.length) return [];
  const rows = await db.select({
    busId: allocationBuses.busId, start: allocationBuses.windowStart, end: allocationBuses.windowEnd,
    allocationId: allocationBuses.allocationId, busCode: buses.code, routeCode: routes.code, departure: timeSlots.departureMinutes,
  }).from(allocationBuses)
    .innerJoin(allocations, eq(allocations.id, allocationBuses.allocationId))
    .innerJoin(timeSlots, eq(timeSlots.id, allocations.timeSlotId))
    .innerJoin(routes, eq(routes.id, timeSlots.routeId))
    .innerJoin(buses, eq(buses.id, allocationBuses.busId))
    .where(and(
      eq(allocationBuses.serviceDate, date),
      inArray(allocationBuses.busId, busIds),
      ne(allocations.status, 'cancelled'),
      ...(exceptAllocationId ? [ne(allocationBuses.allocationId, exceptAllocationId)] : []),
    ));
  return rows.filter((r) => r.start < window.end && window.start < r.end)
    .map((r) => ({ busId: r.busId, busCode: r.busCode, busyWith: `${r.routeCode} at ${formatClock(r.departure)}` }));
}

export async function upsertAllocation(db: DB, input: AllocationInput, actor: string) {
  const { slot, route } = await getSlotWithRoute(db, input.timeSlotId);
  await assertServiceRuns(db, input.serviceDate, slot);
  const busIds = [...new Set(input.busIds)];
  const found = await db.select().from(buses).where(inArray(buses.id, busIds));
  if (found.length !== busIds.length) throw unprocessable('One or more buses do not exist');
  const inactive = found.filter((b) => !b.isActive).map((b) => b.code);
  if (inactive.length) throw unprocessable(`Retired buses cannot be allocated: ${inactive.join(', ')}`);
  const out = await unavailableBusIds(db, input.serviceDate);
  const down = found.filter((b) => out.has(b.id)).map((b) => `${b.code} (${out.get(b.id)})`);
  if (down.length) throw unprocessable(`Out of service on ${input.serviceDate}: ${down.join(', ')}`);

  const window = windowFor(slot, route);
  const [existing] = await db.select().from(allocations).where(and(eq(allocations.serviceDate, input.serviceDate), eq(allocations.timeSlotId, input.timeSlotId)));
  const clashes = await findConflicts(db, input.serviceDate, busIds, window, existing?.id);
  if (clashes.length) {
    throw new HttpError(409, 'bus_conflict', `Already on another trip at that time: ${clashes.map((c) => `${c.busCode} (${c.busyWith})`).join(', ')}`, clashes);
  }

  return db.transaction(async (tx) => {
    const values = {
      status: input.status,
      notes: input.notes ?? null,
      updatedBy: actor,
      updatedAt: new Date(),
      publishedAt: input.status === 'published' ? new Date() : null,
    };
    let allocationId: string;
    if (existing) {
      await tx.update(allocations).set(values).where(eq(allocations.id, existing.id));
      await tx.delete(allocationBuses).where(eq(allocationBuses.allocationId, existing.id));
      allocationId = existing.id;
    } else {
      const [row] = await tx.insert(allocations).values({ serviceDate: input.serviceDate, timeSlotId: input.timeSlotId, createdBy: actor, ...values }).returning({ id: allocations.id });
      allocationId = row!.id;
    }
    await tx.insert(allocationBuses).values(busIds.map((busId) => ({ allocationId, busId, serviceDate: input.serviceDate, windowStart: window.start, windowEnd: window.end })));
    return { allocationId, before: existing ?? null, routeId: route.id, routeName: route.name, departure: slot.departureMinutes, direction: slot.direction };
  });
}

export async function listAllocations(db: DB, date: string, onlyPublished = false) {
  const rows = await db.select({
    id: allocations.id, serviceDate: allocations.serviceDate, timeSlotId: allocations.timeSlotId, status: allocations.status,
    updatedBy: allocations.updatedBy, updatedAt: allocations.updatedAt, publishedAt: allocations.publishedAt, notes: allocations.notes,
  }).from(allocations).where(and(eq(allocations.serviceDate, date), ne(allocations.status, 'cancelled'), ...(onlyPublished ? [eq(allocations.status, 'published')] : [])));
  if (!rows.length) return [];
  const bs = await db.select({ allocationId: allocationBuses.allocationId, id: buses.id, code: buses.code, operatorCode: operators.code, capacity: buses.seatCapacity })
    .from(allocationBuses).innerJoin(buses, eq(buses.id, allocationBuses.busId)).innerJoin(operators, eq(operators.id, buses.operatorId))
    .where(inArray(allocationBuses.allocationId, rows.map((r) => r.id))).orderBy(asc(buses.code));
  return rows.map((r) => {
    const list = bs.filter((b) => b.allocationId === r.id).map(({ allocationId: _a, ...b }) => b);
    return { ...r, buses: list, seats: list.reduce((t, b) => t + b.capacity, 0) };
  });
}

/** Buses for the allocation drawer: each with whether it can be picked and why not. */
export async function busOptions(db: DB, date: string, timeSlotId: string) {
  const { slot, route } = await getSlotWithRoute(db, timeSlotId);
  const window = windowFor(slot, route);
  const [current] = await db.select().from(allocations).where(and(eq(allocations.serviceDate, date), eq(allocations.timeSlotId, timeSlotId)));
  const all = await db.select({ id: buses.id, code: buses.code, operatorCode: operators.code, capacity: buses.seatCapacity, pool: buses.pool, isActive: buses.isActive })
    .from(buses).innerJoin(operators, eq(operators.id, buses.operatorId)).orderBy(asc(buses.code));
  const active = all.filter((b) => b.isActive);
  const out = await unavailableBusIds(db, date);
  const clashes = new Map((await findConflicts(db, date, active.map((b) => b.id), window, current?.id)).map((c) => [c.busId, c.busyWith]));
  return {
    window,
    buses: active.map((b) => ({
      ...b,
      samePool: b.pool === slot.audience,
      blockedReason: out.has(b.id) ? `Out of service: ${out.get(b.id)}` : clashes.has(b.id) ? `On ${clashes.get(b.id)}` : null,
    })),
  };
}

/** Local fallback when the ML optimizer is unreachable: fill each empty slot in time order. */
export async function greedyPlan(db: DB, date: string, demands: { timeSlotId: string; target: number }[]) {
  const plans: { timeSlotId: string; busIds: string[]; seats: number; shortfall: number }[] = [];
  const reserved: { busId: string; start: number; end: number }[] = [];
  const slotRows = await Promise.all(demands.map(async (d) => ({ d, ...(await getSlotWithRoute(db, d.timeSlotId)) })));
  slotRows.sort((a, b) => a.slot.departureMinutes - b.slot.departureMinutes);
  for (const { d, slot, route } of slotRows) {
    const opts = await busOptions(db, date, d.timeSlotId);
    const w = windowFor(slot, route);
    const free = opts.buses.filter((b) => b.samePool && !b.blockedReason && !reserved.some((r) => r.busId === b.id && r.start < w.end && w.start < r.end));
    const picked = pickBuses(d.target, free.map((b) => ({ id: b.id, code: b.code, operatorCode: b.operatorCode, capacity: b.capacity })));
    const seats = picked.reduce((t, b) => t + b.capacity, 0);
    picked.forEach((b) => reserved.push({ busId: b.id!, start: w.start, end: w.end }));
    plans.push({ timeSlotId: d.timeSlotId, busIds: picked.map((b) => b.id!), seats, shortfall: Math.max(0, d.target - seats) });
  }
  return plans;
}

export async function deleteAllocation(db: DB, id: string) {
  const [row] = await db.select().from(allocations).where(eq(allocations.id, id));
  if (!row) return null;
  await db.delete(allocations).where(eq(allocations.id, id));
  return row;
}

