/**
 * watch-evaluation cron handler.
 *
 * Phase K of the v2.5.0 – v2.9.0 roadmap. Runs hourly (see
 * `vercel.json` + `cron.ts`). Loops through enabled watches, bulk-
 * computes the three supported metrics per (agent_id, target_system_id)
 * pair from the last 7 days of receipts, and for each watch decides:
 *   - match_new     : threshold crossed, no recent notification → write
 *                     a notification and update last_matched_at.
 *   - match_ongoing : crossed, but notified within cooldown → bump
 *                     last_evaluated_at only.
 *   - no_match      : metric not in breach → bump last_evaluated_at.
 *
 * Cooldown keeps a persistent breach from generating a daily stream
 * of duplicates — one notification per crossing per 24h. The
 * operator dismisses the underlying cause (or the notification) and
 * gets re-notified naturally on the next crossing.
 *
 * Scope: (lens, metric) combos supported are
 *   friction.failure_rate, friction.proportion_of_wait,
 *   trend.failure_rate_delta
 * Anything else is skipped silently — forward-compat with future
 * metric additions without a coordinated release.
 */

import { query, execute, createLogger } from '@acr/shared';
import { evaluateWatch, type WatchLike, type WatchCondition } from './evaluate.js';

const log = createLogger({ name: 'watch-evaluation' });

interface WatchRow {
  id: string;
  agent_id: string;
  lens: string;
  target_system_id: string;
  metric: string;
  threshold: number;
  condition: WatchCondition;
  last_matched_at: string | null;
}

interface FrictionRow {
  agent_id: string;
  target_system_id: string;
  failure_rate: number;
  proportion_of_wait: number;
}

interface TrendRow {
  agent_id: string;
  target_system_id: string;
  failure_rate_delta: number;
}

export async function handler() {
  const now = new Date();

  try {
    const watches = await query<WatchRow>(
      `SELECT
         id AS "id",
         agent_id AS "agent_id",
         lens AS "lens",
         target_system_id AS "target_system_id",
         metric AS "metric",
         threshold AS "threshold",
         condition AS "condition",
         last_matched_at::text AS "last_matched_at"
       FROM watches
       WHERE enabled = true
       ORDER BY agent_id`,
    );

    if (watches.length === 0) {
      log.info('No enabled watches — nothing to evaluate');
      return { statusCode: 200, body: JSON.stringify({ evaluated: 0, matched: 0 }) };
    }

    // Collect the (agent, target) pairs we need metrics for.
    const needFrictionPairs = new Set<string>();
    const needTrendPairs = new Set<string>();
    const keyFor = (agentId: string, target: string) => `${agentId}\x00${target}`;
    for (const w of watches) {
      const k = keyFor(w.agent_id, w.target_system_id);
      if (w.lens === 'friction') needFrictionPairs.add(k);
      else if (w.lens === 'trend') needTrendPairs.add(k);
    }

    const agentIdsForFriction = Array.from(new Set(
      Array.from(needFrictionPairs).map((k) => k.split('\x00')[0]),
    ));
    const agentIdsForTrend = Array.from(new Set(
      Array.from(needTrendPairs).map((k) => k.split('\x00')[0]),
    ));

    // Friction metrics: per (agent, target) over the last 7 days.
    // failure_rate = failed / total; proportion_of_wait = target wait / agent total wait.
    const frictionByKey = new Map<string, FrictionRow>();
    if (agentIdsForFriction.length > 0) {
      const rows = await query<FrictionRow>(
        `WITH recent AS (
           SELECT emitter_agent_id, target_system_id,
                  COUNT(*) AS total_calls,
                  SUM(CASE WHEN status = 'failed' OR status = 'error' THEN 1 ELSE 0 END) AS failed_calls,
                  SUM(COALESCE(duration_ms, 0)) AS wait_ms
           FROM interaction_receipts
           WHERE emitter_agent_id = ANY($1)
             AND created_at >= now() - INTERVAL '7 days'
           GROUP BY emitter_agent_id, target_system_id
         ),
         agent_totals AS (
           SELECT emitter_agent_id, SUM(wait_ms) AS total_wait
           FROM recent
           GROUP BY emitter_agent_id
         )
         SELECT
           r.emitter_agent_id AS "agent_id",
           r.target_system_id AS "target_system_id",
           CASE WHEN r.total_calls = 0 THEN 0
                ELSE r.failed_calls::FLOAT / r.total_calls::FLOAT
           END AS "failure_rate",
           CASE WHEN at.total_wait = 0 THEN 0
                ELSE r.wait_ms::FLOAT / at.total_wait::FLOAT
           END AS "proportion_of_wait"
         FROM recent r
         JOIN agent_totals at ON at.emitter_agent_id = r.emitter_agent_id`,
        [agentIdsForFriction],
      );
      for (const r of rows) {
        frictionByKey.set(keyFor(r.agent_id, r.target_system_id), r);
      }
    }

    // Trend metrics: failure_rate_delta = this_week_rate − prior_week_rate.
    const trendByKey = new Map<string, TrendRow>();
    if (agentIdsForTrend.length > 0) {
      const rows = await query<TrendRow>(
        `WITH windowed AS (
           SELECT
             emitter_agent_id,
             target_system_id,
             CASE WHEN created_at >= now() - INTERVAL '7 days' THEN 'this'
                  ELSE 'prior' END AS bucket,
             COUNT(*) AS total_calls,
             SUM(CASE WHEN status = 'failed' OR status = 'error' THEN 1 ELSE 0 END) AS failed_calls
           FROM interaction_receipts
           WHERE emitter_agent_id = ANY($1)
             AND created_at >= now() - INTERVAL '14 days'
           GROUP BY emitter_agent_id, target_system_id, bucket
         ),
         agg AS (
           SELECT
             emitter_agent_id,
             target_system_id,
             MAX(CASE WHEN bucket = 'this' AND total_calls > 0
                      THEN failed_calls::FLOAT / total_calls::FLOAT END) AS this_rate,
             MAX(CASE WHEN bucket = 'prior' AND total_calls > 0
                      THEN failed_calls::FLOAT / total_calls::FLOAT END) AS prior_rate
           FROM windowed
           GROUP BY emitter_agent_id, target_system_id
         )
         SELECT
           emitter_agent_id AS "agent_id",
           target_system_id AS "target_system_id",
           COALESCE(this_rate, 0) - COALESCE(prior_rate, 0) AS "failure_rate_delta"
         FROM agg
         WHERE this_rate IS NOT NULL OR prior_rate IS NOT NULL`,
        [agentIdsForTrend],
      );
      for (const r of rows) {
        trendByKey.set(keyFor(r.agent_id, r.target_system_id), r);
      }
    }

    let evaluated = 0;
    let matched = 0;

    for (const w of watches) {
      try {
        const metricValue = readMetric(w, frictionByKey, trendByKey);
        const watchLike: WatchLike = {
          threshold: w.threshold,
          condition: w.condition,
          last_matched_at: w.last_matched_at ? new Date(w.last_matched_at) : null,
        };
        const outcome = evaluateWatch(metricValue, watchLike, now);

        if (outcome === 'match_new') {
          const { title, message } = buildNotificationText(w, metricValue ?? 0);
          await execute(
            `INSERT INTO skill_notifications (
               agent_id, skill_hash, notification_type, severity,
               title, message, metadata, source
             )
             VALUES ($1, NULL, 'watch_match', 'info', $2, $3, $4::jsonb, 'watch')`,
            [
              w.agent_id,
              title,
              message,
              JSON.stringify({
                watch_id: w.id,
                lens: w.lens,
                target_system_id: w.target_system_id,
                metric: w.metric,
                threshold: w.threshold,
                condition: w.condition,
                metric_value: metricValue,
              }),
            ],
          );
          await execute(
            `UPDATE watches SET last_matched_at = $2, last_evaluated_at = $2 WHERE id = $1`,
            [w.id, now.toISOString()],
          );
          matched += 1;
        } else {
          await execute(
            `UPDATE watches SET last_evaluated_at = $2 WHERE id = $1`,
            [w.id, now.toISOString()],
          );
        }
        evaluated += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        log.warn({ watchId: w.id, agentId: w.agent_id, err: msg }, 'Watch evaluation failed');
      }
    }

    log.info({ evaluated, matched, watches_total: watches.length }, 'Watch evaluation complete');
    return {
      statusCode: 200,
      body: JSON.stringify({ evaluated, matched, watches_total: watches.length }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err: msg }, 'Watch evaluation failed');
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}

function readMetric(
  w: WatchRow,
  frictionByKey: Map<string, FrictionRow>,
  trendByKey: Map<string, TrendRow>,
): number | null {
  const key = `${w.agent_id}\x00${w.target_system_id}`;
  if (w.lens === 'friction') {
    const row = frictionByKey.get(key);
    if (!row) return null;
    if (w.metric === 'failure_rate') return row.failure_rate;
    if (w.metric === 'proportion_of_wait') return row.proportion_of_wait;
    return null;
  }
  if (w.lens === 'trend') {
    const row = trendByKey.get(key);
    if (!row) return null;
    if (w.metric === 'failure_rate_delta') return row.failure_rate_delta;
    return null;
  }
  return null;
}

function buildNotificationText(w: WatchRow, value: number): { title: string; message: string } {
  const formattedValue = w.metric === 'failure_rate_delta'
    ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`
    : `${(value * 100).toFixed(1)}%`;
  const formattedThreshold = w.metric === 'failure_rate_delta'
    ? `${w.threshold >= 0 ? '+' : ''}${(w.threshold * 100).toFixed(1)}pp`
    : `${(w.threshold * 100).toFixed(1)}%`;

  const title = `Watch match: ${w.target_system_id} ${w.metric} ${w.condition} ${formattedThreshold}`;
  const message = `${w.lens}.${w.metric} on ${w.target_system_id} is now ${formattedValue} (threshold: ${w.condition} ${formattedThreshold}). Call list_watches to manage.`;
  return { title, message };
}
