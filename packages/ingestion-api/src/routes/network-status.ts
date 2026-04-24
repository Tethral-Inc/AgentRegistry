import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';

const log = createLogger({ name: 'network-status' });
const app = new Hono();

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * GET /network/status — Full network dashboard.
 * All queries run sequentially (pool max:1 on Vercel).
 */
app.get('/network/status', async (c) => {
  // Source defaults to 'agent' so network totals reflect agent traffic,
  // not server-side self-log. Pass source=all for both.
  const sourceParam = c.req.query('source') ?? 'agent';
  const sourceFilter = sourceParam === 'all' ? null : sourceParam;

  const totalsParams: unknown[] = [];
  let totalsSourceClause = '';
  if (sourceFilter) {
    totalsParams.push(sourceFilter);
    totalsSourceClause = ` AND source = $${totalsParams.length}`;
  }

  // 1. 24h totals
  const totalsRows = await query<{
    active_agents: number;
    active_systems: number;
    interactions_24h: number;
    anomaly_rate_24h: number;
  }>(
    `SELECT COUNT(DISTINCT emitter_agent_id)::int AS "active_agents",
            COUNT(DISTINCT target_system_id)::int AS "active_systems",
            COUNT(*)::int AS "interactions_24h",
            COALESCE(
              COUNT(*) FILTER (WHERE anomaly_flagged = true)::float /
              NULLIF(COUNT(*), 0), 0
            ) AS "anomaly_rate_24h"
     FROM interaction_receipts
     WHERE created_at >= now() - INTERVAL '24 hours'${totalsSourceClause}`,
    totalsParams,
  ).catch(() => [{ active_agents: 0, active_systems: 0, interactions_24h: 0, anomaly_rate_24h: 0 }]);

  const totals = totalsRows[0]!;

  // 2. Systems sorted worst-first
  const systems = await query<{
    system_id: string;
    system_type: string;
    total_interactions: number;
    agent_count: number;
    failure_rate: number;
    anomaly_rate: number;
    median_duration_ms: number | null;
    p95_duration_ms: number | null;
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
            last_seen_at::text AS "last_seen_at"
     FROM system_health
     WHERE total_interactions >= 3
       AND last_seen_at >= now() - INTERVAL '30 days'
     ORDER BY
       failure_rate DESC,
       anomaly_rate DESC,
       total_interactions DESC
     LIMIT 50`,
  ).catch(() => []);

  // Staleness check — use an unfiltered probe so the volume filter on systems[]
  // doesn't cause false positives in low-traffic / staging environments.
  const stalenessRows = await query<{ max_last_seen: string | null }>(
    `SELECT MAX(last_seen_at)::text AS "max_last_seen" FROM system_health`,
  ).catch(() => [{ max_last_seen: null }]);
  const latestSeen = stalenessRows[0]?.max_last_seen ?? null;
  const stale = latestSeen
    ? (Date.now() - new Date(latestSeen).getTime()) > TWO_HOURS_MS
    : true;

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
     WHERE anomaly_signal_count > 0
     ORDER BY anomaly_signal_count DESC, anomaly_signal_rate DESC
     LIMIT 20`,
  ).catch(() => []);

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
  ).catch(() => []);

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
    ).catch(() => []);

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
    ).catch(() => []);

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
    totals,
    systems,
    threats,
    recent_escalations: enrichedEscalations,
  });
});

export { app as networkStatusRoute };
