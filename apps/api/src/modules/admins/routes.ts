/** Main admin manages co-admins and their permissions. */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminCreateSchema, adminUpdateSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { adminAccounts, users } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { revokeAllForUser } from '../../auth/tokens.js';
import { audit } from '../../lib/audit.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors.js';
import { actorId } from '../common.js';

export function adminsRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/admins', requirePermission('admins.manage'), async (_req, res) => {
    res.json(await db.select({
      userId: users.id, universityId: users.universityId, name: users.name, designation: adminAccounts.designation, isMainAdmin: adminAccounts.isMainAdmin,
      permissions: adminAccounts.permissions, isActive: adminAccounts.isActive, totpEnabled: adminAccounts.totpEnabled, lastLoginAt: users.lastLoginAt,
    }).from(adminAccounts).innerJoin(users, eq(users.id, adminAccounts.userId)).orderBy(asc(users.name)));
  });

  /** Returns a one-time temporary password. The co-admin must change it and set up 2FA at first sign-in. */
  r.post('/admins', requirePermission('admins.manage'), async (req, res) => {
    const body = parse(adminCreateSchema, req.body);
    if (body.permissions.includes('admins.manage') && !req.admin?.isMainAdmin) throw forbidden('Only the main admin can give admin management');
    const [existing] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.universityId, body.universityId));
    if (existing?.role === 'authority') throw conflict('This person is already an admin');
    if (existing) throw conflict('This ID belongs to a rider account. Use a separate staff ID for the dashboard.');
    const tempPassword = `${randomToken(9)}-${randomToken(6)}`;
    const created = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ universityId: body.universityId, name: body.name, role: 'authority' }).returning({ id: users.id });
      await tx.insert(adminAccounts).values({ userId: u!.id, designation: body.designation, passwordHash: await bcrypt.hash(tempPassword, 12), permissions: body.permissions, createdBy: actorId(req) });
      return u!;
    });
    await audit(db, { actorId: actorId(req), action: 'admins.created', entity: 'admin_account', entityId: created.id, after: { universityId: body.universityId, name: body.name, permissions: body.permissions }, req });
    res.status(201).json({ userId: created.id, temporaryPassword: tempPassword, note: 'Give this password to the person directly. It is shown only once.' });
  });

  r.patch('/admins/:userId', requirePermission('admins.manage'), async (req, res) => {
    const userId = parse(z.string().uuid(), req.params.userId);
    const body = parse(adminUpdateSchema, req.body);
    if (userId === actorId(req)) throw badRequest('You cannot change your own permissions');
    const [acc] = await db.select().from(adminAccounts).where(eq(adminAccounts.userId, userId));
    if (!acc) throw notFound('Admin');
    if (acc.isMainAdmin) throw forbidden('The main admin cannot be changed here');
    if (body.permissions?.includes('admins.manage') && !req.admin?.isMainAdmin) throw forbidden('Only the main admin can give admin management');
    const [after] = await db.update(adminAccounts).set({ ...(body.permissions ? { permissions: body.permissions } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}), updatedAt: new Date() })
      .where(eq(adminAccounts.userId, userId)).returning();
    if (body.isActive === false) await revokeAllForUser(ctx, userId);
    await audit(db, { actorId: actorId(req), action: 'admins.updated', entity: 'admin_account', entityId: userId, before: { permissions: acc.permissions, isActive: acc.isActive }, after: { permissions: after!.permissions, isActive: after!.isActive }, req });
    res.json({ userId, permissions: after!.permissions, isActive: after!.isActive });
  });

  return r;
}
