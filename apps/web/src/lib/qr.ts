/**
 * Builds the same rotating boarding token as the API (apps/api/src/lib/qr.ts):
 *   v1.<kind>.<id>.<step>.<first 24 hex chars of HMAC-SHA256(secret, "<kind>.<id>.<step>")>
 * Works offline once the card's secret has been loaded.
 */
export const QR_STEP_SECONDS = 30;

export async function qrToken(secret: string, kind: 'c' | 'p', id: string, at = Date.now()): Promise<string> {
  const step = Math.floor(at / 1000 / QR_STEP_SECONDS);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${kind}.${id}.${step}`)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  return `v1.${kind}.${id}.${step}.${hex}`;
}

export const secondsLeft = (at = Date.now()) => QR_STEP_SECONDS - (Math.floor(at / 1000) % QR_STEP_SECONDS);
