import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { AppContext } from './context.js';
import { authRouter } from './auth/routes.js';
import { authenticate } from './auth/middleware.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { logger } from './logger.js';
import { meRouter } from './modules/me/routes.js';
import { publicRouter } from './modules/public/routes.js';
import { fleetRouter } from './modules/fleet/routes.js';
import { routesAdminRouter } from './modules/routes/routes.js';
import { allocationsRouter } from './modules/allocations/routes.js';
import { predictionsRouter } from './modules/predictions/routes.js';
import { cardsAdminRouter } from './modules/cards/routes.js';
import { dayPassAdminRouter } from './modules/day-passes/routes.js';
import { paymentsAdminRouter, paymentsGatewayRouter } from './modules/payments/routes.js';
import { academicRouter } from './modules/academic/routes.js';
import { noticesAdminRouter } from './modules/notices/routes.js';
import { ticketsAdminRouter } from './modules/tickets/routes.js';
import { trackingRouter } from './modules/tracking/routes.js';
import { boardingRouter } from './modules/boarding/routes.js';
import { adminsRouter } from './modules/admins/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { feedRouter } from './modules/feed/routes.js';
import { routinesRouter } from './modules/routines/routes.js';
import { reportsRouter } from './modules/reports/routes.js';

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Never log bodies, cookies or auth headers.
    serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }) },
    autoLogging: ctx.config.NODE_ENV !== 'test',
  }));
  app.use(helmet());
  app.use(cors({ origin: ctx.config.corsOrigins, credentials: true }));
  app.use(cookieParser());
  // Keep the raw bytes: GPS trackers sign the exact body they send.
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: ctx.config.NODE_ENV === 'test' ? 10_000 : 300, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/ready', async (_req, res) => {
    await ctx.db.execute(sql`select 1`);
    res.json({ ok: true });
  });

  app.use('/auth', authRouter(ctx));
  app.use('/payments', paymentsGatewayRouter(ctx));
  app.use('/devices', trackingRouter(ctx).devices);
  app.use('/', publicRouter(ctx));
  app.use('/me', meRouter(ctx));
  app.use('/boarding', boardingRouter(ctx));

  // Authority dashboard. Every route below checks a permission.
  const admin = express.Router();
  admin.use(authenticate(ctx));
  admin.use(fleetRouter(ctx));
  admin.use(routesAdminRouter(ctx));
  admin.use(allocationsRouter(ctx));
  admin.use(predictionsRouter(ctx));
  admin.use(cardsAdminRouter(ctx));
  admin.use(dayPassAdminRouter(ctx));
  admin.use(paymentsAdminRouter(ctx));
  admin.use(academicRouter(ctx));
  admin.use(noticesAdminRouter(ctx));
  admin.use(ticketsAdminRouter(ctx));
  admin.use(trackingRouter(ctx).admin);
  admin.use(adminsRouter(ctx));
  admin.use(settingsRouter(ctx));
  admin.use(feedRouter(ctx));
  admin.use(routinesRouter(ctx));
  admin.use(reportsRouter(ctx));
  app.use('/admin', admin);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
