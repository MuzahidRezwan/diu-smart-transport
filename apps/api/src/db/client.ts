import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';
import { logger } from '../logger.js';

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
const GRANTS_FILE = fileURLToPath(new URL('../../drizzle/grants.sql', import.meta.url));

/**
 * Re-applies table grants for the production roles (drizzle/grants.sql).
 * Skipped when the roles do not exist, as in development and tests.
 */
export async function applyGrants(db: DB): Promise<boolean> {
  const res = await db.execute(sql`select rolname from pg_roles where rolname in ('diu_app', 'transport_admin', 'diu_reporting')`);
  if ((res as unknown as { rows: unknown[] }).rows.length < 3) return false;
  const statements = readFileSync(GRANTS_FILE, 'utf8')
    .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) await db.execute(sql.raw(statement));
  return true;
}

/**
 * DATABASE_URL set   -> PostgreSQL through node-postgres.
 * DATABASE_URL unset -> embedded PGlite (Postgres in WASM) for local development
 *                       and tests; data lives in PGLITE_DIR or in memory.
 */
export async function connect(opts: {
  databaseUrl?: string;
  adminDatabaseUrl?: string;
  /** Owner role for DDL (diu_migrator). Defaults to databaseUrl, as in a single-user setup. */
  migrationDatabaseUrl?: string;
  pgliteDir?: string;
  migrate?: boolean;
}): Promise<Database> {
  if (opts.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 20 });
    const adminPool = opts.adminDatabaseUrl && opts.adminDatabaseUrl !== opts.databaseUrl
      ? new Pool({ connectionString: opts.adminDatabaseUrl, max: 10 })
      : pool;
    // An idle connection that the server closes (restart, failover) emits 'error' on the pool;
    // without a listener that error would crash the whole process.
    for (const p of new Set([pool, adminPool])) p.on('error', (err) => logger.warn({ err }, 'idle database connection closed'));
    const db = drizzle(pool, { schema }) as unknown as DB;
    const adminDb = adminPool === pool ? db : (drizzle(adminPool, { schema }) as unknown as DB);
    if (opts.migrate) {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      const ownerPool = new Pool({ connectionString: opts.migrationDatabaseUrl ?? opts.databaseUrl, max: 1 });
      ownerPool.on('error', (err) => logger.warn({ err }, 'idle migration connection closed'));
      try {
        const owner = drizzle(ownerPool, { schema }) as unknown as DB;
        await migrate(owner as never, { migrationsFolder: MIGRATIONS_DIR });
        await applyGrants(owner);
      } catch (err) {
        await Promise.all([pool.end(), adminPool !== pool ? adminPool.end() : undefined]);
        const hint = opts.migrationDatabaseUrl ? '' : ' If DATABASE_URL is a restricted role (diu_app), set MIGRATION_DATABASE_URL to the diu_migrator role.';
        throw new Error(`Database migration failed: ${(err as Error).message}.${hint}`, { cause: err });
      } finally {
        await ownerPool.end();
      }
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
  // PGlite creates its own folder but not the parents (.data/ is missing in a fresh clone).
  if (opts.pgliteDir && !opts.pgliteDir.includes('://')) mkdirSync(dirname(opts.pgliteDir), { recursive: true });
  const client = new PGlite(opts.pgliteDir);
  const pg = drizzle(client, { schema });
  if (opts.migrate ?? true) {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(pg, { migrationsFolder: MIGRATIONS_DIR });
  }
  const db = pg as unknown as DB;
  return { db, adminDb: db, close: () => client.close() };
}
