import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export type CorrelatedRequest = Request & { correlationId: string };

export function correlationIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header('x-correlation-id')?.trim();
  const correlationId =
    supplied && CORRELATION_ID.test(supplied) ? supplied : randomUUID();
  (request as CorrelatedRequest).correlationId = correlationId;
  response.setHeader('X-Correlation-ID', correlationId);
  next();
}
