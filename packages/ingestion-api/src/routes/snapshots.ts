/**
 * Snapshots routes — freeze a lens view under a short public ID.
 *
 * Phase K of the v2.5.0 – v2.9.0 roadmap. Every MCP lens tool (friction,
 * trend, coverage, stable corridors, failure registry, revealed
 * preference, compensation signatures, composition diff) POSTs the
 * rendered result here at the end of its handler and embeds the
 * returned URL in its footer. A teammate without an agent ID can
 * open that URL and see the frozen view.
 *
 * Two routes:
 *   - `POST /agent/:agent_id/snapshots` — authed via the usual agent
 *     auth middleware. Body: `{ lens, query, result_text }`. Returns
 *     `{ short_id, url, expires_at }`. Default expiry 30 days.
 *   - `GET /snapshots/:short_id` — public read, no auth. Returns the
 *     frozen tuple. Expired rows 404.
 *
 * Short IDs are 10 characters of base62. At `gen_random_uuid()` per
 * call that's ~60 bits of entropy — comfortably collision-safe for
 * the hundreds-of-thousands scale this is ever going to run at, and
 * readable in a URL. We retry once on the unlikely collision.
 */

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { query, execute, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'snapshots' });
const app = new Hono();

const KNOWN_LENSES = new Set([
  'friction',
  'trend',
  'coverage',
  'stable_corridors',
  'failure_registry',
  'revealed_preference',
  'compensation',
  'composition_diff',
  'profile',
]);

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateShortId(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += BASE62[bytes[i] % 62];
  }
  return out;
}

interface SnapshotRow {
  short_id: string;
  agent_id: string;
  lens: string;
  query: Record<string, unknown>;
  result_text: string;
  created_at: string;
  expires_at: string;
}

// POST /agent/:agent_id/snapshots — authed
app.post('/agent/:agent_id/snapshots', async (c) => {
  const agentId = c.req.param('agent_id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(makeError('INVALID_INPUT', 'Body must be JSON'), 400);
  }

  const lens = typeof body.lens === 'string' ? body.lens : null;
  const queryObj = body.query && typeof body.query === 'object'
    ? body.query as Record<string, unknown>
    : {};
  const resultText = typeof body.result_text === 'string' ? body.result_text : null;

  if (!lens || !KNOWN_LENSES.has(lens)) {
    return c.json(makeError('INVALID_INPUT', `Unknown or missing lens: ${lens}`), 400);
  }
  if (!resultText || resultText.length === 0) {
    return c.json(makeError('INVALID_INPUT', 'Missing result_text'), 400);
  }
  // Guard against accidental multi-megabyte payloads. Lens output rarely
  // exceeds a few KB; anything over 256KB is almost certainly a bug.
  if (resultText.length > 256 * 1024) {
    return c.json(makeError('INVALID_INPUT', 'result_text exceeds 256KB'), 413);
  }

  // Retry-on-collision: short IDs are rare but possible. One retry is
  // plenty given the ~60-bit space.
  let shortId = generateShortId();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await execute(
        `INSERT INTO snapshots (short_id, agent_id, lens, query, result_text)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [shortId, agentId, lens, JSON.stringify(queryObj), resultText],
      );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && /duplicate key|unique/i.test(msg)) {
        shortId = generateShortId();
        continue;
      }
      throw err;
    }
  }

  const row = await query<{ expires_at: string }>(
    `SELECT expires_at::text AS "expires_at" FROM snapshots WHERE short_id = $1`,
    [shortId],
  );

  log.info({ agentId, lens, shortId }, 'Snapshot created');
  return c.json({
    short_id: shortId,
    expires_at: row[0]?.expires_at ?? null,
  });
});

// GET /snapshots/:short_id — public, no auth
app.get('/snapshots/:short_id', async (c) => {
  const shortId = c.req.param('short_id');

  // Cheap shape check — avoid SQL on malformed inputs
  if (!/^[A-Za-z0-9]{10}$/.test(shortId)) {
    return c.json(makeError('NOT_FOUND', 'Snapshot not found'), 404);
  }

  const rows = await query<SnapshotRow>(
    `SELECT
       short_id AS "short_id",
       agent_id AS "agent_id",
       lens AS "lens",
       query AS "query",
       result_text AS "result_text",
       created_at::text AS "created_at",
       expires_at::text AS "expires_at"
     FROM snapshots
     WHERE short_id = $1 AND expires_at > now()`,
    [shortId],
  );

  if (rows.length === 0) {
    return c.json(makeError('NOT_FOUND', 'Snapshot not found or expired'), 404);
  }

  return c.json(rows[0]);
});

export { app as snapshotsRoute };
