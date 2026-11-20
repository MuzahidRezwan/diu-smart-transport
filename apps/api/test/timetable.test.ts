import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { users } from '../src/db/schema.js';
import { bearer, riderLogin, setup, type TestEnv } from './helpers.js';

/**
 * The seeded DIU timetable (apps/api/src/db/diu-timetable.ts), as published on
 * https://daffodilvarsity.edu.bd/transport. Dates are fixed: 2026-11-20 is a Friday.
 */
const FRIDAY = '2026-11-20';
const SATURDAY = '2026-11-21';
const STUDENT = '232-35-797';
const STAFF = '710301';

interface Slot { routeCode: string; direction: string; audience: string; departure: string; note: string | null }

let env: TestEnv;
beforeAll(async () => {
  env = await setup({}, { timetable: 'diu' });
  await riderLogin(env, STUDENT);
  await riderLogin(env, STAFF);
  for (const id of [STUDENT, STAFF]) {
    await env.ctx.db.update(users).set({ homeRouteId: env.seeded.routeIds.R1 }).where(eq(users.universityId, id));
  }
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await env?.close(); });

async function day(date: string, routeCode: string): Promise<Slot[]> {
  const { body } = await request(env.app).get('/schedule').query({ date, routeId: env.seeded.routeIds[routeCode] }).expect(200);
  return body.slots;
}
const times = (slots: Slot[], direction: string) => slots.filter((s) => s.direction === direction).map((s) => s.departure).sort();

describe('DIU timetable', () => {
  it('has the 13 routes: 10 regular and 3 shuttle', async () => {
    const { body } = await request(env.app).get('/routes').expect(200);
    const codes = body.map((r: { code: string }) => r.code);
    expect(codes).toHaveLength(13);
    for (const c of ['R1', 'R4', 'R10', 'R11', 'R13']) expect(codes).toContain(c);
    expect(body.filter((r: { kind: string }) => r.kind === 'shuttle').map((r: { code: string }) => r.code).sort()).toEqual(['R11', 'R12', 'R13']);
  });

  it('runs the Saturday–Thursday trips, with the 4:20 PM bus for employees only', async () => {
    const r1 = await day(SATURDAY, 'R1');
    expect(times(r1, 'to_campus')).toEqual(['07:00', '10:00', '13:00']);
    expect(times(r1, 'from_campus')).toEqual(['11:20', '14:30', '16:20', '17:30']);
    expect(r1.find((s) => s.departure === '16:20')!.audience).toBe('faculty');
    expect(r1.filter((s) => s.departure !== '16:20').every((s) => s.audience === 'student')).toBe(true);
    // Dhamrai has no employee bus.
    expect(times(await day(SATURDAY, 'R7'), 'from_campus')).toEqual(['11:20', '14:30', '17:30']);
  });

  it('runs buses on Friday at the Friday times', async () => {
    const r1 = await day(FRIDAY, 'R1');
    expect(times(r1, 'to_campus')).toEqual(['07:30']);
    expect(times(r1, 'from_campus')).toEqual(['11:30', '16:30']);
    const savar = await day(FRIDAY, 'R8');
    expect(times(savar, 'from_campus')).toEqual(['11:50', '16:50']);
    expect(savar[0]!.note).toMatch(/Savar > Nabinagar > C&B > DSC/);
    // Mirpur ECB route has no Friday trip.
    expect(await day(FRIDAY, 'R4')).toEqual([]);
  });

  it('carries the website notes on partial trips', async () => {
    const baipail = await day(SATURDAY, 'R6');
    expect(baipail.find((s) => s.direction === 'from_campus' && s.departure === '17:30')!.note).toBe('Goes up to Polashbari U-turn only');
    expect(baipail.find((s) => s.direction === 'to_campus' && s.departure === '07:00')!.note).toBeNull();
  });

  it('gives students the regular bus and staff the employee bus in the afternoon', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${SATURDAY}T09:00:00Z`)); // 15:00 in Dhaka
    const ask = async (id: string) => {
      const { accessToken } = await riderLogin(env, id);
      return (await request(env.app).get('/me/my-bus').query({ direction: 'from_campus' }).set(bearer(accessToken)).expect(200)).body;
    };
    expect((await ask(STUDENT)).next.departure).toBe('17:30');
    expect((await ask(STAFF)).next.departure).toBe('16:20');
  });

  it('shows staff the regular trips in their schedule, and Friday trips on Friday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${FRIDAY}T00:00:00Z`)); // 06:00 in Dhaka
    const { accessToken } = await riderLogin(env, STAFF);
    const { body } = await request(env.app).get('/me/schedule').set(bearer(accessToken)).expect(200);
    expect(times(body.slots, 'to_campus')).toEqual(['07:30']);
    const bus = (await request(env.app).get('/me/my-bus').query({ direction: 'to_campus' }).set(bearer(accessToken)).expect(200)).body;
    expect(bus.isToday).toBe(true);
    expect(bus.next.departure).toBe('07:30');
  });
});
