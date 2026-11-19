import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in again') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission for this') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, 'unprocessable', message, details);
/** A university system we depend on (SSO, directory, gateway) is down or slow. */
export function upstreamUnavailable(service: string, cause?: unknown): HttpError {
  const err = new HttpError(503, 'upstream_unavailable', `${service} is not reachable right now. Try again in a few minutes.`);
  if (cause !== undefined) err.cause = cause; // logged, never sent to the client
  return err;
}

/** Parses input with a zod schema; a failure becomes a 400 with field messages. */
export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'validation_error', 'Some fields are not valid', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Endpoint'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as { id?: string }).id;
  if (err instanceof HttpError) {
    if (err.status >= 500) req.log?.warn({ err }, err.message);
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'validation_error', message: 'Some fields are not valid', details: err.issues, requestId } });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Request body is too large', requestId } });
    return;
  }
  req.log?.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Try again, and quote this request ID if it keeps happening.', requestId } });
};
