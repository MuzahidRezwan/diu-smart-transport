/**
 * Push notifications. The mobile app registers an Expo push token
 * (which wraps FCM on Android and APNs on iOS) through POST /me/devices.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { deviceTokens, semesters, transportCards, users } from '../db/schema.js';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSender {
  send(tokens: string[], message: PushMessage): Promise<void>;
}

export class ConsolePushSender implements PushSender {
  public readonly sent: { tokens: string[]; message: PushMessage }[] = [];
  constructor(private readonly log: (msg: string) => void = () => undefined) {}
  async send(tokens: string[], message: PushMessage) {
    this.sent.push({ tokens, message });
    this.log(`[push] ${tokens.length} device(s): ${message.title}`);
  }
}

export class ExpoPushSender implements PushSender {
  constructor(private readonly accessToken?: string) {}
  async send(tokens: string[], message: PushMessage) {
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100).map((to) => ({ to, sound: 'default', title: message.title, body: message.body, data: message.data }));
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}) },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Expo push failed: ${res.status}`);
    }
  }
}

export type Recipients =
  | { kind: 'all' }
  | { kind: 'students' }
  | { kind: 'faculty' }
  | { kind: 'route'; routeId: string }
  | { kind: 'users'; userIds: string[] };

/** Resolves device tokens for an audience. Route audiences = active card holders of that route. */
export async function tokensFor(db: DB, to: Recipients): Promise<string[]> {
  const base = db.select({ token: deviceTokens.token }).from(deviceTokens).innerJoin(users, eq(users.id, deviceTokens.userId));
  let rows: { token: string }[];
  switch (to.kind) {
    case 'all': rows = await base.where(inArray(users.role, ['student', 'faculty', 'staff'])); break;
    case 'students': rows = await base.where(eq(users.role, 'student')); break;
    case 'faculty': rows = await base.where(inArray(users.role, ['faculty', 'staff'])); break;
    case 'users': rows = to.userIds.length ? await base.where(inArray(users.id, to.userIds)) : []; break;
    case 'route':
      rows = await db.select({ token: deviceTokens.token }).from(deviceTokens)
        .innerJoin(transportCards, eq(transportCards.userId, deviceTokens.userId))
        .innerJoin(semesters, and(eq(semesters.id, transportCards.semesterId), sql`${semesters.isCurrent}`))
        .where(and(eq(transportCards.routeId, to.routeId), eq(transportCards.status, 'active')));
      break;
  }
  return [...new Set(rows.map((r) => r.token))];
}

/** Best-effort: a push failure never fails the request that caused it. */
export async function notify(db: DB, push: PushSender, to: Recipients, message: PushMessage): Promise<number> {
  try {
    const tokens = await tokensFor(db, to);
    if (tokens.length) await push.send(tokens, message);
    return tokens.length;
  } catch {
    return 0;
  }
}
