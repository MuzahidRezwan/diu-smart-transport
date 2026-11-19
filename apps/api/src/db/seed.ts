/**
 * Fills an empty development database with sample data.
 * Usage: npm run db:seed   (refuses to run in production)
 * The main admin password is generated and printed once; it is never stored in git.
 */
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { connect } from './client.js';
import { seed } from './seed-data.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed sample data in production.');
  process.exit(1);
}

const database = await connect({ databaseUrl: process.env.DATABASE_URL, pgliteDir: process.env.PGLITE_DIR ?? './.data/pglite', migrate: true });
const existing = await database.db.execute(sql`select count(*)::int as n from semesters`);
const n = Number(((existing as unknown as { rows: { n: number }[] }).rows[0] ?? { n: 0 }).n);
if (n > 0) {
  console.log('Database already has data. Nothing seeded.');
} else {
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  const result = await seed(database.db, { adminPassword: password });
  console.log(`Seeded ${Object.keys(result.routeIds).length} routes, ${Object.keys(result.busIds).length} buses, ${Object.keys(result.slotIds).length} time slots.`);
  console.log(`Main admin ID: ${result.mainAdmin.universityId}`);
  console.log(`Main admin password (shown once): ${password}`);
  console.log('Sign in at the dashboard, then scan the QR with an authenticator app to finish 2FA setup.');
}
await database.close();
