import { Hono } from 'hono';
import { query, createLogger, ELEVATED_SKILL_SIGNAL_SQL } from '@acr/shared';
import { probeAggregationFreshness } from '../helpers/aggregation-freshness.js';

const log = createLogger({ name: 'network-status' });
const app = new Hono();

/**
 * GET /network/status — Full network dashboard.
 * All queries run sequentially (pool max:1 on Vercel).
 */
app.get('/network/status', async (c) => {
  // Source defaults to 'all' so network totals reflect every capture path
  // (the host-side hook is primary). The systems block reads the source='all'
  // rollup row the aggregator writes (migration 000023). The old 'agent'
  // default matched only self-reported receipts — essentially none exist —
  // so both totals and systems read empty. Pass source=agent/server to slice.
  const sourceParam = c.req.query('source') ?? 'all';

  // 1. 24h totals.
  //
  // Computed as separate single-aggregate queries rather than one SELECT
  // with two COUNT(DISTINCT ...) expressions. CockroachDB (this backend)
  // rejects multiple distinct aggregations in a single statement, and the
  // failure was swallowed by a bare .catch → every total read 0 even while
  // receipts existed (observatory-summary, which already uses this split
  // pattern, reported the real counts). Each query carries the same optional
  // source filter so the totals and the systems block stay consistent.
  // Sequential awaits respect the pool max:1 on Vercel. Failures are logged,
  // not silently zeroed, so this can't regress into invisible-empty again.
  const sourceClause = sourceParam === 'all' ? '' : ' AND source = $1';
  const totalsParams: unknown[] = sourceParam === 'all' ? [] : [sourceParam];

  // degraded: a single flag raised by ANY query catch in this handler. When a
  // query throws, we MUST NOT let its zero/empty default render as a healthy
  // network (no failing systems / no threats / no escalations). The flag tells
  // the renderer the reading is unavailable, not an all-clear.
  let degraded = false;

  const agentsRow = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT emitter_agent_id)::int AS "n"
     FROM interaction_receipts
     WHERE created_at >= now() - INTERVAL '24 hours'${sourceClause}`,
    totalsParams,
  ).catch((err) => { log.error({ err }, 'network totals: active_agents query failed'); degraded = true; return [{ n: 0 }]; });

  const systemsCountRow = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT target_system_id)::int AS "n"
     FROM interaction_receipts
     WHERE created_at >= now() - INTERVAL '24 hours'${sourceClause}`,
    totalsParams,
  ).catch((err) => { log.error({ err }, 'network totals: active_systems query failed'); degraded = true; return [{ n: 0 }]; });

  const volumeRow = await query<{ total: number; anomalies: number }>(
    `SELECT COUNT(*)::int AS "total",
            COUNT(*) FILTER (WHERE anomaly_flagged = true)::int AS "anomalies"
     FROM interaction_receipts
     WHERE created_at >= now() - INTERVAL '24 hours'${sourceClause}`,
    totalsParams,
  ).catch((err) => { log.error({ err }, 'network totals: volume query failed'); degraded = true; return [{ total: 0, anomalies: 0 }]; });

  const totalInteractions = volumeRow[0]?.total ?? 0;
  const totals = {
    active_agents: agentsRow[0]?.n ?? 0,
    active_systems: systemsCountRow[0]?.n ?? 0,
    interactions_24h: totalInteractions,
    anomaly_rate_24h: totalInteractions > 0 ? (volumeRow[0]?.anomalies ?? 0) / totalInteractions : 0,
  };

  // 2. Systems sorted worst-first. Aggregator emits one row per
  // (system, source) plus an 'all' rollup, so the read filter matches
  // the source param 1:1.
  const systems = await query<{
    system_id: string;
    system_type: string;
    total_interactions: number;
    agent_count: number;
    failure_rate: number;
    anomaly_rate: number;
    median_duration_ms: number | null;
    p95_duration_ms: number | null;
    p99_duration_ms: number | null;
    last_seen_at: string;
  }>(
    `SELECT system_id AS "system_id",
            system_type AS "system_type",
            total_interactions AS "total_interactions",
            distinct_agent_count AS "agent_count",
            failure_rate AS "failure_rate",
            anomaly_rate AS "anomaly_rate",
            median_duration_ms AS "median_duration_ms",
            p95_duration_ms AS "p95_duration_ms",
            p99_duration_ms AS "p99_duration_ms",
            last_seen_at::text AS "last_seen_at"
     FROM system_health
     WHERE source = $1
       AND total_interactions >= 3
       AND last_seen_at >= now() - INTERVAL '30 days'
     ORDER BY
       failure_rate DESC,
       anomaly_rate DESC,
       total_interactions DESC
     LIMIT 50`,
    [sourceParam],
  ).catch((err) => { log.error({ err }, 'network systems query failed'); degraded = true; return []; });

  // Staleness comes from the same probe /health uses, so the two
  // routes can never disagree about pipeline state.
  const freshness = await probeAggregationFreshness();
  const stale = freshness.stale;

  // 3. Skills with anomaly signals
  const threats = await query<{
    skill_hash: string;
    skill_name: string | null;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
    agent_count: number;
    first_seen: string;
    last_updated: string;
  }>(
    `SELECT skill_hash AS "skill_hash",
            skill_name AS "skill_name",
            anomaly_signal_count AS "anomaly_signal_count",
            anomaly_signal_rate AS "anomaly_signal_rate",
            agent_count AS "agent_count",
            first_seen_at::text AS "first_seen",
            last_updated::text AS "last_updated"
     FROM skill_hashes
     WHERE ${ELEVATED_SKILL_SIGNAL_SQL}
     ORDER BY anomaly_signal_count DESC, anomaly_signal_rate DESC
     LIMIT 20`,
  ).catch((err) => { log.error({ err }, 'network threats query failed'); degraded = true; return []; });

  // 4. Recent escalations
  const escalations = await query<{
    target: string;
    anomaly_count: number;
    agents_affected: number;
    detected_at: string;
  }>(
    `SELECT entity_id AS "target",
            anomaly_count AS "anomaly_count",
            distinct_counterparts AS "agents_affected",
            summary_date::text AS "detected_at"
     FROM daily_summaries
     WHERE entity_type = 'correlation'
       AND summary_date >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY summary_date DESC, anomaly_count DESC
     LIMIT 10`,
  ).catch((err) => { log.error({ err }, 'network escalations query failed'); degraded = true; return []; });

  // 5. Batch-enrich escalations with provider + category data (single query per dimension)
  let enrichedEscalations = escalations;
  if (escalations.length > 0) {
    const targetIds = escalations.map((e) => e.target);

    const providerRows = await query<{ target_system_id: string; provider: string }>(
      `SELECT target_system_id AS "target_system_id",
              emitter_provider_class AS "provider"
       FROM interaction_receipts
       WHERE target_system_id = ANY($1)
         AND anomaly_flagged = true
         AND created_at >= now() - INTERVAL '7 days'
       GROUP BY target_system_id, emitter_provider_class`,
      [targetIds],
    ).catch((err) => { log.error({ err }, 'network escalation provider-enrich query failed'); degraded = true; return []; });

    const categoryRows = await query<{ target_system_id: string; category: string }>(
      `SELECT target_system_id AS "target_system_id",
              anomaly_category AS "category"
       FROM interaction_receipts
       WHERE target_system_id = ANY($1)
         AND anomaly_flagged = true
         AND anomaly_category IS NOT NULL
         AND created_at >= now() - INTERVAL '7 days'
       GROUP BY target_system_id, anomaly_category`,
      [targetIds],
    ).catch((err) => { log.error({ err }, 'network escalation category-enrich query failed'); degraded = true; return []; });

    const providerMap = new Map<string, string[]>();
    for (const r of providerRows) {
      const arr = providerMap.get(r.target_system_id) ?? [];
      arr.push(r.provider);
      providerMap.set(r.target_system_id, arr);
    }

    const categoryMap = new Map<string, string[]>();
    for (const r of categoryRows) {
      const arr = categoryMap.get(r.target_system_id) ?? [];
      arr.push(r.category);
      categoryMap.set(r.target_system_id, arr);
    }

    enrichedEscalations = escalations.map((e) => ({
      ...e,
      providers_affected: providerMap.get(e.target) ?? [],
      anomaly_categories: categoryMap.get(e.target) ?? [],
    })) as typeof escalations;
  }

  c.header('Cache-Control', 'public, max-age=300');

  return c.json({
    timestamp: new Date().toISOString(),
    stale,
    degraded,
    ...(degraded ? { degraded_reason: 'network-status query failed' } : {}),
    totals,
    systems,
    threats,
    recent_escalations: enrichedEscalations,
  });
});

export { app as networkStatusRoute };
