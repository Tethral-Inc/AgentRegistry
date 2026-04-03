import { query, execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'friction-baseline-compute' });

interface BaselineRow {
  target_class: string;
  median_ms: number;
  p95_ms: number;
  p99_ms: number;
  sample_count: string;
  stddev_ms: number;
  mean_ms: number;
  failure_rate: number;
}

export async function handler() {
  try {
    // Compute population baselines from all agents' receipt data
    // Group by target_system_id to get per-system baselines
    const rows = await query<BaselineRow>(
      `SELECT
         target_system_id AS "target_class",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "median_ms",
         percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS "p95_ms",
         percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS "p99_ms",
         COUNT(*)::text AS "sample_count",
         stddev(duration_ms)::float AS "stddev_ms",
         avg(duration_ms)::float AS "mean_ms",
         (COUNT(*) FILTER (WHERE status != 'success'))::float / NULLIF(COUNT(*), 0) AS "failure_rate"
       FROM interaction_receipts
       WHERE created_at >= now() - INTERVAL '7 days'
         AND duration_ms IS NOT NULL
         AND duration_ms > 0
       GROUP BY target_system_id
       HAVING COUNT(*) >= 10`,
    );

    if (rows.length === 0) {
      log.info('Insufficient data for baselines (need >= 10 samples per target)');
      return { statusCode: 200, body: JSON.stringify({ computed: 0 }) };
    }

    let computed = 0;

    for (const row of rows) {
      const volatility = row.mean_ms > 0 ? (row.stddev_ms ?? 0) / row.mean_ms : 0;

      await execute(
        `INSERT INTO friction_baselines (
           target_class, baseline_median_ms, baseline_p95_ms, baseline_p99_ms,
           sample_count, volatility_score, failure_rate, last_computed
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (target_class) DO UPDATE SET
           baseline_median_ms = $2,
           baseline_p95_ms = $3,
           baseline_p99_ms = $4,
           sample_count = $5,
           volatility_score = $6,
           failure_rate = $7,
           last_computed = now()`,
        [
          row.target_class,
          row.median_ms,
          row.p95_ms,
          row.p99_ms,
          parseInt(row.sample_count, 10),
          volatility,
          row.failure_rate ?? 0,
        ],
      );

      computed++;
    }

    log.info({ computed }, 'Friction baselines computed');

    return {
      statusCode: 200,
      body: JSON.stringify({ computed }),
    };
  } catch (err) {
    log.error({ err }, 'Friction baseline computation failed');
    return { statusCode: 500, body: 'Internal error' };
  }
}
