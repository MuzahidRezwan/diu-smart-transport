import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpDirectory, OidcProvider } from '../src/auth/providers.js';
import { setup, type TestEnv } from './helpers.js';

// Port 1 refuses connections at once, standing in for a university system that is down.
const DOWN = 'http://127.0.0.1:1';

let env: TestEnv;
beforeAll(async () => { env = await setup({ directory: new HttpDirectory(DOWN, 'test-token') }); });
afterAll(async () => { await env?.close(); });

describe('when a university system is down', () => {
  it('sends the rider back to the app with a reason instead of an error page', async () => {
    const start = await request(env.app).get('/auth/sso/start?client=web').expect(200);
    const state = new URL(start.body.authorizationUrl).searchParams.get('state')!;
    const cb = await request(env.app).get('/auth/sso/callback').query({ state, mock_id: '232-35-797' }).expect(303);
    const back = new URL(cb.headers.location!);
    expect(back.origin + back.pathname).toBe('http://web.test/auth/callback');
    expect(back.searchParams.get('error')).toBe('university_unavailable');
    expect(back.searchParams.get('code')).toBeNull();
  });

  it('answers 503 with a clear message when sign-in cannot start', async () => {
    const original = env.ctx.sso;
    env.ctx.sso = new OidcProvider({ issuer: DOWN, clientId: 'x', clientSecret: 'y', scopes: 'openid', idClaim: 'university_id' });
    try {
      const res = await request(env.app).get('/auth/sso/start?client=mobile').expect(503);
      expect(res.body.error.code).toBe('upstream_unavailable');
      expect(res.body.error.message).toMatch(/University sign-in is not reachable/);
      expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
    } finally {
      env.ctx.sso = original;
    }
  });
});
