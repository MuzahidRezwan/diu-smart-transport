import { formatClock } from '@diu/shared';
import type { BusLite } from '../lib/types';
import { BusChip, Segmented } from './ui';

export interface RiderHomeData {
  name: string;
  universityId: string;
  routeName: string | null;
  stops: string[];
  hasCard: boolean;
  direction: 'to_campus' | 'from_campus';
  /** dayLabel is set when the next bus is not today (evening, Friday, holiday). */
  next: { departureMinutes: number; minutesUntil: number; label: string; dayLabel?: string | null } | null;
  buses: BusLite[];
  closed?: string | null;
}

const OPS: Record<string, string> = { H: 'Hanif', M: 'Monir', S: 'Surjomukhi' };

/** The "My Bus" card. Used by the rider portal and by the authority's read-only preview. */
export function RiderHome({ data, onDirection, readOnly }: { data: RiderHomeData; onDirection?(d: 'to_campus' | 'from_campus'): void; readOnly?: boolean }) {
  const stops = data.direction === 'to_campus' ? data.stops : [...data.stops].reverse();
  return (
    <div className="grid gap-3">
      <Segmented label="Direction" value={data.direction} onChange={(d) => onDirection?.(d)} options={[['to_campus', 'To campus'], ['from_campus', 'To home']]} />
      {data.closed && <div className="card"><b>No buses today: {data.closed}</b></div>}
      {!data.next ? (
        <div className="card"><b>No buses in this direction in the next 7 days.</b></div>
      ) : (
        <div className="card grid gap-2.5 border-0" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          <div className="flex text-xs font-extrabold"><span className="flex-1 opacity-85">{data.next.dayLabel ? 'NEXT BUS' : 'YOUR BUS'}</span><span>{data.next.dayLabel ?? (data.next.minutesUntil > 0 ? `in ${data.next.minutesUntil} min` : 'boarding now')}</span></div>
          <div className="num text-4xl font-bold">{formatClock(data.next.departureMinutes)}</div>
          <div className="font-bold">{data.next.label}</div>
          {data.hasCard ? (data.buses.length ? (
            <div className="grid gap-1.5 rounded-xl p-2.5" style={{ background: 'color-mix(in srgb, var(--accent-ink) 12%, transparent)' }}>
              {['H', 'M', 'S'].map((op) => {
                const list = data.buses.filter((b) => b.operatorCode === op);
                return list.length ? <div key={op} className="flex flex-wrap items-center gap-1.5"><span className="min-w-[76px] text-xs font-bold">{OPS[op]}</span>{list.map((b) => <span key={b.id} style={{ color: '#0e1a33' }}><BusChip code={b.code} /></span>)}</div> : null;
              })}
            </div>
          ) : <div className="text-xs font-bold">Buses not published yet · usually by 2:00 PM</div>) : <div className="text-xs font-bold opacity-90">Bus numbers are shown to card holders</div>}
        </div>
      )}
      {stops.length > 0 && (
        <div className="card">
          <b>Route{data.routeName ? ` · ${data.routeName}` : ''}</b>
          <ol className="mt-2 flex gap-0 overflow-x-auto pb-1">
            {stops.map((s, i) => (
              <li key={`${s}-${i}`} className="relative grid min-w-[72px] justify-items-center gap-1.5 text-center text-[11px] font-bold text-muted">
                <i className="z-[1] h-3.5 w-3.5 rounded-full border-[3px]" style={{ borderColor: 'var(--accent)', background: i === stops.length - 1 ? 'var(--accent)' : 'var(--surface)' }} />
                {i > 0 && <span className="absolute left-[-50%] top-1.5 h-0.5 w-full" style={{ background: 'var(--line)' }} />}
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}
      {readOnly && <p className="muted text-xs">Read-only preview with a sample account.</p>}
    </div>
  );
}
