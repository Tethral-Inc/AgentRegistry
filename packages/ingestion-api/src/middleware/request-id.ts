import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'node:crypto';

export function requestId() {
  return createMiddleware(async (c, next) => {
    const id = randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  });
}
