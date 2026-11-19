/**
 * Access tokens: 15-minute JWTs (HS256).
 * Refresh tokens: random, stored hashed, rotated on every use. Presenting an
 * already-used refresh token revokes its whole family (stolen-token detection).
 */
import type { Request, Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthTokens, UserRole } from '@diu/shared';
import type { AppContext } from '../context.js';
import { refreshTokens } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';

const ISSUER = 'diu-transport';
const AUDIENCE = 'diu-transport-api';
export const REFRESH_COOKIE = 'diu_rt';

export interface AccessClaims {
  sub: string;
  role: UserRole;
  uid: string;
}

export async function signAccessToken(ctx: AppContext, claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, uid: claims.uid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ctx.config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(ctx.config.jwtSecret);
}

export async function verifyAccessToken(ctx: AppContext, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, ctx.config.jwtSecret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    return { sub: String(payload.sub), role: payload.role as UserRole, uid: String(payload.uid) };
  } catch {
    throw unauthorized('Your session has expired');
  }
}

async function storeRefresh(ctx: AppContext, userId: string, familyId: string, req: Request): Promise<string> {
  const raw = randomToken(32);
  await ctx.db.insert(refreshTokens).values({
    userId,
    familyId,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + ctx.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    ip: req.ip ?? null,
  });
  return raw;
}

function setRefreshCookie(ctx: AppContext, res: Response, raw: string) {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: ctx.config.isProd,
    sameSite: 'strict',
    path: `${ctx.config.basePath}/auth`,
    maxAge: ctx.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

/** Starts a new session. Web gets the refresh token as an HttpOnly cookie; mobile gets it in the body. */
export async function issueSession(
  ctx: AppContext,
  user: { id: string; role: UserRole; universityId: string },
  req: Request,
  res: Response,
  client: 'web' | 'mobile',
  familyId: string = crypto.randomUUID(),
): Promise<AuthTokens> {
  const accessToken = await signAccessToken(ctx, { sub: user.id, role: user.role, uid: user.universityId });
  const refresh = await storeRefresh(ctx, user.id, familyId, req);
  if (client === 'web') setRefreshCookie(ctx, res, refresh);
  return { accessToken, expiresIn: ctx.config.ACCESS_TOKEN_TTL_SECONDS, ...(client === 'mobile' ? { refreshToken: refresh } : {}) };
}

/** Exchanges a refresh token for a new pair. Reuse of an old token kills the family. */
export async function rotateRefresh(ctx: AppContext, raw: string): Promise<{ userId: string; familyId: string }> {
  const [row] = await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw)));
  if (!row || row.revokedAt || row.expiresAt < new Date()) throw unauthorized();
  if (row.usedAt) {
    await revokeFamily(ctx, row.familyId);
    throw unauthorized('This session was used somewhere else and has been closed for safety. Sign in again.');
  }
  const updated = await ctx.db.update(refreshTokens).set({ usedAt: new Date() })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.usedAt))).returning({ id: refreshTokens.id });
  if (!updated.length) {
    await revokeFamily(ctx, row.familyId);
    throw unauthorized();
  }
  return { userId: row.userId, familyId: row.familyId };
}

export async function revokeFamily(ctx: AppContext, familyId: string) {
  await ctx.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(ctx: AppContext, userId: string) {
  await ctx.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function familyOf(ctx: AppContext, raw: string): Promise<string | null> {
  const [row] = await ctx.db.select({ familyId: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw)));
  return row?.familyId ?? null;
}

export function clearRefreshCookie(ctx: AppContext, res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: `${ctx.config.basePath}/auth` });
}
