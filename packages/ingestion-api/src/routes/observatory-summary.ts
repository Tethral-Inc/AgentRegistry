import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';

const log = createLogger({ name: 'observatory-summary' });
const app = new Hono();

/**
 * GET /network/observatory-summary — Public, unauthenticated network counter.
 * Used by the landing page hero. Returns a small JSON object with current
 * scale numbers. Cached aggressively.
 *
 * Thin client principle: this endpoint is read-only, returns pre-computed
 * counts only. No interpretation. The landing page handles its own
 * fallback (template counter starting at 150) when active_agents_24h is 0.
 */
app.get('/network/observatory-summary', async (c) => {
  // Total agents seen in the last 24h.
  const agentsRows = await query<{ active_agents_24h: number }>(
    `SELECT COUNT(DISTINCT emitter_agent_id)::int AS "active_agents_24h"
     FROM interaction_receipts
     WHERE created_at >= now() - INTERVAL '24 hours'`,
  ).catch(() => [{ active_agents_24h: 0 }]);

  // Interactions logged in the last 24h.
  const interactionsRows = await query<{ interactions_24h: number }>(
    `SELECT COUNT(*)::int AS "interactions_24h"
     FROM interaction_receipts
     WHERE created_at >= now() - INTERVAL '24 hours'`,
  ).catch(() => [{ interactions_24h: 0 }]);

  // Distinct targets observed in the last 24h.
  const targetsRows = await query<{ targets_tracked: number }>(
    `SELECT COUNT(DISTINCT target_system_id)::int AS "targets_tracked"
     FROM interaction_receipts
     WHERE created_at >= now() - INTERVAL '24 hours'`,
  ).catch(() => [{ targets_tracked: 0 }]);

  // Healthy corridors — system_health rows where health_status = 'healthy'.
  const corridorsRows = await query<{ healthy_corridors: number }>(
    `SELECT COUNT(*)::int AS "healthy_corridors"
     FROM system_health
     WHERE health_status = 'healthy'
       AND total_interactions > 0`,
  ).catch(() => [{ healthy_corridors: 0 }]);

  // Active jeopardy flags — skills with elevated threat level.
  const flagsRows = await query<{ active_jeopardy_flags: number }>(
    `SELECT COUNT(*)::int AS "active_jeopardy_flags"
     FROM skill_hashes
     WHERE threat_level IN ('low', 'medium', 'high', 'critical')`,
  ).catch(() => [{ active_jeopardy_flags: 0 }]);

  const totals = {
    active_agents_24h: agentsRows[0]?.active_agents_24h ?? 0,
    interactions_24h: interactionsRows[0]?.interactions_24h ?? 0,
    targets_tracked: targetsRows[0]?.targets_tracked ?? 0,
    healthy_corridors: corridorsRows[0]?.healthy_corridors ?? 0,
    active_jeopardy_flags: flagsRows[0]?.active_jeopardy_flags ?? 0,
  };

  // Public endpoint. Aggressive cache so the landing page doesn't hit the DB
  // on every visit. 5 minute cache, 30 second stale-while-revalidate.
  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=30');

  return c.json({
    timestamp: new Date().toISOString(),
    ...totals,
  });
});

export { app as observatorySummaryRoute };
