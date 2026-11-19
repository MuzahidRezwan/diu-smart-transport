import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { computeBusRequirement, formatClock, formatMix } from '@diu/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dayLabel, routeLabel } from '../lib/format';
import type { Allocation, BusOption, PredictionRow } from '../lib/types';
import { ErrorNote, Loading, useToast } from './ui';

const OPS: Record<string, string> = { H: 'Hanif', M: 'Monir', S: 'Surjomukhi' };

export function AllocationDrawer({ row, date, current, onClose }: { row: PredictionRow; date: string; current?: Allocation; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set(current?.buses.map((b) => b.id) ?? []));
  const options = useQuery({ queryKey: ['alloc-options', date, row.timeSlotId], queryFn: () => api<{ buses: BusOption[]; window: { start: number; end: number } }>('/admin/allocations/options', { query: { date, timeSlotId: row.timeSlotId } }) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const buses = options.data?.buses ?? [];
  const pool = buses.filter((b) => b.samePool);
  const seats = buses.filter((b) => selected.has(b.id)).reduce((t, b) => t + b.capacity, 0);
  const free = pool.filter((b) => !b.blockedReason || selected.has(b.id)).map((b) => ({ id: b.id, code: b.code, operatorCode: b.operatorCode, capacity: b.capacity }));
  const req = useMemo(() => computeBusRequirement(row.p90, free, { operators: ['H', 'M', 'S'] }), [row.p90, free]);
  const tone = seats >= row.p90 ? 'ok' : seats >= row.predicted ? 'warn' : 'crit';

  const save = useMutation({
    mutationFn: (status: 'draft' | 'published') => api<Allocation>('/admin/allocations', { method: 'PUT', body: { serviceDate: date, timeSlotId: row.timeSlotId, busIds: [...selected], status } }),
    onSuccess: (_d, status) => {
      qc.invalidateQueries({ queryKey: ['allocations', date] });
      toast(status === 'published' ? `Published · ${routeLabel(row.direction, row.routeName)} ${formatClock(row.departureMinutes)} · riders notified` : 'Draft saved');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/allocations/${current!.id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['allocations', date] }); toast('Allocation deleted'); onClose(); },
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Allocate buses">
        <div className="flex items-start gap-2.5 border-b border-line p-4">
          <div className="flex-1">
            <p className="muted text-xs">{row.routeKind === 'shuttle' ? 'Shuttle' : `${row.routeCode} · ${row.audience === 'faculty' ? 'Faculty' : 'Student'} service`} · {dayLabel(date)}</p>
            <h2 className="text-lg">{routeLabel(row.direction, row.routeName)} · {formatClock(row.departureMinutes)}</h2>
            <p className="muted text-xs">{current ? `${current.status === 'published' ? 'Published' : 'Draft'}` : 'No allocation yet'}</p>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2">
            {[['Routine max', row.expectedMax, 'everyone with class'], ['Predicted', row.predicted, 'likely riders'], ['P90 (safe)', row.p90, 'allocate for this']].map(([l, v, s]) => (
              <div key={String(l)} className="tile"><div className="tile-label">{l}</div><div className="tile-big text-2xl">{v}</div><div className="muted text-xs">{s}</div></div>
            ))}
          </div>
          <div>
            <b>Buses required for P90</b>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {req.singleOperator.map((o) => (
                <div key={o.operatorCode} className="tile"><span className="muted text-xs">Only {OPS[o.operatorCode]}</span><b className="block text-lg" style={{ color: o.feasible ? undefined : 'var(--crit)' }}>{o.busesNeeded}</b><span className="text-xs">{o.feasible ? 'available' : 'not enough free'}</span></div>
              ))}
              <div className="tile"><span className="muted text-xs">Mixed</span><b className="block text-lg">{req.mixed.busesNeeded}</b><span className="mono text-xs">{formatMix(req.mixed.byOperator)}</span></div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <div className="flex"><b className="flex-1">Seats selected</b><span className="num"><b>{seats}</b> / {row.p90} needed</span></div>
            <div className={`bar ${tone}`}><i style={{ width: `${Math.min(100, Math.round((seats / Math.max(1, row.p90)) * 100))}%` }} /></div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" onClick={() => setSelected(new Set(req.mixed.buses.map((b) => b.id!)))}>Use suggestion ({formatMix(req.mixed.byOperator) || 'none'})</button>
              <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
          {options.isLoading ? <Loading what="Loading buses" /> : options.error ? <ErrorNote error={options.error} /> : (
            <div className="grid gap-3">
              <b>Available buses · {row.audience} pool</b>
              {options.data && <span className="muted text-xs">Crossed-out buses are on a trip that overlaps {formatClock(options.data.window.start)}–{formatClock(options.data.window.end)}, or out of service. Hover for the reason.</span>}
              {['H', 'M', 'S'].map((op) => {
                const list = pool.filter((b) => b.operatorCode === op);
                if (!list.length) return null;
                return (
                  <div key={op} className="grid gap-2">
                    <div><b>{OPS[op]}</b> <span className="muted text-xs">{list[0]!.capacity} seats</span></div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((b) => (
                        <button key={b.id} type="button" className={`bus op-${op}`} aria-pressed={selected.has(b.id)} disabled={Boolean(b.blockedReason) && !selected.has(b.id)}
                          title={b.blockedReason ?? `${b.capacity} seats`} onClick={() => toggle(b.id)}>{b.code}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {save.error ? <ErrorNote error={save.error} /> : null}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line p-3">
          {can('allocation.publish') && <button className="btn btn-primary" disabled={!selected.size || save.isPending} onClick={() => save.mutate('published')}>Publish</button>}
          <button className="btn" disabled={!selected.size || save.isPending} onClick={() => save.mutate('draft')}>Save draft</button>
          <span className="flex-1" />
          {current && <button className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete allocation</button>}
        </div>
      </aside>
    </>
  );
}
