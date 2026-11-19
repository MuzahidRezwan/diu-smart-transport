/** Builds the real AppContext from configuration. Tests build their own with fakes. */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { loadConfig, type Config } from './config.js';
import { connect, type Database } from './db/client.js';
import { adminAccounts, users } from './db/schema.js';
import { HttpDirectory, MockDirectory, MockSsoProvider, OidcProvider } from './auth/providers.js';
import { MockGateway, SslCommerzGateway } from './modules/payments/gateway.js';
import { HttpMlClient } from './modules/predictions/ml-client.js';
import { ConsolePushSender, ExpoPushSender } from './notifications/push.js';
import { ALL_PERMISSIONS } from '@diu/shared';
import { noopRealtime, type AppContext } from './context.js';
import { logger } from './logger.js';

export async function buildContext(
  config: Config = loadConfig(process.env, (m) => logger.warn(m)),
  opts: { migrate?: boolean } = {},
): Promise<{ ctx: AppContext; database: Database }> {
  const database = await connect({
    databaseUrl: config.DATABASE_URL,
    adminDatabaseUrl: config.ADMIN_DATABASE_URL,
    pgliteDir: config.PGLITE_DIR ?? './.data/pglite',
    migrate: opts.migrate ?? true,
  });
  const ctx: AppContext = {
    config,
    db: database.db,
    adminDb: database.adminDb,
    sso: config.SSO_MODE === 'oidc'
      ? new OidcProvider({ issuer: config.OIDC_ISSUER!, clientId: config.OIDC_CLIENT_ID!, clientSecret: config.OIDC_CLIENT_SECRET!, scopes: config.OIDC_SCOPES, idClaim: config.OIDC_UNIVERSITY_ID_CLAIM })
      : new MockSsoProvider(config.PUBLIC_API_URL),
    directory: config.DIRECTORY_MODE === 'http' ? new HttpDirectory(config.DIRECTORY_BASE_URL!, config.DIRECTORY_TOKEN ?? '') : new MockDirectory(),
    gateway: config.PAYMENT_GATEWAY === 'sslcommerz'
      ? new SslCommerzGateway(config.SSLCOMMERZ_STORE_ID!, config.SSLCOMMERZ_STORE_PASSWORD!, config.SSLCOMMERZ_SANDBOX)
      : new MockGateway(config.PUBLIC_API_URL),
    ml: new HttpMlClient(config.ML_SERVICE_URL, config.ML_SERVICE_TOKEN),
    push: config.PUSH_PROVIDER === 'expo' ? new ExpoPushSender(config.EXPO_ACCESS_TOKEN) : new ConsolePushSender((m) => logger.info(m)),
    realtime: noopRealtime,
  };
  if (opts.migrate ?? true) await ensureBootstrapAdmin(ctx);
  return { ctx, database };
}

/**
 * Creates the first main admin from BOOTSTRAP_ADMIN_* on an empty system.
 * The password must be changed and 2FA set up at first sign-in.
 */
async function ensureBootstrapAdmin(ctx: AppContext) {
  const { BOOTSTRAP_ADMIN_ID: id, BOOTSTRAP_ADMIN_NAME: name, BOOTSTRAP_ADMIN_PASSWORD: password } = ctx.config;
  if (!id || !name || !password) return;
  const existing = await ctx.db.select({ id: adminAccounts.userId }).from(adminAccounts).where(eq(adminAccounts.isMainAdmin, true));
  if (existing.length) return;
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
  const [u] = await ctx.db.insert(users).values({ universityId: id, name, role: 'authority' }).onConflictDoNothing().returning({ id: users.id });
  if (!u) return;
  await ctx.db.insert(adminAccounts).values({ userId: u.id, designation: 'Transport Head', passwordHash: await bcrypt.hash(password, 12), isMainAdmin: true, permissions: [...ALL_PERMISSIONS] });
  logger.info({ universityId: id }, 'Bootstrap main admin created. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.');
}
