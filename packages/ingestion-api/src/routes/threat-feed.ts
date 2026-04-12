import { Hono } from 'hono';
import { query, makeError } from '@acr/shared';

const app = new Hono();

/**
 * Anomaly signal feed polling endpoint.
 * Returns skills with anomaly signals in chronological order.
 * Clients poll this on an interval (e.g., every 60 seconds).
 *
 * Query params:
 *   since - ISO timestamp, only return events after this time
 *   limit - max results (default 50, max 200)
 */
app.get('/threats/feed', async (c) => {
  const since = c.req.query('since') ?? new Date(Date.now() - 86400000).toISOString();
  const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(1, limitParam), 200);

  const events = await query<{
    skill_hash: string;
    skill_name: string | null;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
    agent_count: number;
    first_seen_at: string;
    last_updated: string;
  }>(
    `SELECT skill_hash AS "skill_hash",
            skill_name AS "skill_name",
            anomaly_signal_count AS "anomaly_signal_count",
            anomaly_signal_rate AS "anomaly_signal_rate",
            agent_count AS "agent_count",
            first_seen_at::text AS "first_seen_at",
            last_updated::text AS "last_updated"
     FROM skill_hashes
     WHERE anomaly_signal_count > 0
       AND last_updated > $1
     ORDER BY last_updated DESC
     LIMIT $2`,
    [since, limit],
  );

  return c.json({
    events: events.map((e) => ({
      skill_hash: e.skill_hash,
      skill_name: e.skill_name,
      anomaly_signal_count: e.anomaly_signal_count,
      anomaly_signal_rate: e.anomaly_signal_rate,
      agent_count: e.agent_count,
      first_seen: e.first_seen_at,
      updated_at: e.last_updated,
    })),
    count: events.length,
    polled_at: new Date().toISOString(),
  });
});

export { app as threatFeedRoute };
