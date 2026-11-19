/**
 * Offline rotating boarding token, identical to the API's (apps/api/src/lib/qr.ts):
 *   v1.<kind>.<id>.<step>.<first 24 hex of HMAC-SHA256(secret, "<kind>.<id>.<step>")>
 */
import { sha256 } from 'js-sha256';
import * as SecureStore from 'expo-secure-store';

export const QR_STEP_SECONDS = 30;

export function qrToken(secret: string, kind: 'c' | 'p', id: string, at = Date.now()): string {
  const step = Math.floor(at / 1000 / QR_STEP_SECONDS);
  return `v1.${kind}.${id}.${step}.${sha256.hmac(secret, `${kind}.${id}.${step}`).slice(0, 24)}`;
}

export const secondsLeft = (at = Date.now()) => QR_STEP_SECONDS - (Math.floor(at / 1000) % QR_STEP_SECONDS);

/** The card secret is kept in the keystore so the QR works with no internet at the bus stop. */
const KEY = 'diu.card';
export interface StoredCard { id: string; secret: string; kind: 'c' | 'p'; label: string; expiresOn: string | null }
export const saveCard = (c: StoredCard) => SecureStore.setItemAsync(KEY, JSON.stringify(c));
export const loadCard = async (): Promise<StoredCard | null> => {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as StoredCard) : null;
};
export const forgetCard = () => SecureStore.deleteItemAsync(KEY);
