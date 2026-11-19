/** Applies pending migrations. Usage: npm run db:migrate */
import { connect } from './client.js';

const database = await connect({
  databaseUrl: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  pgliteDir: process.env.PGLITE_DIR ?? './.data/pglite',
  migrate: true,
});
await database.close();
console.log('Migrations applied.');
