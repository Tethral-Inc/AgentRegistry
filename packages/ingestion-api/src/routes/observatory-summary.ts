import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';

const log = createLogger({ name: 'observatory-summary' });
const app = new Hono();

/**
 * GET /network/observatory-summary — Public network counters.
 *
 * Used by the landing page hero. Returns raw counts only — no
 * synthetic verdicts, no inherited label filters. If a client wants
 * to derive signal-based counts, it does so from the
 * raw numbers returned here.
 *
 * Cached for 5 minutes with 30s stale-while-revalidate.
 */
app.get('/network/observatory-summary', async (c) => {
  // Active agents — distinct emitters in the last 24h.
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

  // Systems observed — total entries in system_health. Raw count,
  // no filter on health_status (inherited synthetic label).
  const systemsRows = await query<{ systems_observed: number }>(
    `SELECT COUNT(*)::int AS "systems_observed"
     FROM system_health
     WHERE total_interactions > 0`,
  ).catch(() => [{ systems_observed: 0 }]);

  // Skills with any anomaly signal activity. Raw count, no filter on
  // threat_level (inherited synthetic label). Clients see the number
  // of distinct skills for which the network has observed at least
  // one anomaly signal.
  const skillsWithSignalsRows = await query<{ skills_with_signals: number }>(
    `SELECT COUNT(*)::int AS "skills_with_signals"
     FROM skill_hashes
     WHERE anomaly_signal_count > 0`,
  ).catch(() => [{ skills_with_signals: 0 }]);

  const totals = {
    active_agents_24h: agentsRows[0]?.active_agents_24h ?? 0,
    interactions_24h: interactionsRows[0]?.interactions_24h ?? 0,
    targets_tracked: targetsRows[0]?.targets_tracked ?? 0,
    systems_observed: systemsRows[0]?.systems_observed ?? 0,
    skills_with_signals: skillsWithSignalsRows[0]?.skills_with_signals ?? 0,
  };

  // Public endpoint. Aggressive cache so the landing page doesn't hit
  // the DB on every visit.
  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=30');

  return c.json({
    timestamp: new Date().toISOString(),
    ...totals,
  });
});

export { app as observatorySummaryRoute };
