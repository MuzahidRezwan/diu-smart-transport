import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { users } from '../src/db/schema.js';
import { bearer, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  await riderLogin(env, '232-35-797');
  await env.ctx.db.update(users).set({ homeRouteId: env.seeded.routeIds['R-01'] }).where(eq(users.universityId, '232-35-797'));
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await env?.close(); });

/** Signs in at the faked time (tokens are checked against the clock), then asks for My Bus. */
async function myBus(direction: string) {
  const { accessToken } = await riderLogin(env, '232-35-797');
  return request(env.app).get('/me/my-bus').query({ direction }).set(bearer(accessToken)).expect(200);
}

describe('My Bus', () => {
  it('on a day without trips, points to the first bus of the next day with trips', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T06:00:00Z')); // Friday 12:00 in Dhaka; the sample timetable has no Friday trips
    const { body } = await myBus('to_campus');
    expect(body.isToday).toBe(false);
    expect(body.serviceDate).toBe('2026-11-21');
    expect(body.next.direction).toBe('to_campus');
    expect(body.minutesUntil).toBeNull();
  });

  it('after the last trip of the day, points to the next morning', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T17:00:00Z')); // Saturday 23:00 in Dhaka
    const { body } = await myBus('from_campus');
    expect(body.serviceDate).toBe('2026-11-22');
    expect(body.next.direction).toBe('from_campus');
  });

  it('during a service day, gives today\'s next bus and the minutes until it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z')); // Saturday 06:00 in Dhaka
    const { body } = await myBus('to_campus');
    expect(body.isToday).toBe(true);
    expect(body.serviceDate).toBe('2026-11-21');
    expect(body.minutesUntil).toBe(body.next.departureMinutes - 360);
  });
});
