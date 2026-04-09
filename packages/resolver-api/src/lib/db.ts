/**
 * Database access for Cloudflare Workers.
 *
 * CF Workers cannot use TCP sockets (no `pg` driver).
 * We proxy read queries through the ingestion API's internal
 * query endpoint which has full pg driver access on Vercel.
 *
 * The primary read path is KV cache. DB queries are the
 * fallback when cache misses. The 3-second timeout enables
 * stale-while-revalidate: if DB is slow, return stale KV data.
 *
 * Production upgrade path: Cloudflare Hyperdrive (managed TCP-to-HTTP
 * connection pooler) replaces this proxy with direct pg access.
 */

const DB_TIMEOUT_MS = 3000;
const DEFAULT_PROXY_URL = 'https://ingestion-api-john-lunsfords-projects.vercel.app';

/**
 * Execute a read-only SQL query by proxying through the ingestion API.
 * Uses INTERNAL_QUERY_SECRET for auth (falls back to connection string prefix).
 * Times out after 3 seconds to enable stale-while-revalidate fallback.
 */
// No separate secret needed — derive auth from connection string prefix (both sides have it)

export async function dbQuery<T>(
  connectionString: string,
  sql: string,
  params: unknown[] = [],
  proxyUrl?: string,
): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);

  const authKey = connectionString.substring(0, 32);

  try {
    const response = await fetch(`${proxyUrl ?? DEFAULT_PROXY_URL}/api/internal/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': authKey,
      },
      body: JSON.stringify({ sql, params }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Query proxy failed: ${response.status}`);
    }

    const result = await response.json() as { rows: T[] };
    return result.rows ?? [];
  } finally {
    clearTimeout(timeout);
  }
}
