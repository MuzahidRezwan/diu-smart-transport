import { Router } from 'express';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { addDays, predictionQuerySchema, toHHMM } from '@diu/shared';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/client.js';
import { predictions, routes, timeSlots } from '../../db/schema.js';
import { requirePermission } from '../../auth/middleware.js';
import { audit } from '../../lib/audit.js';
import { HttpError, parse } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { actorId } from '../common.js';
import { buildForecastRequest } from './forecast-input.js';

/** Runs the forecast for a date range and stores the result. Used by the dashboard and the nightly job. */
export async function refreshForecast(ctx: AppContext, from: string, days: number) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const settings = await getSettings(ctx.db);
  const request = await buildForecastRequest(ctx.db, dates, ctx.config.dataKey, settings.attendanceFactorColdStart);
  const result = await ctx.ml.forecast(request);
  for (const row of result.rows) {
    const values = { expectedMax: row.expectedMax, predicted: row.predicted, p90: row.p90, modelVersion: result.modelVersion, generatedAt: new Date() };
    await ctx.adminDb.insert(predictions).values({ serviceDate: row.date, timeSlotId: row.timeSlotId, ...values })
      .onConflictDoUpdate({ target: [predictions.serviceDate, predictions.timeSlotId], set: values });
  }
  return { rows: result.rows.length, modelVersion: result.modelVersion, riders: request.riders.length, sessions: request.sessions.length };
}

export async function readPredictions(db: DB, from: string, days: number) {
  const to = addDays(from, days - 1);
  const rows = await db.select({
    serviceDate: predictions.serviceDate, timeSlotId: predictions.timeSlotId, expectedMax: predictions.expectedMax,
    predicted: predictions.predicted, p90: predictions.p90, modelVersion: predictions.modelVersion,
    routeId: routes.id, routeCode: routes.code, routeName: routes.name, routeKind: routes.kind,
    direction: timeSlots.direction, audience: timeSlots.audience, departureMinutes: timeSlots.departureMinutes,
  }).from(predictions)
    .innerJoin(timeSlots, eq(timeSlots.id, predictions.timeSlotId))
    .innerJoin(routes, eq(routes.id, timeSlots.routeId))
    .where(and(gte(predictions.serviceDate, from), lte(predictions.serviceDate, to)))
    .orderBy(asc(predictions.serviceDate), asc(timeSlots.departureMinutes), asc(routes.code));
  return rows.map((r) => ({ ...r, departure: toHHMM(r.departureMinutes) }));
}

export function predictionsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get('/predictions', requirePermission('predictions.view'), async (req, res) => {
    const q = parse(predictionQuerySchema, req.query);
    const rows = await readPredictions(ctx.adminDb, q.from, q.days);
    const totals: Record<string, { studentIn: number; studentOut: number; facultyIn: number; facultyOut: number }> = {};
    for (const x of rows) {
      const t = (totals[x.serviceDate] ??= { studentIn: 0, studentOut: 0, facultyIn: 0, facultyOut: 0 });
      const key = `${x.audience === 'student' ? 'student' : 'faculty'}${x.direction === 'to_campus' ? 'In' : 'Out'}` as keyof typeof t;
      t[key] += x.predicted;
    }
    res.json({ rows, totals });
  });

  r.post('/predictions/refresh', requirePermission('predictions.run'), async (req, res) => {
    const q = parse(predictionQuerySchema, req.body);
    try {
      const out = await refreshForecast(ctx, q.from, q.days);
      await audit(ctx.adminDb, { actorId: actorId(req), action: 'predictions.refreshed', entity: 'prediction', entityId: q.from, after: out, req });
      res.json(out);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      req.log?.error({ err }, 'forecast failed');
      throw new HttpError(503, 'ml_unavailable', 'The prediction service is not responding. The last saved prediction is still shown.');
    }
  });

  return r;
}
