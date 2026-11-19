import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPLAINT_CATEGORIES } from '@diu/shared';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import type { Ticket } from '../../lib/types';
import { ErrorNote, Pill, Segmented, useToast } from '../../components/ui';

export function SupportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'complaint' | 'suggestion' | 'help'>('complaint');
  const [form, setForm] = useState({ category: 'late_bus', subject: '', body: '', busCode: '', hideIdentityFromDriver: true });
  const [open, setOpen] = useState<string | null>(null);
  const mine = useQuery({ queryKey: ['my-tickets'], queryFn: () => api<Ticket[]>('/me/tickets') });
  const detail = useQuery({ queryKey: ['my-ticket', open], queryFn: () => api<Ticket>(`/me/tickets/${open}`), enabled: Boolean(open) });
  const send = useMutation({
    mutationFn: () => api<{ number: string }>('/me/tickets', { body: kind === 'help' ? { kind, subject: form.subject, body: form.body } : { kind, category: form.category, body: form.body, busCode: form.busCode || undefined, hideIdentityFromDriver: form.hideIdentityFromDriver } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['my-tickets'] }); toast(`Sent · ticket ${r.number}`); setForm({ ...form, subject: '', body: '', busCode: '' }); },
  });
  return (
    <>
      <form className="card grid gap-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <Segmented label="Type" value={kind} onChange={setKind} options={[['complaint', 'Complaint'], ['suggestion', 'Suggestion'], ['help', 'Help']]} />
        {kind === 'help'
          ? <label className="field" htmlFor="subj">Subject<input id="subj" className="input" required minLength={3} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
          : <div className="flex flex-wrap gap-2">
              <label className="field flex-1" htmlFor="cat">Category<select id="cat" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}</select></label>
              <label className="field" htmlFor="bus">Bus (optional)<input id="bus" className="input mono" placeholder="H-14" value={form.busCode} onChange={(e) => setForm({ ...form, busCode: e.target.value.toUpperCase() })} /></label>
            </div>}
        <label className="field" htmlFor="body">Details<textarea id="body" className="input" rows={4} required minLength={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Bus number, time and what happened" /></label>
        {kind !== 'help' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.hideIdentityFromDriver} onChange={(e) => setForm({ ...form, hideIdentityFromDriver: e.target.checked })} />Hide my name from the driver</label>}
        {send.error ? <ErrorNote error={send.error} /> : null}
        <button className="btn btn-primary justify-center" disabled={send.isPending}>Send</button>
      </form>
      <b>My tickets</b>
      {(mine.data ?? []).map((t) => (
        <button key={t.id} className="card text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
          <div className="flex gap-2"><b className="flex-1">{t.number}</b><Pill tone={t.status === 'resolved' ? 'ok' : t.status === 'in_progress' ? 'warn' : 'none'}>{t.status.replace('_', ' ')}</Pill></div>
          <p className="muted m-0 line-clamp-2 text-sm">{t.body}</p>
          {open === t.id && detail.data?.messages?.map((m, i) => <div key={i} className="tile mt-2"><div className="muted text-xs">{dateTime(m.createdAt)} · {m.authorType === 'staff' ? 'Transport office' : 'You'}</div>{m.body}</div>)}
        </button>
      ))}
    </>
  );
}
