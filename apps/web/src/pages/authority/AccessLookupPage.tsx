import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { universityId as universityIdSchema } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, dayLabel, taka } from '../../lib/format';
import type { AccessLookup } from '../../lib/types';
import { Card, ErrorNote, Loading, Pill, ReasonDialog, useToast, type Tone } from '../../components/ui';

const TONE: Record<string, Tone> = { success: 'ok', failed: 'crit', initiated: 'warn', cancelled: 'none', refunded: 'none', active: 'ok', expired: 'none', revoked: 'crit', pending_approval: 'warn', pending_payment: 'warn', rejected: 'crit', approved: 'ok', used: 'none', pending: 'warn' };
const label = (s: string) => s.replaceAll('_', ' ');

export function AccessLookupPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'grant' | 'revoke' | null>(null);
  const valid = universityIdSchema.safeParse(input.trim()).success;
  const q = useQuery({ queryKey: ['access', id], queryFn: () => api<AccessLookup>(`/admin/access/${id}`), enabled: Boolean(id), retry: false });

  return (
    <Card title="Transport access lookup">
      <div className="grid max-w-4xl gap-4">
        <p className="rounded-lg px-3 py-2.5 font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          Only transport access is shown here. Student and faculty profiles (phone, department, batch, photo, results) stay in the university system. Nobody in the transport office can open or edit a rider's account.
        </p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) setId(input.trim()); }}>
          <label className="field w-full max-w-sm" htmlFor="uid">Full university ID<input id="uid" className="input mono" autoComplete="off" placeholder="e.g. 232-35-797" value={input} onChange={(e) => setInput(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={!valid}>Look up</button>
        </form>
        <p className="muted m-0 text-xs">Partial IDs and names are not searchable, so nobody can browse the rider list. Every lookup is recorded in the audit log.</p>
        {q.isLoading && <Loading />}
        {q.error ? <ErrorNote error={q.error} /> : null}
        {q.data && <Result data={q.data} canChange={can('access.grant_revoke')} onGrant={() => setDialog('grant')} onRevoke={() => setDialog('revoke')} />}
      </div>
      {dialog && q.data && (
        <ReasonDialog title={dialog === 'grant' ? 'Give free transport access' : 'Revoke transport access'}
          subject={<>ID <b className="mono">{q.data.rider.universityId}</b> · {q.data.rider.name}. Only this semester's transport card changes; the rider's profile and account are untouched.</>}
          onCancel={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api(`/admin/access/${q.data!.rider.universityId}/${dialog}`, { body: { reason } });
            await qc.invalidateQueries({ queryKey: ['access', id] });
            toast(`ID ${q.data!.rider.universityId}: access ${dialog === 'grant' ? 'given' : 'revoked'} · reason saved in audit log`);
            setDialog(null);
          }} />
      )}
    </Card>
  );
}

function Result({ data, canChange, onGrant, onRevoke }: { data: AccessLookup; canChange: boolean; onGrant(): void; onRevoke(): void }) {
  const { rider, history } = data;
  const s = history.summary;
  const current = history.cards[0];
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto"><table className="data">
        <thead><tr><th>ID</th><th>Name</th><th>Rider type</th><th>Route</th><th>Transport access</th><th /></tr></thead>
        <tbody><tr>
          <td className="mono">{rider.universityId}</td><td><b>{rider.name}</b></td><td className="capitalize">{rider.riderType}</td><td>{rider.homeRoute ?? '—'}</td>
          <td><Pill tone={TONE[rider.cardStatus] ?? 'none'}>{label(rider.cardStatus)}</Pill></td>
          <td>{canChange && (rider.cardStatus === 'active' ? <button className="btn btn-sm btn-danger" onClick={onRevoke}>Revoke access</button> : <button className="btn btn-sm btn-primary" onClick={onGrant}>Give free access</button>)}</td>
        </tr></tbody>
      </table></div>

      <h3>Transport history</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="tile"><div className="tile-label">Total paid</div><div className="tile-big">{taka(s.totalPaidBdt)}</div><div className="muted text-xs">{s.payments} payment(s) · {s.semestersPaid} semester(s)</div></div>
        <div className="tile"><div className="tile-label">Last paid</div><div className="tile-big text-xl">{s.lastPaid ? dateTime(s.lastPaid.at) : 'Never'}</div><div className="muted text-xs">{s.lastPaid ? `${taka(s.lastPaid.amountBdt)} via ${s.lastPaid.method ?? '—'} · ${s.lastPaid.semester}` : 'No successful payment'}</div></div>
        <div className="tile"><div className="tile-label">This semester</div><div className="tile-big text-xl capitalize">{current ? label(current.status) : 'No card'}</div><div className="muted text-xs">{current?.source ? label(current.source) : ''}</div></div>
      </div>

      <Card title="Payments">
        {history.payments.length ? <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Date · time</th><th>Transaction ID</th><th>Semester</th><th className="text-right">Amount</th><th>Method</th><th>Status</th></tr></thead>
          <tbody>{history.payments.map((p) => (
            <tr key={p.tranId}><td className="num text-xs">{dateTime(p.paidAt ?? p.createdAt)}</td><td className="mono text-xs">{p.tranId}</td><td>{p.semester}</td><td className="num text-right"><b>{taka(p.amountBdt)}</b></td><td>{p.method ?? '—'}</td>
              <td><Pill tone={TONE[p.status] ?? 'none'}>{p.status === 'success' ? 'Successful' : label(p.status)}</Pill>{p.failureReason && <div className="muted text-xs">{p.failureReason}</div>}</td></tr>
          ))}</tbody></table></div> : <p className="muted">No payments on record.</p>}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Transport cards">
          {history.cards.length ? <table className="data"><thead><tr><th>Semester</th><th>Status</th><th>Valid until</th></tr></thead>
            <tbody>{history.cards.map((c) => <tr key={c.id}><td><b>{c.semesterName}</b><div className="muted text-xs">{c.route} · {c.source ? label(c.source) : c.reason}</div></td><td><Pill tone={TONE[c.status] ?? 'none'}>{label(c.status)}</Pill></td><td className="text-xs">{c.expiresOn ?? '—'}</td></tr>)}</tbody></table>
            : <p className="muted">Never had a transport card.</p>}
        </Card>
        <Card title="One Day Pass">
          {history.dayPasses.length ? <table className="data"><thead><tr><th>Date</th><th>Route</th><th>Status</th></tr></thead>
            <tbody>{history.dayPasses.map((d) => <tr key={d.travelDate}><td><b className="text-xs">{dayLabel(d.travelDate)}</b><div className="muted text-xs">{d.autoApproved ? 'Auto-approved' : d.reason}</div></td><td>{d.route}</td><td><Pill tone={TONE[d.status] ?? 'none'}>{d.status}</Pill></td></tr>)}</tbody></table>
            : <p className="muted">No day passes.</p>}
        </Card>
      </div>
      <Card title="Access changes by the transport office">
        {history.accessChanges.length ? history.accessChanges.map((a, i) => (
          <div key={i} className="grid grid-cols-[150px_1fr] gap-2.5 border-b border-line py-2 last:border-0"><span className="muted text-xs">{dateTime(a.at)}</span><div><b>{label(a.action.split('.')[1] ?? a.action)}</b> · by {a.actorName ?? 'System'}<div className="muted text-xs">Reason: {a.reason ?? '—'}</div></div></div>
        )) : <p className="muted">None. Grants, revokes and approvals without payment appear here with the reason.</p>}
      </Card>
    </div>
  );
}
