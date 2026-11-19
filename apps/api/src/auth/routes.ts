/**
 * /auth: rider sign-in through the university, authority sign-in with
 * password + TOTP, refresh rotation and logout.
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { authorityLoginSchema, refreshSchema, totpVerifySchema } from '@diu/shared';
import type { AppContext } from '../context.js';
import { adminAccounts, userProfiles, users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import { HttpError, badRequest, forbidden, parse, unauthorized } from '../lib/errors.js';
import { closeHandoff, consumeHandoff, createHandoff, peekHandoffById, updateHandoffPayload } from './handoffs.js';
import { authenticate } from './middleware.js';
import { REFRESH_COOKIE, clearRefreshCookie, familyOf, issueSession, revokeAllForUser, revokeFamily, rotateRefresh } from './tokens.js';

authenticator.options = { window: 1 };

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MAX_TOTP_ATTEMPTS = 5;
const clientSchema = z.enum(['web', 'mobile']).default('web');
/** A real bcrypt hash to compare against when the account does not exist, so timing does not reveal valid IDs. */
let timingHashP: Promise<string> | undefined;
const timingHash = () => (timingHashP ??= bcrypt.hash(randomToken(16), 12));

export function authRouter(ctx: AppContext): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: ctx.config.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: 'draft-7', legacyHeaders: false });
  r.use(limiter);
  const callbackUrl = ctx.config.apiUrl('/auth/sso/callback');

  /* ---------- riders: university SSO ---------- */

  r.get('/sso/start', async (req, res) => {
    const client = parse(clientSchema, req.query.client);
    const verifier = randomToken(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const { key: state } = await createHandoff(ctx.db, 'oauth_state', { verifier, client }, 600);
    const authorizationUrl = await ctx.sso.authorizationUrl({ state, codeChallenge: challenge, redirectUri: callbackUrl });
    res.json({ authorizationUrl });
  });

  if (ctx.sso.mode === 'mock' && !ctx.config.isProd) {
    // Stand-in for the university login page during development.
    r.get('/sso/mock-authorize', (req, res) => {
      const state = String(req.query.state ?? '').replace(/[^A-Za-z0-9_-]/g, '');
      // The form posts here and the callback then redirects to the web app or mobile app, so those targets must be allowed.
      const mobileScheme = `${new URL(ctx.config.MOBILE_REDIRECT_URI).protocol}`;
      res.setHeader('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(ctx.config.WEB_APP_URL).origin} ${mobileScheme}; frame-ancestors ${ctx.config.DEMO_MODE ? 'https://huggingface.co' : "'none'"}`);
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Mock DIU sign-in</title>
<body style="font-family:system-ui;max-width:420px;margin:60px auto">
<h2>Mock DIU sign-in (${ctx.config.DEMO_MODE ? 'demo' : 'development only'})</h2><p>Stands in for the university's login page. Type a university ID, e.g. 232-35-797 (student with a transport card) or 710410 (faculty with a card). Any other ID signs in as a new rider without a card.</p>
<form action="${ctx.config.basePath}/auth/sso/callback" method="get"><input type="hidden" name="state" value="${state}">
<input name="mock_id" placeholder="University ID" required style="padding:8px;width:100%"><br><br><button>Sign in</button></form></body>`);
    });
  }

  r.get('/sso/callback', async (req, res) => {
    const q = parse(z.object({ state: z.string().min(16), code: z.string().optional(), mock_id: z.string().optional(), error: z.string().optional() }), req.query);
    const st = await consumeHandoff<{ verifier: string; client: 'web' | 'mobile' }>(ctx.db, 'oauth_state', q.state);
    if (!st) throw badRequest('This sign-in link has expired. Start again.');
    const target = st.client === 'mobile' ? ctx.config.MOBILE_REDIRECT_URI : new URL('/auth/callback', ctx.config.WEB_APP_URL).toString();
    const fail = (reason: string) => res.redirect(303, `${target}?error=${encodeURIComponent(reason)}`);
    if (q.error) return fail('sign_in_cancelled');

    const code = ctx.sso.mode === 'mock' && q.mock_id ? `mock.${q.mock_id.trim()}` : q.code;
    if (!code) return fail('missing_code');
    // The browser landed here, so failures become a redirect with a reason, not a JSON page.
    let identity: Awaited<ReturnType<typeof ctx.sso.exchange>>;
    let person: Awaited<ReturnType<typeof ctx.directory.lookup>>;
    try {
      identity = await ctx.sso.exchange({ code, codeVerifier: st.verifier, redirectUri: callbackUrl });
      person = await ctx.directory.lookup(identity.universityId);
    } catch (err) {
      if (err instanceof HttpError && err.status === 503) {
        req.log?.warn({ err }, 'university system unavailable during sign-in');
        return fail('university_unavailable');
      }
      if (err instanceof HttpError && err.status === 401) return fail('sign_in_failed');
      throw err;
    }
    if (!person) return fail('not_in_directory');

    // Upsert identity and the rider's own profile. Profile goes to its own table.
    const [existing] = await ctx.db.select().from(users).where(eq(users.universityId, person.universityId));
    if (existing?.role === 'authority') return fail('use_authority_login');
    let userId = existing?.id;
    if (existing) {
      await ctx.db.update(users).set({ name: person.name, category: person.category, role: person.role, lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, existing.id));
    } else {
      const [created] = await ctx.db.insert(users).values({ universityId: person.universityId, name: person.name, role: person.role, category: person.category, lastLoginAt: new Date() }).returning({ id: users.id });
      userId = created!.id;
    }
    const profile = {
      department: person.department ?? null, program: person.program ?? null, batch: person.batch ?? null, section: person.section ?? null,
      teacherInitial: person.teacherInitial ?? null, designation: person.designation ?? null, phone: person.phone ?? null,
      email: person.email ?? identity.email ?? null, photoUrl: person.photoUrl ?? null, syncedAt: new Date(),
    };
    await ctx.db.insert(userProfiles).values({ userId: userId!, ...profile }).onConflictDoUpdate({ target: userProfiles.userId, set: profile });

    const { key: loginCode } = await createHandoff(ctx.db, 'login_code', { userId, client: st.client }, 120);
    res.redirect(303, `${target}?code=${encodeURIComponent(loginCode)}`);
  });

  r.post('/sso/complete', async (req, res) => {
    const body = parse(z.object({ code: z.string().min(20).max(100) }), req.body);
    const p = await consumeHandoff<{ userId: string; client: 'web' | 'mobile' }>(ctx.db, 'login_code', body.code);
    if (!p) throw unauthorized('This sign-in code has expired. Start again.');
    const [user] = await ctx.db.select().from(users).where(eq(users.id, p.userId));
    if (!user || !user.isActive) throw unauthorized('This account is not active');
    res.json(await issueSession(ctx, user, req, res, p.client));
  });

  /* ---------- authority: password, then TOTP ---------- */

  r.post('/authority/login', async (req, res) => {
    const body = parse(authorityLoginSchema, req.body);
    const generic = new HttpError(401, 'invalid_credentials', 'Wrong ID or password');
    const [row] = await ctx.db.select({ user: users, acc: adminAccounts }).from(users)
      .innerJoin(adminAccounts, eq(adminAccounts.userId, users.id))
      .where(and(eq(users.universityId, body.universityId), eq(users.role, 'authority')));
    if (!row || !row.acc.isActive || !row.user.isActive) {
      await bcrypt.compare(body.password, await timingHash()); // same timing as a real check
      throw generic;
    }
    if (row.acc.lockedUntil && row.acc.lockedUntil > new Date()) {
      throw new HttpError(423, 'locked', `Too many wrong attempts. Try again after ${row.acc.lockedUntil.toISOString()}.`);
    }
    if (!(await bcrypt.compare(body.password, row.acc.passwordHash))) {
      const attempts = row.acc.failedAttempts + 1;
      await ctx.db.update(adminAccounts).set({
        failedAttempts: attempts >= MAX_FAILED_LOGINS ? 0 : attempts,
        lockedUntil: attempts >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      }).where(eq(adminAccounts.userId, row.user.id));
      await audit(ctx.db, { actorId: row.user.id, action: 'auth.login_failed', entity: 'admin_account', entityId: row.user.id, req });
      throw generic;
    }
    await ctx.db.update(adminAccounts).set({ failedAttempts: 0, lockedUntil: null }).where(eq(adminAccounts.userId, row.user.id));

    if (ctx.config.DEMO_MODE) {
      // Public demo only (refused in production): visitors share one account, so 2FA is skipped.
      await ctx.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.user.id));
      await audit(ctx.db, { actorId: row.user.id, action: 'auth.login', entity: 'admin_account', entityId: row.user.id, req });
      return void res.json({ ...(await issueSession(ctx, row.user, req, res, 'web')), demo: true });
    }

    let enrollment: { otpauthUrl: string; secret: string } | undefined;
    if (!row.acc.totpEnabled) {
      const secret = authenticator.generateSecret();
      await ctx.db.update(adminAccounts).set({ totpSecretEnc: encrypt(ctx.config.dataKey, secret) }).where(eq(adminAccounts.userId, row.user.id));
      enrollment = { secret, otpauthUrl: authenticator.keyuri(row.user.universityId, 'DIU Transport', secret) };
    }
    const challenge = await createHandoff(ctx.db, 'totp_challenge', { userId: row.user.id, attempts: 0, client: req.body?.client === 'mobile' ? 'mobile' : 'web' }, 300);
    res.json({ challengeId: challenge.id, mustEnrollTotp: Boolean(enrollment), enrollment, mustChangePassword: row.acc.mustChangePassword });
  });

  r.post('/authority/totp', async (req, res) => {
    const body = parse(totpVerifySchema, req.body);
    const ch = await peekHandoffById(ctx.db, 'totp_challenge', body.challengeId);
    if (!ch) throw unauthorized('This sign-in attempt has expired. Enter your password again.');
    const payload = ch.payload as { userId: string; attempts: number; client: 'web' | 'mobile' };
    const [row] = await ctx.db.select({ user: users, acc: adminAccounts }).from(users)
      .innerJoin(adminAccounts, eq(adminAccounts.userId, users.id)).where(eq(users.id, payload.userId));
    if (!row?.acc.totpSecretEnc) throw unauthorized();
    const ok = authenticator.verify({ token: body.code, secret: decrypt(ctx.config.dataKey, row.acc.totpSecretEnc) });
    if (!ok) {
      const attempts = payload.attempts + 1;
      if (attempts >= MAX_TOTP_ATTEMPTS) await closeHandoff(ctx.db, ch.id);
      else await updateHandoffPayload(ctx.db, ch.id, { ...payload, attempts });
      throw new HttpError(401, 'invalid_code', 'That code is not right. Check the time on your phone and try again.');
    }
    await closeHandoff(ctx.db, ch.id);
    if (!row.acc.totpEnabled) await ctx.db.update(adminAccounts).set({ totpEnabled: true }).where(eq(adminAccounts.userId, row.user.id));
    await ctx.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.user.id));
    await audit(ctx.db, { actorId: row.user.id, action: 'auth.login', entity: 'admin_account', entityId: row.user.id, req });
    res.json(await issueSession(ctx, row.user, req, res, payload.client));
  });

  r.post('/authority/change-password', authenticate(ctx), async (req, res) => {
    if (req.auth?.role !== 'authority') throw forbidden();
    if (ctx.config.DEMO_MODE) throw forbidden('Password changes are turned off in the demo, so the next visitor can still sign in.');
    const body = parse(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12, 'Use at least 12 characters').max(200),
    }), req.body);
    const [acc] = await ctx.db.select().from(adminAccounts).where(eq(adminAccounts.userId, req.auth.userId));
    if (!acc || !(await bcrypt.compare(body.currentPassword, acc.passwordHash))) throw new HttpError(401, 'invalid_credentials', 'Current password is wrong');
    if (body.newPassword === body.currentPassword) throw badRequest('Choose a different password');
    await ctx.db.update(adminAccounts).set({ passwordHash: await bcrypt.hash(body.newPassword, 12), mustChangePassword: false, updatedAt: new Date() })
      .where(eq(adminAccounts.userId, req.auth.userId));
    await revokeAllForUser(ctx, req.auth.userId);
    await audit(ctx.db, { actorId: req.auth.userId, action: 'auth.password_changed', entity: 'admin_account', entityId: req.auth.userId, req });
    res.json({ ok: true, message: 'Password changed. Sign in again on every device.' });
  });

  /* ---------- sessions ---------- */

  r.post('/refresh', async (req, res) => {
    const body = parse(refreshSchema, req.body ?? {});
    const raw = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw unauthorized();
    const { userId, familyId } = await rotateRefresh(ctx, raw);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
    if (!user || !user.isActive) throw unauthorized('This account is not active');
    res.json(await issueSession(ctx, user, req, res, body.refreshToken ? 'mobile' : 'web', familyId));
  });

  r.post('/logout', async (req, res) => {
    const raw = (req.body?.refreshToken as string | undefined) ?? req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      const family = await familyOf(ctx, raw);
      if (family) await revokeFamily(ctx, family);
    }
    clearRefreshCookie(ctx, res);
    res.json({ ok: true });
  });

  r.post('/logout-all', authenticate(ctx), async (req, res) => {
    await revokeAllForUser(ctx, req.auth!.userId);
    clearRefreshCookie(ctx, res);
    res.json({ ok: true });
  });

  return r;
}
