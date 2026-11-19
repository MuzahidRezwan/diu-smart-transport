import { computeBusRequirement, type FleetBus } from '@diu/shared';
import type { Allocation, BusRow, PredictionRow } from './types';
import type { Tone } from '../components/ui';

/**
 * Groups departures into "waves": departures closer than 45 minutes belong
 * together (Dhanmondi leaves 06:40 for the 7:00 wave, the shuttle at 07:15).
 */
export function waves(rows: PredictionRow[]): { start: number; rows: PredictionRow[] }[] {
  const sorted = [...rows].sort((a, b) => a.departureMinutes - b.departureMinutes);
  const groups: PredictionRow[][] = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    if (last && r.departureMinutes - last[last.length - 1]!.departureMinutes <= 45) last.push(r);
    else groups.push([r]);
  }
  // Name each wave after its most common departure, so "7:00 AM wave" even though Dhanmondi leaves at 6:40.
  return groups.map((g) => {
    const counts = new Map<number, number>();
    for (const r of g) counts.set(r.departureMinutes, (counts.get(r.departureMinutes) ?? 0) + 1);
    const start = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    return { start, rows: g };
  });
}

/** Buses needed for the busiest wave: buses repeat across waves, so this is the real constraint. */
export function peakRequirement(rows: PredictionRow[], fleet: BusRow[], unavailable: Set<string>, audience: 'student' | 'faculty') {
  const ws = waves(rows).map((w) => ({ start: w.start, seats: w.rows.reduce((t, r) => t + r.p90, 0) }));
  const peak = ws.sort((a, b) => b.seats - a.seats)[0];
  const pool: FleetBus[] = fleet.filter((b) => b.isActive && b.pool === audience && !unavailable.has(b.code))
    .map((b) => ({ id: b.id, code: b.code, operatorCode: b.operatorCode, capacity: b.seatCapacity }));
  if (!peak) return null;
  return { start: peak.start, seats: peak.seats, req: computeBusRequirement(peak.seats, pool, { operators: ['H', 'M', 'S'] }) };
}

export function coverage(row: PredictionRow, alloc: Allocation | undefined): { tone: Tone; text: string } {
  if (!alloc || !alloc.buses.length) return { tone: 'none', text: 'Not allocated' };
  const draft = alloc.status === 'draft' ? ' · draft' : '';
  if (alloc.seats >= row.p90) return { tone: alloc.status === 'draft' ? 'info' : 'ok', text: `Covered${draft}` };
  if (alloc.seats >= row.predicted) return { tone: 'warn', text: `Tight · ${row.p90 - alloc.seats} below P90${draft}` };
  return { tone: 'crit', text: `Short ${row.predicted - alloc.seats} seats${draft}` };
}
