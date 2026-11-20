import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { addDays, dayLabel, todayDhaka } from '../../lib/format';
import type { Allocation, AvailabilityDay } from '../../lib/types';
import { BusChip, Card, Loading, Pill } from '../../components/ui';

export function AvailabilityPage() {
  const today = todayDhaka();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const avail = useQuery({ queryKey: ['availability', today, 7], queryFn: () => api<AvailabilityDay[]>('/admin/fleet/availability', { query: { from: today, days: 7 } }) });
  const allocs = useQueries({ queries: dates.map((d) => ({ queryKey: ['allocations', d], queryFn: () => api<Allocation[]>('/admin/allocations', { query: { date: d } }) })) });
  if (avail.isLoading) return <Loading />;
  return (
    <>
      <Card title="Next 7 days availability">
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Date</th><th>Total</th><th>Out of service</th><th>Available</th></tr></thead>
          <tbody>{(avail.data ?? []).map((d) => (
            <tr key={d.date}><td><b>{dayLabel(d.date)}</b></td><td className="num">{d.total}</td>
              <td><div className="flex flex-wrap gap-1.5">{d.unavailable.length ? d.unavailable.map((u) => <span key={u.code} className="flex items-center gap-1"><BusChip code={u.code} /><span className="muted text-xs">{u.reason}</span></span>) : <span className="muted">None</span>}</div></td>
              <td className="num"><b>{d.available}</b></td></tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card title="Next 7 days allocation">
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Date</th><th>Trips with buses</th><th>Published</th><th>Drafts</th><th>Buses used</th></tr></thead>
          <tbody>{dates.map((d, i) => {
            const a = allocs[i]?.data ?? [];
            const used = new Set(a.flatMap((x) => x.buses.map((b) => b.code)));
            return <tr key={d}><td><b>{dayLabel(d)}</b></td><td className="num">{a.filter((x) => x.buses.length).length}</td>
              <td><Pill tone="ok">{a.filter((x) => x.status === 'published').length}</Pill></td><td><Pill tone={a.some((x) => x.status === 'draft') ? 'warn' : 'none'}>{a.filter((x) => x.status === 'draft').length}</Pill></td>
              <td className="num">{used.size}</td></tr>;
          })}</tbody>
        </table></div>
      </Card>
    </>
  );
}
