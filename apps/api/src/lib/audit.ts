import type { Request } from 'express';
import type { DB } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  subjectUserId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  req?: Request;
}

/** Appends one audit row. The table rejects updates and deletes at the database level. */
export async function audit(db: DB, e: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: e.actorId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    subjectUserId: e.subjectUserId ?? null,
    before: e.before === undefined ? null : (e.before as object),
    after: e.after === undefined ? null : (e.after as object),
    reason: e.reason ?? null,
    ip: e.req?.ip ?? null,
    userAgent: e.req?.get('user-agent')?.slice(0, 300) ?? null,
  });
}
