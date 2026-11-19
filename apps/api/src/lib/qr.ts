/**
 * Rotating boarding QR codes that work offline.
 *
 * The rider's app receives its card's QR secret once (over TLS, only for its
 * own card) and derives a new token every 30 seconds, like a TOTP code:
 *
 *   v1.<kind>.<id>.<step>.<signature>
 *
 * kind = c (transport card) or p (day pass); step = floor(unix / 30).
 * A screenshot stops working within about a minute.
 */
import { hmacHex, safeEqual } from './crypto.js';

export const QR_STEP_SECONDS = 30;
const TOLERANCE_STEPS = 2;

export type QrKind = 'c' | 'p';

export function qrStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / QR_STEP_SECONDS);
}

function sign(secret: string, kind: QrKind, id: string, step: number): string {
  return hmacHex(secret, `${kind}.${id}.${step}`).slice(0, 24);
}

export function makeQrToken(secret: string, kind: QrKind, id: string, at: Date = new Date()): string {
  const step = qrStep(at);
  return `v1.${kind}.${id}.${step}.${sign(secret, kind, id, step)}`;
}

export function parseQrToken(token: string): { kind: QrKind; id: string; step: number; sig: string } | null {
  const m = /^v1\.([cp])\.([0-9a-f-]{36})\.(\d{1,12})\.([0-9a-f]{24})$/.exec(token);
  if (!m) return null;
  return { kind: m[1] as QrKind, id: m[2]!, step: Number(m[3]), sig: m[4]! };
}

/** True when the signature matches and the token is no older/newer than ~60 seconds. */
export function verifyQrToken(token: string, secret: string, at: Date = new Date()): boolean {
  const parsed = parseQrToken(token);
  if (!parsed) return false;
  if (Math.abs(parsed.step - qrStep(at)) > TOLERANCE_STEPS) return false;
  return safeEqual(parsed.sig, sign(secret, parsed.kind, parsed.id, parsed.step));
}
