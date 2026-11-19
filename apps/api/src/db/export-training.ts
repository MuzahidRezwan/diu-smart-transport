/**
 * Writes the ML training input: the same shape as a forecast request, with the
 * last 120 days of boarding counts per trip as history.
 *
 *   npm run ml:export -w @diu/api -- training-export.json          (development)
 *   node dist/db/export-training.js /tmp/training-export.json        (inside the api container)
 *
 * Riders are pseudonymised exactly as in the nightly forecast (keyed hash, no
 * names or IDs), but department/batch/section remain, so treat the file as
 * personal data: it is written with mode 600 and git refuses it.
 */
import { writeFileSync } from 'node:fs';
import { dhakaDate } from '@diu/shared';
import { loadConfig } from '../config.js';
import { getSettings } from '../lib/settings.js';
import { buildForecastRequest } from '../modules/predictions/forecast-input.js';
import { connect } from './client.js';

const out = process.argv[2] ?? 'training-export.json';
const config = loadConfig();
const database = await connect({ databaseUrl: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR ?? './.data/pglite', migrate: false });
try {
  const settings = await getSettings(database.db);
  const data = await buildForecastRequest(database.db, [dhakaDate()], config.dataKey, settings.attendanceFactorColdStart);
  writeFileSync(out, JSON.stringify(data), { mode: 0o600 });
  const days = new Set(data.history.map((h) => h.date)).size;
  console.log(`Wrote ${out}: ${data.riders.length} riders, ${data.slots.length} trips, ${days} days of boarding history.`);
  if (days < 30) console.log('Fewer than 30 days of boarding scans: training will not beat the baseline yet. Keep scanning.');
} finally {
  await database.close();
}
