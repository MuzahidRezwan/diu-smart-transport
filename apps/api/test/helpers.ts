import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { connect, MIGRATIONS_DIR, type Database } from '../src/db/client.js';
import { adminAccounts, users } from '../src/db/schema.js';
import { seed, type SeedResult } from '../src/db/seed-data.js';
import { MockDirectory, MockSsoProvider } from '../src/auth/providers.js';
import { MockGateway } from '../src/modules/payments/gateway.js';
import type { MlClient } from '../src/modules/predictions/ml-client.js';
import { ConsolePushSender } from '../src/notifications/push.js';
import { decrypt } from '../src/lib/crypto.js';
import { noopRealtime, type AppContext } from '../src/context.js';

export const ADMIN_PASSWORD = 'test-admin-password-123';

/** ML fake: echoes a fixed demand so tests do not need the Python service. */
export const fakeMl: MlClient = {
  async forecast(req) {
    return { modelVersion: 'test', rows: req.dates.flatMap((date) => req.slots.map((s) => ({ date, timeSlotId: s.timeSlotId, expectedMax: 60, predicted: 50, p90: 58 }))) };
  },
  async plan() { throw new Error('optimizer offline in tests'); },
  async parseRoutine() { return { contentHash: 'h1', department: 'SWE', sessions: [], warnings: [] }; },
  async fetchRoutine() { return { contentHash: 'h1', department: 'SWE', sessions: [], warnings: [] }; },
};

export interface TestEnv {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  seeded: SeedResult;
  push: ConsolePushSender;
  close(): Promise<void>;
}

/**
 * TEST_PG_URL unset: in-memory PGlite (fast, no setup).
 * TEST_PG_URL set (a superuser URL): a fresh database on real PostgreSQL with the
 * production roles from drizzle/roles.sql. Migrations run as diu_migrator, rider
 * code as diu_app and authority code as transport_admin, so a missing grant fails
 * the test the same way it would fail in production.
 */
async function testDatabase(): Promise<Database> {
  const superUrl = process.env.TEST_PG_URL;
  if (!superUrl) return connect({ migrate: true });
  const { Client } = await import('pg');
  const name = `diu_test_${randomBytes(5).toString('hex')}`;
  const at = (user: string, db = name) => { const u = new URL(superUrl); u.username = user; u.password = ''; u.pathname = `/${db}`; return u.toString(); };
  const admin = new Client({ connectionString: superUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const inDb = new Client({ connectionString: (() => { const u = new URL(superUrl); u.pathname = `/${name}`; return u.toString(); })() });
  await inDb.connect();
  await inDb.query(readFileSync(`${MIGRATIONS_DIR}/roles.sql`, 'utf8'));
  await inDb.end();
  const database = await connect({ databaseUrl: at('diu_app'), adminDatabaseUrl: at('transport_admin'), migrationDatabaseUrl: at('diu_migrator'), migrate: true });
  return {
    ...database,
    async close() {
      await database.close();
      const c = new Client({ connectionString: superUrl });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

/**
 * A fresh app and database. Tests use the small 'sample' timetable (Saturday–Thursday
 * only, predictable codes like R-01 and SH-1) unless they ask for the real 'diu' one.
 */
export async function setup(overrides: Partial<AppContext> = {}, opts: { timetable?: 'diu' | 'sample' } = {}): Promise<TestEnv> {
  const config = loadConfig({ NODE_ENV: 'test', PUBLIC_API_URL: 'http://api.test', WEB_APP_URL: 'http://web.test' });
  const database = await testDatabase();
  const push = new ConsolePushSender();
  const ctx: AppContext = {
    config, db: database.db, adminDb: database.adminDb,
    sso: new MockSsoProvider(config.PUBLIC_API_URL), directory: new MockDirectory(), gateway: new MockGateway(config.PUBLIC_API_URL),
    ml: fakeMl, push, realtime: noopRealtime, ...overrides,
  };
  // A semester around today, so the tests keep working in any year.
  const day = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const seeded = await seed(ctx.db, { adminPassword: ADMIN_PASSWORD, timetable: opts.timetable ?? 'sample', semester: { code: 'FALL-2026', name: 'Test semester', startsOn: day(-60), endsOn: day(60) } });
  return { ctx, app: createApp(ctx), seeded, push, close: () => database.close() };
}

/** Full rider sign-in through the (mock) university SSO. Returns an access token. */
export async function riderLogin(env: TestEnv, universityId: string, client: 'web' | 'mobile' = 'mobile') {
  const start = await request(env.app).get(`/auth/sso/start?client=${client}`).expect(200);
  const state = new URL(start.body.authorizationUrl).searchParams.get('state')!;
  const cb = await request(env.app).get('/auth/sso/callback').query({ state, mock_id: universityId }).expect(303);
  const code = new URL(cb.headers.location!, 'http://x').searchParams.get('code')!;
  const done = await request(env.app).post('/auth/sso/complete').send({ code }).expect(200);
  return done.body as { accessToken: string; refreshToken?: string };
}

/** Authority sign-in: password, then a valid TOTP code (enrolling on first use). */
export async function adminLogin(env: TestEnv, universityId = '710215', password = ADMIN_PASSWORD) {
  const step1 = await request(env.app).post('/auth/authority/login').send({ universityId, password }).expect(200);
  const [user] = await env.ctx.db.select({ id: users.id }).from(users).where(eq(users.universityId, universityId));
  const [acc] = await env.ctx.db.select().from(adminAccounts).where(eq(adminAccounts.userId, user!.id));
  const code = authenticator.generate(decrypt(env.ctx.config.dataKey, acc!.totpSecretEnc!));
  const step2 = await request(env.app).post('/auth/authority/totp').send({ challengeId: step1.body.challengeId, code }).expect(200);
  return step2.body.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The nth day with trips after today in Dhaka, for the sample timetable (it has no Friday trips). */
export function nextServiceDate(n = 1): string {
  const d = new Date(Date.now() + 6 * 3600_000);
  let k = 0;
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 5) k++;
  }
  return d.toISOString().slice(0, 10);
}
