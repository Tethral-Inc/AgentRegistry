import { Hono } from 'hono';
import { query, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'internal-query' });
const app = new Hono();

/**
 * Mutation keywords that must never appear in proxied queries.
 * Checked case-insensitively against the full query body, not just the prefix.
 */
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'COPY', 'EXECUTE', 'CALL',
];

function isSafeReadQuery(sql: string): boolean {
  const upper = sql.toUpperCase();

  // Must start with SELECT or WITH (for CTEs)
  const trimmed = upper.trim();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return false;
  }

  // Must not contain any mutation keywords anywhere in the body
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Word-boundary match to avoid false positives like "SELECTED"
    const pattern = new RegExp(`\\b${keyword}\\b`);
    if (pattern.test(upper)) {
      return false;
    }
  }

  // Must not contain semicolons (prevents multi-statement injection)
  if (sql.includes(';')) {
    return false;
  }

  return true;
}

/**
 * Internal query proxy for the Cloudflare Worker resolver.
 * CF Workers can't use TCP sockets, so they proxy read queries
 * through this endpoint which has full pg driver access.
 *
 * Security:
 * - Authenticated by dedicated INTERNAL_QUERY_SECRET env var (exact match)
 * - Falls back to exact 16-char prefix of connection string if secret not set
 * - Rejects any query containing mutation keywords (INSERT, DELETE, DROP, etc.)
 * - Rejects multi-statement queries (semicolons)
 * - Rejects CTEs containing mutation operations
 */
app.post('/internal/query', async (c) => {
  // Validate internal auth with exact match
  const internalKey = c.req.header('x-internal-key');
  const expectedSecret = process.env.INTERNAL_QUERY_SECRET
    ?? (process.env.COCKROACH_CONNECTION_STRING ?? '').substring(0, 16);

  if (!internalKey || !expectedSecret || internalKey !== expectedSecret) {
    return c.json(makeError('UNAUTHORIZED', 'Invalid internal key'), 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(makeError('INVALID_INPUT', 'Request body must be valid JSON'), 400);
  }

  const { sql, params } = body as { sql: string; params: unknown[] };

  if (!sql || typeof sql !== 'string') {
    return c.json(makeError('INVALID_INPUT', 'sql is required'), 400);
  }

  if (!isSafeReadQuery(sql)) {
    log.warn({ sql: sql.substring(0, 200) }, 'Rejected unsafe query via proxy');
    return c.json(makeError('UNAUTHORIZED', 'Only read-only SELECT queries allowed via proxy'), 403);
  }

  try {
    const rows = await query(sql, params);
    return c.json({ rows });
  } catch (err) {
    log.error({ err }, 'Internal query failed');
    return c.json(makeError('INTERNAL_ERROR', 'Query failed'), 500);
  }
});

export { app as internalQueryRoute };
