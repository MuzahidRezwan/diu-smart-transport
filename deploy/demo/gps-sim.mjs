// Demo GPS simulator: pretends to be the trackers on the buses, so the live map moves.
//
//   node deploy/demo/gps-sim.mjs http://127.0.0.1:7860/api
//
// It signs in as the demo transport office, gives every allocated bus a tracker key
// (the same endpoint a real installer uses) and sends signed positions to
// POST /devices/gps every few seconds, exactly like a real tracker.
//
// - Buses on a published trip right now drive along their route at real speed.
// - A route with no trip running right now (night, between trips, a route with no
//   Friday service) replays its next published trip at REPLAY_SPEED x, naming that
//   trip in the x-demo-trip header (honoured only in DEMO_MODE), so every route's
//   live map has something to show while you test.
//
// Demo only. Stops when the API stops answering.
import { createHmac } from 'node:crypto';

const API = (process.argv[2] ?? 'http://127.0.0.1:7860/api').replace(/\/+$/, '');
const PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? 'diu-demo-2026';
const TICK_MS = 5_000;
const REFRESH_MS = 120_000;
const REPLAY_SPEED = 3;
const REPLAY_PAUSE_MIN = 4; // at the end of a replayed trip, before it starts again
const TURNAROUND_MIN = 30;

const log = (msg) => console.log(`[gps-sim] ${msg}`);

/* ---------- time in Dhaka ---------- */
const dhakaNow = () => new Date(Date.now() + 6 * 3600_000); // Dhaka has no DST
const isoDay = (offsetDays = 0) => new Date(dhakaNow().getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const minutesNow = () => { const d = dhakaNow(); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; };

/* ---------- HTTP ---------- */
let token = '';
async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && token && path !== '/auth/authority/login') { await login(); return call(method, path, body); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error?.message ?? ''}`);
  return data;
}
async function login() {
  token = '';
  token = (await call('POST', '/auth/authority/login', { universityId: '710215', password: PASSWORD })).accessToken;
}

/* ---------- geometry ---------- */
const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
/** The point a fraction f (0..1) of the way along a polyline, by distance. */
function along(points, f) {
  const legs = points.slice(1).map((p, i) => km(points[i], p));
  let left = Math.min(1, Math.max(0, f)) * legs.reduce((t, l) => t + l, 0);
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] || i === legs.length - 1) {
      const t = legs[i] ? Math.min(1, left / legs[i]) : 1;
      const a = points[i], b = points[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    left -= legs[i];
  }
  return points[points.length - 1];
}

/**
 * Where a bus is, t minutes after its departure. Route stops run from the far end to
 * DSC. To campus: drive to DSC, then wait there. From campus: drive out, then come back.
 */
function positionAt(route, direction, t) {
  const stops = route.stops;
  const d = route.durationMinutes;
  if (direction === 'to_campus') return along(stops, t / d);
  const out = [...stops].reverse();
  return t <= d ? along(out, t / d) : along(stops, (t - d) / d);
}
const tripLength = (route, direction) => (direction === 'to_campus' ? route.durationMinutes + TURNAROUND_MIN : 2 * route.durationMinutes);

/* ---------- what is on the road ---------- */
let routes = new Map();
let trips = []; // { date, slot, route, buses: [{ id, code }] }, published only
const keys = new Map(); // busId -> { deviceId, key }

async function refresh() {
  routes = new Map((await call('GET', '/routes')).filter((r) => r.stops?.length >= 2).map((r) => [r.id, r]));
  const next = [];
  for (let i = 0; i < 8; i++) {
    const date = isoDay(i);
    const [schedule, allocs] = await Promise.all([call('GET', `/schedule?date=${date}`), call('GET', `/admin/allocations?date=${date}`)]);
    const slots = new Map(schedule.slots.map((s) => [s.timeSlotId, s]));
    for (const a of allocs) {
      const slot = slots.get(a.timeSlotId);
      const route = slot && routes.get(slot.routeId);
      if (a.status === 'published' && route && a.buses.length) next.push({ date, dayOffset: i, slot, route, buses: a.buses });
    }
  }
  trips = next;
  for (const t of trips) for (const b of t.buses) {
    if (keys.has(b.id)) continue;
    const deviceId = `demo-${b.code}`;
    const issued = await call('POST', `/admin/fleet/buses/${b.id}/device-key`, { gpsDeviceId: deviceId });
    keys.set(b.id, { deviceId, key: issued.deviceKey });
  }
}

/** Real trips: buses whose published trip is running now. */
function liveNow() {
  const now = minutesNow();
  const out = [];
  for (const trip of trips.filter((x) => x.dayOffset === 0)) {
    const t = now - trip.slot.departureMinutes;
    if (t < 0 || t > tripLength(trip.route, trip.slot.direction)) continue;
    trip.buses.forEach((b, i) => out.push({ bus: b, trip, t: Math.max(0, t - i * 1.5), replay: false })); // buses leave a minute or two apart
  }
  return out;
}

/** Replay: the next published trip of each route, looped at REPLAY_SPEED x, routes spread out. */
const replayStart = Date.now();
function replay() {
  const now = minutesNow();
  const upcoming = [...trips].filter((x) => x.dayOffset > 0 || x.slot.departureMinutes > now)
    .sort((a, b) => a.dayOffset - b.dayOffset || a.slot.departureMinutes - b.slot.departureMinutes);
  const chosen = new Map();
  for (const trip of upcoming) if (!chosen.has(trip.route.id)) chosen.set(trip.route.id, trip);
  const elapsed = ((Date.now() - replayStart) / 60_000) * REPLAY_SPEED;
  const out = [];
  [...chosen.values()].forEach((trip, k) => {
    const len = tripLength(trip.route, trip.slot.direction);
    const cycle = len + REPLAY_PAUSE_MIN * REPLAY_SPEED;
    const t = (elapsed + (k * 0.37 % 1) * cycle) % cycle; // each route at a different point of its trip
    trip.buses.forEach((b, i) => out.push({ bus: b, trip, t: Math.min(len, Math.max(0, t - i * 4)), replay: true }));
  });
  return out;
}

/* ---------- sending ---------- */
const last = new Map(); // busId -> { lat, lng, at }
async function send({ bus, trip, t, replay: isReplay }) {
  const device = keys.get(bus.id);
  if (!device) return;
  const p = positionAt(trip.route, trip.slot.direction, t);
  const prev = last.get(bus.id);
  const at = Date.now();
  let speedKmh = 0, heading;
  if (prev) {
    const dist = km(prev, p);
    const hours = (at - prev.at) / 3_600_000;
    if (hours > 0) speedKmh = Math.min(90, dist / hours);
    if (dist > 0.001) heading = bearing(prev, p);
  }
  last.set(bus.id, { ...p, at });
  const body = JSON.stringify({
    lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)), speedKmh: Number(speedKmh.toFixed(1)),
    ...(heading === undefined ? {} : { heading: Number(heading.toFixed(0)) }), recordedAt: new Date(at).toISOString(),
  });
  const ts = Math.floor(at / 1000);
  const res = await fetch(`${API}/devices/gps`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-id': device.deviceId,
      'x-timestamp': String(ts),
      'x-signature': createHmac('sha256', device.key).update(`${ts}.${body}`).digest('hex'),
      ...(isReplay ? { 'x-demo-trip': trip.slot.timeSlotId } : {}),
    },
    body,
  });
  if (!res.ok) throw new Error(`GPS ping for ${bus.code}: ${res.status}`);
}

/* ---------- main loop ---------- */
let mode = '';
let failures = 0;
async function tick() {
  const live = liveNow();
  const liveRoutes = new Set(live.map((m) => m.trip.route.id));
  const replayed = replay().filter((m) => !liveRoutes.has(m.trip.route.id));
  const moving = [...live, ...replayed]; // a bus on a real trip is never also replayed (deduplicated below)
  const newMode = `${live.length} bus(es) on trips now, ${new Set(replayed.map((m) => m.trip.route.id)).size} route(s) replaying their next trip at ${REPLAY_SPEED}x`;
  if (newMode !== mode) { mode = newMode; log(mode); }
  const seen = new Set();
  const results = await Promise.allSettled(moving.filter((m) => !seen.has(m.bus.id) && seen.add(m.bus.id)).map(send));
  const bad = results.filter((r) => r.status === 'rejected');
  failures = bad.length && bad.length === results.length ? failures + 1 : 0;
  if (failures === 1) log(`Pings failing: ${bad[0].reason?.message ?? bad[0].reason}`);
}

try {
  await login();
  await refresh();
  log(`Trackers ready on ${keys.size} buses; ${trips.length} published trips in the next 8 days.`);
} catch (err) {
  log(`Could not start: ${err.message}`);
  process.exit(1);
}
setInterval(() => { refresh().catch((err) => log(`Refresh failed: ${err.message}`)); }, REFRESH_MS);
setInterval(() => {
  tick().catch((err) => { failures++; if (failures === 1) log(err.message); });
  if (failures > 24) { log('The API stopped answering; stopping.'); process.exit(0); } // about 2 minutes
}, TICK_MS);
await tick().catch((err) => log(err.message));
