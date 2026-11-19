import type { RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import { hasPermission, type Permission, type UserRole } from '@diu/shared';
import type { AppContext } from '../context.js';
import { adminAccounts, users } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from './tokens.js';

export interface AuthInfo {
  userId: string;
  role: UserRole;
  universityId: string;
  name: string;
}
export interface AdminInfo {
  isMainAdmin: boolean;
  permissions: string[];
  designation: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
      admin?: AdminInfo;
    }
  }
}

/** Verifies the bearer token and loads the account. Permissions are read fresh on every request. */
export function authenticate(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized('Sign in first');
    const claims = await verifyAccessToken(ctx, token);
    const [user] = await ctx.db.select({ id: users.id, role: users.role, universityId: users.universityId, name: users.name, isActive: users.isActive })
      .from(users).where(eq(users.id, claims.sub));
    if (!user || !user.isActive) throw unauthorized('This account is not active');
    req.auth = { userId: user.id, role: user.role, universityId: user.universityId, name: user.name };
    if (user.role === 'authority') {
      const [acc] = await ctx.db.select().from(adminAccounts).where(eq(adminAccounts.userId, user.id));
      if (!acc || !acc.isActive) throw unauthorized('This admin account is not active');
      req.admin = { isMainAdmin: acc.isMainAdmin, permissions: acc.permissions, designation: acc.designation };
    }
    next();
  };
}

export const requireRoles = (...roles: UserRole[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  if (!roles.includes(req.auth.role)) throw forbidden();
  next();
};

/** Students, faculty and staff: the people who ride. */
export const requireRider = requireRoles('student', 'faculty', 'staff');

/** Authority account holding every listed permission. */
export const requirePermission = (...needed: Permission[]): RequestHandler => (req, _res, next) => {
  if (!req.auth || req.auth.role !== 'authority' || !req.admin) throw forbidden();
  for (const p of needed) if (!hasPermission(req.admin, p)) throw forbidden(`Needs permission: ${p}`);
  next();
};

export const can = (req: { admin?: AdminInfo }, p: Permission) => Boolean(req.admin && hasPermission(req.admin, p));
