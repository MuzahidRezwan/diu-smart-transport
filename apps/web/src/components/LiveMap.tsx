import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import { api } from '../lib/api';
import { routeLabel } from '../lib/format';
import type { LivePosition, RouteInfo } from '../lib/types';
import { BusChip } from './ui';

const DSC: [number, number] = [23.8768, 90.3207];
const OP_COLOR: Record<string, string> = { H: '#4f46e5', M: '#0b8f83', S: '#d9620c' };

/** OpenStreetMap tiles. Positions come from GPS trackers; only buses on a trip are shown to riders. */
export function LiveMap({ positionsPath = '/admin/tracking/live', routeFilter }: { positionsPath?: string; routeFilter?: string }) {
  const [route, setRoute] = useState(routeFilter ?? 'all');
  const [q, setQ] = useState('');
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const live = useQuery({
    queryKey: ['live', positionsPath],
    queryFn: async () => {
      const r = await api<LivePosition[] | { positions: LivePosition[] }>(positionsPath);
      return Array.isArray(r) ? r : r.positions;
    },
    refetchInterval: 10_000,
  });
  const shown = (live.data ?? []).filter((p) => (route === 'all' || p.trip?.routeId === route) && (!q || p.code.includes(q.toUpperCase())));
  return (
    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <MapContainer center={DSC} zoom={11} style={{ height: 420 }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {(routes.data ?? []).map((r) => (
          <Polyline key={r.id} positions={r.stops.map((s) => [s.lat, s.lng] as [number, number])}
            pathOptions={{ color: route === r.id ? '#1446a0' : '#8a96b0', weight: route === r.id ? 5 : 3, opacity: 0.8 }} />
        ))}
        <CircleMarker center={DSC} radius={9} pathOptions={{ color: '#1446a0', fillOpacity: 1 }}><Tooltip permanent direction="top">DSC</Tooltip></CircleMarker>
        {shown.map((p) => (
          <CircleMarker key={p.busId} center={[p.lat, p.lng]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: OP_COLOR[p.operatorCode] ?? '#333', fillOpacity: 1 }}>
            <Tooltip direction="right">{p.code}{p.trip ? ` · ${routeLabel(p.trip.direction, p.trip.routeName)}` : ''}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="grid content-start gap-3">
        {!routeFilter && <>
          <label className="field" htmlFor="live-q">Search bus<input id="live-q" className="input" placeholder="e.g. H-14" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="field" htmlFor="live-route">Route
            <select id="live-route" className="input" value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="all">All routes</option>
              {(routes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
            </select>
          </label>
        </>}
        <b>On the road ({shown.length})</b>
        {shown.length ? shown.map((p) => (
          <div key={p.busId} className="flex items-center justify-between gap-2 border-b border-line py-1.5">
            <BusChip code={p.code} /><span className="text-xs">{p.trip ? routeLabel(p.trip.direction, p.trip.routeName) : 'Not on a trip'}</span>
          </div>
        )) : <p className="muted text-xs">No bus is reporting its position right now. Trackers send a position every 15 seconds during trips.</p>}
      </div>
    </div>
  );
}
