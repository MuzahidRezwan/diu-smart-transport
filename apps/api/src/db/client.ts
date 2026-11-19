import { fileURLToPath } from 'node:url';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

/** Works for both node-postgres and PGlite. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<any, typeof schema>;

export interface Database {
  /** Rider-facing connection. */
  db: DB;
  /** Authority-facing connection (transport_admin role in production). */
  adminDb: DB;
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * DATABASE_URL set   -> PostgreSQL through node-postgres.
 * DATABASE_URL unset -> embedded PGlite (Postgres in WASM) for local development
 *                       and tests; data lives in PGLITE_DIR or in memory.
 */
export async function connect(opts: { databaseUrl?: string; adminDatabaseUrl?: string; pgliteDir?: string; migrate?: boolean }): Promise<Database> {
  if (opts.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 20 });
    const adminPool = opts.adminDatabaseUrl && opts.adminDatabaseUrl !== opts.databaseUrl
      ? new Pool({ connectionString: opts.adminDatabaseUrl, max: 10 })
      : pool;
    const db = drizzle(pool, { schema }) as unknown as DB;
    const adminDb = adminPool === pool ? db : (drizzle(adminPool, { schema }) as unknown as DB);
    if (opts.migrate) {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(drizzle(pool, { schema }), { migrationsFolder: MIGRATIONS_DIR });
    }
    return {
      db,
      adminDb,
      async close() {
        await pool.end();
        if (adminPool !== pool) await adminPool.end();
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite(opts.pgliteDir);
  const pg = drizzle(client, { schema });
  if (opts.migrate ?? true) {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(pg, { migrationsFolder: MIGRATIONS_DIR });
  }
  const db = pg as unknown as DB;
  return { db, adminDb: db, close: () => client.close() };
}
