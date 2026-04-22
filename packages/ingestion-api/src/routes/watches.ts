/**
 * Watches routes — create, list, delete a persistent lens threshold.
 *
 * Phase K of the v2.5.0 – v2.9.0 roadmap. Watches are
 * "tell me when X crosses Y" conditions the operator registers via the
 * MCP `set_watch` tool. The `watch-evaluation` cron (runs hourly at
 * `:22`, see `packages/intelligence/watches/index.ts`) re-runs each
 * enabled watch against the current friction/trend data and writes
 * a notification to `skill_notifications` with `source='watch'` on a
 * fresh crossing.
 *
 * Scope constraint (v1): the (lens, metric) combinations accepted
 * here are the narrow set for which a scalar threshold is meaningful:
 *   - `friction.failure_rate`       : target's failure rate (0.0 – 1.0)
 *   - `friction.proportion_of_wait` : target's share of total wait (0.0 – 1.0)
 *   - `trend.failure_rate_delta`    : target's week-over-week failure
 *                                     rate delta in percentage points
 *                                     (0.05 = +5pp)
 * Every other lens either has no natural scalar surface (coverage,
 * stable corridors) or would require a per-call parametrization of
 * the threshold unit that doesn't fit one row. If a watch's stored
 * (lens, metric) isn't in this set, the cron skips it rather than
 * failing loudly — forward-compat with future metric additions.
 */

import { Hono } from 'hono';
import { query, execute, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'watches' });
const app = new Hono();

const KNOWN_LENSES = new Set(['friction', 'trend']);
const KNOWN_METRICS = new Set(['failure_rate', 'proportion_of_wait', 'failure_rate_delta']);
const KNOWN_CONDITIONS = new Set(['above', 'below']);

interface WatchRow {
  id: string;
  lens: string;
  target_system_id: string;
  metric: string;
  threshold: number;
  condition: string;
  enabled: boolean;
  last_evaluated_at: string | null;
  last_matched_at: string | null;
  created_at: string;
}

// GET /agent/:agent_id/watches
app.get('/agent/:agent_id/watches', async (c) => {
  const agentId = c.req.param('agent_id');
  const enabledOnly = c.req.query('enabled') !== 'false';

  const conditions: string[] = ['agent_id = $1'];
  const params: unknown[] = [agentId];
  if (enabledOnly) conditions.push('enabled = true');

  const rows = await query<WatchRow>(
    `SELECT
       id AS "id",
       lens AS "lens",
       target_system_id AS "target_system_id",
       metric AS "metric",
       threshold AS "threshold",
       condition AS "condition",
       enabled AS "enabled",
       last_evaluated_at::text AS "last_evaluated_at",
       last_matched_at::text AS "last_matched_at",
       created_at::text AS "created_at"
     FROM watches
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );

  return c.json({ watches: rows });
});

// POST /agent/:agent_id/watches
app.post('/agent/:agent_id/watches', async (c) => {
  const agentId = c.req.param('agent_id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(makeError('INVALID_INPUT', 'Body must be JSON'), 400);
  }

  const lens = typeof body.lens === 'string' ? body.lens : null;
  const targetSystemId = typeof body.target_system_id === 'string' ? body.target_system_id : null;
  const metric = typeof body.metric === 'string' ? body.metric : null;
  const threshold = typeof body.threshold === 'number' ? body.threshold : null;
  const condition = typeof body.condition === 'string' ? body.condition : 'above';

  if (!lens || !KNOWN_LENSES.has(lens)) {
    return c.json(makeError('INVALID_INPUT', `Unknown lens: ${lens}`), 400);
  }
  if (!targetSystemId) {
    return c.json(makeError('INVALID_INPUT', 'Missing target_system_id'), 400);
  }
  if (!metric || !KNOWN_METRICS.has(metric)) {
    return c.json(makeError('INVALID_INPUT', `Unknown metric: ${metric}`), 400);
  }
  if (threshold == null || !Number.isFinite(threshold)) {
    return c.json(makeError('INVALID_INPUT', 'Threshold must be a finite number'), 400);
  }
  if (!KNOWN_CONDITIONS.has(condition)) {
    return c.json(makeError('INVALID_INPUT', `Unknown condition: ${condition}`), 400);
  }

  // UPSERT — a second call with the same (lens, target, metric,
  // condition) updates the threshold in place. This matches the
  // operator's likely intent: "change the line I drew earlier."
  try {
    await execute(
      `INSERT INTO watches (agent_id, lens, target_system_id, metric, threshold, condition)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agent_id, lens, target_system_id, metric, condition)
       DO UPDATE SET threshold = EXCLUDED.threshold, enabled = true`,
      [agentId, lens, targetSystemId, metric, threshold, condition],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, agentId }, 'Watch create failed');
    return c.json(makeError('INTERNAL_ERROR', `Watch create failed: ${msg}`), 500);
  }

  log.info({ agentId, lens, targetSystemId, metric, threshold, condition }, 'Watch created');
  return c.json({
    success: true,
    lens,
    target_system_id: targetSystemId,
    metric,
    threshold,
    condition,
  });
});

// DELETE /agent/:agent_id/watches/:id — soft delete via enabled=false
app.delete('/agent/:agent_id/watches/:id', async (c) => {
  const agentId = c.req.param('agent_id');
  const watchId = c.req.param('id');

  const updated = await execute(
    `UPDATE watches SET enabled = false
     WHERE id = $1 AND agent_id = $2 AND enabled = true`,
    [watchId, agentId],
  );

  if (updated === 0) {
    return c.json(makeError('NOT_FOUND', 'Watch not found or already disabled'), 404);
  }

  return c.json({ success: true, id: watchId });
});

export { app as watchesRoute };
