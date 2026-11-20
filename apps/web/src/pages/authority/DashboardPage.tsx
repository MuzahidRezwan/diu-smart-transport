import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatClock, formatMix } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, dayLabel, nf, routeLabel, todayDhaka } from '../../lib/format';
import { useTripDays } from '../../lib/tripDays';
import { coverage, peakRequirement, waves } from '../../lib/demand';
import type { Allocation, AvailabilityDay, BusRow, PredictionRow } from '../../lib/types';
import { AllocationDrawer } from '../../components/AllocationDrawer';
import { Workspace } from '../../components/Workspace';
import { BusChip, Card, ErrorNote, Loading, Modal, Pill, Segmented, useToast } from '../../components/ui';

const OPS: Record<string, string> = { H: 'Hanif', M: 'Monir', S: 'Surjomukhi' };

export function DashboardPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayDhaka();
  // When nothing runs today (a holiday, or after a timetable change), open on the next day with trips.
  const tripDays = useTripDays(today, 8);
  const firstServiceDay = tripDays.firstWithTrips;
  const [date, setDateState] = useState(today);
  const [moved, setMoved] = useState(false);
  const setDate = (d: string) => { setMoved(true); setDateState(d); };
  useEffect(() => { if (!moved) setDateState(firstServiceDay); }, [firstServiceDay, moved]);
  const day = tripDays.byDate.get(date);
  const [aud, setAud] = useState<'student' | 'faculty'>('student');
  const [dir, setDir] = useState<'to_campus' | 'from_campus'>('to_campus');
  const [drawer, setDrawer] = useState<PredictionRow | null>(null);
  const [week, setWeek] = useState(false);

  const preds = useQuery({ queryKey: ['predictions', date], queryFn: () => api<{ rows: PredictionRow[] }>('/admin/predictions', { query: { from: date, days: 1 } }), enabled: can('predictions.view') });
  const allocs = useQuery({ queryKey: ['allocations', date], queryFn: () => api<Allocation[]>('/admin/allocations', { query: { date } }) });
  const fleet = useQuery({ queryKey: ['buses'], queryFn: () => api<BusRow[]>('/admin/fleet/buses'), enabled: can('fleet.view') });
  const avail = useQuery({ queryKey: ['availability', date, 1], queryFn: () => api<AvailabilityDay[]>('/admin/fleet/availability', { query: { from: date, days: 1 } }), enabled: can('fleet.view') });

  const refresh = useMutation({
    mutationFn: () => api<{ rows: number; modelVersion: string }>('/admin/predictions/refresh', { body: { from: date, days: 8 } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['predictions'] }); toast(`Prediction updated · ${r.rows} trips · model ${r.modelVersion}`); },
  });
  const suggest = useMutation({
    mutationFn: () => api<{ saved: number; source: string; shortfalls: unknown[] }>('/admin/allocations/suggest', { body: { serviceDate: date, onlyEmpty: true } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['allocations', date] }); toast(`${r.saved} empty slot(s) filled as drafts (${r.source}). Review, then publish.`); },
  });
  const publishDay = useMutation({
    mutationFn: () => api<{ published: number }>('/admin/allocations/publish-day', { body: { serviceDate: date } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['allocations', date] }); toast(`Published ${r.published} slot(s) for ${dayLabel(date)} · riders notified`); },
  });

  const rows = preds.data?.rows ?? [];
  const allocBySlot = useMemo(() => new Map((allocs.data ?? []).map((a) => [a.timeSlotId, a])), [allocs.data]);
  const unavailable = new Set((avail.data?.[0]?.unavailable ?? []).map((u) => u.code));
  const drafts = (allocs.data ?? []).filter((a) => a.status === 'draft').length;

  const sum = (a: string, d: string, k: 'predicted' | 'expectedMax' | 'p90') => rows.filter((r) => r.audience === a && r.direction === d).reduce((t, r) => t + r[k], 0);
  const cov = rows.reduce((acc, r) => { const c = coverage(r, allocBySlot.get(r.timeSlotId)); const key = c.tone === 'info' ? 'ok' : c.tone; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const tableRows = rows.filter((r) => r.audience === aud && r.direction === dir);

  const block = (audience: 'student' | 'faculty', title: string) => {
    const pIn = peakRequirement(rows.filter((r) => r.audience === audience && r.direction === 'to_campus'), fleet.data ?? [], unavailable, audience);
    const pOut = peakRequirement(rows.filter((r) => r.audience === audience && r.direction === 'from_campus'), fleet.data ?? [], unavailable, audience);
    const cell = (p: typeof pIn, op: string) => {
      const o = p?.req.singleOperator.find((x) => x.operatorCode === op);
      return o ? <>{o.busesNeeded} {!o.feasible && <span className="text-xs font-bold" style={{ color: 'var(--crit)' }}>have {o.available}</span>}</> : '—';
    };
    return (
      <Card title={title} actions={<Pill tone="info">{dayLabel(date)}</Pill>}>
        {audience === 'faculty' && <p className="muted mb-2 text-xs">Staff-only trips, such as the 4:20 PM employee bus. Staff on regular trips are counted with the students.</p>}
        <div className="mb-3.5 grid gap-3 sm:grid-cols-2">
          {(['to_campus', 'from_campus'] as const).map((d) => (
            <div key={d} className="tile">
              <div className="tile-label">Total {d === 'to_campus' ? 'in' : 'out'}</div>
              <div className="tile-big">{nf(sum(audience, d, 'predicted'))}</div>
              <div className="muted text-xs">Routine max {nf(sum(audience, d, 'expectedMax'))} · P90 {nf(sum(audience, d, 'p90'))}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Required buses (busiest wave)</th><th>In · {pIn ? formatClock(pIn.start) : '—'}</th><th>Out · {pOut ? formatClock(pOut.start) : '—'}</th></tr></thead>
            <tbody>
              {['H', 'M', 'S'].map((op) => <tr key={op}><td className="font-bold">Only {OPS[op]}</td><td className="num">{cell(pIn, op)}</td><td className="num">{cell(pOut, op)}</td></tr>)}
              <tr><td className="font-bold">Mixed (fewest buses)</td>
                {[pIn, pOut].map((p, i) => <td key={i} className="num">{p ? <>{p.req.mixed.busesNeeded} <span className="muted text-xs">{formatMix(p.req.mixed.byOperator)}</span></> : '—'}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="muted mt-2.5 text-xs">Counted on P90 seats of the busiest wave. Buses repeat across waves, so the whole day never needs more than this.</p>
      </Card>
    );
  };

  let lastWave = -1;
  const waveStarts = new Map(waves(tableRows).flatMap((w) => w.rows.map((r) => [r.timeSlotId, w.start] as const)));

  return (
    <>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-lg">{date === today ? "Today's prediction" : `Prediction for ${dayLabel(date, true)}`}</h2>
          <button className="btn" aria-label="Previous day" disabled={date <= today} onClick={() => setDate(addDays(date, -1))}>‹</button>
          <button className="btn" aria-label="Next day" disabled={date >= addDays(today, 7)} onClick={() => setDate(addDays(date, 1))}>›</button>
          {date !== firstServiceDay && <button className="btn" onClick={() => setDate(firstServiceDay)}>{firstServiceDay === today ? 'Back to today' : 'Back to next service day'}</button>}
          {can('predictions.run') && <button className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? 'Running…' : 'Re-run forecast'}</button>}
          <button className="btn btn-primary" onClick={() => setWeek(true)}>See next 7 days prediction</button>
        </div>
        {firstServiceDay !== today && date === firstServiceDay && <p className="muted">No trips run today, so the next day with trips is shown.</p>}
        {refresh.error ? <ErrorNote error={refresh.error} /> : null}
        {day?.closed ? <Card><p className="muted">No service: {day.closed}.</p></Card>
          : day && day.trips === 0 ? <Card><p className="muted">No trips are scheduled on this day.</p></Card>
          : preds.isLoading ? <Loading what="Loading prediction" />
          : !rows.length ? <Card><p className="muted">No prediction for this date yet. {can('predictions.run') ? 'Press "Re-run forecast".' : 'Ask an allocation officer to run it.'}</p></Card>
          : <div className="grid gap-4 xl:grid-cols-2">{block('student', 'Students (regular trips)')}{block('faculty', 'Faculty / Admin')}</div>}
      </section>

      {rows.length > 0 && (
        <Card title="Categorized route prediction" actions={<>
          <Segmented label="Service" value={aud} onChange={setAud} options={[['student', 'Students'], ['faculty', 'Faculty']]} />
          <Segmented label="Direction" value={dir} onChange={setDir} options={[['to_campus', 'To DSC'], ['from_campus', 'From DSC']]} />
        </>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="muted text-xs font-bold">Whole day:</span>
            <Pill tone="ok">{cov.ok ?? 0} covered</Pill><Pill tone="warn">{cov.warn ?? 0} tight</Pill><Pill tone="crit">{cov.crit ?? 0} short</Pill><Pill tone="none">{cov.none ?? 0} not allocated</Pill>
            <span className="flex-1" />
            {can('allocation.manage') && <button className="btn btn-sm" disabled={suggest.isPending} onClick={() => suggest.mutate()}>Fill empty slots with suggestion</button>}
            {can('allocation.publish') && <button className="btn btn-sm btn-primary" disabled={!drafts || publishDay.isPending} onClick={() => publishDay.mutate()}>Publish full day ({drafts} draft{drafts === 1 ? '' : 's'})</button>}
          </div>
          {suggest.error ? <ErrorNote error={suggest.error} /> : null}
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Route</th><th>Path · time</th><th>Riders</th><th>Allocated</th><th>Status</th><th /></tr></thead>
              <tbody>
                {tableRows.map((r) => {
                  const a = allocBySlot.get(r.timeSlotId);
                  const c = coverage(r, a);
                  const ws = waveStarts.get(r.timeSlotId)!;
                  const header = ws !== lastWave ? (lastWave = ws, <tr className="wave-row"><td colSpan={6}>{formatClock(ws)} wave</td></tr>) : null;
                  return (<Fragment key={r.timeSlotId}>{header}
                    <tr>
                      <td><b>{r.routeKind === 'shuttle' ? 'Shuttle' : r.routeCode}</b><div className="muted text-xs">{r.audience === 'faculty' ? 'Faculty' : 'Student'}</div></td>
                      <td>{routeLabel(r.direction, r.routeName)}<div className="muted text-xs">Departs {formatClock(r.departureMinutes)}{r.note ? ` · ${r.note}` : ''}</div></td>
                      <td className="num"><b>{r.predicted}</b> <span className="muted text-xs">/ P90 {r.p90}</span><div className="muted text-xs">Routine max {r.expectedMax}</div></td>
                      <td><div className="flex flex-wrap gap-1">{a?.buses.length ? a.buses.map((b) => <BusChip key={b.id} code={b.code} />) : <span className="muted text-xs">None</span>}</div></td>
                      <td><Pill tone={c.tone}>{c.text}</Pill></td>
                      <td>{can('allocation.manage') && <button className={`btn btn-sm ${a?.buses.length ? '' : 'btn-primary'}`} onClick={() => setDrawer(r)}>{a?.buses.length ? 'Edit' : 'Allocate bus'}</button>}</td>
                    </tr>
                  </Fragment>);
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Workspace />

      {drawer && <AllocationDrawer row={drawer} date={date} current={allocBySlot.get(drawer.timeSlotId)} onClose={() => setDrawer(null)} />}
      {week && <WeekModal from={today} onClose={() => setWeek(false)} onPick={(d) => { setDate(d); setWeek(false); }} />}
    </>
  );
}

function WeekModal({ from, onClose, onPick }: { from: string; onClose(): void; onPick(date: string): void }) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const preds = useQuery({ queryKey: ['predictions-week', from], queryFn: () => api<{ rows: PredictionRow[] }>('/admin/predictions', { query: { from, days: 7 } }) });
  const tripDays = useTripDays(from, 7);
  const allocs = useQueries({ queries: dates.map((d) => ({ queryKey: ['allocations', d], queryFn: () => api<Allocation[]>('/admin/allocations', { query: { date: d } }) })) });
  return (
    <Modal title="Next 7 days prediction" onClose={onClose}>
      <p className="muted text-xs">Predicted riders from the latest routines, calendar and past boarding scans. "Remaining" = trips without buses yet.</p>
      {preds.isLoading ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Date</th><th>Students in</th><th>Students out</th><th>Faculty in / out</th><th>Trips allocated</th><th>Remaining</th><th /></tr></thead>
            <tbody>
              {dates.map((d, i) => {
                const rs = (preds.data?.rows ?? []).filter((r) => r.serviceDate === d);
                const info = tripDays.byDate.get(d);
                if (info?.closed) return <tr key={d}><td><b>{dayLabel(d)}</b></td><td colSpan={6}><Pill tone="none">No service · {info.closed}</Pill></td></tr>;
                if (info && info.trips === 0) return <tr key={d}><td><b>{dayLabel(d)}</b></td><td colSpan={6}><Pill tone="none">No trips scheduled</Pill></td></tr>;
                const s = (a: string, dir: string) => rs.filter((r) => r.audience === a && r.direction === dir).reduce((t, r) => t + r.predicted, 0);
                const done = (allocs[i]?.data ?? []).filter((a) => a.buses.length).length;
                return (
                  <tr key={d}>
                    <td><b>{dayLabel(d)}</b></td><td className="num">{nf(s('student', 'to_campus'))}</td><td className="num">{nf(s('student', 'from_campus'))}</td>
                    <td className="num">{s('faculty', 'to_campus')} / {s('faculty', 'from_campus')}</td><td className="num">{done} / {rs.length}</td>
                    <td><Pill tone={rs.length - done ? 'warn' : 'ok'}>{rs.length - done}</Pill></td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => onPick(d)}>Allocate</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
