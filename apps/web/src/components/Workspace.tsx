import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, dayLabel } from '../lib/format';
import type { CardRequest, DayPassRequest, FeedItem, Notice, RouteInfo } from '../lib/types';
import { LiveMap } from './LiveMap';
import { Card, ErrorNote, Loading, Pill, ReasonDialog, useToast } from './ui';

type Tab = 'feed' | 'cards' | 'daypass' | 'live' | 'notice' | 'preview';

export function Workspace() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  const cards = useQuery({ queryKey: ['card-requests'], queryFn: () => api<CardRequest[]>('/admin/cards/requests'), enabled: can('cards.approve') });
  const passes = useQuery({ queryKey: ['day-passes', 'pending'], queryFn: () => api<DayPassRequest[]>('/admin/day-passes'), enabled: can('daypass.approve') });
  const tabs: [Tab, string, number | undefined, boolean][] = [
    ['feed', 'Feed', undefined, true],
    ['cards', 'Transport card requests', cards.data?.length, can('cards.approve')],
    ['daypass', 'One day pass requests', passes.data?.length, can('daypass.approve')],
    ['live', 'Live route', undefined, can('tracking.view')],
    ['notice', 'Notice', undefined, can('notices.publish')],
    ['preview', 'See student / faculty dashboard', undefined, true],
  ];
  return (
    <Card>
      <div className="tabs" role="tablist">
        {tabs.filter((t) => t[3]).map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{n ? <span className="badge">{n}</span> : null}</button>
        ))}
      </div>
      <div className="pt-3.5">
        {tab === 'feed' && <FeedTab />}
        {tab === 'cards' && <CardsTab rows={cards.data} loading={cards.isLoading} />}
        {tab === 'daypass' && <DayPassTab rows={passes.data} loading={passes.isLoading} />}
        {tab === 'live' && <LiveMap />}
        {tab === 'notice' && <NoticeTab />}
        {tab === 'preview' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="muted m-0 min-w-[260px] flex-1">See the rider app with a <b>sample account</b> and today's published buses. It is read-only: real students' and faculty members' apps cannot be opened from here.</p>
            <Link className="btn btn-primary" to="/admin/preview">Open preview</Link>
          </div>
        )}
      </div>
    </Card>
  );
}

function FeedTab() {
  const feed = useQuery({ queryKey: ['feed'], queryFn: () => api<FeedItem[]>('/admin/feed'), refetchInterval: 30_000 });
  if (feed.isLoading) return <Loading />;
  if (!feed.data?.length) return <p className="muted">No activity yet.</p>;
  return <div>{feed.data.map((f, i) => (
    <div key={i} className="grid grid-cols-[110px_1fr] gap-2.5 border-b border-line py-2.5 last:border-0">
      <span className="muted num text-xs">{dateTime(f.at)}</span>
      <div><Pill tone={f.kind}>{f.by}</Pill> <span className="ml-1.5">{f.text}</span></div>
    </div>
  ))}</div>;
}

function CardsTab({ rows, loading }: { rows?: CardRequest[]; loading: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [approving, setApproving] = useState<CardRequest | null>(null);
  const decide = async (r: CardRequest, decision: 'approve' | 'reject', reason: string) => {
    await api(`/admin/cards/${r.cardId}/decision`, { body: { decision, reason } });
    qc.invalidateQueries({ queryKey: ['card-requests'] });
    toast(`${r.universityId}: ${decision === 'approve' ? 'card approved' : 'request rejected'} · reason saved in audit log`);
  };
  const [rejecting, setRejecting] = useState<CardRequest | null>(null);
  if (loading) return <Loading />;
  return (
    <>
      <p className="muted mt-0 text-xs">Riders who paid are approved automatically and do not appear here. These need a decision.</p>
      {!rows?.length ? <p className="muted">No pending requests.</p> : (
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>ID</th><th>Name</th><th>Category · route</th><th>Payment</th><th>Note</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.cardId}>
              <td className="mono">{r.universityId}</td><td><b>{r.name}</b></td>
              <td>{r.category?.replaceAll('_', ' ')}<div className="muted text-xs">{r.route}</div></td>
              <td><Pill tone={r.status === 'pending_payment' ? 'warn' : 'none'}>{r.status === 'pending_payment' ? 'Payment pending' : 'Unpaid'}</Pill></td>
              <td className="muted text-xs">{r.note}</td>
              <td><div className="flex gap-1.5">
                {can('cards.grant_free') && <button className="btn btn-sm btn-primary" onClick={() => setApproving(r)}>Approve (free)</button>}
                <button className="btn btn-sm btn-danger" onClick={() => setRejecting(r)}>Reject</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {approving && <ReasonDialog title="Approve card without payment" subject={<>ID <b className="mono">{approving.universityId}</b> · {approving.name} · {approving.route}. Only this semester's card changes.</>} onCancel={() => setApproving(null)} onConfirm={async (reason) => { await decide(approving, 'approve', reason); setApproving(null); }} />}
      {rejecting && <ReasonDialog title="Reject card request" subject={<>ID <b className="mono">{rejecting.universityId}</b> · {rejecting.name}. The rider sees your reason.</>} onCancel={() => setRejecting(null)} onConfirm={async (reason) => { await decide(rejecting, 'reject', reason); setRejecting(null); }} />}
    </>
  );
}

function DayPassTab({ rows, loading }: { rows?: DayPassRequest[]; loading: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<{ row: DayPassRequest; decision: 'approve' | 'reject' } | null>(null);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ dayPassLimitPerSemester: number; dayPassOverLimit: string }>('/admin/settings') });
  if (loading) return <Loading />;
  return (
    <>
      <p className="muted mt-0 text-xs">Rule: the first {settings.data?.dayPassLimitPerSemester ?? 1} pass(es) per semester are approved automatically. Requests over the limit {settings.data?.dayPassOverLimit === 'reject' ? 'are rejected' : 'wait here'}. Change this in Settings.</p>
      {!rows?.length ? <p className="muted">No pending requests.</p> : (
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>ID</th><th>Name</th><th>Date · route</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="mono">{r.universityId}</td><td><b>{r.name}</b></td><td>{dayLabel(r.travelDate)}<div className="muted text-xs">{r.route}</div></td>
              <td><div className="flex gap-1.5"><button className="btn btn-sm btn-primary" onClick={() => setPending({ row: r, decision: 'approve' })}>Approve anyway</button><button className="btn btn-sm btn-danger" onClick={() => setPending({ row: r, decision: 'reject' })}>Reject</button></div></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {pending && <ReasonDialog title={pending.decision === 'approve' ? 'Approve extra day pass' : 'Reject day pass'} subject={<>ID <b className="mono">{pending.row.universityId}</b> · {dayLabel(pending.row.travelDate)} · {pending.row.route}</>}
        onCancel={() => setPending(null)}
        onConfirm={async (reason) => {
          await api(`/admin/day-passes/${pending.row.id}/decision`, { body: { decision: pending.decision, reason } });
          qc.invalidateQueries({ queryKey: ['day-passes'] });
          toast('Decision saved');
          setPending(null);
        }} />}
    </>
  );
}

function NoticeTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const notices = useQuery({ queryKey: ['notices'], queryFn: () => api<Notice[]>('/admin/notices') });
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', routeId: '' });
  const publish = useMutation({
    mutationFn: () => api<{ devicesNotified: number }>('/admin/notices', { body: { title: form.title, body: form.body, audience: form.audience.startsWith('route:') ? 'route' : form.audience, routeId: form.audience.startsWith('route:') ? form.audience.slice(6) : undefined } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['notices'] }); toast(`Notice published · ${r.devicesNotified} device(s) notified`); setForm({ title: '', body: '', audience: 'all', routeId: '' }); },
  });
  return (
    <div className="grid gap-4">
      <form className="grid max-w-2xl gap-3" onSubmit={(e) => { e.preventDefault(); publish.mutate(); }}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="field min-w-[220px] flex-1" htmlFor="n-title">Title<input id="n-title" className="input" required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. 6:00 PM Uttara trip delayed by 20 minutes" /></label>
          <label className="field" htmlFor="n-aud">Send to
            <select id="n-aud" className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              <option value="all">All users</option><option value="students">All students</option><option value="faculty">All faculty / staff</option>
              {(routes.data ?? []).map((r) => <option key={r.id} value={`route:${r.id}`}>Route {r.code} · {r.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field" htmlFor="n-body">Message<textarea id="n-body" className="input" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="What riders should do" /></label>
        <div><button className="btn btn-primary" disabled={publish.isPending}>Publish notice + push notification</button></div>
        {publish.error ? <ErrorNote error={publish.error} /> : null}
      </form>
      <div>
        <h3 className="mb-2">Published</h3>
        {(notices.data ?? []).map((n) => (
          <div key={n.id} className="grid grid-cols-[110px_1fr] gap-2.5 border-b border-line py-2.5 last:border-0">
            <span className="muted text-xs">{dateTime(n.publishedAt)}</span>
            <div><b>{n.title}</b> <Pill tone="info">{n.audience === 'route' ? `Route ${n.routeName}` : n.audience}</Pill><div className="muted text-xs">{n.body}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
