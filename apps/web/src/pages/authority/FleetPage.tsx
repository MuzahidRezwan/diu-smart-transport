import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { todayDhaka } from '../../lib/format';
import type { Allocation, AvailabilityDay, BusRow } from '../../lib/types';
import { BusChip, Card, Loading, Pill } from '../../components/ui';

export function FleetPage() {
  const today = todayDhaka();
  const buses = useQuery({ queryKey: ['buses'], queryFn: () => api<BusRow[]>('/admin/fleet/buses') });
  const avail = useQuery({ queryKey: ['availability', today, 1], queryFn: () => api<AvailabilityDay[]>('/admin/fleet/availability', { query: { from: today, days: 1 } }) });
  const allocs = useQuery({ queryKey: ['allocations', today], queryFn: () => api<Allocation[]>('/admin/allocations', { query: { date: today } }) });
  if (buses.isLoading) return <Loading />;
  const out = new Map((avail.data?.[0]?.unavailable ?? []).map((u) => [u.code, u.reason]));
  const trips = new Map<string, number>();
  for (const a of allocs.data ?? []) for (const b of a.buses) trips.set(b.code, (trips.get(b.code) ?? 0) + 1);
  const list = buses.data ?? [];
  const active = list.filter((b) => b.isActive);
  return (
    <Card title="Total bus list" actions={<>
      <Pill tone="none">{list.length} buses</Pill>
      <Pill tone="ok">{active.length - out.size} available today</Pill>
      <Pill tone="info">{trips.size} allocated today</Pill>
    </>}>
      <div className="overflow-x-auto"><table className="data">
        <thead><tr><th>Bus</th><th>Operator</th><th>Seats</th><th>Pool</th><th>Driver</th><th>GPS</th><th>Today</th></tr></thead>
        <tbody>{list.map((b) => (
          <tr key={b.id}>
            <td><BusChip code={b.code} /></td><td>{b.operatorName}</td><td className="num">{b.seatCapacity}</td><td>{b.pool === 'faculty' ? 'Faculty' : 'Student'}</td>
            <td>{b.driverName ?? '—'}<div className="muted mono text-xs">{b.driverPhone}</div></td>
            <td className="text-xs">{b.gpsDeviceId ? <Pill tone="ok">Linked</Pill> : <Pill tone="none">No tracker</Pill>}</td>
            <td>{!b.isActive ? <Pill tone="none">Retired</Pill> : out.has(b.code) ? <Pill tone="crit">{out.get(b.code)}</Pill> : trips.get(b.code) ? <Pill tone="info">{trips.get(b.code)} trip(s)</Pill> : <Pill tone="ok">Free</Pill>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}
