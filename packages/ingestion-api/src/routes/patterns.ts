/**
 * Patterns routes — read active patterns + dismiss a pattern.
 *
 * Patterns are written asynchronously by the `pattern-detection` cron
 * (see `packages/intelligence/patterns/index.ts`). This route exposes
 * the read + dismiss surface the MCP consumes for the
 * "Things we noticed" section on `get_my_agent` and `whats_new`.
 *
 * Read contract: `GET /agent/:id/patterns?active=true` returns only
 * non-dismissed, non-expired patterns whose confidence clears the
 * surface threshold. Callers that want the full history (including
 * dismissed) pass `active=false`.
 *
 * Dismiss contract: `POST /agent/:id/patterns/:type/dismiss` sets
 * `dismissed_at` + optional `dismiss_reason`. The row is kept (not
 * deleted) so the cron handler knows not to resurrect it on the next
 * detection pass.
 */

import { Hono } from 'hono';
import { query, execute, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'patterns' });
const app = new Hono();

// Mirror of SURFACE_CONFIDENCE_THRESHOLD from @acr/intelligence. Kept
// here so the API doesn't need to import the intelligence package just
// to read one constant. If you change this, change both.
const SURFACE_CONFIDENCE_THRESHOLD = 0.6;

const KNOWN_PATTERN_TYPES = new Set([
  'composition_staleness',
  'retry_burst',
  'lens_call_spike',
  'skill_version_drift',
]);

interface PatternRow {
  id: string;
  pattern_type: string;
  confidence: number;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  detected_at: string;
  expires_at: string;
  dismissed_at: string | null;
  dismiss_reason: string | null;
}

// GET /agent/:agent_id/patterns
app.get('/agent/:agent_id/patterns', async (c) => {
  const agentId = c.req.param('agent_id');
  const activeOnly = c.req.query('active') !== 'false';

  const conditions: string[] = ['agent_id = $1'];
  const params: unknown[] = [agentId];

  if (activeOnly) {
    conditions.push('dismissed_at IS NULL');
    conditions.push('expires_at > now()');
    params.push(SURFACE_CONFIDENCE_THRESHOLD);
    conditions.push(`confidence >= $${params.length}`);
  }

  const rows = await query<PatternRow>(
    `SELECT
       id AS "id",
       pattern_type AS "pattern_type",
       confidence AS "confidence",
       title AS "title",
       message AS "message",
       metadata AS "metadata",
       detected_at::text AS "detected_at",
       expires_at::text AS "expires_at",
       dismissed_at::text AS "dismissed_at",
       dismiss_reason AS "dismiss_reason"
     FROM agent_patterns
     WHERE ${conditions.join(' AND ')}
     ORDER BY confidence DESC, detected_at DESC`,
    params,
  );

  return c.json({ patterns: rows });
});

// POST /agent/:agent_id/patterns/:pattern_type/dismiss
app.post('/agent/:agent_id/patterns/:pattern_type/dismiss', async (c) => {
  const agentId = c.req.param('agent_id');
  const patternType = c.req.param('pattern_type');

  if (!KNOWN_PATTERN_TYPES.has(patternType)) {
    return c.json(
      makeError('INVALID_INPUT', `Unknown pattern_type: ${patternType}`),
      400,
    );
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* no body is ok */ }
  const reason = typeof body.reason === 'string' ? body.reason : null;

  const updated = await execute(
    `UPDATE agent_patterns
     SET dismissed_at = now(), dismiss_reason = $3
     WHERE agent_id = $1 AND pattern_type = $2 AND dismissed_at IS NULL`,
    [agentId, patternType, reason],
  );

  if (updated === 0) {
    return c.json(
      makeError('NOT_FOUND', `No active pattern of type ${patternType} for this agent`),
      404,
    );
  }

  log.info({ agentId, patternType, reason }, 'Pattern dismissed');
  return c.json({ success: true, pattern_type: patternType });
});

export { app as patternsRoute };
