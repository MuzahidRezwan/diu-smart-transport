/**
 * The authority must never see rider profiles or act as a rider.
 * These tests sweep the dashboard endpoints for profile data.
 */
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, nextServiceDate, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
// What the mock directory stores as Khalilur's profile; none of it may leak.
const PROFILE_MARKERS = [/khalilur35-797@diu\.edu\.bd/, /Software Engineering/, /BSc in SWE/, /"section"/, /"batch"/, /"phone"/, /"email"/, /"department"/];

beforeAll(async () => {
  env = await setup();
  admin = await adminLogin(env);
  const rider = (await riderLogin(env, '232-35-797')).accessToken;
  await request(env.app).post('/me/card').set(bearer(rider)).send({ routeId: env.seeded.routeIds['R-01'] }).expect(201);
  await request(env.app).post('/me/tickets').set(bearer(rider)).send({ kind: 'complaint', category: 'overcrowding', body: 'The 2:30 PM bus left people behind at DSC.', routeId: env.seeded.routeIds['R-01'] }).expect(201);
  await request(env.app).post('/me/tickets').set(bearer(rider)).send({ kind: 'help', subject: 'Login problem', body: 'Cannot see my card after paying.' }).expect(201);
});
afterAll(async () => { await env.close(); });

const today = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

describe('authority data boundary', () => {
  it('never returns profile fields from dashboard endpoints', async () => {
    const endpoints = [
      '/admin/cards/requests', `/admin/cards/auto-approved?date=${today()}`, '/admin/access/232-35-797', '/admin/day-passes',
      `/admin/payments?from=${today()}&to=${today()}&status=all`, '/admin/tickets?kind=complaint', '/admin/tickets?kind=help', '/admin/feed',
      '/admin/admins', '/admin/notices', `/admin/allocations?date=${nextServiceDate(1)}`, `/admin/reports/summary?from=${today()}&to=${today()}`,
    ];
    for (const url of endpoints) {
      const res = await request(env.app).get(url).set(bearer(admin));
      expect(res.status, url).toBe(200);
      const text = JSON.stringify(res.body);
      for (const m of PROFILE_MARKERS) expect(text, `${url} leaked ${m}`).not.toMatch(m);
    }
  });

  it('access lookup needs the full ID and shows transport history only', async () => {
    await request(env.app).get('/admin/access/232-35').set(bearer(admin)).expect(400);
    await request(env.app).get('/admin/access/Khalilur').set(bearer(admin)).expect(400);
    const res = await request(env.app).get('/admin/access/232-35-797').set(bearer(admin)).expect(200);
    expect(Object.keys(res.body.rider).sort()).toEqual(['cardStatus', 'category', 'homeRoute', 'name', 'riderType', 'universityId']);
    expect(res.body.history.payments[0]).toMatchObject({ amountBdt: 4500, status: 'initiated' });
  });

  it('records every lookup in the audit log', async () => {
    const before = await env.ctx.db.execute(sql`select count(*)::int as n from audit_logs where action = 'access.lookup'`);
    await request(env.app).get('/admin/access/232-35-797').set(bearer(admin)).expect(200);
    const after = await env.ctx.db.execute(sql`select count(*)::int as n from audit_logs where action = 'access.lookup'`);
    const n = (r: unknown) => Number((r as { rows: { n: number }[] }).rows[0]!.n);
    expect(n(after)).toBe(n(before) + 1);
  });

  it('shows tickets by number and route, without who wrote them', async () => {
    const res = await request(env.app).get('/admin/tickets?kind=complaint').set(bearer(admin)).expect(200);
    const t = res.body.tickets[0];
    expect(t.number).toMatch(/^C-\d+$/);
    expect(t.route).toBe('Mirpur-10');
    expect(t).not.toHaveProperty('userId');
    expect(JSON.stringify(t)).not.toContain('Khalilur');
    expect(JSON.stringify(t)).not.toContain('232-35-797');
  });

  it('delivers staff replies to the rider inside the ticket', async () => {
    const list = await request(env.app).get('/admin/tickets?kind=help').set(bearer(admin)).expect(200);
    await request(env.app).post(`/admin/tickets/${list.body.tickets[0].id}/reply`).set(bearer(admin)).send({ body: 'Pull down to refresh My Card.' }).expect(200);
    const rider = (await riderLogin(env, '232-35-797')).accessToken;
    const mine = await request(env.app).get('/me/tickets').set(bearer(rider)).expect(200);
    const help = mine.body.find((x: { kind: string }) => x.kind === 'help');
    const detail = await request(env.app).get(`/me/tickets/${help.id}`).set(bearer(rider)).expect(200);
    expect(detail.body.messages[0]).toMatchObject({ authorType: 'staff', body: 'Pull down to refresh My Card.' });
  });

  it('has no way to act as a rider or read a rider profile', async () => {
    for (const url of ['/admin/users/232-35-797', '/admin/users/232-35-797/profile', '/admin/impersonate/232-35-797', '/me/../admin/users']) {
      const res = await request(env.app).get(url).set(bearer(admin));
      expect([400, 403, 404], url).toContain(res.status);
      for (const m of PROFILE_MARKERS) expect(JSON.stringify(res.body)).not.toMatch(m);
    }
    const bad = await request(env.app).post('/admin/admins').set(bearer(admin))
      .send({ universityId: '710299', name: 'Too Much', designation: 'x', permissions: ['users.read_profile'] }).expect(400);
    expect(bad.body.error.code).toBe('validation_error');
  });

  it('keeps rider data scoped to the rider', async () => {
    const other = (await riderLogin(env, '221-15-443')).accessToken;
    const mine = await request(env.app).get('/me/tickets').set(bearer(other)).expect(200);
    expect(mine.body).toEqual([]);
    const theirs = await request(env.app).get('/admin/tickets?kind=complaint').set(bearer(admin));
    await request(env.app).get(`/me/tickets/${theirs.body.tickets[0].id}`).set(bearer(other)).expect(404);
  });

  it('keeps the audit log append-only', async () => {
    const err = await env.ctx.db.execute(sql`delete from audit_logs`).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(err).not.toBeNull();
    expect(String(err!.cause?.message ?? err!.message)).toMatch(/append-only/);
  });
});
