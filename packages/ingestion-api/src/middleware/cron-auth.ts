/**
 * Vercel cron authentication middleware.
 * Vercel sends Authorization: Bearer <CRON_SECRET> on cron invocations.
 * Manual invocation requires the same header.
 */
import { createMiddleware } from 'hono/factory';
import { makeError } from '@acr/shared';

export const cronAuth = createMiddleware(async (c, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No CRON_SECRET configured — block all cron access
    return c.json(makeError('UNAUTHORIZED', 'Cron not configured'), 401);
  }

  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${secret}`) {
    return c.json(makeError('UNAUTHORIZED', 'Invalid cron secret'), 401);
  }

  await next();
});
