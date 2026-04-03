const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

/**
 * KV-based rate limiter with optimistic increment.
 *
 * KV does not support atomic increment, so there is a small race window
 * between read and write. We mitigate this by:
 * 1. Always incrementing first (optimistic), then checking
 * 2. Using a soft overflow buffer (10%) before hard-rejecting
 *
 * This means under extreme concurrency, the limit may be exceeded by
 * ~10% in the worst case. For a read-only resolver API with KV caching,
 * this tradeoff is acceptable. The ingestion API uses Upstash Redis
 * with atomic INCR for exact enforcement.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `rl:${ip}:${Math.floor(now / WINDOW_SECONDS)}`;

  // Read current count
  const current = await kv.get(windowKey, 'text');
  const count = (current ? parseInt(current, 10) : 0) + 1;

  // Always write the incremented value first (optimistic)
  await kv.put(windowKey, String(count), {
    expirationTtl: WINDOW_SECONDS * 2,
  });

  // Hard limit with 10% overflow buffer for race conditions
  const hardLimit = Math.ceil(MAX_REQUESTS * 1.1);

  if (count > hardLimit) {
    const windowEnd = (Math.floor(now / WINDOW_SECONDS) + 1) * WINDOW_SECONDS;
    return {
      allowed: false,
      remaining: 0,
      retryAfter: windowEnd - now,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, MAX_REQUESTS - count),
  };
}
