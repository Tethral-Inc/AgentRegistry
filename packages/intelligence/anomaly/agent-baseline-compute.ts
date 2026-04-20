import { execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'agent-baseline-compute' });

/**
 * Compute per-agent receipt-volume + anomaly-rate baselines from the last
 * 7 days of ingest_counters. One row per agent; upserted.
 *
 * hours_of_data is the number of hourly buckets observed — acts as a
 * confidence gate so detection doesn't fire against too-thin baselines.
 */
export async function handler() {
  try {
    const result = await execute(
      `INSERT INTO agent_baselines (
         agent_id,
         receipts_per_hour_p50,
         receipts_per_hour_p95,
         receipts_per_hour_p99,
         anomaly_rate_p50,
         anomaly_rate_p99,
         hours_of_data,
         computed_at
       )
       SELECT
         agent_id,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY receipt_count::FLOAT)::FLOAT,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY receipt_count::FLOAT)::FLOAT,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY receipt_count::FLOAT)::FLOAT,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY CASE WHEN receipt_count > 0 THEN anomaly_flagged::FLOAT / receipt_count::FLOAT ELSE 0 END)::FLOAT,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY CASE WHEN receipt_count > 0 THEN anomaly_flagged::FLOAT / receipt_count::FLOAT ELSE 0 END)::FLOAT,
         COUNT(*)::INT,
         now()
       FROM ingest_counters
       WHERE bucket_hour >= now() - INTERVAL '7 days'
       GROUP BY agent_id
       ON CONFLICT (agent_id) DO UPDATE SET
         receipts_per_hour_p50 = EXCLUDED.receipts_per_hour_p50,
         receipts_per_hour_p95 = EXCLUDED.receipts_per_hour_p95,
         receipts_per_hour_p99 = EXCLUDED.receipts_per_hour_p99,
         anomaly_rate_p50 = EXCLUDED.anomaly_rate_p50,
         anomaly_rate_p99 = EXCLUDED.anomaly_rate_p99,
         hours_of_data = EXCLUDED.hours_of_data,
         computed_at = EXCLUDED.computed_at`,
    );

    log.info({ rows: result }, 'Agent baselines computed');
    return { statusCode: 200, body: JSON.stringify({ rows_upserted: result }) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err: msg }, 'Agent baseline compute failed');
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}
