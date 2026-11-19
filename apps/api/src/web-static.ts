/**
 * Serves the built web app (apps/web/dist) from the same origin as the API,
 * which then lives under a path such as /api. One origin means the refresh
 * cookie works on any host, including ones whose subdomains are separate
 * sites (*.hf.space, *.app.github.dev, *.onrender.com).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type Express } from 'express';

export function serveWebApp(root: Express, dir: string, opts: { https: boolean; framedBy?: string }) {
  const base = resolve(dir);
  const index = join(base, 'index.html');
  if (!existsSync(index)) throw new Error(`WEB_DIST_DIR has no index.html: ${base}`);

  root.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', `frame-ancestors ${opts.framedBy ?? "'none'"}`);
    if (opts.https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  root.use('/assets', express.static(join(base, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }));
  root.use(express.static(base, { index: false, maxAge: '1h' }));
  // Every other GET is a page of the single-page app.
  root.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
