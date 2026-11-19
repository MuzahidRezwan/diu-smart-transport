import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshTokens } from '../src/db/schema.js';
import { expiryTask } from '../src/jobs/tasks.js';
import { setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env?.close(); });

describe('nightly expiry job', () => {
  it('deletes refresh tokens a week after they expire and keeps newer ones', async () => {
    const userId = env.seeded.mainAdmin.userId;
    const familyId = randomUUID();
    const day = 86_400_000;
    await env.ctx.db.insert(refreshTokens).values([
      { userId, familyId, tokenHash: 'old-expired-hash', expiresAt: new Date(Date.now() - 10 * day) },
      { userId, familyId, tokenHash: 'just-expired-hash', expiresAt: new Date(Date.now() - 1 * day) },
      { userId, familyId, tokenHash: 'still-valid-hash', expiresAt: new Date(Date.now() + 20 * day) },
    ]);
    const result = await expiryTask(env.ctx);
    expect(result.refreshTokensDeleted).toBe(1);
    const left = await env.ctx.db.select({ h: refreshTokens.tokenHash }).from(refreshTokens).where(eq(refreshTokens.familyId, familyId));
    expect(left.map((r) => r.h).sort()).toEqual(['just-expired-hash', 'still-valid-hash']);
  });
});
