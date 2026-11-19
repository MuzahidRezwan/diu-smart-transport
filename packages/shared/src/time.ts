/** Time helpers. Slot times are stored as minutes after midnight, Asia/Dhaka. */

export const DHAKA_TZ = 'Asia/Dhaka';

/** "07:30" -> 450. Throws on malformed input. */
export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 450 -> "07:30" */
export function toHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 450 -> "7:30 AM" */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export interface TimeWindow {
  start: number;
  end: number;
}

/** Half-open overlap: [a.start, a.end) and [b.start, b.end). Back-to-back windows do not overlap. */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * How long a bus is busy for one trip.
 * To campus: from departure until it reaches DSC plus turnaround.
 * From campus: it drives out and has to come back to DSC before it can serve another slot.
 */
export function busyWindow(
  direction: 'to_campus' | 'from_campus',
  departureMinutes: number,
  routeDurationMinutes: number,
  turnaroundMinutes = 30,
): TimeWindow {
  if (direction === 'to_campus') {
    return { start: departureMinutes, end: departureMinutes + routeDurationMinutes + turnaroundMinutes };
  }
  return { start: departureMinutes, end: departureMinutes + 2 * routeDurationMinutes };
}

/** YYYY-MM-DD of a Date in Dhaka time. */
export function dhakaDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DHAKA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Minutes after midnight, Dhaka time. */
export function dhakaMinutes(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: DHAKA_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD date string. */
export function weekdayOf(isoDate: string): number {
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDay();
}

/** Adds days to a YYYY-MM-DD string. */
export function addDays(isoDate: string, days: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y!, mo! - 1, d! + days));
  return t.toISOString().slice(0, 10);
}
