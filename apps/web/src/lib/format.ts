import { formatClock, parseHHMM } from '@diu/shared';

export const clock = (hhmm: string) => formatClock(parseHHMM(hhmm));
export const taka = (n: number) => `৳${n.toLocaleString('en-IN')}`;
export const nf = (n: number) => n.toLocaleString('en-US');

/** Today's date in Dhaka as YYYY-MM-DD. */
export function todayDhaka(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(iso: string, long = false): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
    : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}


export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const routeLabel = (direction: string, routeName: string) => (direction === 'to_campus' ? `${routeName} → DSC` : `DSC → ${routeName}`);
