import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, nextServiceDate, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
const date = nextServiceDate(1);
beforeAll(async () => {
  env = await setup();
  admin = await adminLogin(env);
});
afterAll(async () => { await env?.close(); });

const slot = (k: string) => env.seeded.slotIds[k]!;
const bus = (code: string) => env.seeded.busIds[code]!;

describe('bus allocation', () => {
  it('saves a draft and returns seats', async () => {
    const res = await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: date, timeSlotId: slot('R-01|student|to_campus|07:00'), busIds: [bus('H-10'), bus('S-01')], status: 'draft' }).expect(200);
    expect(res.body).toMatchObject({ status: 'draft', seats: 70 });
    expect(res.body.buses.map((b: { code: string }) => b.code)).toEqual(['H-10', 'S-01']);
  });

  it('refuses a bus that is already on an overlapping trip', async () => {
    // R-01 7:00 to campus keeps H-10 busy until 8:45; Uttara 7:00 overlaps.
    const res = await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: date, timeSlotId: slot('R-02|student|to_campus|07:00'), busIds: [bus('H-10')], status: 'draft' }).expect(409);
    expect(res.body.error.code).toBe('bus_conflict');
    expect(res.body.error.message).toContain('H-10');
  });

  it('allows the same bus on a later trip that does not overlap', async () => {
    await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: date, timeSlotId: slot('R-01|student|from_campus|13:00'), busIds: [bus('H-10')], status: 'draft' }).expect(200);
  });

  it('refuses a bus marked out of service for that day', async () => {
    await request(env.app).post(`/admin/fleet/buses/${bus('M-15')}/unavailability`).set(bearer(admin))
      .send({ fromDate: date, toDate: date, reason: 'Engine repair' }).expect(201);
    const res = await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: date, timeSlotId: slot('R-03|student|to_campus|07:00'), busIds: [bus('M-15')], status: 'draft' }).expect(422);
    expect(res.body.error.message).toContain('Engine repair');
  });

  it('marks buses busy elsewhere as blocked in the drawer options', async () => {
    const res = await request(env.app).get('/admin/allocations/options').set(bearer(admin))
      .query({ date, timeSlotId: slot('R-02|student|to_campus|07:00') }).expect(200);
    const h10 = res.body.buses.find((b: { code: string }) => b.code === 'H-10');
    const m15 = res.body.buses.find((b: { code: string }) => b.code === 'M-15');
    expect(h10.blockedReason).toContain('R-01');
    expect(m15.blockedReason).toContain('Out of service');
  });

  it('shows riders only published allocations', async () => {
    const rider = await riderLogin(env, '232-35-797');
    // Give the rider a card so bus numbers are visible.
    await request(env.app).post('/admin/access/232-35-797/grant').set(bearer(admin)).send({ routeId: env.seeded.routeIds['R-01'], reason: 'Test card for schedule visibility' }).expect(200);
    const before = await request(env.app).get('/me/schedule').set(bearer(rider.accessToken)).query({ date }).expect(200);
    const s700 = before.body.slots.find((s: { timeSlotId: string }) => s.timeSlotId === slot('R-01|student|to_campus|07:00'));
    expect(s700.published).toBe(false);
    expect(s700.buses).toEqual([]);

    await request(env.app).post('/admin/allocations/publish-day').set(bearer(admin)).send({ serviceDate: date }).expect(200);
    const after = await request(env.app).get('/me/schedule').set(bearer(rider.accessToken)).query({ date }).expect(200);
    const p700 = after.body.slots.find((s: { timeSlotId: string }) => s.timeSlotId === slot('R-01|student|to_campus|07:00'));
    expect(p700.published).toBe(true);
    expect(p700.buses.map((b: { code: string }) => b.code)).toEqual(['H-10', 'S-01']);
  });

  it('hides bus numbers from riders without a card', async () => {
    const rider = await riderLogin(env, '242-35-301');
    const res = await request(env.app).get('/me/schedule').set(bearer(rider.accessToken)).query({ date, routeId: env.seeded.routeIds['R-01'] }).expect(200);
    expect(res.body.canSeeBuses).toBe(false);
    expect(res.body.slots.every((s: { buses: unknown[] }) => s.buses.length === 0)).toBe(true);
  });

  it('needs allocation.publish to publish', async () => {
    const created = await request(env.app).post('/admin/admins').set(bearer(admin))
      .send({ universityId: '710240', name: 'Draft Only', designation: 'Clerk', permissions: ['dashboard.view', 'allocation.manage'] }).expect(201);
    const clerk = await adminLogin(env, '710240', created.body.temporaryPassword);
    await request(env.app).put('/admin/allocations').set(bearer(clerk))
      .send({ serviceDate: date, timeSlotId: slot('R-04|student|to_campus|07:00'), busIds: [bus('H-12')], status: 'published' }).expect(403);
    await request(env.app).put('/admin/allocations').set(bearer(clerk))
      .send({ serviceDate: date, timeSlotId: slot('R-04|student|to_campus|07:00'), busIds: [bus('H-12')], status: 'draft' }).expect(200);
  });

  it('suggests allocations from predictions with the local planner when the optimizer is offline', async () => {
    const day2 = nextServiceDate(2);
    await request(env.app).post('/admin/predictions/refresh').set(bearer(admin)).send({ from: day2, days: 1 }).expect(200);
    const res = await request(env.app).post('/admin/allocations/suggest').set(bearer(admin)).send({ serviceDate: day2 }).expect(200);
    expect(res.body.source).toBe('greedy');
    expect(res.body.saved).toBeGreaterThan(10);
    const list = await request(env.app).get('/admin/allocations').set(bearer(admin)).query({ date: day2 }).expect(200);
    expect(list.body.every((a: { status: string }) => a.status === 'draft')).toBe(true);
  });

  it('refuses dates when the slot does not run', async () => {
    // The sample timetable runs Saturday to Thursday.
    let friday = new Date(Date.now() + 6 * 3600_000);
    while (friday.getUTCDay() !== 5) friday = new Date(friday.getTime() + 86_400_000);
    await request(env.app).put('/admin/allocations').set(bearer(admin))
      .send({ serviceDate: friday.toISOString().slice(0, 10), timeSlotId: slot('R-05|student|to_campus|07:00'), busIds: [bus('H-14')], status: 'draft' }).expect(422);
  });
});
