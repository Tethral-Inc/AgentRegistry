import { Hono } from 'hono';
import { query, execute, sha256, makeError, createLogger } from '@acr/shared';
import { randomBytes } from 'node:crypto';

const log = createLogger({ name: 'api-keys' });
const app = new Hono();

/**
 * Admin auth middleware for API key management.
 * Requires X-Admin-Key header matching the ADMIN_SECRET env var.
 * If ADMIN_SECRET is not set, all requests are rejected.
 */
async function requireAdmin(c: any, next: () => Promise<void>) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return c.json(makeError('UNAUTHORIZED', 'Admin endpoint not configured'), 503);
  }
  const provided = c.req.header('x-admin-key');
  if (!provided || provided !== adminSecret) {
    return c.json(makeError('UNAUTHORIZED', 'Valid X-Admin-Key header required'), 401);
  }
  await next();
}

// All API key endpoints require admin auth
app.use('/api-keys', requireAdmin);
app.use('/api-keys/*', requireAdmin);

// POST /api/v1/api-keys - Create a new API key
app.post('/api-keys', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { return c.json(makeError('INVALID_INPUT', 'Request body must be valid JSON'), 400); }
  const { operator_id, name, tier } = body as {
    operator_id: string;
    name: string;
    tier?: string;
  };

  if (!operator_id || typeof operator_id !== 'string') {
    return c.json(makeError('MISSING_FIELD', 'operator_id is required'), 400);
  }
  if (!name || typeof name !== 'string') {
    return c.json(makeError('MISSING_FIELD', 'name is required'), 400);
  }

  const validTiers = ['free', 'paid', 'enterprise'];
  const keyTier = validTiers.includes(tier ?? '') ? tier! : 'free';

  const rawKey = `acr_${randomBytes(24).toString('hex')}`;
  const keyHash = sha256(rawKey);
  const rateLimit = keyTier === 'enterprise' ? 10000 : keyTier === 'paid' ? 1000 : 100;

  await execute(
    `INSERT INTO api_keys (key_hash, operator_id, name, tier, rate_limit_per_hour)
     VALUES ($1, $2, $3, $4, $5)`,
    [keyHash, operator_id, name, keyTier, rateLimit],
  );

  log.info({ operatorId: operator_id, tier: keyTier }, 'API key created');

  return c.json({
    key: rawKey,
    key_hash: keyHash,
    operator_id,
    name,
    tier: keyTier,
    rate_limit_per_hour: rateLimit,
  }, 201);
});

// GET /api/v1/api-keys?operator_id=xxx
app.get('/api-keys', async (c) => {
  const operatorId = c.req.query('operator_id');
  if (!operatorId) {
    return c.json(makeError('MISSING_FIELD', 'operator_id query param required'), 400);
  }

  const keys = await query<{
    key_hash: string; name: string; tier: string;
    rate_limit_per_hour: number; created_at: string;
    last_used_at: string | null; revoked: boolean;
  }>(
    `SELECT key_hash AS "key_hash", name AS "name", tier AS "tier",
     rate_limit_per_hour AS "rate_limit_per_hour",
     created_at::text AS "created_at", last_used_at::text AS "last_used_at",
     revoked AS "revoked"
     FROM api_keys WHERE operator_id = $1 ORDER BY created_at DESC`,
    [operatorId],
  );

  return c.json({
    keys: keys.map((k) => ({
      key_hash: k.key_hash.substring(0, 12) + '...',
      name: k.name, tier: k.tier,
      rate_limit_per_hour: k.rate_limit_per_hour,
      created_at: k.created_at, last_used_at: k.last_used_at,
      revoked: k.revoked,
    })),
  });
});

// DELETE /api/v1/api-keys/:key_hash
app.delete('/api-keys/:key_hash', async (c) => {
  const keyHash = c.req.param('key_hash');
  const updated = await execute(
    `UPDATE api_keys SET revoked = true WHERE key_hash = $1 AND revoked = false`,
    [keyHash],
  );
  if (updated === 0) {
    return c.json(makeError('NOT_FOUND', 'Key not found or already revoked'), 404);
  }
  log.info({ keyHash: keyHash.substring(0, 12) }, 'API key revoked');
  return c.json({ revoked: true });
});

export { app as apiKeysRoute };
