import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { livePositionsForRoute } from '../src/modules/tracking/routes.js';
import { ADMIN_PASSWORD, adminLogin, bearer, setup, type TestEnv } from './helpers.js';

/** Signs a ping the way a tracker does: HMAC-SHA256(key, "<unix seconds>.<raw body>"). */
function ping(env: TestEnv, device: { id: string; key: string }, extra: { ts?: number; demoTrip?: string; key?: string } = {}) {
  const body = JSON.stringify({ lat: 23.85, lng: 90.33, speedKmh: 32, heading: 40, recordedAt: new Date().toISOString() });
  const ts = extra.ts ?? Math.floor(Date.now() / 1000);
  const req = request(env.app).post('/devices/gps')
    .set('content-type', 'application/json')
    .set('x-device-id', device.id)
    .set('x-timestamp', String(ts))
    .set('x-signature', createHmac('sha256', extra.key ?? device.key).update(`${ts}.${body}`).digest('hex'));
  if (extra.demoTrip) req.set('x-demo-trip', extra.demoTrip);
  return req.send(body);
}

async function tracker(env: TestEnv, token: string, busCode: string) {
  const busId = env.seeded.busIds[busCode]!;
  const { body } = await request(env.app).post(`/admin/fleet/buses/${busId}/device-key`).set(bearer(token)).send({ gpsDeviceId: `test-${busCode}` }).expect(200);
  return { busId, device: { id: `test-${busCode}`, key: body.deviceKey as string } };
}

async function live(env: TestEnv, token: string, busId: string) {
  const { body } = await request(env.app).get('/admin/tracking/live').set(bearer(token)).expect(200);
  return body.find((p: { busId: string }) => p.busId === busId);
}

describe('GPS trackers', () => {
  let env: TestEnv;
  let admin: string;
  beforeAll(async () => { env = await setup(); admin = await adminLogin(env); });
  afterAll(async () => { await env?.close(); });

  it('accepts signed positions and shows the bus to the transport office', async () => {
    const { busId, device } = await tracker(env, admin, 'H-10');
    await ping(env, device).expect(204);
    const pos = await live(env, admin, busId);
    expect(pos).toMatchObject({ code: 'H-10', lat: 23.85, lng: 90.33, trip: null });
  });

  it('refuses a wrong signature or an old timestamp', async () => {
    const { device } = await tracker(env, admin, 'H-12');
    await ping(env, device, { key: 'not-the-key' }).expect(401);
    await ping(env, device, { ts: Math.floor(Date.now() / 1000) - 600 }).expect(401);
  });

  it('ignores the demo trip header outside demo mode', async () => {
    const { busId, device } = await tracker(env, admin, 'H-14');
    await ping(env, device, { demoTrip: env.seeded.slotIds['R-01|student|to_campus|07:00'] }).expect(204);
    expect((await live(env, admin, busId)).trip).toBeNull();
    expect(livePositionsForRoute(env.seeded.routeIds['R-01']!).some((p) => p.busId === busId)).toBe(false);
  });
});

describe('GPS trackers in demo mode', () => {
  let env: TestEnv;
  let admin: string;
  beforeAll(async () => {
    const config = loadConfig({ NODE_ENV: 'test', PUBLIC_API_URL: 'http://api.test', WEB_APP_URL: 'http://web.test', DEMO_MODE: 'true' });
    env = await setup({ config });
    admin = (await request(env.app).post('/auth/authority/login').send({ universityId: '710215', password: ADMIN_PASSWORD }).expect(200)).body.accessToken;
  });
  afterAll(async () => { await env?.close(); });

  it('lets the simulator replay a trip, which riders on that route then see', async () => {
    const { busId, device } = await tracker(env, admin, 'M-10');
    const routeId = env.seeded.routeIds['R-01']!;
    await ping(env, device, { demoTrip: env.seeded.slotIds['R-01|student|to_campus|07:00'] }).expect(204);
    expect((await live(env, admin, busId)).trip).toMatchObject({ routeId, routeCode: 'R-01', direction: 'to_campus', departureMinutes: 420 });
    expect(livePositionsForRoute(routeId).some((p) => p.busId === busId)).toBe(true);
  });

  it('ignores a header that is not a time slot', async () => {
    const { busId, device } = await tracker(env, admin, 'M-11');
    await ping(env, device, { demoTrip: 'not-a-uuid' }).expect(204);
    expect((await live(env, admin, busId)).trip).toBeNull();
  });
});
