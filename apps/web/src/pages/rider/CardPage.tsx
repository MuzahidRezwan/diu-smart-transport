import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { USER_CATEGORY_LABELS, type UserCategory } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, dayLabel, isFriday, todayDhaka } from '../../lib/format';
import { qrToken, secondsLeft } from '../../lib/qr';
import type { RouteInfo } from '../../lib/types';
import { ErrorNote, Loading, Pill, useToast } from '../../components/ui';

interface MyCard {
  card: { id: string; status: string; semester: string; route: { id: string; name: string }; issuedAt: string | null; expiresOn: string | null; qrSecret: string | null } | null;
  dayPasses: { id: string; travelDate: string; route: string; status: string; qrSecret: string | null }[];
  dayPassesLeft: number;
}

function RotatingQr({ secret, kind, id }: { secret: string; kind: 'c' | 'p'; id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [left, setLeft] = useState(secondsLeft());
  useEffect(() => {
    let alive = true;
    const draw = async () => {
      const token = await qrToken(secret, kind, id);
      const url = await QRCode.toDataURL(token, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
      if (alive) setSrc(url);
    };
    draw();
    const t = setInterval(() => { const s = secondsLeft(); setLeft(s); if (s === 30) draw(); }, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [secret, kind, id]);
  return (
    <div className="grid justify-items-center gap-1.5 pb-4">
      {src ? <img src={src} alt="Boarding QR code" width={200} height={200} className="rounded-lg bg-white p-2" /> : <Loading what="Making QR" />}
      <span className="muted text-xs">Show this when boarding · refreshes in <b>{left}</b>s · works offline</span>
    </div>
  );
}

export function CardPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['my-card'], queryFn: () => api<MyCard>('/me/card') });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const [routeId, setRouteId] = useState('');
  const [note, setNote] = useState('');
  const [passDate, setPassDate] = useState(() => { let d = todayDhaka(); while (isFriday(d)) d = addDays(d, 1); return d; });
  const chosen = routeId || me?.homeRouteId || routes.data?.[0]?.id || '';

  const pay = useMutation({
    mutationFn: () => api<{ redirectUrl: string }>('/me/card', { body: { routeId: chosen, gateway: 'sslcommerz' } }),
    onSuccess: (r) => window.location.assign(r.redirectUrl),
  });
  const free = useMutation({
    mutationFn: () => api('/me/card/free-request', { body: { routeId: chosen, note } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-card'] }); toast('Request sent to the transport office'); },
  });
  const pass = useMutation({
    mutationFn: () => api<{ status: string }>('/me/day-passes', { body: { travelDate: passDate, routeId: chosen } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['my-card'] }); toast(r.status === 'approved' ? 'Day pass approved' : 'Request sent for approval'); },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const { card, dayPasses, dayPassesLeft } = q.data!;
  const active = card?.status === 'active' && card.qrSecret;

  return (
    <>
      {active ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-3 p-4 text-white" style={{ background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--op-m)))' }}>
            <div className="grid h-[76px] w-16 place-items-center rounded-lg border-2 border-white/50 bg-white/20 text-xl font-bold">{me?.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</div>
            <div><div className="text-xs font-bold opacity-85">DAFFODIL INTERNATIONAL UNIVERSITY</div><b className="text-lg">{me?.name}</b><div className="text-xs">{me?.profile.department}</div></div>
          </div>
          <dl className="grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 p-4 text-sm">
            <dt className="muted font-bold">ID</dt><dd className="mono">{me?.universityId}</dd>
            <dt className="muted font-bold">Card</dt><dd>{card.semester} · {USER_CATEGORY_LABELS[me?.category as UserCategory] ?? ''}</dd>
            <dt className="muted font-bold">Route</dt><dd>{card.route.name} ⇄ DSC</dd>
            <dt className="muted font-bold">Expires</dt><dd>{card.expiresOn}</dd>
            <dt className="muted font-bold">Status</dt><dd><Pill tone="ok">Active</Pill></dd>
          </dl>
          <RotatingQr secret={card.qrSecret!} kind="c" id={card.id} />
        </div>
      ) : (
        <div className="card grid gap-3">
          <b>Transport card {card ? <Pill tone="warn">{card.status.replace('_', ' ')}</Pill> : null}</b>
          <label className="field" htmlFor="route">Your route<select id="route" className="input" value={chosen} onChange={(e) => setRouteId(e.target.value)}>{(routes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <p className="muted m-0 text-xs">Fee for {USER_CATEGORY_LABELS[me?.category as UserCategory] ?? 'your category'} is set by the transport office. Pay with bKash, Nagad, Rocket or card through SSLCommerz. The card turns active as soon as the payment is confirmed.</p>
          <button className="btn btn-primary justify-center" disabled={!chosen || pay.isPending} onClick={() => pay.mutate()}>Pay and get card</button>
          {pay.error ? <ErrorNote error={pay.error} /> : null}
          <details><summary className="cursor-pointer text-sm font-bold">Ask for free access instead</summary>
            <div className="mt-2 grid gap-2"><textarea className="input" rows={2} placeholder="Why (e.g. scholarship, sports quota)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn" disabled={note.trim().length < 10 || free.isPending} onClick={() => free.mutate()}>Send request</button>{free.error ? <ErrorNote error={free.error} /> : null}</div>
          </details>
        </div>
      )}

      {dayPasses.map((p) => (
        <div key={p.id} className="card">
          <div className="flex items-center gap-2"><b className="flex-1">One Day Pass · {dayLabel(p.travelDate)}</b><Pill tone={p.status === 'approved' ? 'ok' : 'none'}>{p.status}</Pill></div>
          <div className="muted text-xs">{p.route}, both directions</div>
          {p.qrSecret && p.travelDate === todayDhaka() && <RotatingQr secret={p.qrSecret} kind="p" id={p.id} />}
        </div>
      ))}

      {!active && (
        <div className="card grid gap-2">
          <b>One Day Pass · {dayPassesLeft} left this semester</b>
          <div className="flex flex-wrap items-end gap-2">
            <label className="field" htmlFor="pd">Date<input id="pd" type="date" className="input" min={todayDhaka()} value={passDate} onChange={(e) => setPassDate(e.target.value)} /></label>
            <button className="btn" disabled={!chosen || pass.isPending} onClick={() => pass.mutate()}>Request pass</button>
          </div>
          {pass.error ? <ErrorNote error={pass.error} /> : null}
        </div>
      )}
    </>
  );
}
