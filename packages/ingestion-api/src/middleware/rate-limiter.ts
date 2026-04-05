import { createMiddleware } from 'hono/factory';
import { makeError } from '@acr/shared';

/**
 * Upstash Redis rate limiter for serverless environments.
 *
 * Uses Upstash's REST API for sliding-window rate limiting.
 * Each check is a single HTTP roundtrip.
 *
 * Accepts env vars from either Vercel KV integration or direct Upstash:
 * - KV_REST_API_URL / UPSTASH_REDIS_REST_URL
 * - KV_REST_API_TOKEN / UPSTASH_REDIS_REST_TOKEN
 */

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

interface UpstashResponse {
  result: number | null;
}

async function upstashCommand(
  url: string,
  token: string,
  command: string[],
): Promise<UpstashResponse> {
  const res = await fetch(`${url}/${command.join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<UpstashResponse>;
}

export function rateLimiter() {
  return createMiddleware(async (c, next) => {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

    // Skip rate limiting if Upstash is not configured
    if (!url || !token) {
      await next();
      return;
    }

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';

    const now = Math.floor(Date.now() / 1000);
    const windowKey = `rl:${ip}:${Math.floor(now / WINDOW_SECONDS)}`;

    try {
      // INCR + EXPIRE in a pipeline-like fashion via REST
      const incrResult = await upstashCommand(url, token, ['INCR', windowKey]);
      const count = incrResult.result ?? 1;

      // Set TTL on first request in window
      if (count === 1) {
        await upstashCommand(url, token, ['EXPIRE', windowKey, String(WINDOW_SECONDS * 2)]);
      }

      c.header('X-RateLimit-Limit', String(MAX_REQUESTS));
      c.header('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - count)));

      if (count > MAX_REQUESTS) {
        const windowEnd = (Math.floor(now / WINDOW_SECONDS) + 1) * WINDOW_SECONDS;
        c.header('Retry-After', String(windowEnd - now));
        return c.json(makeError('RATE_LIMITED', 'Too many requests'), 429);
      }
    } catch {
      // If Upstash is down, allow the request through
      // Better to serve without rate limiting than to block everything
    }

    await next();
  });
}
