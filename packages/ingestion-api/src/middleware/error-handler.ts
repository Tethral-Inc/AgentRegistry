import type { ErrorHandler } from 'hono';
import { makeError } from '@acr/shared';
import { createLogger } from '@acr/shared';

const log = createLogger({ name: 'ingestion-api' });

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';

  log.error({ err, requestId, path: c.req.path }, 'Unhandled error');

  if (err.message === 'RATE_LIMITED') {
    return c.json(makeError('RATE_LIMITED', 'Too many requests'), 429);
  }

  return c.json(
    makeError('INTERNAL_ERROR', 'An unexpected error occurred'),
    500,
  );
};
