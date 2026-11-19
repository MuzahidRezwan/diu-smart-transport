/**
 * Job worker. Run exactly one instance (npm run start:jobs).
 * Times are Asia/Dhaka.
 */
import cron from 'node-cron';
import { buildContext } from '../bootstrap.js';
import { logger } from '../logger.js';
import { expiryTask, forecastTask, gpsRetentionTask, renewalReminderTask, routineSyncTask } from './tasks.js';

// Only the API server runs migrations, so two processes never migrate at once.
const { ctx } = await buildContext(undefined, { migrate: false });

const schedule: [string, string, (c: typeof ctx) => Promise<unknown>][] = [
  ['10 0 * * *', 'expiry', expiryTask],
  ['0 3 * * *', 'gps-retention', gpsRetentionTask],
  ['0 5 * * *', 'routine-sync', routineSyncTask],
  ['30 5 * * *', 'forecast', forecastTask],
  ['0 13 * * *', 'forecast-midday', forecastTask],
  ['0 10 * * *', 'renewal-reminders', renewalReminderTask],
];

for (const [expr, name, task] of schedule) {
  cron.schedule(expr, async () => {
    const started = Date.now();
    try {
      const result = await task(ctx);
      logger.info({ job: name, ms: Date.now() - started, result }, 'job done');
    } catch (err) {
      logger.error({ job: name, err }, 'job failed');
    }
  }, { timezone: 'Asia/Dhaka' });
}

const runNow = process.argv.find((a) => a.startsWith('--run='))?.slice(6);
if (runNow) {
  const job = schedule.find(([, name]) => name === runNow);
  if (!job) { logger.error(`Unknown job ${runNow}`); process.exit(1); }
  logger.info({ result: await job[2](ctx) }, `ran ${runNow}`);
  process.exit(0);
}
logger.info(`Job worker started with ${schedule.length} schedules`);
