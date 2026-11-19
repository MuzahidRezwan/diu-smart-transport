import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { noticeCreateSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { notices, routes } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { notFound, parse } from '../../lib/errors.js';
import { notify, type Recipients } from '../../notifications/push.js';
import { actorId } from '../common.js';

export function noticesAdminRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/notices', requirePermission('dashboard.view'), async (_req, res) => {
    res.json(await db.select({ id: notices.id, title: notices.title, body: notices.body, audience: notices.audience, routeId: notices.routeId, routeName: routes.name, publishedAt: notices.publishedAt })
      .from(notices).leftJoin(routes, eq(routes.id, notices.routeId)).orderBy(desc(notices.publishedAt)).limit(100));
  });

  r.post('/notices', requirePermission('notices.publish'), async (req, res) => {
    const body = parse(noticeCreateSchema, req.body);
    if (body.audience === 'route') {
      const [route] = await db.select({ id: routes.id }).from(routes).where(eq(routes.id, body.routeId!));
      if (!route) throw notFound('Route');
    }
    const [row] = await db.insert(notices).values({ ...body, routeId: body.audience === 'route' ? body.routeId! : null, publishedBy: actorId(req) }).returning();
    const to: Recipients = body.audience === 'route' ? { kind: 'route', routeId: body.routeId! } : { kind: body.audience };
    const devices = await notify(ctx.db, ctx.push, to, { title: body.title, body: body.body || 'Open the app for details.', data: { type: 'notice', id: row!.id } });
    ctx.realtime.emit(body.audience === 'route' ? `route:${body.routeId}` : 'riders', 'notice.published', row);
    await audit(db, { actorId: actorId(req), action: 'notices.published', entity: 'notice', entityId: row!.id, after: { ...row, devices }, req });
    res.status(201).json({ ...row, devicesNotified: devices });
  });

  r.delete('/notices/:id', requirePermission('notices.publish'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [row] = await db.delete(notices).where(eq(notices.id, id)).returning();
    if (!row) throw notFound('Notice');
    await audit(db, { actorId: actorId(req), action: 'notices.deleted', entity: 'notice', entityId: id, before: row, req });
    res.json({ ok: true });
  });

  return r;
}
