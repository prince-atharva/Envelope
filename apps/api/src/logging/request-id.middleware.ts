import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Accept a caller-supplied id only if it is short and plain. Anything else
// could be used to forge or break log lines, so it is replaced.
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Registered before every other middleware (see configureApp). Gives each request
 * an id that pino-http, the CLS context, error responses and queued jobs all share.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && ACCEPTED_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
