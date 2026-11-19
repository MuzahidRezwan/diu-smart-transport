import { Router } from 'express';
import { settingsSchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { parse } from '../../lib/errors.js';
import { getSettings, putSettings } from '../../lib/settings.js';
import { actorId } from '../common.js';

export function settingsRouter(ctx: AppContext): Router {
  const r = Router();
  r.get('/settings', requirePermission('dashboard.view'), async (_req, res) => { res.json(await getSettings(ctx.adminDb)); });
  r.patch('/settings', requirePermission('settings.manage'), async (req, res) => {
    const body = parse(settingsSchema, req.body);
    const before = await getSettings(ctx.adminDb);
    const after = await putSettings(ctx.adminDb, body, actorId(req));
    await audit(ctx.adminDb, { actorId: actorId(req), action: 'settings.updated', entity: 'settings', entityId: 'app', before, after, req });
    res.json(after);
  });
  return r;
}
