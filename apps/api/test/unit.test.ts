import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { decrypt, encrypt } from '../src/lib/crypto.js';
import { makeQrToken, parseQrToken, verifyQrToken } from '../src/lib/qr.js';

const id = '3f6c2a9e-8b1d-4c7e-9a2f-1b2c3d4e5f60';
const secret = 'qr-secret-for-tests';

describe('rotating QR tokens', () => {
  it('verifies a fresh token', () => {
    const now = new Date();
    const token = makeQrToken(secret, 'c', id, now);
    expect(parseQrToken(token)).toMatchObject({ kind: 'c', id });
    expect(verifyQrToken(token, secret, now)).toBe(true);
  });

  it('accepts about a minute of clock drift but not more', () => {
    const t0 = new Date('2026-11-19T10:00:00Z');
    const token = makeQrToken(secret, 'c', id, t0);
    expect(verifyQrToken(token, secret, new Date(t0.getTime() + 55_000))).toBe(true);
    expect(verifyQrToken(token, secret, new Date(t0.getTime() + 5 * 60_000))).toBe(false);
  });

  it('rejects a token signed with another secret or edited', () => {
    const now = new Date();
    const token = makeQrToken(secret, 'c', id, now);
    expect(verifyQrToken(token, 'other-secret', now)).toBe(false);
    expect(verifyQrToken(token.replace('.c.', '.p.'), secret, now)).toBe(false);
    expect(verifyQrToken('not-a-token', secret, now)).toBe(false);
  });
});

describe('encryption', () => {
  it('round-trips and detects tampering', () => {
    const key = Buffer.alloc(32, 7);
    const box = encrypt(key, 'totp-seed');
    expect(decrypt(key, box)).toBe('totp-seed');
    const parts = box.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(key, parts.join(':'))).toThrow();
  });
});

describe('configuration', () => {
  it('refuses mock providers and missing secrets in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    const key = Buffer.alloc(32, 1).toString('base64');
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: key, DATABASE_URL: 'postgres://h/db' })).toThrow(/SSO_MODE=mock/);
  });

  it('rejects an encryption key of the wrong size', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
  });
});

describe('configuration', () => {
  it('starts from a copied .env.example, where unused keys are left empty', () => {
    const fromExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
      .split('\n').filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as const);
    const env = Object.fromEntries(fromExample);
    env.JWT_SECRET = 'x'.repeat(48);
    env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    const config = loadConfig(env, () => undefined);
    expect(config.SSO_MODE).toBe('mock');
    expect(config.OIDC_ISSUER).toBeUndefined();
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it('refuses mocks and missing secrets in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' }, () => undefined)).toThrow(/Missing required secrets/);
  });
});
