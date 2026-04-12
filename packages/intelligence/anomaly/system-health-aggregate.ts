import { query, execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'system-health-aggregate' });

interface AggregateRow {
  target_system_id: string;
  target_system_type: string;
  total_count: string;
  distinct_agents: string;
  anomaly_count: string;
  failure_count: string;
  median_duration: number | null;
}

// No synthetic health_status label. Raw rates (failure_rate, anomaly_rate)
// are written directly — clients interpret the numbers.

export async function handler() {
  try {
    // Query interaction_receipts from last 24 hours, grouped by target
    const rows = await query<AggregateRow>(
      `SELECT
         target_system_id AS "target_system_id",
         target_system_type AS "target_system_type",
         COUNT(*)::text AS "total_count",
         COUNT(DISTINCT emitter_agent_id)::text AS "distinct_agents",
         COUNT(*) FILTER (WHERE anomaly_flagged = true)::text AS "anomaly_count",
         COUNT(*) FILTER (WHERE status != 'success')::text AS "failure_count",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "median_duration"
       FROM interaction_receipts
       WHERE created_at >= now() - INTERVAL '24 hours'
       GROUP BY target_system_id, target_system_type`,
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

      await execute(
        `INSERT INTO system_health (
           system_id, system_type, total_interactions, distinct_agent_count,
           anomaly_signal_count, anomaly_rate, median_duration_ms,
           failure_rate, last_seen_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (system_id) DO UPDATE SET
           total_interactions = $3,
           distinct_agent_count = $4,
           anomaly_signal_count = $5,
           anomaly_rate = $6,
           median_duration_ms = $7,
           failure_rate = $8,
           last_seen_at = now()`,
        [
          row.target_system_id,
          row.target_system_type,
          totalCount,
          distinctAgents,
          anomalyCount,
          anomalyRate,
          row.median_duration,
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
    log.error({ err }, 'System health aggregation failed');
    return { statusCode: 500, body: 'Internal error' };
  }
}
