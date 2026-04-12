import { Hono } from 'hono';
import { query, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'network-skills' });
const app = new Hono();

const VALID_SORT_FIELDS: Record<string, string> = {
  agent_count: 'agent_count',
  interaction_count: 'interaction_count',
  anomaly_signal_rate: 'anomaly_signal_rate',
  anomaly_signal_count: 'anomaly_signal_count',
};

/**
 * GET /network/skills — Skill adoption list (cursor-based).
 */
app.get('/network/skills', async (c) => {
  const minAnomalySignals = c.req.query('min_anomaly_signals');
  const sortKey = c.req.query('sort') ?? 'agent_count';
  const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(1, limitParam), 200);
  const cursor = c.req.query('cursor'); // last_updated of last item

  const sortExpr = VALID_SORT_FIELDS[sortKey] ?? 'agent_count';

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (minAnomalySignals) {
    params.push(parseInt(minAnomalySignals, 10));
    conditions.push(`anomaly_signal_count >= $${params.length}`);
  }
  if (cursor) {
    params.push(cursor);
    conditions.push(`last_updated < $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit + 1);

  const rows = await query<{
    skill_hash: string;
    skill_name: string | null;
    agent_count: number;
    interaction_count: number;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
    first_seen: string;
    last_updated: string;
  }>(
    `SELECT skill_hash AS "skill_hash",
            skill_name AS "skill_name",
            agent_count AS "agent_count",
            interaction_count AS "interaction_count",
            anomaly_signal_count AS "anomaly_signal_count",
            anomaly_signal_rate AS "anomaly_signal_rate",
            first_seen_at::text AS "first_seen",
            last_updated::text AS "last_updated"
     FROM skill_hashes
     ${whereClause}
     ORDER BY ${sortExpr} DESC, last_updated DESC
     LIMIT $${params.length}`,
    params,
  );

  const hasMore = rows.length > limit;
  const skills = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && skills.length > 0
    ? skills[skills.length - 1]!.last_updated
    : null;

  c.header('Cache-Control', 'public, max-age=300');

  return c.json({
    skills,
    next_cursor: nextCursor,
    limit,
  });
});

/**
 * GET /network/skills/:hash — Single skill detail.
 * Returns aggregate counts and provider breakdown — NO agent_id lists (privacy).
 */
app.get('/network/skills/:hash', async (c) => {
  const hash = c.req.param('hash');

  // Skill metadata
  const skillRows = await query<{
    skill_hash: string;
    skill_name: string | null;
    agent_count: number;
    interaction_count: number;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
    first_seen: string;
    last_updated: string;
  }>(
    `SELECT skill_hash AS "skill_hash",
            skill_name AS "skill_name",
            agent_count AS "agent_count",
            interaction_count AS "interaction_count",
            anomaly_signal_count AS "anomaly_signal_count",
            anomaly_signal_rate AS "anomaly_signal_rate",
            first_seen_at::text AS "first_seen",
            last_updated::text AS "last_updated"
     FROM skill_hashes
     WHERE skill_hash = $1
     LIMIT 1`,
    [hash],
  );

  if (skillRows.length === 0) {
    return c.json(makeError('NOT_FOUND', `Skill "${hash}" not found`), 404);
  }

  const skill = skillRows[0]!;

  // Provider breakdown — aggregate only, no agent IDs
  const providerBreakdown = await query<{
    provider_class: string;
    agent_count: number;
  }>(
    `SELECT a.provider_class AS "provider_class",
            COUNT(DISTINCT cs.agent_id)::int AS "agent_count"
     FROM composition_snapshots cs
     JOIN agents a ON a.agent_id = cs.agent_id
     WHERE $1 = ANY(cs.component_hashes)
     GROUP BY a.provider_class
     ORDER BY "agent_count" DESC`,
    [hash],
  ).catch(() => []);

  // Cross-provider correlation check — parameterized, no string concat in SQL
  const skillTargetId = `skill:${hash}`;
  const providersWithAnomalies = await query<{ provider: string; anomaly_count: number }>(
    `SELECT emitter_provider_class AS "provider",
            COUNT(*)::int AS "anomaly_count"
     FROM interaction_receipts
     WHERE target_system_id = $1
       AND anomaly_flagged = true
       AND created_at >= now() - INTERVAL '7 days'
     GROUP BY emitter_provider_class`,
    [skillTargetId],
  ).catch(() => []);

  c.header('Cache-Control', 'public, max-age=300');

  return c.json({
    ...skill,
    provider_breakdown: providerBreakdown,
    cross_provider_anomalies: providersWithAnomalies,
  });
});

export { app as networkSkillsRoute };
