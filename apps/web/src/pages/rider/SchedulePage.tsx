import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dhakaMinutes, formatClock } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, dayLabel, todayDhaka } from '../../lib/format';
import type { ScheduleSlot } from '../../lib/types';
import { BusChip, ErrorNote, Loading, Pill, Segmented } from '../../components/ui';

export function SchedulePage() {
  const { me } = useAuth();
  const today = todayDhaka();
  const nextDay = addDays(today, 1);
  const [date, setDate] = useState(today);
  const [service, setService] = useState<'student' | 'faculty'>(me?.role === 'student' ? 'student' : 'faculty');
  const q = useQuery({ queryKey: ['my-schedule', date, service], queryFn: () => api<{ slots: ScheduleSlot[]; closed: string | null; canSeeBuses: boolean }>('/me/schedule', { query: { date, audience: service } }) });
  const now = dhakaMinutes();
  const section = (dir: 'to_campus' | 'from_campus') => (q.data?.slots ?? []).filter((s) => s.direction === dir).map((s) => {
    const left = date === today && s.departureMinutes < now - 5;
    return (
      <div key={s.timeSlotId} className="card" style={left ? { opacity: 0.55 } : undefined}>
        <div className="flex items-center gap-2"><b className="num">{formatClock(s.departureMinutes)}</b><span className="text-xs">{dir === 'to_campus' ? `${s.routeName} → DSC` : `DSC → ${s.routeName}`}</span><span className="flex-1" />{s.audience === 'faculty' && <Pill tone="info">Staff only</Pill>}{left && <Pill tone="none">Left</Pill>}</div>
        {s.note && <div className="muted mt-1 text-xs">{s.note}</div>}
        {q.data!.canSeeBuses && <div className="mt-1.5 flex flex-wrap gap-1.5">{s.buses?.length ? s.buses.map((b) => <BusChip key={b.id} code={b.code} />) : <span className="muted text-xs">Buses not published yet</span>}</div>}
      </div>
    );
  });
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Segmented label="Day" value={date} onChange={setDate} options={[[today, 'Today'], [nextDay, dayLabel(nextDay)]]} />
        {me?.role !== 'student' && <Segmented label="Service" value={service} onChange={setService} options={[['faculty', 'Faculty'], ['student', 'Student']]} />}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : q.data!.closed ? <div className="card"><b>No service: {q.data!.closed}</b></div> : (
        <>
          <b className="muted text-xs">TO CAMPUS</b>{section('to_campus')}
          <b className="muted text-xs">TO HOME</b>{section('from_campus')}
        </>
      )}
    </>
  );
}
