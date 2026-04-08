import { query, execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'data-archival' });

const ARCHIVE_AFTER_DAYS = 90;

export async function handler() {
  try {
    // Count receipts eligible for archival
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM interaction_receipts
       WHERE created_at < now() - $1::int * INTERVAL '1 day'`,
      [ARCHIVE_AFTER_DAYS],
    );

    const totalEligible = parseInt(countResult[0]?.count ?? '0', 10);

    if (totalEligible === 0) {
      log.info('No receipts eligible for archival');
      return { statusCode: 200, body: JSON.stringify({ archived: 0 }) };
    }

    // Export to daily_summaries before deletion (by agent)
    const summaryCount = await execute(
      `INSERT INTO daily_summaries (
        summary_date, entity_type, entity_id,
        total_interactions, anomaly_count, median_duration_ms,
        failure_count, distinct_counterparts
      )
      SELECT
        created_at::date AS summary_date,
        'agent' AS entity_type,
        emitter_agent_id AS entity_id,
        COUNT(*) AS total_interactions,
        COUNT(*) FILTER (WHERE anomaly_flagged = true) AS anomaly_count,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS median_duration_ms,
        COUNT(*) FILTER (WHERE status != 'success') AS failure_count,
        COUNT(DISTINCT target_system_id) AS distinct_counterparts
      FROM interaction_receipts
      WHERE created_at < now() - $1::int * INTERVAL '1 day'
      GROUP BY created_at::date, emitter_agent_id
      ON CONFLICT (summary_date, entity_type, entity_id) DO UPDATE SET
        total_interactions = EXCLUDED.total_interactions,
        anomaly_count = EXCLUDED.anomaly_count,
        median_duration_ms = EXCLUDED.median_duration_ms,
        failure_count = EXCLUDED.failure_count,
        distinct_counterparts = EXCLUDED.distinct_counterparts`,
      [ARCHIVE_AFTER_DAYS],
    );

    // Also summarize by target
    await execute(
      `INSERT INTO daily_summaries (
        summary_date, entity_type, entity_id,
        total_interactions, anomaly_count, median_duration_ms,
        failure_count, distinct_counterparts
      )
      SELECT
        created_at::date AS summary_date,
        'system' AS entity_type,
        target_system_id AS entity_id,
        COUNT(*) AS total_interactions,
        COUNT(*) FILTER (WHERE anomaly_flagged = true) AS anomaly_count,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS median_duration_ms,
        COUNT(*) FILTER (WHERE status != 'success') AS failure_count,
        COUNT(DISTINCT emitter_agent_id) AS distinct_counterparts
      FROM interaction_receipts
      WHERE created_at < now() - $1::int * INTERVAL '1 day'
      GROUP BY created_at::date, target_system_id
      ON CONFLICT (summary_date, entity_type, entity_id) DO UPDATE SET
        total_interactions = EXCLUDED.total_interactions,
        anomaly_count = EXCLUDED.anomaly_count,
        median_duration_ms = EXCLUDED.median_duration_ms,
        failure_count = EXCLUDED.failure_count,
        distinct_counterparts = EXCLUDED.distinct_counterparts`,
      [ARCHIVE_AFTER_DAYS],
    );

    // Delete archived receipts
    const deleted = await execute(
      `DELETE FROM interaction_receipts
       WHERE created_at < now() - $1::int * INTERVAL '1 day'`,
      [ARCHIVE_AFTER_DAYS],
    );

    // Skill catalog cleanup
    // 1. Remove crawl_errors older than 30 days
    const crawlErrorsDeleted = await execute(
      `DELETE FROM crawl_errors WHERE created_at < now() - INTERVAL '30 days'`,
    ).catch(() => 0);

    // 2. Null out old version content (keep metadata, free storage) after 180 days
    const versionContentNulled = await execute(
      `UPDATE skill_version_history SET skill_content = NULL
       WHERE skill_content IS NOT NULL AND detected_at < now() - INTERVAL '180 days'`,
    ).catch(() => 0);

    // 3. Archive removed skills after 90 days
    const skillsArchived = await execute(
      `UPDATE skill_catalog SET status = 'archived', updated_at = now()
       WHERE status = 'removed' AND updated_at < now() - INTERVAL '90 days'`,
    ).catch(() => 0);

    log.info({
      eligible: totalEligible,
      summarized: summaryCount,
      deleted,
      crawlErrorsDeleted,
      versionContentNulled,
      skillsArchived,
    }, 'Data archival completed');

    return {
      statusCode: 200,
      body: JSON.stringify({
        archived: deleted, summarized: summaryCount,
        crawl_errors_deleted: crawlErrorsDeleted,
        version_content_nulled: versionContentNulled,
        skills_archived: skillsArchived,
      }),
    };
  } catch (err) {
    log.error({ err }, 'Data archival failed');
    return { statusCode: 500, body: 'Internal error' };
  }
}
