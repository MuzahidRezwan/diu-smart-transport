/** The authority "Feed" tab: recent activity, written for people. IDs only, no profiles. */
import { Router } from 'express';
import { desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auditLogs, users } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { parse } from '../../lib/errors.js';

const LABELS: Record<string, { text: string; kind: 'ok' | 'info' | 'warn' | 'crit' | 'none' }> = {
  'allocation.published': { text: 'Allocation published', kind: 'info' },
  'allocation.published_day': { text: 'Full day published', kind: 'info' },
  'allocation.saved_draft': { text: 'Allocation draft saved', kind: 'none' },
  'allocation.suggested': { text: 'Model suggestion applied as drafts', kind: 'none' },
  'allocation.deleted': { text: 'Allocation deleted', kind: 'warn' },
  'cards.activated_by_payment': { text: 'Card auto-approved after payment', kind: 'ok' },
  'cards.approved': { text: 'Card approved', kind: 'ok' },
  'cards.approved_without_payment': { text: 'Card approved without payment', kind: 'warn' },
  'cards.rejected': { text: 'Card request rejected', kind: 'none' },
  'access.granted': { text: 'Free transport access given', kind: 'warn' },
  'access.revoked': { text: 'Transport access revoked', kind: 'crit' },
  'payments.failed': { text: 'Payment failed', kind: 'crit' },
  'payments.exported': { text: 'Payments exported', kind: 'info' },
  'predictions.refreshed': { text: 'Prediction refreshed', kind: 'info' },
  'notices.published': { text: 'Notice published', kind: 'info' },
  'routines.uploaded': { text: 'New routine waiting for review', kind: 'warn' },
  'routines.activated': { text: 'Routine activated', kind: 'ok' },
  'daypass.approved': { text: 'Extra day pass approved', kind: 'none' },
};

export function feedRouter(ctx: AppContext): Router {
  const r = Router();
  r.get('/feed', requirePermission('dashboard.view'), async (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const rows = await ctx.adminDb.select({ at: auditLogs.createdAt, action: auditLogs.action, entityId: auditLogs.entityId, actor: users.name, after: auditLogs.after })
      .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(ne(auditLogs.action, 'access.lookup'))
      .orderBy(desc(auditLogs.createdAt)).limit(q.limit * 2);
    res.json(rows.filter((r) => LABELS[r.action]).slice(0, q.limit).map((r) => {
      const after = (r.after ?? {}) as Record<string, unknown>;
      const extra = [after.tranId, after.title, after.count !== undefined ? `${after.count} slots` : null, after.rows !== undefined ? `${after.rows} rows` : null].filter(Boolean).join(' · ');
      return { at: r.at, kind: LABELS[r.action]!.kind, text: `${LABELS[r.action]!.text}${extra ? ` · ${extra}` : ''}`, by: r.actor ?? 'System' };
    }));
  });
  return r;
}
