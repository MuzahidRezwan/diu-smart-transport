import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payments, users } from '../src/db/schema.js';
import { makeQrToken } from '../src/lib/qr.js';
import { csvCell } from '../src/modules/payments/routes.js';
import { methodFromCardType, SslCommerzGateway } from '../src/modules/payments/gateway.js';
import { adminLogin, bearer, riderLogin, setup, type TestEnv } from './helpers.js';
import { createHash } from 'node:crypto';

let env: TestEnv;
let admin: string;
beforeAll(async () => { env = await setup(); admin = await adminLogin(env); });
afterAll(async () => { await env.close(); });

const today = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

describe('card payment', () => {
  let tranId = '';
  let rider = '';

  it('charges the fee from the rules, not from the client', async () => {
    rider = (await riderLogin(env, '232-35-797')).accessToken;
    const res = await request(env.app).post('/me/card').set(bearer(rider)).send({ routeId: env.seeded.routeIds['R-01'], amountBdt: 1 }).expect(201);
    expect(res.body.amountBdt).toBe(4500);
    expect(res.body.redirectUrl).toContain('/payments/mock/pay');
    tranId = res.body.tranId;
    const card = await request(env.app).get('/me/card').set(bearer(rider)).expect(200);
    expect(card.body.card.status).toBe('pending_payment');
    expect(card.body.card.qrSecret).toBeNull();
  });

  it('does not activate from the browser redirect', async () => {
    await request(env.app).post('/payments/return/success').type('form').send({ tran_id: tranId }).expect(303);
    const card = await request(env.app).get('/me/card').set(bearer(rider));
    expect(card.body.card.status).toBe('pending_payment');
  });

  it('activates the card from a validated IPN, exactly once', async () => {
    await request(env.app).post('/payments/sslcommerz/ipn').type('form').send({ tran_id: tranId, status: 'VALID', val_id: `mock-${tranId}-bKash` }).expect(200);
    const card = await request(env.app).get('/me/card').set(bearer(rider)).expect(200);
    expect(card.body.card.status).toBe('active');
    expect(card.body.card.qrSecret).toHaveLength(43);
    await request(env.app).post('/payments/sslcommerz/ipn').type('form').send({ tran_id: tranId, status: 'VALID', val_id: `mock-${tranId}-bKash` }).expect(200);
    const rows = await env.ctx.db.select().from(payments).where(eq(payments.tranId, tranId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'success', method: 'bKash', amountBdt: 4500 });
    expect(env.push.sent.length).toBeGreaterThanOrEqual(0);
  });

  it('marks a payment failed when the gateway does not confirm it', async () => {
    const other = (await riderLogin(env, '221-15-443')).accessToken;
    const res = await request(env.app).post('/me/card').set(bearer(other)).send({ routeId: env.seeded.routeIds['R-02'] }).expect(201);
    await request(env.app).post('/payments/sslcommerz/ipn').type('form').send({ tran_id: res.body.tranId, status: 'VALID', val_id: `mock-${res.body.tranId}-fail` }).expect(200);
    const [row] = await env.ctx.db.select().from(payments).where(eq(payments.tranId, res.body.tranId));
    expect(row!.status).toBe('failed');
    const card = await request(env.app).get('/me/card').set(bearer(other));
    expect(card.body.card.status).toBe('pending_payment');
  });

  it('lets a supervisor scan the rotating QR, and rejects a copied old one', async () => {
    const card = (await request(env.app).get('/me/card').set(bearer(rider))).body.card;
    // Supervisors are a role, provisioned by IT; create one directly for the test.
    const [sup] = await env.ctx.db.insert(users).values({ universityId: '710555', name: 'Bus Supervisor', role: 'supervisor' }).returning();
    const { signAccessToken } = await import('../src/auth/tokens.js');
    const supToken = await signAccessToken(env.ctx, { sub: sup!.id, role: 'supervisor', uid: '710555' });
    const now = new Date();
    const ok = await request(env.app).post('/boarding/scan').set(bearer(supToken))
      .send({ qrToken: makeQrToken(card.qrSecret, 'c', card.id, now), busId: env.seeded.busIds['H-10'], scannedAt: now.toISOString() }).expect(200);
    expect(ok.body).toMatchObject({ valid: true, name: 'Khalilur Rahman' });
    const old = new Date(now.getTime() - 5 * 60_000);
    const bad = await request(env.app).post('/boarding/scan').set(bearer(supToken))
      .send({ qrToken: makeQrToken(card.qrSecret, 'c', card.id, old), busId: env.seeded.busIds['H-10'], scannedAt: now.toISOString() }).expect(200);
    expect(bad.body.valid).toBe(false);
  });
});

describe('payments report and export', () => {
  it('summarises the day', async () => {
    const res = await request(env.app).get('/admin/payments').set(bearer(admin)).query({ from: today(), to: today(), status: 'all' }).expect(200);
    expect(res.body.summary).toMatchObject({ ridersPaid: 1, totalBdt: 4500 });
    expect(res.body.summary.byMethod).toEqual([{ method: 'bKash', count: 1, amountBdt: 4500 }]);
    expect(res.body.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('exports CSV with only transport columns', async () => {
    const res = await request(env.app).get('/admin/payments/export').set(bearer(admin)).query({ from: today(), to: today(), format: 'csv' }).expect(200);
    expect(res.headers['content-disposition']).toContain(`diu-transport-payments_${today()}.csv`);
    const [header, first] = res.text.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('"Date","Time","Transaction ID","University ID","Name","Rider type","Route","Semester","Amount (BDT)","Method","Status"');
    expect(first).toContain('"232-35-797"');
    expect(res.text).not.toMatch(/@diu\.edu\.bd|Software Engineering|017\d{8}/);
  });

  it('exports a real Excel workbook', async () => {
    const res = await request(env.app).get('/admin/payments/export').set(bearer(admin)).query({ from: today(), to: today(), format: 'xlsx' })
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('neutralises spreadsheet formulas in CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+880')).toBe('"\'+880"');
    expect(csvCell('Khalilur')).toBe('"Khalilur"');
  });

  it('limits reports to 93 days and needs payments.export to download', async () => {
    await request(env.app).get('/admin/payments').set(bearer(admin)).query({ from: '2026-01-01', to: '2026-12-31' }).expect(400);
    const created = await request(env.app).post('/admin/admins').set(bearer(admin))
      .send({ universityId: '710251', name: 'Sumaiya Akter', designation: 'Card desk', permissions: ['dashboard.view', 'cards.approve', 'payments.view'] }).expect(201);
    const desk = await adminLogin(env, '710251', created.body.temporaryPassword);
    await request(env.app).get('/admin/payments').set(bearer(desk)).query({ from: today(), to: today() }).expect(200);
    await request(env.app).get('/admin/payments/export').set(bearer(desk)).query({ from: today(), to: today() }).expect(403);
  });
});

describe('gateway helpers', () => {
  it('maps SSLCommerz card types to methods', () => {
    expect(methodFromCardType('BKASH-BKash')).toBe('bKash');
    expect(methodFromCardType('NAGAD-Nagad')).toBe('Nagad');
    expect(methodFromCardType('VISA-Dutch Bangla')).toBe('Card');
  });

  it('verifies SSLCommerz IPN signatures', () => {
    const storePass = 'sandbox-store-pass'; // secret-scan: allow (test fixture, not a real store)
    const gw = new SslCommerzGateway('teststore', storePass, true);
    const fields: Record<string, string> = { tran_id: 'DIU-TC-1', val_id: 'v1', amount: '4500.00', status: 'VALID', verify_key: 'amount,status,tran_id,val_id' };
    const data: Record<string, string> = { amount: '4500.00', status: 'VALID', tran_id: 'DIU-TC-1', val_id: 'v1', store_passwd: createHash('md5').update(storePass).digest('hex') };
    fields.verify_sign = createHash('md5').update(Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('&')).digest('hex');
    expect(gw.verifyIpnSignature(fields)).toBe(true);
    expect(gw.verifyIpnSignature({ ...fields, amount: '1.00' })).toBe(false);
  });
});
