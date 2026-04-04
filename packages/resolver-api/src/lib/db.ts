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
const PROXY_URL = 'https://ingestion-api-john-lunsfords-projects.vercel.app';

/**
 * Execute a read-only SQL query by proxying through the ingestion API.
 * Times out after 3 seconds to enable stale-while-revalidate fallback.
 */
export async function dbQuery<T>(
  connectionString: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);

  try {
    const response = await fetch(`${PROXY_URL}/api/internal/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Simple shared-secret auth: first 16 chars of connection string
        'X-Internal-Key': connectionString.substring(0, 16),
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
