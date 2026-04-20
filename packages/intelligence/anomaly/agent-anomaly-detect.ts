import { query, createLogger } from '@acr/shared';

const log = createLogger({ name: 'agent-anomaly-detect' });

// Phase 0: log signals only. Flipping this to false makes detection write
// to agent_quarantine, which the ingest path will then read and (once its
// own SHADOW_MODE is off) use to reject.
const SHADOW_MODE = true;

// Don't fire signals until we've seen at least this many hours of the
// agent's activity. Protects against day-one false positives.
const MIN_HOURS_OF_DATA = 24;

// Multiply baseline p99 by this factor before flagging. 3x p99 is an
// extreme tail the agent's own history rarely reaches.
const VOLUME_SPIKE_FACTOR = 3;
const ANOMALY_RATE_SPIKE_FACTOR = 3;

// Floor the absolute thresholds so we don't fire on tiny baselines where
// p99 is 1 or 2 receipts/hour.
const MIN_VOLUME_TO_FLAG = 100;
const MIN_ANOMALY_RATE_TO_FLAG = 0.1;

interface DetectionRow {
  agent_id: string;
  bucket_hour: string;
  receipt_count: number;
  anomaly_flagged: number;
  p99: number;
  anomaly_rate_p99: number;
  hours_of_data: number;
}

export async function handler() {
  try {
    const rows = await query<DetectionRow>(
      `SELECT
         c.agent_id AS "agent_id",
         c.bucket_hour::text AS "bucket_hour",
         c.receipt_count AS "receipt_count",
         c.anomaly_flagged AS "anomaly_flagged",
         b.receipts_per_hour_p99 AS "p99",
         b.anomaly_rate_p99 AS "anomaly_rate_p99",
         b.hours_of_data AS "hours_of_data"
       FROM ingest_counters c
       JOIN agent_baselines b ON b.agent_id = c.agent_id
       WHERE c.bucket_hour >= now() - INTERVAL '2 hours'
         AND b.hours_of_data >= $1`,
      [MIN_HOURS_OF_DATA],
    );

    let scanned = 0;
    let flagged = 0;

    for (const row of rows) {
      scanned += 1;
      const signals: string[] = [];

      const volumeThreshold = Math.max(
        MIN_VOLUME_TO_FLAG,
        (row.p99 ?? 0) * VOLUME_SPIKE_FACTOR,
      );
      if (row.receipt_count > volumeThreshold) {
        signals.push('volume_spike');
      }

      if (row.receipt_count > 0) {
        const anomalyRate = row.anomaly_flagged / row.receipt_count;
        const rateThreshold = Math.max(
          MIN_ANOMALY_RATE_TO_FLAG,
          (row.anomaly_rate_p99 ?? 0) * ANOMALY_RATE_SPIKE_FACTOR,
        );
        if (anomalyRate > rateThreshold) {
          signals.push('anomaly_rate_spike');
        }
      }

      if (signals.length > 0) {
        flagged += 1;
        log.warn(
          {
            agentId: row.agent_id,
            bucketHour: row.bucket_hour,
            receiptCount: row.receipt_count,
            anomalyFlagged: row.anomaly_flagged,
            baselineP99: row.p99,
            anomalyRateP99: row.anomaly_rate_p99,
            hoursOfData: row.hours_of_data,
            signals,
            shadow: SHADOW_MODE,
          },
          'Agent anomaly signal',
        );
        // SHADOW_MODE: do not write to agent_quarantine yet. Phase 1 will
        // flip this to an INSERT ... ON CONFLICT (agent_id) DO UPDATE.
      }
    }

    log.info({ scanned, flagged }, 'Agent anomaly scan complete');
    return { statusCode: 200, body: JSON.stringify({ scanned, flagged }) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err: msg }, 'Agent anomaly detect failed');
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}
