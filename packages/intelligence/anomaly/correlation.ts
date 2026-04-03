import { query, execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'anomaly-correlation' });

interface AnomalyCluster {
  targetId: string;
  agentIds: Set<string>;
  providerClasses: Set<string>;
  categories: Map<string, number>;
  firstSeen: number;
  lastSeen: number;
  totalSignals: number;
}

/**
 * Cross-agent anomaly correlation.
 * Detects when multiple independent agents report anomalies
 * against the same target within a time window — stronger signal
 * than single-agent reports since it rules out agent-specific bugs.
 */
export async function correlateAnomalies(): Promise<{
  clusters: number;
  escalations: number;
}> {
  // Fetch anomaly receipts from the last 6 hours
  const rows = await query<{
    target_system_id: string;
    emitter_agent_id: string;
    emitter_provider_class: string;
    anomaly_category: string;
    request_timestamp_ms: string;
  }>(
    `SELECT target_system_id AS "target_system_id",
            emitter_agent_id AS "emitter_agent_id",
            COALESCE(emitter_provider_class, 'unknown') AS "emitter_provider_class",
            COALESCE(anomaly_category, 'other') AS "anomaly_category",
            request_timestamp_ms::text AS "request_timestamp_ms"
     FROM interaction_receipts
     WHERE anomaly_flagged = true
       AND created_at >= now() - INTERVAL '6 hours'
     ORDER BY request_timestamp_ms ASC`,
  );

  if (rows.length === 0) return { clusters: 0, escalations: 0 };

  // Build clusters by target
  const clusters = new Map<string, AnomalyCluster>();

  for (const row of rows) {
    let cluster = clusters.get(row.target_system_id);
    if (!cluster) {
      cluster = {
        targetId: row.target_system_id,
        agentIds: new Set(),
        providerClasses: new Set(),
        categories: new Map(),
        firstSeen: parseInt(row.request_timestamp_ms, 10),
        lastSeen: parseInt(row.request_timestamp_ms, 10),
        totalSignals: 0,
      };
      clusters.set(row.target_system_id, cluster);
    }

    cluster.agentIds.add(row.emitter_agent_id);
    cluster.providerClasses.add(row.emitter_provider_class);
    cluster.categories.set(
      row.anomaly_category,
      (cluster.categories.get(row.anomaly_category) ?? 0) + 1,
    );
    cluster.lastSeen = Math.max(cluster.lastSeen, parseInt(row.request_timestamp_ms, 10));
    cluster.totalSignals++;
  }

  let escalations = 0;

  for (const cluster of clusters.values()) {
    // Cross-provider correlation: if agents from 2+ different providers
    // report the same target, the signal is much stronger
    const crossProvider = cluster.providerClasses.size >= 2;
    const multiAgent = cluster.agentIds.size >= 3;

    if (crossProvider || multiAgent) {
      // Determine the dominant anomaly category
      let topCategory = 'other';
      let topCount = 0;
      for (const [cat, count] of cluster.categories) {
        if (count > topCount) {
          topCategory = cat;
          topCount = count;
        }
      }

      // Time decay: signals from the last hour weigh more
      const recentCutoff = Date.now() - 3600000;
      const isRecent = cluster.lastSeen > recentCutoff;

      // Escalation criteria
      const shouldEscalate = (crossProvider && cluster.agentIds.size >= 2) ||
                              (multiAgent && isRecent);

      if (shouldEscalate) {
        escalations++;

        // Log the correlation for the threat update Lambda to pick up
        await execute(
          `INSERT INTO daily_summaries (
            summary_date, entity_type, entity_id,
            total_interactions, anomaly_count, distinct_counterparts
          ) VALUES (CURRENT_DATE, 'correlation', $1, $2, $3, $4)
          ON CONFLICT (summary_date, entity_type, entity_id) DO UPDATE SET
            total_interactions = $2,
            anomaly_count = $3,
            distinct_counterparts = $4`,
          [
            cluster.targetId,
            cluster.totalSignals,
            cluster.totalSignals,
            cluster.agentIds.size,
          ],
        );

        log.warn({
          target: cluster.targetId,
          agents: cluster.agentIds.size,
          providers: Array.from(cluster.providerClasses),
          topCategory,
          signals: cluster.totalSignals,
          crossProvider,
        }, 'Anomaly correlation escalation');
      }
    }
  }

  log.info({ clusters: clusters.size, escalations }, 'Anomaly correlation completed');
  return { clusters: clusters.size, escalations };
}
