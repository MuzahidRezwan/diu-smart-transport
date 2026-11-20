import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dayLabel, routeLabel } from '../../lib/format';
import type { BusLite, RouteInfo, ScheduleSlot } from '../../lib/types';
import { RiderHome } from '../../components/RiderHome';
import { ErrorNote, Loading, Segmented } from '../../components/ui';
import { LiveMap } from '../../components/LiveMap';

interface MyBus { closed: string | null; direction: 'to_campus' | 'from_campus'; next: ScheduleSlot | null; serviceDate: string; isToday: boolean; minutesUntil: number | null; buses: BusLite[]; canSeeBuses: boolean; reason?: string }

export function MyBusPage() {
  const { me } = useAuth();
  const isStaff = me?.role !== 'student';
  const [dir, setDir] = useState<'to_campus' | 'from_campus' | undefined>(undefined);
  const [service, setService] = useState<'student' | 'faculty'>(isStaff ? 'faculty' : 'student');
  const q = useQuery({ queryKey: ['my-bus', dir, service], queryFn: () => api<MyBus>('/me/my-bus', { query: { direction: dir, audience: service } }), refetchInterval: 60_000 });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const route = routes.data?.find((r) => r.id === me?.homeRouteId);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!me?.homeRouteId) return (
    <div className="card grid gap-2"><b>Choose your route to get started</b><p className="muted m-0">Apply for a transport card or a One Day Pass and pick your route.</p><Link className="btn btn-primary justify-center" to="/app/card">Get a card or pass</Link></div>
  );
  const d = q.data!;
  return (
    <>
      {isStaff && <Segmented label="Service" value={service} onChange={setService} options={[['faculty', 'Faculty service'], ['student', 'Student service']]} />}
      {!d.canSeeBuses && (
        <div className="card grid gap-2" style={{ borderColor: 'var(--accent)' }}>
          <b>Get your transport card</b>
          <span className="muted text-xs">See bus numbers and live buses, and board with your QR. Approved instantly after payment.</span>
          <Link className="btn btn-primary justify-center" to="/app/card">Apply for transport card</Link>
        </div>
      )}
      <RiderHome onDirection={setDir} data={{
        name: me.name, universityId: me.universityId, routeName: route?.name ?? null, stops: route?.stops.map((s) => s.name) ?? [], hasCard: d.canSeeBuses, direction: d.direction, closed: d.closed, buses: d.buses,
        next: d.next && route ? { departureMinutes: d.next.departureMinutes, minutesUntil: d.minutesUntil ?? 0, label: routeLabel(d.next.direction, route.name), dayLabel: d.isToday ? null : dayLabel(d.serviceDate), note: d.next.note } : null,
      }} />
      <Link className="btn justify-center" to="/app/schedule">See today's bus schedule</Link>
      {d.canSeeBuses && <div className="card"><b>Live route</b><div className="mt-2"><LiveMap positionsPath="/me/live" routeFilter={me.homeRouteId} /></div></div>}
    </>
  );
}
