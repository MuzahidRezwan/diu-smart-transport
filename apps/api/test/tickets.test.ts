import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, riderLogin, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env?.close(); });

describe('complaints and help requests', () => {
  it('gives every ticket its own number when many arrive at once', async () => {
    const riders = await Promise.all(['232-35-797', '221-15-443', '233-15-020'].map((id) => riderLogin(env, id)));
    const send = (i: number) => request(env.app).post('/me/tickets').set(bearer(riders[i % riders.length]!.accessToken))
      .send({ kind: 'complaint', category: 'overcrowding', body: `Bus was full at DSC, report number ${i}.` });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => send(i)));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
    const numbers = results.map((r) => r.body.number as string);
    expect(new Set(numbers).size).toBe(12);
    expect(numbers.every((n) => /^C-\d{4,}$/.test(n))).toBe(true);
  });
});
