/**
 * Payment gateways. SSLCommerz covers bKash, Nagad, Rocket and cards in one
 * integration. Card status changes only after server-side validation of the
 * IPN, never from the browser redirect.
 */
import { createHash } from 'node:crypto';

export interface InitSessionInput {
  tranId: string;
  amountBdt: number;
  productName: string;
  customer: { name: string; email: string; phone: string };
  urls: { success: string; fail: string; cancel: string; ipn: string };
}

export interface ValidatedPayment {
  valid: boolean;
  tranId: string;
  amountBdt: number;
  currency: string;
  method: string | null;
  valId: string;
  bankTranId: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly name: 'sslcommerz' | 'mock';
  initSession(input: InitSessionInput): Promise<{ redirectUrl: string }>;
  /** Checks an IPN's signature fields (when the gateway signs them). */
  verifyIpnSignature(fields: Record<string, string>): boolean;
  /** Asks the gateway itself whether a payment is real and complete. */
  validate(valId: string): Promise<ValidatedPayment>;
}

/** Maps SSLCommerz card_type values ("BKASH-BKash", "NAGAD-Nagad", "VISA-Dutch Bangla"...) to a method name. */
export function methodFromCardType(cardType: string | undefined | null): string | null {
  if (!cardType) return null;
  const t = cardType.toUpperCase();
  if (t.includes('BKASH')) return 'bKash';
  if (t.includes('NAGAD')) return 'Nagad';
  if (t.includes('ROCKET') || t.includes('DBBL MOBILE')) return 'Rocket';
  if (t.includes('UPAY')) return 'Upay';
  if (/VISA|MASTER|AMEX|UNIONPAY|DBBL|CARD/.test(t)) return 'Card';
  return 'Other';
}

export class SslCommerzGateway implements PaymentGateway {
  readonly name = 'sslcommerz' as const;
  private readonly base: string;

  constructor(private readonly storeId: string, private readonly storePassword: string, sandbox: boolean) {
    this.base = sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
  }

  async initSession(input: InitSessionInput): Promise<{ redirectUrl: string }> {
    const form = new URLSearchParams({
      store_id: this.storeId,
      store_passwd: this.storePassword,
      total_amount: input.amountBdt.toFixed(2),
      currency: 'BDT',
      tran_id: input.tranId,
      success_url: input.urls.success,
      fail_url: input.urls.fail,
      cancel_url: input.urls.cancel,
      ipn_url: input.urls.ipn,
      product_name: input.productName,
      product_category: 'Transport',
      product_profile: 'non-physical-goods',
      shipping_method: 'NO',
      num_of_item: '1',
      cus_name: input.customer.name,
      cus_email: input.customer.email,
      cus_phone: input.customer.phone,
      cus_add1: 'Daffodil Smart City',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
    });
    const res = await fetch(`${this.base}/gwprocess/v4/api.php`, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as { status?: string; GatewayPageURL?: string; failedreason?: string };
    if (body.status !== 'SUCCESS' || !body.GatewayPageURL) throw new Error(`SSLCommerz session failed: ${body.failedreason ?? res.status}`);
    return { redirectUrl: body.GatewayPageURL };
  }

  /** SSLCommerz signs IPNs: md5 over the fields listed in verify_key plus md5(store password), sorted by key. */
  verifyIpnSignature(fields: Record<string, string>): boolean {
    const { verify_sign: sign, verify_key: keys } = fields;
    if (!sign || !keys) return false;
    const data: Record<string, string> = {};
    for (const k of keys.split(',')) data[k] = fields[k] ?? '';
    data.store_passwd = createHash('md5').update(this.storePassword).digest('hex');
    const joined = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('&');
    return createHash('md5').update(joined).digest('hex') === sign;
  }

  async validate(valId: string): Promise<ValidatedPayment> {
    const url = new URL(`${this.base}/validator/api/validationserverAPI.php`);
    url.search = new URLSearchParams({ val_id: valId, store_id: this.storeId, store_passwd: this.storePassword, format: 'json', v: '1' }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const b = (await res.json()) as Record<string, string>;
    return {
      valid: b.status === 'VALID' || b.status === 'VALIDATED',
      tranId: b.tran_id ?? '',
      amountBdt: Number(b.currency_amount ?? b.amount ?? 0),
      currency: b.currency_type ?? b.currency ?? '',
      method: methodFromCardType(b.card_type),
      valId,
      bankTranId: b.bank_tran_id ?? null,
      raw: b,
    };
  }
}

/**
 * Development/test gateway. The "payment page" is served by the API itself
 * (/payments/mock/pay) and the IPN uses val_id "mock-<tranId>-<method>".
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock' as const;
  /** tranId -> amount, so validation can echo what was asked. */
  private readonly sessions = new Map<string, number>();

  constructor(private readonly publicApiUrl: string) {}

  async initSession(input: InitSessionInput): Promise<{ redirectUrl: string }> {
    this.sessions.set(input.tranId, input.amountBdt);
    const url = new URL('/payments/mock/pay', this.publicApiUrl);
    url.searchParams.set('tran_id', input.tranId);
    url.searchParams.set('amount', String(input.amountBdt));
    return { redirectUrl: url.toString() };
  }

  verifyIpnSignature(): boolean {
    return true;
  }

  async validate(valId: string): Promise<ValidatedPayment> {
    const m = /^mock-(.+)-(bKash|Nagad|Rocket|Card|fail)$/.exec(valId);
    const tranId = m?.[1] ?? '';
    return {
      valid: Boolean(m) && m![2] !== 'fail' && this.sessions.has(tranId),
      tranId,
      amountBdt: this.sessions.get(tranId) ?? 0,
      currency: 'BDT',
      method: m && m[2] !== 'fail' ? m[2]! : null,
      valId,
      bankTranId: m ? `MOCKBANK${tranId.slice(-6)}` : null,
      raw: { mock: true, valId },
    };
  }
}
