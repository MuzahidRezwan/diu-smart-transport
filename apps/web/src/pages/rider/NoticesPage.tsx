import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import type { Notice } from '../../lib/types';
import { ErrorNote, Loading } from '../../components/ui';

export function NoticesPage() {
  const q = useQuery({ queryKey: ['my-notices'], queryFn: () => api<Notice[]>('/me/notices'), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data?.length) return <p className="muted">No notices yet.</p>;
  return <>{q.data.map((n) => (
    <div key={n.id} className="card"><div className="flex gap-2"><b className="flex-1">{n.title}</b><span className="muted text-xs">{dateTime(n.publishedAt)}</span></div><p className="muted m-0 text-sm">{n.body}</p></div>
  ))}</>;
}
