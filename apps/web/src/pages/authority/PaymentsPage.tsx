import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { USER_CATEGORY_LABELS, type UserCategory } from '@diu/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, dateTime, taka, todayDhaka } from '../../lib/format';
import type { PaymentsReport } from '../../lib/types';
import { Card, ErrorNote, Loading, Pill, useToast, type Tone } from '../../components/ui';

const TONE: Record<string, Tone> = { success: 'ok', failed: 'crit', initiated: 'warn', refunded: 'none', cancelled: 'none' };

export function PaymentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const today = todayDhaka();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('success');
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const query = { from, to, status, method: method || undefined };
  const q = useQuery({ queryKey: ['payments', query], queryFn: () => api<PaymentsReport>('/admin/payments', { query }) });

  const exportAs = async (format: 'xlsx' | 'csv') => {
    setBusy(format); setError(null);
    try { const name = await download('/admin/payments/export', { ...query, format }); toast(`Downloaded ${name} · saved in audit log`); }
    catch (e) { setError(e); } finally { setBusy(null); }
  };
  const s = q.data?.summary;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="flex-1 text-lg">Payments & collection</h2>
        <div className="seg" role="group" aria-label="Quick dates">
          <button aria-pressed={from === today && to === today} onClick={() => { setFrom(today); setTo(today); }}>Today</button>
          <button aria-pressed={from === addDays(today, -1) && to === addDays(today, -1)} onClick={() => { setFrom(addDays(today, -1)); setTo(addDays(today, -1)); }}>Yesterday</button>
          <button aria-pressed={from === addDays(today, -6) && to === today} onClick={() => { setFrom(addDays(today, -6)); setTo(today); }}>Last 7 days</button>
        </div>
        <label className="field" htmlFor="from">From<input id="from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field" htmlFor="to">To<input id="to" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="field" htmlFor="status">Status<select id="status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="success">Successful</option><option value="failed">Failed</option><option value="initiated">Pending</option><option value="refunded">Refunded</option><option value="all">All</option></select></label>
        <label className="field" htmlFor="method">Method<select id="method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option>{['bKash', 'Nagad', 'Rocket', 'Card'].map((m) => <option key={m}>{m}</option>)}</select></label>
      </div>
      {q.error ? <ErrorNote error={q.error} /> : null}
      {q.isLoading || !s ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="tile"><div className="tile-label">Riders paid</div><div className="tile-big">{s.ridersPaid}</div><div className="muted text-xs">{from === to ? from : `${from} to ${to}`}</div></div>
            <div className="tile"><div className="tile-label">Total collected</div><div className="tile-big">{taka(s.totalBdt)}</div></div>
            <div className="tile"><div className="tile-label">Failed / pending</div><div className="tile-big">{s.failedOrPending}</div><div className="muted text-xs">Not counted in the total</div></div>
            <div className="tile"><div className="tile-label">Refunded</div><div className="tile-big">{s.refunded}</div></div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="By method"><table className="data"><tbody>{s.byMethod.map((m) => <tr key={m.method}><td><b>{m.method}</b></td><td className="num">{m.count} rider{m.count === 1 ? '' : 's'}</td><td className="num text-right"><b>{taka(m.amountBdt)}</b></td></tr>)}</tbody></table>{!s.byMethod.length && <p className="muted">No payments.</p>}</Card>
            <Card title="By rider type"><table className="data"><tbody>{s.byCategory.map((c) => <tr key={c.category}><td><b>{USER_CATEGORY_LABELS[c.category as UserCategory] ?? c.category}</b></td><td className="num">{c.count}</td><td className="num text-right"><b>{taka(c.amountBdt)}</b></td></tr>)}</tbody></table>{!s.byCategory.length && <p className="muted">No payments.</p>}</Card>
          </div>
          <Card title={`${q.data!.rows.length} payment${q.data!.rows.length === 1 ? '' : 's'} in this list`} actions={can('payments.export') ? <>
            <button className="btn btn-sm btn-primary" disabled={!q.data!.rows.length || Boolean(busy)} onClick={() => exportAs('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel (.xlsx)'}</button>
            <button className="btn btn-sm" disabled={!q.data!.rows.length || Boolean(busy)} onClick={() => exportAs('csv')}>{busy === 'csv' ? 'Preparing…' : 'Download CSV'}</button>
          </> : null}>
            <p className="muted mt-0 text-xs">The file has the same columns as this table. No phone, email or department. Every download is saved in the audit log with your name.</p>
            {error ? <ErrorNote error={error} /> : null}
            <div className="overflow-x-auto"><table className="data">
              <thead><tr><th>Time</th><th>Transaction ID</th><th>University ID</th><th>Name</th><th>Rider type · route</th><th className="text-right">Amount</th><th>Method</th><th>Status</th></tr></thead>
              <tbody>{q.data!.rows.map((p) => (
                <tr key={p.tranId}><td className="num text-xs">{dateTime(p.paidAt ?? p.createdAt)}</td><td className="mono text-xs">{p.tranId}</td><td className="mono">{p.universityId}</td><td>{p.name}</td>
                  <td className="text-xs">{USER_CATEGORY_LABELS[p.category as UserCategory] ?? '—'}<div className="muted">{p.route}</div></td><td className="num text-right"><b>{taka(p.amountBdt)}</b></td><td>{p.method ?? '—'}</td>
                  <td><Pill tone={TONE[p.status] ?? 'none'}>{p.status === 'success' ? 'Successful' : p.status}</Pill></td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        </>
      )}
    </section>
  );
}
