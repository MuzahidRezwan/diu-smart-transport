/**
 * Card payments.
 * - The amount always comes from the fee rules on the server.
 * - The card is activated only from a gateway-validated IPN, exactly once.
 */
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { feeRules, payments, routes, transportCards, userProfiles, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { notify } from '../../notifications/push.js';
import { activateCard } from '../cards/service.js';
import { currentSemester, makeTranId } from '../common.js';

export async function startCardPayment(ctx: AppContext, userId: string, routeId: string) {
  const db = ctx.db;
  const sem = await currentSemester(db);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw notFound('User');
  if (!user.category) throw unprocessable('Your fee category is unknown. Contact the transport office.');
  const [route] = await db.select().from(routes).where(eq(routes.id, routeId));
  if (!route || !route.isActive) throw notFound('Route');
  const [fee] = await db.select().from(feeRules).where(and(eq(feeRules.semesterId, sem.id), eq(feeRules.category, user.category), eq(feeRules.isActive, true)));
  if (!fee) throw unprocessable('The fee for your category is not set yet. Try again later.');

  let [card] = await db.select().from(transportCards).where(and(eq(transportCards.userId, userId), eq(transportCards.semesterId, sem.id)));
  if (card?.status === 'active') throw conflict('You already have an active card this semester');
  if (card?.status === 'revoked') throw conflict('Your card was revoked this semester. Contact the transport office.');
  if (card) {
    [card] = await db.update(transportCards).set({ routeId, status: 'pending_payment', updatedAt: new Date() }).where(eq(transportCards.id, card.id)).returning();
  } else {
    [card] = await db.insert(transportCards).values({ userId, semesterId: sem.id, routeId, status: 'pending_payment' }).returning();
  }
  if (!user.homeRouteId) await db.update(users).set({ homeRouteId: routeId }).where(eq(users.id, userId));

  const tranId = makeTranId();
  await db.insert(payments).values({ userId, cardId: card!.id, semesterId: sem.id, amountBdt: fee.amountBdt, gateway: ctx.gateway.name, tranId });

  // The rider's own contact details go to the gateway for their own payment receipt.
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
  const base = ctx.config.PUBLIC_API_URL;
  const session = await ctx.gateway.initSession({
    tranId,
    amountBdt: fee.amountBdt,
    productName: `DIU transport card ${sem.name} (${route.name})`,
    customer: { name: user.name, email: profile?.email ?? `${user.universityId}@diu.edu.bd`, phone: profile?.phone ?? '01700000000' },
    urls: {
      success: `${base}/payments/return/success`,
      fail: `${base}/payments/return/fail`,
      cancel: `${base}/payments/return/cancel`,
      ipn: `${base}/payments/sslcommerz/ipn`,
    },
  });
  return { tranId, amountBdt: fee.amountBdt, redirectUrl: session.redirectUrl };
}

export type IpnOutcome = 'activated' | 'already_done' | 'failed' | 'ignored';

export async function handleIpn(ctx: AppContext, fields: Record<string, string>): Promise<IpnOutcome> {
  const db = ctx.db;
  const tranId = fields.tran_id ?? '';
  const [payment] = await db.select().from(payments).where(eq(payments.tranId, tranId));
  if (!payment) return 'ignored';
  if (payment.status === 'success') return 'already_done';

  const fail = async (reason: string, status: 'failed' | 'cancelled' = 'failed') => {
    await db.update(payments).set({ status, failureReason: reason.slice(0, 200), rawIpn: fields }).where(and(eq(payments.id, payment.id), eq(payments.status, 'initiated')));
    await audit(db, { actorId: null, action: `payments.${status}`, entity: 'payment', entityId: payment.id, subjectUserId: payment.userId, after: { tranId, reason } });
    return 'failed' as const;
  };

  if (fields.status === 'FAILED') return fail(fields.error || 'Payment failed at the gateway');
  if (fields.status === 'CANCELLED') return fail('Cancelled by the payer', 'cancelled');
  if (!ctx.gateway.verifyIpnSignature(fields)) return fail('IPN signature did not match');
  if (!fields.val_id) return fail('IPN had no validation ID');

  const v = await ctx.gateway.validate(fields.val_id);
  if (!v.valid) return fail('Gateway did not confirm the payment');
  if (v.tranId !== tranId) return fail('Transaction ID mismatch');
  if (Math.round(v.amountBdt) !== payment.amountBdt) return fail(`Amount mismatch: paid ${v.amountBdt}, expected ${payment.amountBdt}`);
  if (v.currency && v.currency !== 'BDT') return fail(`Unexpected currency ${v.currency}`);

  // Conditional update: only one IPN can move this payment to success.
  const done = await db.update(payments).set({
    status: 'success', method: v.method, gatewayValId: v.valId, gatewayBankTranId: v.bankTranId, rawIpn: fields, paidAt: new Date(),
  }).where(and(eq(payments.id, payment.id), eq(payments.status, 'initiated'))).returning({ id: payments.id });
  if (!done.length) return 'already_done';

  if (payment.cardId) {
    const { after } = await activateCard(ctx, db, payment.cardId, 'payment', null);
    await audit(db, { actorId: null, action: 'cards.activated_by_payment', entity: 'transport_card', entityId: after.id, subjectUserId: payment.userId, after: { tranId, amountBdt: payment.amountBdt, method: v.method } });
    await notify(db, ctx.push, { kind: 'users', userIds: [payment.userId] }, {
      title: 'Payment received: your transport card is active',
      body: `৳${payment.amountBdt} via ${v.method ?? 'gateway'} · ${tranId}`,
    });
    ctx.realtime.emit('authority', 'payment.success', { tranId });
  }
  return 'activated';
}
