import { createServer } from 'node:http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { and, eq } from 'drizzle-orm';
import { createApp } from './app.js';
import { buildContext } from './bootstrap.js';
import { verifyAccessToken } from './auth/tokens.js';
import { semesters, transportCards } from './db/schema.js';
import { logger } from './logger.js';
import { serveWebApp } from './web-static.js';

const { ctx, database } = await buildContext();
const app = createApp(ctx);
const { basePath } = ctx.config;
// With a base path (e.g. /api) the API is mounted there, and the web app can be served from the same origin.
const root = basePath ? express() : app;
if (basePath) {
  root.disable('x-powered-by');
  root.use(basePath, app);
  if (ctx.config.WEB_DIST_DIR) {
    serveWebApp(root, ctx.config.WEB_DIST_DIR, {
      https: ctx.config.PUBLIC_API_URL.startsWith('https://'),
      framedBy: ctx.config.DEMO_MODE ? 'https://huggingface.co' : undefined,
    });
  }
}
const server = createServer(root);

/**
 * Socket.IO rooms:
 *   authority      - all bus positions, payments, new tickets (authority accounts)
 *   route:<id>     - buses and allocation changes for one route (active card holders of that route)
 *   riders         - general notices
 */
const io = new SocketServer(server, { cors: { origin: ctx.config.corsOrigins, credentials: true }, path: `${basePath}/realtime` });
ctx.realtime = { emit: (room, event, data) => { io.to(room).emit(event, data); } };

io.use(async (socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token ?? '');
    const claims = await verifyAccessToken(ctx, token);
    socket.data.userId = claims.sub;
    socket.data.role = claims.role;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', async (socket) => {
  if (socket.data.role === 'authority') {
    await socket.join('authority');
    return;
  }
  await socket.join('riders');
  const [card] = await ctx.db.select({ routeId: transportCards.routeId }).from(transportCards)
    .innerJoin(semesters, eq(semesters.id, transportCards.semesterId))
    .where(and(eq(transportCards.userId, socket.data.userId), eq(semesters.isCurrent, true), eq(transportCards.status, 'active')));
  if (card) await socket.join(`route:${card.routeId}`); // live buses only for card holders, only their route
});

server.listen(ctx.config.PORT, () => logger.info(`API listening on :${ctx.config.PORT}`));

const shutdown = async () => {
  logger.info('Shutting down');
  io.close();
  server.close();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
