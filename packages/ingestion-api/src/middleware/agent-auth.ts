/**
 * Per-agent endpoint authentication middleware.
 * Validates API key and verifies the key owner matches the requested agent.
 */
import { createMiddleware } from 'hono/factory';
import { sha256, query, execute, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

export const agentAuth = createMiddleware<any, string, {}, any>(async (c, next) => {
  // Accept key from Authorization header or X-Api-Key (backwards compat)
  const authHeader = c.req.header('Authorization');
  const xApiKey = c.req.header('X-Api-Key');
  const rawKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : xApiKey;

  if (!rawKey) {
    return c.json(makeError('UNAUTHORIZED', 'API key required. Include Authorization: Bearer <key> header.'), 401);
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

  // Resolve the agent ID from the URL and verify ownership
  const identifier = c.req.param('identifier') ?? c.req.param('agent_id');
  if (identifier) {
    const resolved = await resolveAgentId(identifier);
    if (resolved.agent_id !== keyRow.operator_id) {
      return c.json(makeError('FORBIDDEN', 'API key does not authorize access to this agent.'), 403);
    }
  }

  // Set auth context for downstream routes (Hono env not typed, use header pass-through)
  c.req.raw.headers.set('X-ACR-Auth-Agent', keyRow.operator_id);
  c.req.raw.headers.set('X-ACR-Auth-Tier', keyRow.tier);

  // Update last_used_at (fire-and-forget)
  execute(
    `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1`,
    [keyHash],
  ).catch(() => {});

  await next();
});
