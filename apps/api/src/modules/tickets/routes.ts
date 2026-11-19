/**
 * Complaints, suggestions and help requests.
 * Staff see tickets by number and route only; the rider's identity is never
 * returned on the authority side. Replies reach the rider inside the ticket.
 */
import { Router } from 'express';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ticketReplySchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { routes, ticketMessages, tickets } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { notFound, parse } from '../../lib/errors.js';
import { notify } from '../../notifications/push.js';
import { actorId } from '../common.js';

export async function nextTicketNumber(db: DB, kind: 'complaint' | 'suggestion' | 'help'): Promise<string> {
  const prefix = kind === 'help' ? 'H' : 'C';
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(kind === 'help' ? eq(tickets.kind, 'help') : inArray(tickets.kind, ['complaint', 'suggestion']));
  return `${prefix}-${1001 + Number(row?.n ?? 0)}`;
}

/** Staff-safe projection: no user ID, no name. */
const staffColumns = {
  id: tickets.id, number: tickets.number, kind: tickets.kind, category: tickets.category, subject: tickets.subject, route: routes.name,
  busCode: tickets.busCode, body: tickets.body, status: tickets.status, readByStaff: tickets.readByStaff, createdAt: tickets.createdAt, updatedAt: tickets.updatedAt,
};

export function ticketsAdminRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/tickets', requirePermission('support.manage'), async (req, res) => {
    const q = parse(z.object({ kind: z.enum(['complaint', 'help']).default('complaint') }), req.query);
    const kinds = q.kind === 'help' ? ['help' as const] : ['complaint' as const, 'suggestion' as const];
    const rows = await db.select(staffColumns).from(tickets).leftJoin(routes, eq(routes.id, tickets.routeId))
      .where(inArray(tickets.kind, kinds)).orderBy(desc(tickets.createdAt)).limit(200);
    res.json({ unread: rows.filter((t) => !t.readByStaff).length, tickets: rows });
  });

  r.get('/tickets/:id', requirePermission('support.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [t] = await db.select(staffColumns).from(tickets).leftJoin(routes, eq(routes.id, tickets.routeId)).where(eq(tickets.id, id));
    if (!t) throw notFound('Ticket');
    if (!t.readByStaff) await db.update(tickets).set({ readByStaff: true }).where(eq(tickets.id, id));
    const messages = await db.select({ authorType: ticketMessages.authorType, body: ticketMessages.body, createdAt: ticketMessages.createdAt })
      .from(ticketMessages).where(eq(ticketMessages.ticketId, id)).orderBy(asc(ticketMessages.createdAt));
    res.json({ ...t, readByStaff: true, messages });
  });

  r.post('/tickets/:id/reply', requirePermission('support.manage'), async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(ticketReplySchema, req.body);
    const [t] = await db.select({ id: tickets.id, userId: tickets.userId, number: tickets.number, status: tickets.status }).from(tickets).where(eq(tickets.id, id));
    if (!t) throw notFound('Ticket');
    await db.insert(ticketMessages).values({ ticketId: id, authorType: 'staff', authorId: actorId(req), body: body.body });
    const status = body.status ?? (t.status === 'open' ? 'in_progress' : t.status);
    await db.update(tickets).set({ status, readByStaff: true, updatedAt: new Date() }).where(eq(tickets.id, id));
    await audit(db, { actorId: actorId(req), action: 'tickets.replied', entity: 'ticket', entityId: id, after: { status }, req });
    // Delivered to the rider's own devices; staff never learn who that is.
    await notify(ctx.db, ctx.push, { kind: 'users', userIds: [t.userId] }, { title: `Reply on ${t.number}`, body: body.body.slice(0, 120), data: { type: 'ticket', id } });
    res.json({ ok: true, status });
  });

  return r;
}
