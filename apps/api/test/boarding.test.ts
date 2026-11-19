import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dhakaDate, dhakaMinutes } from '@diu/shared';
import { allocationBuses, allocations, users } from '../src/db/schema.js';
import { signAccessToken } from '../src/auth/tokens.js';
import { makeQrToken } from '../src/lib/qr.js';
import { bearer, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let supervisor = '';
let card: { id: string; qrSecret: string };

/** Publishes a trip for `busCode` on `routeCode` that is running right now. */
async function tripNow(routeCode: string, busCode: string) {
  const slotKey = Object.keys(env.seeded.slotIds).find((k) => k.startsWith(`${routeCode}|student|`))!;
  const now = new Date();
  const [alloc] = await env.ctx.db.insert(allocations)
    .values({ serviceDate: dhakaDate(now), timeSlotId: env.seeded.slotIds[slotKey]!, status: 'published', publishedAt: now })
    .returning({ id: allocations.id });
  const minutes = dhakaMinutes(now);
  await env.ctx.db.insert(allocationBuses).values({
    allocationId: alloc!.id, busId: env.seeded.busIds[busCode]!, serviceDate: dhakaDate(now), windowStart: minutes - 10, windowEnd: minutes + 60,
  });
}

const scan = (busCode: string) => {
  const now = new Date();
  return request(env.app).post('/boarding/scan').set(bearer(supervisor))
    .send({ qrToken: makeQrToken(card.qrSecret, 'c', card.id, now), busId: env.seeded.busIds[busCode], scannedAt: now.toISOString() })
    .expect(200);
};

beforeAll(async () => {
  env = await setup();
  // A Mirpur (R-01) card holder, paid through the mock gateway.
  const rider = (await riderLogin(env, '232-35-797')).accessToken;
  const started = await request(env.app).post('/me/card').set(bearer(rider)).send({ routeId: env.seeded.routeIds['R-01'] }).expect(201);
  await request(env.app).post('/payments/sslcommerz/ipn').type('form')
    .send({ tran_id: started.body.tranId, status: 'VALID', val_id: `mock-${started.body.tranId}-bKash` }).expect(200);
  card = (await request(env.app).get('/me/card').set(bearer(rider)).expect(200)).body.card;

  const [sup] = await env.ctx.db.insert(users).values({ universityId: '710555', name: 'Bus Supervisor', role: 'supervisor' }).returning();
  supervisor = await signAccessToken(env.ctx, { sub: sup!.id, role: 'supervisor', uid: '710555' });

  await tripNow('R-01', 'H-10');
  await tripNow('R-02', 'H-12');
  await tripNow('SH-1', 'M-03');
});
afterAll(async () => { await env.close(); });

describe('boarding scan and the rider route', () => {
  it('accepts a card on its own route', async () => {
    expect((await scan('H-10')).body).toMatchObject({ valid: true, name: 'Khalilur Rahman' });
  });

  it('turns a card away from another route and says which route it is for', async () => {
    const res = await scan('H-12');
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toMatch(/^Card is for the .+ route$/);
  });

  it('lets every card holder use the shuttle', async () => {
    expect((await scan('M-03')).body.valid).toBe(true);
  });
});
