import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, adminLogin, bearer, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

describe('rider sign-in through university SSO', () => {
  it('signs a student in and returns their own profile on /me', async () => {
    const { accessToken } = await riderLogin(env, '232-35-797');
    const me = await request(env.app).get('/me').set(bearer(accessToken)).expect(200);
    expect(me.body).toMatchObject({ universityId: '232-35-797', role: 'student', name: 'Khalilur Rahman', category: 'student_tri_semester' });
    expect(me.body.profile).toMatchObject({ department: 'Software Engineering', batch: '41', section: 'G' });
  });

  it('rejects a reused sign-in code', async () => {
    const start = await request(env.app).get('/auth/sso/start?client=mobile');
    const state = new URL(start.body.authorizationUrl).searchParams.get('state')!;
    const cb = await request(env.app).get('/auth/sso/callback').query({ state, mock_id: '221-15-443' });
    const code = new URL(cb.headers.location!, 'http://x').searchParams.get('code')!;
    await request(env.app).post('/auth/sso/complete').send({ code }).expect(200);
    await request(env.app).post('/auth/sso/complete').send({ code }).expect(401);
  });

  it('rejects an unknown OAuth state', async () => {
    await request(env.app).get('/auth/sso/callback').query({ state: 'x'.repeat(40), mock_id: '232-35-797' }).expect(400);
  });

  it('rotates refresh tokens and kills the session when an old one is reused', async () => {
    const first = await riderLogin(env, '241-11-205');
    const second = await request(env.app).post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    // Someone replays the old token: both it and the new one stop working.
    await request(env.app).post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    await request(env.app).post('/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
  });

  it('gives the web client an HttpOnly refresh cookie instead of a token in the body', async () => {
    const start = await request(env.app).get('/auth/sso/start?client=web');
    const state = new URL(start.body.authorizationUrl).searchParams.get('state')!;
    const cb = await request(env.app).get('/auth/sso/callback').query({ state, mock_id: '233-15-020' });
    expect(cb.headers.location).toMatch(/^http:\/\/web\.test\/auth\/callback\?code=/);
    const code = new URL(cb.headers.location!).searchParams.get('code')!;
    const done = await request(env.app).post('/auth/sso/complete').send({ code }).expect(200);
    expect(done.body.refreshToken).toBeUndefined();
    expect(String(done.headers['set-cookie'])).toMatch(/diu_rt=.*HttpOnly.*SameSite=Strict/);
  });
});

describe('authority sign-in', () => {
  it('requires a TOTP code after the password', async () => {
    const step1 = await request(env.app).post('/auth/authority/login').send({ universityId: '710215', password: ADMIN_PASSWORD }).expect(200);
    expect(step1.body.challengeId).toBeTruthy();
    expect(step1.body.mustEnrollTotp).toBe(true);
    expect(step1.body.enrollment.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    await request(env.app).post('/auth/authority/totp').send({ challengeId: step1.body.challengeId, code: '000000' }).expect(401);
    const token = await adminLogin(env);
    const me = await request(env.app).get('/me').set(bearer(token)).expect(200);
    expect(me.body.admin.isMainAdmin).toBe(true);
  });

  it('gives the same error for a wrong ID and a wrong password', async () => {
    const a = await request(env.app).post('/auth/authority/login').send({ universityId: '999999', password: 'test-wrong-password' }).expect(401);
    const b = await request(env.app).post('/auth/authority/login').send({ universityId: '710215', password: 'wrong-password' }).expect(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after five wrong passwords', async () => {
    const token = await adminLogin(env);
    const created = await request(env.app).post('/admin/admins').set(bearer(token))
      .send({ universityId: '710233', name: 'Rafiqul Islam', designation: 'Allocation officer', permissions: ['dashboard.view'] }).expect(201);
    for (let i = 0; i < 5; i++) await request(env.app).post('/auth/authority/login').send({ universityId: '710233', password: 'nope-nope-nope' }).expect(401);
    await request(env.app).post('/auth/authority/login').send({ universityId: '710233', password: created.body.temporaryPassword }).expect(423);
  });

  it('does not let riders use the authority login, or authority accounts use rider SSO', async () => {
    await riderLogin(env, '232-35-812');
    await request(env.app).post('/auth/authority/login').send({ universityId: '232-35-812', password: 'anything-long' }).expect(401);
    const start = await request(env.app).get('/auth/sso/start?client=mobile');
    const state = new URL(start.body.authorizationUrl).searchParams.get('state')!;
    const cb = await request(env.app).get('/auth/sso/callback').query({ state, mock_id: '710215' }).expect(303);
    expect(cb.headers.location).toContain('error=use_authority_login');
  });

  it('blocks riders from every /admin endpoint', async () => {
    const { accessToken } = await riderLogin(env, '232-35-797');
    await request(env.app).get('/admin/fleet/buses').set(bearer(accessToken)).expect(403);
    await request(env.app).get('/admin/payments?from=2026-01-01&to=2026-01-02').set(bearer(accessToken)).expect(403);
    await request(env.app).get('/admin/fleet/buses').expect(401);
  });
});
