import { query, execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'system-health-aggregate' });

interface AggregateRow {
  target_system_id: string;
  target_system_type: string;
  source: string | null;
  total_count: string;
  distinct_agents: string;
  anomaly_count: string;
  failure_count: string;
  median_duration: number | null;
  p95_duration: number | null;
  p99_duration: number | null;
}

// No synthetic health_status label. Raw rates (failure_rate, anomaly_rate)
// are written directly — clients interpret the numbers.

export async function handler() {
  try {
    // We want per-source rows AND a cross-source 'all' rollup per system.
    // CockroachDB does NOT implement `GROUP BY GROUPING SETS` ("unimplemented:
    // this syntax"), so we emit the two grouping levels as UNION ALL'd
    // aggregations instead: the first SELECT groups by (system, type, source),
    // the second drops `source` (NULL) to produce the rollup that becomes the
    // 'all' row at INSERT time (row.source ?? 'all' below). Both halves read
    // the same 24h base rows, so the rollup percentiles are computed over the
    // full per-system population — not averaged from the per-source rows.
    //
    // This is the fix for the network-status totals/systems contradiction: the
    // totals query filtered by source, the systems block read from this table
    // which had no source dimension. Both can now filter by the same value.
    // distinct_agent_count counts PERSISTENT agents only (>= 5 receipts in
    // the window). Ephemeral one-shot registrations (CI runs, throwaway
    // sessions) once dominated the number — a system showed "74 agents, 74
    // interactions" (exactly one call per "agent") and downstream population
    // baselines treated that churn as a fleet. Interaction counts stay raw;
    // only the agent-population number gets the persistence filter.
    const AGG_COLS = `
         COUNT(*)::text AS "total_count",
         COUNT(DISTINCT ir.emitter_agent_id) FILTER (WHERE p.agent_id IS NOT NULL)::text AS "distinct_agents",
         COUNT(*) FILTER (WHERE ir.anomaly_flagged = true)::text AS "anomaly_count",
         COUNT(*) FILTER (WHERE ir.status != 'success')::text AS "failure_count",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ir.duration_ms::FLOAT)::int AS "median_duration",
         percentile_cont(0.95) WITHIN GROUP (ORDER BY ir.duration_ms::FLOAT)::int AS "p95_duration",
         percentile_cont(0.99) WITHIN GROUP (ORDER BY ir.duration_ms::FLOAT)::int AS "p99_duration"`;
    const WINDOW = `ir.created_at >= now() - INTERVAL '24 hours'`;
    const FROM_JOINED = `
       FROM interaction_receipts ir
       LEFT JOIN persistent p ON p.agent_id = ir.emitter_agent_id`;
    const rows = await query<AggregateRow>(
      `WITH persistent AS (
         SELECT emitter_agent_id AS agent_id
         FROM interaction_receipts
         WHERE created_at >= now() - INTERVAL '24 hours'
         GROUP BY emitter_agent_id
         HAVING COUNT(*) >= 5
       )
       SELECT
         ir.target_system_id AS "target_system_id",
         ir.target_system_type AS "target_system_type",
         ir.source AS "source",
         ${AGG_COLS}${FROM_JOINED}
       WHERE ${WINDOW}
       GROUP BY ir.target_system_id, ir.target_system_type, ir.source
       UNION ALL
       SELECT
         ir.target_system_id AS "target_system_id",
         ir.target_system_type AS "target_system_type",
         NULL AS "source",
         ${AGG_COLS}${FROM_JOINED}
       WHERE ${WINDOW}
       GROUP BY ir.target_system_id, ir.target_system_type`,
    );

    if (rows.length === 0) {
      log.info('No interactions in last 24 hours');
      return { statusCode: 200, body: JSON.stringify({ updated: 0 }) };
    }

    let updated = 0;

    for (const row of rows) {
      const totalCount = parseInt(row.total_count, 10);
      const distinctAgents = parseInt(row.distinct_agents, 10);
      const anomalyCount = parseInt(row.anomaly_count, 10);
      const failureCount = parseInt(row.failure_count, 10);

      const anomalyRate = totalCount > 0 ? anomalyCount / totalCount : 0;
      const failureRate = totalCount > 0 ? failureCount / totalCount : 0;

      // The NULL group (rollup across sources) becomes the 'all' row.
      // Per-source rows use the raw source value the receipt was
      // ingested with ('agent' | 'server').
      const source = row.source ?? 'all';

      await execute(
        `INSERT INTO system_health (
           system_id, source, system_type, total_interactions, distinct_agent_count,
           anomaly_signal_count, anomaly_rate, median_duration_ms, p95_duration_ms,
           p99_duration_ms, failure_rate, last_seen_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (system_id, source) DO UPDATE SET
           system_type = $3,
           total_interactions = $4,
           distinct_agent_count = $5,
           anomaly_signal_count = $6,
           anomaly_rate = $7,
           median_duration_ms = $8,
           p95_duration_ms = $9,
           p99_duration_ms = $10,
           failure_rate = $11,
           last_seen_at = now()`,
        [
          row.target_system_id,
          source,
          row.target_system_type,
          totalCount,
          distinctAgents,
          anomalyCount,
          anomalyRate,
          row.median_duration,
          row.p95_duration,
          row.p99_duration,
          failureRate,
        ],
      );

      updated++;
    }

    log.info({ updated }, 'System health aggregation completed');

    return {
      statusCode: 200,
      body: JSON.stringify({ updated }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err }, 'System health aggregation failed');
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}
