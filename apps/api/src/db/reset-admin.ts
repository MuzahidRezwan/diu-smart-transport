/**
 * Break-glass reset for an authority account whose owner lost the 2FA device or
 * the password when no other admin can help (for example the Main Admin).
 * Run by IT on the server; it is written to the audit log with the reason.
 *
 *   docker compose exec api node dist/db/reset-admin.js 710215 "Lost phone, IT ticket 1234"
 *   npm run admin:reset -w @diu/api -- 710215 "Lost phone, IT ticket 1234"      (development)
 *
 * Effect: a new temporary password (printed once) that must be changed at the
 * next sign-in, 2FA enrolment starts over, the lockout is cleared and every
 * session of that account is signed out. A deactivated account stays deactivated.
 */
import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { audit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';
import { connect } from './client.js';
import { adminAccounts, refreshTokens, users } from './schema.js';

const [universityId, reason = ''] = process.argv.slice(2);
if (!universityId || reason.trim().length < 10) {
  console.error('Usage: reset-admin <university ID> "<reason, at least 10 characters>"');
  process.exit(2);
}

const config = loadConfig();
const database = await connect({ databaseUrl: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR ?? './.data/pglite', migrate: false });
try {
  const { db } = database;
  const [row] = await db.select({ id: users.id, name: users.name, isActive: adminAccounts.isActive })
    .from(users).innerJoin(adminAccounts, eq(adminAccounts.userId, users.id)).where(eq(users.universityId, universityId));
  if (!row) {
    console.error(`No authority account with ID ${universityId}.`);
    process.exitCode = 1;
  } else {
    const temporaryPassword = `${randomToken(9)}-${randomToken(6)}`;
    await db.update(adminAccounts).set({
      passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true,
      totpSecretEnc: null, totpEnabled: false, failedAttempts: 0, lockedUntil: null, updatedAt: new Date(),
    }).where(eq(adminAccounts.userId, row.id));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, row.id), isNull(refreshTokens.revokedAt)));
    await audit(db, { actorId: null, action: 'admins.break_glass_reset', entity: 'admin_account', entityId: row.id, reason: reason.trim() });
    console.log(`Reset ${row.name} (${universityId}). Temporary password, shown once: ${temporaryPassword}`);
    console.log('Give it to the person directly. At sign-in they set a new password and scan a new 2FA code.');
    if (!row.isActive) console.log('Note: this account is deactivated; the Main Admin must reactivate it in Admins.');
  }
} finally {
  await database.close();
}
