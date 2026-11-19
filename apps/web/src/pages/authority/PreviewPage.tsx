import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dhakaMinutes } from '@diu/shared';
import { api } from '../../lib/api';
import { routeLabel, todayDhaka } from '../../lib/format';
import type { Allocation, RouteInfo, ScheduleSlot } from '../../lib/types';
import { RiderHome } from '../../components/RiderHome';
import { Card, Loading, Segmented } from '../../components/ui';

/**
 * What riders see, with a sample account and today's published buses.
 * Read-only: it never opens a real rider's account and cannot change anything.
 */
export function PreviewPage() {
  const today = todayDhaka();
  const [routeId, setRouteId] = useState<string>('');
  const [audience, setAudience] = useState<'student' | 'faculty'>('student');
  const [dir, setDir] = useState<'to_campus' | 'from_campus'>(dhakaMinutes() < 720 ? 'to_campus' : 'from_campus');
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const route = routes.data?.find((r) => r.id === routeId) ?? routes.data?.[0];
  const schedule = useQuery({ queryKey: ['schedule-public', today, route?.id, audience], queryFn: () => api<{ slots: ScheduleSlot[]; closed: string | null }>('/schedule', { query: { date: today, routeId: route!.id, audience } }), enabled: Boolean(route) });
  const allocs = useQuery({ queryKey: ['allocations', today], queryFn: () => api<Allocation[]>('/admin/allocations', { query: { date: today } }) });
  if (!route) return <Loading />;
  const now = dhakaMinutes();
  const next = (schedule.data?.slots ?? []).find((s) => s.direction === dir && s.departureMinutes >= now - 5);
  const published = (allocs.data ?? []).find((a) => a.timeSlotId === next?.timeSlotId && a.status === 'published');
  return (
    <Card title="Rider app preview" actions={<>
      <Segmented label="Service" value={audience} onChange={setAudience} options={[['student', 'Student'], ['faculty', 'Faculty']]} />
      <select className="input w-auto" value={route.id} onChange={(e) => setRouteId(e.target.value)} aria-label="Route">{routes.data!.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
    </>}>
      <p className="rounded-lg px-3 py-2.5 font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>Sample account, read-only. Real riders' apps cannot be opened from the dashboard. Only published buses appear, exactly as riders see them.</p>
      <div className="mx-auto mt-3 w-full max-w-sm rounded-[36px] border-[10px] p-4" style={{ borderColor: '#0d1424', background: 'var(--bg)' }}>
        <div className="mb-3"><b>Sample {audience === 'faculty' ? 'Faculty' : 'Student'}</b><div className="muted text-xs">ID 000-00-000 · Route: {route.name}</div></div>
        <RiderHome readOnly onDirection={setDir} data={{
          name: 'Sample', universityId: '000-00-000', routeName: route.name, stops: [...route.stops.map((s) => s.name)], hasCard: true, direction: dir,
          closed: schedule.data?.closed, buses: published?.buses ?? [],
          next: next ? { departureMinutes: next.departureMinutes, minutesUntil: next.departureMinutes - now, label: routeLabel(next.direction, route.name) } : null,
        }} />
      </div>
    </Card>
  );
}
