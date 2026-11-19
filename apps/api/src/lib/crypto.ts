import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function hmacHex(key: string | Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext>, all base64url. */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decrypt(key: Buffer, payload: string): string {
  const [v, iv, tag, ct] = payload.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
