/**
 * Cohort baselines — "what does typical look like for agents in your
 * provider_class?" Public endpoint: no agent_id, no API key.
 *
 * Why: a brand-new agent has no history of its own. Every lens renders
 * thin-sample for the first ~10 interactions, and the agent sees a black
 * hole. Baselines from the wider cohort (keyed on provider_class) let us
 * prepend "Your cohort's typical performance:" to lens output so there's
 * useful framing from the first call.
 *
 * Privacy model: results are cohort-aggregated, never per-agent. We
 * require `cohort_size >= 3` for any target to appear; single-agent or
 * two-agent cohorts can leak identity and are dropped. No agent IDs, no
 * API keys, no skill hashes leave this endpoint.
 *
 * Source filter: excludes `source='environmental'` by default so the
 * probe receipts (which every MCP emits on startup) don't distort the
 * "typical real-agent behavior" number. Pass `include_env=1` to see the
 * unfiltered rollup.
 */

import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';

const log = createLogger({ name: 'baselines' });
const app = new Hono();

const MIN_COHORT_SIZE = 3;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_TARGETS = 20;

/**
 * GET /baselines/cohort — Typical performance for a provider-class cohort.
 *
 * Query params:
 *   provider_class (required) — e.g., 'anthropic', 'openai', 'unknown'
 *   window_days    (optional) — lookback window, default 7
 *   include_env    (optional) — 1 to include environmental probe receipts
 */
app.get('/baselines/cohort', async (c) => {
  const providerClass = c.req.query('provider_class');
  if (!providerClass) {
    return c.json(
      { error: { code: 'MISSING_PARAM', message: 'provider_class is required' } },
      400,
    );
  }

  const windowDaysRaw = parseInt(c.req.query('window_days') ?? String(DEFAULT_WINDOW_DAYS), 10);
  const windowDays = Number.isFinite(windowDaysRaw)
    ? Math.min(Math.max(1, windowDaysRaw), 30)
    : DEFAULT_WINDOW_DAYS;
  const includeEnv = c.req.query('include_env') === '1';

  // Source exclusion: environmental probes are synthetic baselines
  // emitted by every MCP on startup. They're useful as per-agent
  // baselines in the friction report, but they'd dilute the "what do
  // real agent calls look like" number we want here.
  const sourceClause = includeEnv ? '' : ` AND source <> 'environmental'`;

  try {
    // 1. Cohort size: distinct agents in the class over the window.
    const cohortRows = await query<{ cohort_size: number; total_interactions: number }>(
      `SELECT COUNT(DISTINCT emitter_agent_id)::int AS "cohort_size",
              COUNT(*)::int AS "total_interactions"
       FROM interaction_receipts
       WHERE emitter_provider_class = $1
         AND created_at >= now() - ($2 || ' days')::interval${sourceClause}`,
      [providerClass, String(windowDays)],
    );
    const cohortSize = cohortRows[0]?.cohort_size ?? 0;
    const totalInteractions = cohortRows[0]?.total_interactions ?? 0;

    if (cohortSize < MIN_COHORT_SIZE) {
      return c.json({
        provider_class: providerClass,
        window_days: windowDays,
        cohort_size: cohortSize,
        total_interactions: totalInteractions,
        targets: [],
        reason: cohortSize === 0
          ? 'No agents in this provider class yet.'
          : `Cohort too small (${cohortSize} < ${MIN_COHORT_SIZE}) — withholding to protect identity.`,
      });
    }

    // 2. Per-target typical performance. HAVING clause enforces the
    // min-cohort-size rule at the target level too — a target with only
    // one agent calling it gets dropped from the output.
    const targets = await query<{
      target_system_id: string;
      target_system_type: string | null;
      cohort_size: number;
      total_interactions: number;
      median_duration_ms: number | null;
      p95_duration_ms: number | null;
      failure_rate: number;
      anomaly_rate: number;
    }>(
      `SELECT target_system_id AS "target_system_id",
              MIN(target_system_type) AS "target_system_type",
              COUNT(DISTINCT emitter_agent_id)::int AS "cohort_size",
              COUNT(*)::int AS "total_interactions",
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::float AS "median_duration_ms",
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::float AS "p95_duration_ms",
              COALESCE(
                COUNT(*) FILTER (WHERE status = 'failure')::float /
                NULLIF(COUNT(*), 0), 0
              ) AS "failure_rate",
              COALESCE(
                COUNT(*) FILTER (WHERE anomaly_flagged = true)::float /
                NULLIF(COUNT(*), 0), 0
              ) AS "anomaly_rate"
       FROM interaction_receipts
       WHERE emitter_provider_class = $1
         AND created_at >= now() - ($2 || ' days')::interval
         AND duration_ms IS NOT NULL${sourceClause}
       GROUP BY target_system_id
       HAVING COUNT(DISTINCT emitter_agent_id) >= ${MIN_COHORT_SIZE}
       ORDER BY COUNT(*) DESC
       LIMIT ${MAX_TARGETS}`,
      [providerClass, String(windowDays)],
    );

    // Cache for 5 minutes — cohort baselines move slowly.
    c.header('Cache-Control', 'public, max-age=300');

    return c.json({
      provider_class: providerClass,
      window_days: windowDays,
      cohort_size: cohortSize,
      total_interactions: totalInteractions,
      targets,
    });
  } catch (err) {
    log.error({ err, providerClass }, 'Cohort baseline query failed');
    return c.json(
      { error: { code: 'BASELINE_QUERY_FAILED', message: 'Failed to compute cohort baseline' } },
      500,
    );
  }
});

export { app as baselinesRoute };
