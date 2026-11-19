/** One-time, short-lived values (OAuth state, login codes, 2FA challenges). Only hashes are stored. */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { authHandoffs } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export type HandoffKind = 'oauth_state' | 'login_code' | 'totp_challenge';

export async function createHandoff(db: DB, kind: HandoffKind, payload: Record<string, unknown>, ttlSeconds: number) {
  const key = randomToken(32);
  const [row] = await db.insert(authHandoffs).values({
    kind,
    keyHash: sha256(`${kind}:${key}`),
    payload,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  }).returning({ id: authHandoffs.id });
  return { id: row!.id, key };
}

/** Marks the value used and returns its payload, or null if unknown, used or expired. */
export async function consumeHandoff<T = Record<string, unknown>>(db: DB, kind: HandoffKind, key: string): Promise<T | null> {
  const rows = await db.update(authHandoffs).set({ usedAt: new Date() })
    .where(and(eq(authHandoffs.keyHash, sha256(`${kind}:${key}`)), isNull(authHandoffs.usedAt), gt(authHandoffs.expiresAt, new Date())))
    .returning({ payload: authHandoffs.payload });
  return (rows[0]?.payload as T | undefined) ?? null;
}

/** Reads a challenge by id without consuming it (2FA allows a few attempts). */
export async function peekHandoffById(db: DB, kind: HandoffKind, id: string) {
  const [row] = await db.select().from(authHandoffs)
    .where(and(eq(authHandoffs.id, id), eq(authHandoffs.kind, kind), isNull(authHandoffs.usedAt), gt(authHandoffs.expiresAt, new Date())));
  return row ?? null;
}

export async function updateHandoffPayload(db: DB, id: string, payload: Record<string, unknown>) {
  await db.update(authHandoffs).set({ payload }).where(eq(authHandoffs.id, id));
}

export async function closeHandoff(db: DB, id: string) {
  await db.update(authHandoffs).set({ usedAt: new Date() }).where(eq(authHandoffs.id, id));
}
