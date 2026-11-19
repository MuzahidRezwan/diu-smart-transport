/**
 * Configuration from environment variables. Secrets are never given defaults
 * in production: the server refuses to start without them.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  TRUST_PROXY: bool.default(false),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
  MOBILE_REDIRECT_URI: z.string().default('diutransport://auth'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().optional(),
  ADMIN_DATABASE_URL: z.string().optional(),
  /** Role that owns the schema and runs migrations (diu_migrator). Defaults to DATABASE_URL. */
  MIGRATION_DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),

  JWT_SECRET: z.string().min(32).optional(),
  /** base64 of 32 random bytes, used for AES-256-GCM (TOTP secrets, QR seeds, device keys). */
  DATA_ENCRYPTION_KEY: z.string().optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),

  SSO_MODE: z.enum(['mock', 'oidc']).default('mock'),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().default('openid profile email'),
  OIDC_UNIVERSITY_ID_CLAIM: z.string().default('university_id'),

  DIRECTORY_MODE: z.enum(['mock', 'http']).default('mock'),
  DIRECTORY_BASE_URL: z.string().url().optional(),
  DIRECTORY_TOKEN: z.string().optional(),

  PAYMENT_GATEWAY: z.enum(['mock', 'sslcommerz']).default('mock'),
  SSLCOMMERZ_STORE_ID: z.string().optional(),
  SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),
  SSLCOMMERZ_SANDBOX: bool.default(true),

  ML_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  ML_SERVICE_TOKEN: z.string().optional(),

  PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  BOOTSTRAP_ADMIN_ID: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Omit<Env, 'JWT_SECRET' | 'DATA_ENCRYPTION_KEY'> {
  jwtSecret: Uint8Array;
  dataKey: Buffer;
  corsOrigins: string[];
  isProd: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.warn): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';

  if (isProd) {
    const missing = (['JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'DATABASE_URL'] as const).filter((k) => !e[k]);
    if (missing.length) throw new Error(`Missing required secrets in production: ${missing.join(', ')}`);
    if (e.SSO_MODE === 'mock') throw new Error('SSO_MODE=mock is not allowed in production');
    if (e.DIRECTORY_MODE === 'mock') throw new Error('DIRECTORY_MODE=mock is not allowed in production');
    if (e.PAYMENT_GATEWAY === 'mock') throw new Error('PAYMENT_GATEWAY=mock is not allowed in production');
    if (!e.ML_SERVICE_TOKEN) throw new Error('ML_SERVICE_TOKEN is required in production');
  }
  if (e.SSO_MODE === 'oidc' && !(e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_CLIENT_SECRET)) {
    throw new Error('SSO_MODE=oidc needs OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET');
  }
  if (e.PAYMENT_GATEWAY === 'sslcommerz' && !(e.SSLCOMMERZ_STORE_ID && e.SSLCOMMERZ_STORE_PASSWORD)) {
    throw new Error('PAYMENT_GATEWAY=sslcommerz needs SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD');
  }

  let jwtSecret = e.JWT_SECRET;
  if (!jwtSecret) {
    jwtSecret = randomBytes(48).toString('base64url');
    if (e.NODE_ENV !== 'test') log('JWT_SECRET not set: using a random one for this run. Sessions end on restart.');
  }
  let dataKey: Buffer;
  if (e.DATA_ENCRYPTION_KEY) {
    dataKey = Buffer.from(e.DATA_ENCRYPTION_KEY, 'base64');
    if (dataKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be base64 of exactly 32 bytes');
  } else {
    dataKey = randomBytes(32);
    if (e.NODE_ENV !== 'test') log('DATA_ENCRYPTION_KEY not set: using a random one. Encrypted values will not survive a restart.');
  }

  const { JWT_SECRET: _j, DATA_ENCRYPTION_KEY: _d, ...rest } = e;
  return {
    ...rest,
    jwtSecret: new TextEncoder().encode(jwtSecret),
    dataKey,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProd,
  };
}
