import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { paymentsQuerySchema } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { payments, routes, semesters, transportCards, users } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { parse } from '../../lib/errors.js';
import { actorId } from '../common.js';
import { handleIpn } from './service.js';

/* ---------------- gateway callbacks (public) ---------------- */

export function paymentsGatewayRouter(ctx: AppContext): Router {
  const r = Router();

  /** SSLCommerz server-to-server notification. The only place a payment becomes "success". */
  r.post('/sslcommerz/ipn', async (req, res) => {
    const fields = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)]));
    const outcome = await handleIpn(ctx, fields);
    req.log?.info({ tranId: fields.tran_id, outcome }, 'ipn');
    res.json({ received: true });
  });

  /** Browser comes back from the gateway. Never changes state: only redirects to the result page. */
  r.all('/return/:result', (req, res) => {
    const result = ['success', 'fail', 'cancel'].includes(String(req.params.result)) ? String(req.params.result) : 'fail';
    const tranId = String((req.body?.tran_id ?? req.query.tran_id ?? '')).replace(/[^A-Za-z0-9-]/g, '');
    res.redirect(303, `${ctx.config.WEB_APP_URL}/payment/result?status=${result}&tran_id=${encodeURIComponent(tranId)}`);
  });

  if (ctx.gateway.name === 'mock' && !ctx.config.isProd) {
    r.get('/mock/pay', (req, res) => {
      const tranId = String(req.query.tran_id ?? '').replace(/[^A-Za-z0-9-]/g, '');
      const amount = Number(req.query.amount ?? 0);
      const btn = (m: string) => `<button name="method" value="${m}" style="padding:10px 14px;margin:4px">${m === 'fail' ? 'Simulate failure' : `Pay with ${m}`}</button>`;
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Mock payment</title><body style="font-family:system-ui;max-width:440px;margin:60px auto">
<h2>Mock payment gateway (development only)</h2><p>Transaction <code>${tranId}</code> · ৳${amount}</p>
<form method="post" action="${ctx.config.basePath}/payments/mock/complete"><input type="hidden" name="tran_id" value="${tranId}">${['bKash', 'Nagad', 'Card', 'fail'].map(btn).join('')}</form></body>`);
    });
    r.post('/mock/complete', async (req, res) => {
      const body = parse(z.object({ tran_id: z.string(), method: z.enum(['bKash', 'Nagad', 'Card', 'fail']) }), req.body);
      const outcome = await handleIpn(ctx, { tran_id: body.tran_id, status: body.method === 'fail' ? 'FAILED' : 'VALID', val_id: `mock-${body.tran_id}-${body.method}` });
      res.redirect(303, `${ctx.config.WEB_APP_URL}/payment/result?status=${outcome === 'activated' ? 'success' : 'fail'}&tran_id=${encodeURIComponent(body.tran_id)}`);
    });
  }

  return r;
}

/* ---------------- authority: payments & collection ---------------- */

/** Dhaka has no daylight saving, so a fixed +6h gives the local calendar date. */
const dhakaDay = sql<string>`to_char((${payments.createdAt} at time zone 'UTC') + interval '6 hours', 'YYYY-MM-DD')`;

async function paymentRows(db: DB, q: z.infer<typeof paymentsQuerySchema>) {
  const rows = await db.select({
    createdAt: payments.createdAt, paidAt: payments.paidAt, day: dhakaDay, tranId: payments.tranId, universityId: users.universityId, name: users.name,
    category: users.category, route: routes.name, semester: semesters.code, amountBdt: payments.amountBdt, method: payments.method, status: payments.status,
    failureReason: payments.failureReason,
  }).from(payments)
    .innerJoin(users, eq(users.id, payments.userId))
    .innerJoin(semesters, eq(semesters.id, payments.semesterId))
    .leftJoin(transportCards, eq(transportCards.id, payments.cardId))
    .leftJoin(routes, eq(routes.id, transportCards.routeId))
    .where(and(sql`${dhakaDay} between ${q.from} and ${q.to}`, ...(q.method ? [eq(payments.method, q.method)] : [])))
    .orderBy(desc(payments.createdAt));
  return rows;
}

function summarize(rows: Awaited<ReturnType<typeof paymentRows>>, from: string, to: string) {
  const ok = rows.filter((r) => r.status === 'success');
  const group = (key: 'method' | 'category') => {
    const m = new Map<string, { count: number; amountBdt: number }>();
    for (const r of ok) { const k = r[key] ?? 'unknown'; const g = m.get(k) ?? { count: 0, amountBdt: 0 }; g.count++; g.amountBdt += r.amountBdt; m.set(k, g); }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amountBdt - a.amountBdt);
  };
  return {
    from, to,
    ridersPaid: ok.length,
    totalBdt: ok.reduce((t, r) => t + r.amountBdt, 0),
    failedOrPending: rows.filter((r) => r.status === 'failed' || r.status === 'initiated').length,
    refunded: rows.filter((r) => r.status === 'refunded').length,
    byMethod: group('method').map(({ name, ...v }) => ({ method: name, ...v })),
    byCategory: group('category').map(({ name, ...v }) => ({ category: name, ...v })),
  };
}

/** Spreadsheet cells starting with = + - @ would run as formulas: prefix them. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const EXPORT_COLUMNS = ['Date', 'Time', 'Transaction ID', 'University ID', 'Name', 'Rider type', 'Route', 'Semester', 'Amount (BDT)', 'Method', 'Status'] as const;

function exportRecords(rows: Awaited<ReturnType<typeof paymentRows>>) {
  return rows.map((r) => {
    const at = new Date((r.paidAt ?? r.createdAt).getTime() + 6 * 3600_000);
    return [r.day, at.toISOString().slice(11, 16), r.tranId, r.universityId, r.name, r.category ?? '', r.route ?? '', r.semester, r.amountBdt, r.method ?? '', r.status];
  });
}

export function paymentsAdminRouter(ctx: AppContext): Router {
  const r = Router();
  const db = ctx.adminDb;

  r.get('/payments', requirePermission('payments.view'), async (req, res) => {
    const q = parse(paymentsQuerySchema, req.query);
    const all = await paymentRows(db, q);
    const list = q.status === 'all' ? all : all.filter((x) => x.status === q.status);
    res.json({ summary: summarize(all, q.from, q.to), rows: list });
  });

  r.get('/payments/export', requirePermission('payments.export'), async (req, res) => {
    const q = parse(paymentsQuerySchema, req.query);
    const format = parse(z.enum(['csv', 'xlsx']).default('xlsx'), req.query.format);
    const all = await paymentRows(db, q);
    const list = q.status === 'all' ? all : all.filter((x) => x.status === q.status);
    const records = exportRecords(list);
    const base = q.from === q.to ? `diu-transport-payments_${q.from}` : `diu-transport-payments_${q.from}_to_${q.to}`;
    await audit(db, { actorId: actorId(req), action: 'payments.exported', entity: 'payment', entityId: `${q.from}..${q.to}`, after: { format, status: q.status, method: q.method ?? null, rows: records.length }, req });

    if (format === 'csv') {
      const csv = '﻿' + [EXPORT_COLUMNS.map(csvCell).join(','), ...records.map((row) => row.map(csvCell).join(','))].join('\r\n') + '\r\n';
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${base}.csv"`);
      res.send(csv);
      return;
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DIU Smart Transport';
    const ws = wb.addWorksheet('Payments');
    ws.addRow([...EXPORT_COLUMNS]).font = { bold: true };
    // ExcelJS writes values, not formulas, for plain strings; the prefix guard still applies for CSV users.
    records.forEach((row) => ws.addRow(row));
    ws.columns.forEach((c, i) => { c.width = [11, 7, 22, 14, 24, 22, 14, 12, 13, 9, 11][i]; });
    const sum = summarize(all, q.from, q.to);
    const s2 = wb.addWorksheet('Summary');
    s2.addRows([
      ['DIU Smart Transport · payment report'], ['Period', `${q.from} to ${q.to}`], ['Exported by', `${req.auth!.name} (${req.auth!.universityId})`], ['Exported at', new Date().toISOString()], [],
      ['Riders paid', sum.ridersPaid], ['Total collected (BDT)', sum.totalBdt], ['Failed / pending', sum.failedOrPending], ['Refunded', sum.refunded], [],
      ['Method', 'Riders', 'Amount (BDT)'], ...sum.byMethod.map((m) => [m.method, m.count, m.amountBdt]),
    ]);
    s2.getColumn(1).width = 24; s2.getColumn(2).width = 30;
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="${base}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });

  return r;
}
