import { describe, expect, it } from 'vitest';
import { busesForCapacity, computeBusRequirement, formatMix, pickBuses, type FleetBus } from '../src/bus-calculator.js';

const bus = (code: string, capacity: number): FleetBus => ({ code, operatorCode: code[0]!, capacity });
const fleet: FleetBus[] = [
  bus('H-10', 40), bus('H-12', 40), bus('H-14', 40),
  bus('M-03', 36), bus('M-05', 36),
  bus('S-01', 30), bus('S-02', 30), bus('S-03', 30),
];

describe('pickBuses', () => {
  it('uses the fewest buses, then the smallest bus that covers the rest', () => {
    // 100 seats: 40 + 40 leaves 20, smallest bus >= 20 is a 30-seater
    expect(pickBuses(100, fleet).map((b) => b.code)).toEqual(['H-10', 'H-12', 'S-01']);
  });

  it('picks one bus when one is enough, choosing the tightest fit', () => {
    expect(pickBuses(33, fleet).map((b) => b.code)).toEqual(['M-03']);
  });

  it('returns everything it has when demand exceeds the fleet', () => {
    expect(pickBuses(1000, fleet)).toHaveLength(fleet.length);
  });

  it('returns nothing for zero demand', () => {
    expect(pickBuses(0, fleet)).toEqual([]);
  });
});

describe('computeBusRequirement', () => {
  it('reports only-H, only-M, only-S and mixed options', () => {
    const r = computeBusRequirement(100, fleet);
    const h = r.singleOperator.find((o) => o.operatorCode === 'H')!;
    const m = r.singleOperator.find((o) => o.operatorCode === 'M')!;
    const s = r.singleOperator.find((o) => o.operatorCode === 'S')!;
    expect(h).toMatchObject({ busesNeeded: 3, feasible: true, seats: 120, emptySeats: 20 });
    expect(m).toMatchObject({ busesNeeded: 3, feasible: false, available: 2, shortfallSeats: 28 });
    expect(s).toMatchObject({ busesNeeded: 4, feasible: false, available: 3, shortfallSeats: 10 });
    expect(r.mixed).toMatchObject({ busesNeeded: 3, feasible: true, seats: 110, emptySeats: 10 });
    expect(formatMix(r.mixed.byOperator)).toBe('H×2 · S×1');
  });

  it('applies the safety buffer before choosing buses', () => {
    const r = computeBusRequirement(80, fleet, { bufferPct: 0.1 });
    expect(r.target).toBe(88);
    expect(r.mixed.seats).toBeGreaterThanOrEqual(88);
  });

  it('lists operators with no free bus when asked', () => {
    const r = computeBusRequirement(50, [bus('H-10', 40)], { operators: ['H', 'M', 'S'] });
    expect(r.singleOperator.map((o) => o.operatorCode)).toEqual(['H', 'M', 'S']);
    expect(r.singleOperator.find((o) => o.operatorCode === 'S')).toMatchObject({ available: 0, feasible: false });
  });

  it('rejects negative demand', () => {
    expect(() => computeBusRequirement(-1, fleet)).toThrow();
  });
});

describe('busesForCapacity', () => {
  it('rounds up', () => {
    expect(busesForCapacity(1000, 40)).toBe(25);
    expect(busesForCapacity(1001, 40)).toBe(26);
    expect(busesForCapacity(0, 30)).toBe(0);
  });
});
