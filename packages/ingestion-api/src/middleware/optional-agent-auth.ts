/**
 * Optional API-key auth for write endpoints.
 *
 * If an Authorization: Bearer <key> (or X-Api-Key) header is present,
 * validates the key against api_keys. Invalid or revoked keys are rejected.
 * Missing keys pass through so existing SDK clients that don't yet send
 * credentials keep working. Routes that want to enforce matching between
 * the authed agent and the request body (e.g. receipts' emitter.agent_id)
 * do so by reading the X-ACR-Auth-Agent header the middleware sets.
 */
import { createMiddleware } from 'hono/factory';
import { sha256, query, execute, makeError } from '@acr/shared';

export const optionalAgentAuth = createMiddleware<any, string, {}, any>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const xApiKey = c.req.header('X-Api-Key');
  const rawKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : xApiKey;

  if (!rawKey) {
    await next();
    return;
  }

  const keyHash = sha256(rawKey);
  const rows = await query<{ operator_id: string; tier: string; revoked: boolean }>(
    `SELECT operator_id AS "operator_id", tier AS "tier", revoked AS "revoked"
     FROM api_keys WHERE key_hash = $1`,
    [keyHash],
  );

  if (rows.length === 0) {
    return c.json(makeError('UNAUTHORIZED', 'Invalid API key.'), 401);
  }

  const keyRow = rows[0]!;
  if (keyRow.revoked) {
    return c.json(makeError('UNAUTHORIZED', 'API key has been revoked.'), 401);
  }

  c.req.raw.headers.set('X-ACR-Auth-Agent', keyRow.operator_id);
  c.req.raw.headers.set('X-ACR-Auth-Tier', keyRow.tier);

  execute(
    `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1`,
    [keyHash],
  ).catch(() => {});

  await next();
});
