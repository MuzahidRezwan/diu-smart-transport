/**
 * Converts passenger demand into buses, using the real seat capacity of each bus.
 *
 * Used by the dashboard ("Only Hanif / Only Monir / Only Surjomukhi / Mixed")
 * and by the API when validating an allocation. The ML service solves the
 * full day with an optimizer; this is the per-slot view.
 */

export interface FleetBus {
  id?: string;
  code: string;
  operatorCode: string;
  capacity: number;
}

export interface SingleOperatorOption {
  operatorCode: string;
  /** Buses needed if only this operator's buses are used. */
  busesNeeded: number;
  /** Buses of this operator that are free for the slot. */
  available: number;
  feasible: boolean;
  seats: number;
  emptySeats: number;
  shortfallSeats: number;
  buses: FleetBus[];
}

export interface MixedOption {
  busesNeeded: number;
  feasible: boolean;
  seats: number;
  emptySeats: number;
  shortfallSeats: number;
  buses: FleetBus[];
  byOperator: Record<string, number>;
}

export interface BusRequirement {
  demand: number;
  /** Demand after the safety buffer; this is what the options cover. */
  target: number;
  singleOperator: SingleOperatorOption[];
  mixed: MixedOption;
}

export interface RequirementOptions {
  /** Extra seats on top of demand, e.g. 0.1 for +10%. Default 0. */
  bufferPct?: number;
  /** Operator codes to always report, even with no free bus (e.g. ['H', 'M', 'S']). */
  operators?: readonly string[];
}

const byCapacityDesc = (a: FleetBus, b: FleetBus) => b.capacity - a.capacity || a.code.localeCompare(b.code);

/**
 * Fewest buses first, then fewest empty seats.
 * Takes the largest buses while the remaining need is bigger than any single bus,
 * then the smallest bus that covers what is left.
 */
export function pickBuses(target: number, pool: readonly FleetBus[]): FleetBus[] {
  const avail = [...pool].filter((b) => b.capacity > 0).sort(byCapacityDesc);
  const chosen: FleetBus[] = [];
  let seats = 0;
  while (seats < target && avail.length) {
    const need = target - seats;
    // Smallest capacity that still covers the need; among equals, the lowest bus code.
    let best = Infinity;
    for (const b of avail) if (b.capacity >= need && b.capacity < best) best = b.capacity;
    const idx = best === Infinity ? 0 : avail.findIndex((b) => b.capacity === best);
    const [bus] = avail.splice(idx, 1);
    chosen.push(bus!);
    seats += bus!.capacity;
  }
  return chosen;
}

const sumSeats = (buses: readonly FleetBus[]) => buses.reduce((t, b) => t + b.capacity, 0);

export function computeBusRequirement(
  demand: number,
  freeFleet: readonly FleetBus[],
  options: RequirementOptions = {},
): BusRequirement {
  if (!Number.isFinite(demand) || demand < 0) throw new Error('demand must be a non-negative number');
  const target = Math.ceil(demand * (1 + (options.bufferPct ?? 0)));
  const operators = [...new Set([...(options.operators ?? []), ...freeFleet.map((b) => b.operatorCode)])].sort();

  const singleOperator = operators.map((op): SingleOperatorOption => {
    const own = freeFleet.filter((b) => b.operatorCode === op);
    const picked = pickBuses(target, own);
    const seats = sumSeats(picked);
    const feasible = seats >= target;
    // When the operator runs out, estimate the count with its typical (largest) bus.
    const typical = own.length ? Math.max(...own.map((b) => b.capacity)) : 0;
    const busesNeeded = feasible
      ? picked.length
      : typical > 0 ? picked.length + Math.ceil((target - seats) / typical) : 0;
    return {
      operatorCode: op,
      busesNeeded: target === 0 ? 0 : busesNeeded,
      available: own.length,
      feasible,
      seats,
      emptySeats: Math.max(0, seats - target),
      shortfallSeats: Math.max(0, target - seats),
      buses: picked,
    };
  });

  const mixedBuses = pickBuses(target, freeFleet);
  const mixedSeats = sumSeats(mixedBuses);
  const byOperator: Record<string, number> = {};
  for (const b of mixedBuses) byOperator[b.operatorCode] = (byOperator[b.operatorCode] ?? 0) + 1;

  return {
    demand,
    target,
    singleOperator,
    mixed: {
      busesNeeded: mixedBuses.length,
      feasible: mixedSeats >= target,
      seats: mixedSeats,
      emptySeats: Math.max(0, mixedSeats - target),
      shortfallSeats: Math.max(0, target - mixedSeats),
      buses: mixedBuses,
      byOperator,
    },
  };
}

/** Theoretical count with one bus size, e.g. "only 40-seat buses". */
export function busesForCapacity(demand: number, capacity: number): number {
  if (capacity <= 0) throw new Error('capacity must be positive');
  return Math.ceil(Math.max(0, demand) / capacity);
}

/** "H×3 · M×1" */
export function formatMix(byOperator: Record<string, number>): string {
  return Object.entries(byOperator)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([op, n]) => `${op}×${n}`)
    .join(' · ');
}
