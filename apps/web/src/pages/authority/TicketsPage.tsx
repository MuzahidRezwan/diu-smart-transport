import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import type { Ticket } from '../../lib/types';
import { Card, ErrorNote, Loading, Modal, Pill, useToast } from '../../components/ui';

export function TicketsPage() {
  const kind = useParams().kind === 'help' ? 'help' : 'complaint';
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['tickets', kind], queryFn: () => api<{ unread: number; tickets: Ticket[] }>('/admin/tickets', { query: { kind } }) });
  return (
    <Card title={kind === 'help' ? 'Help requests' : 'Complaints & suggestions'} actions={list.data?.unread ? <span className="badge">{list.data.unread} unread</span> : null}>
      <p className="muted mt-0 text-xs">Shown by ticket number and route only. Your reply reaches the rider in their app inside the ticket, so their name and phone are not needed here.</p>
      {list.isLoading ? <Loading /> : !list.data?.tickets.length ? <p className="muted">Nothing here yet.</p> : list.data.tickets.map((t) => (
        <button key={t.id} className="grid w-full grid-cols-[1fr_auto] gap-2 border-b border-line py-2.5 text-left last:border-0" onClick={() => setOpen(t.id)}>
          <div>{!t.readByStaff && <Pill tone="crit">New</Pill>} <b>{t.number}</b>{t.route && <span className="muted"> · {t.route}</span>}{t.category && <span className="muted"> · {t.category.replaceAll('_', ' ')}</span>}
            <div className="line-clamp-2">{t.subject ? <b>{t.subject}: </b> : null}{t.body}</div></div>
          <div className="text-right"><Pill tone={t.status === 'resolved' || t.status === 'closed' ? 'ok' : t.status === 'in_progress' ? 'warn' : 'none'}>{t.status.replace('_', ' ')}</Pill><div className="muted text-xs">{dateTime(t.createdAt)}</div></div>
        </button>
      ))}
      {open && <TicketModal id={open} kind={kind} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function TicketModal({ id, kind, onClose }: { id: string; kind: string; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const t = useQuery({ queryKey: ['ticket', id], queryFn: () => api<Ticket>(`/admin/tickets/${id}`) });
  const reply = useMutation({
    mutationFn: (status?: string) => api(`/admin/tickets/${id}/reply`, { body: { body, status } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets', kind] }); qc.invalidateQueries({ queryKey: ['ticket', id] }); setBody(''); toast('Reply sent to the rider'); },
  });
  return (
    <Modal title={t.data ? `${t.data.number}${t.data.route ? ` · ${t.data.route}` : ''}` : 'Ticket'} onClose={onClose} width={640}>
      {t.isLoading ? <Loading /> : t.data && (
        <>
          <div className="tile"><div className="muted text-xs">{dateTime(t.data.createdAt)} · rider</div>{t.data.subject && <b>{t.data.subject}</b>}<p className="m-0">{t.data.body}</p></div>
          {(t.data.messages ?? []).map((m, i) => <div key={i} className="tile" style={m.authorType === 'staff' ? { background: 'var(--accent-soft)' } : undefined}><div className="muted text-xs">{dateTime(m.createdAt)} · {m.authorType === 'staff' ? 'Transport office' : 'Rider'}</div><p className="m-0">{m.body}</p></div>)}
          <label className="field" htmlFor="reply">Reply<textarea id="reply" className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          {reply.error ? <ErrorNote error={reply.error} /> : null}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={body.trim().length < 2 || reply.isPending} onClick={() => reply.mutate(undefined)}>Send reply</button>
            <button className="btn" disabled={body.trim().length < 2 || reply.isPending} onClick={() => reply.mutate('resolved')}>Send and mark resolved</button>
          </div>
        </>
      )}
    </Modal>
  );
}
