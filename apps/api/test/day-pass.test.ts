import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, nextServiceDate, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeAll(async () => { env = await setup(); admin = await adminLogin(env); });
afterAll(async () => { await env?.close(); });

describe('one day pass', () => {
  it('auto-approves the first pass of the semester', async () => {
    const rider = (await riderLogin(env, '233-15-020')).accessToken;
    const res = await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: nextServiceDate(1), routeId: env.seeded.routeIds['R-02'] }).expect(201);
    expect(res.body).toMatchObject({ status: 'approved', autoApproved: true, passesLeft: 0 });
    const card = await request(env.app).get('/me/card').set(bearer(rider)).expect(200);
    expect(card.body.dayPasses[0].qrSecret).toBeTruthy();
    expect(card.body.dayPassesLeft).toBe(0);
  });

  it('sends the second request to the authority in manual mode', async () => {
    const rider = (await riderLogin(env, '233-15-020')).accessToken;
    const res = await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: nextServiceDate(2), routeId: env.seeded.routeIds['R-02'] }).expect(201);
    expect(res.body).toMatchObject({ status: 'pending', autoApproved: false });
    const queue = await request(env.app).get('/admin/day-passes').set(bearer(admin)).expect(200);
    expect(queue.body).toHaveLength(1);
    await request(env.app).post(`/admin/day-passes/${queue.body[0].id}/decision`).set(bearer(admin)).send({ decision: 'approve' }).expect(400);
    const ok = await request(env.app).post(`/admin/day-passes/${queue.body[0].id}/decision`).set(bearer(admin)).send({ decision: 'approve', reason: 'Lab exam on that day' }).expect(200);
    expect(ok.body.status).toBe('approved');
  });

  it('rejects over-limit requests outright when settings say so, and the limit can be raised', async () => {
    await request(env.app).patch('/admin/settings').set(bearer(admin)).send({ dayPassOverLimit: 'reject' }).expect(200);
    const rider = (await riderLogin(env, '233-15-020')).accessToken;
    const res = await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: nextServiceDate(3), routeId: env.seeded.routeIds['R-02'] }).expect(422);
    expect(res.body.error.code).toBe('day_pass_limit');
    await request(env.app).patch('/admin/settings').set(bearer(admin)).send({ dayPassLimitPerSemester: 3 }).expect(200);
    await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: nextServiceDate(3), routeId: env.seeded.routeIds['R-02'] }).expect(201);
  });

  it('does not give passes to riders who already have a card', async () => {
    await request(env.app).post('/admin/access/232-35-797/grant').set(bearer(admin)).send({ routeId: env.seeded.routeIds['R-01'], reason: 'Card for day pass test' }).expect(200);
    const rider = (await riderLogin(env, '232-35-797')).accessToken;
    await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: nextServiceDate(1), routeId: env.seeded.routeIds['R-01'] }).expect(409);
  });

  it('refuses past dates and duplicate dates', async () => {
    const rider = (await riderLogin(env, '242-35-301')).accessToken;
    await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: '2020-01-01', routeId: env.seeded.routeIds['R-01'] }).expect(400);
    await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: nextServiceDate(1), routeId: env.seeded.routeIds['R-01'] }).expect(201);
    await request(env.app).post('/me/day-passes').set(bearer(rider)).send({ travelDate: nextServiceDate(1), routeId: env.seeded.routeIds['R-01'] }).expect(409);
  });
});
