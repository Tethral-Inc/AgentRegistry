/**
 * Public leaderboard — anonymous aggregate network data.
 * No agent IDs, no individual profiles. Safe for public consumption.
 */
import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';

const log = createLogger({ name: 'leaderboard' });
const app = new Hono();

app.get('/leaderboard', async (c) => {
  // Top systems by adoption (agent count), with reliability stats
  const systems = await query<{
    system_id: string;
    system_type: string;
    total_interactions: number;
    agent_count: number;
    failure_rate: number;
    anomaly_rate: number;
    median_duration_ms: number | null;
  }>(
    `SELECT system_id AS "system_id",
            system_type AS "system_type",
            total_interactions::int AS "total_interactions",
            distinct_agent_count::int AS "agent_count",
            failure_rate AS "failure_rate",
            anomaly_rate AS "anomaly_rate",
            median_duration_ms AS "median_duration_ms"
     FROM system_health
     ORDER BY distinct_agent_count DESC, total_interactions DESC
     LIMIT 50`,
  ).catch((err) => { log.warn({ err }, 'Leaderboard systems query failed'); return []; });

  // Top skills by adoption, with anomaly signal data
  const skills = await query<{
    skill_hash: string;
    skill_name: string | null;
    skill_source: string | null;
    agent_count: number;
    interaction_count: number;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
  }>(
    `SELECT skill_hash AS "skill_hash",
            skill_name AS "skill_name",
            skill_source AS "skill_source",
            agent_count::int AS "agent_count",
            interaction_count::int AS "interaction_count",
            anomaly_signal_count::int AS "anomaly_signal_count",
            anomaly_signal_rate AS "anomaly_signal_rate"
     FROM skill_hashes
     WHERE agent_count > 0
     ORDER BY agent_count DESC, interaction_count DESC
     LIMIT 50`,
  ).catch((err) => { log.warn({ err }, 'Leaderboard skills query failed'); return []; });

  // Network totals (from observatory-summary pattern)
  const totals = await query<{
    total_agents: number;
    total_interactions: number;
    total_systems: number;
    total_skills: number;
  }>(
    `SELECT
       (SELECT COUNT(DISTINCT emitter_agent_id)::int FROM interaction_receipts WHERE created_at >= now() - INTERVAL '7 days') AS "total_agents",
       (SELECT COUNT(*)::int FROM interaction_receipts WHERE created_at >= now() - INTERVAL '7 days') AS "total_interactions",
       (SELECT COUNT(*)::int FROM system_health) AS "total_systems",
       (SELECT COUNT(*)::int FROM skill_hashes WHERE agent_count > 0) AS "total_skills"`,
  ).catch((err) => {
    log.warn({ err }, 'Leaderboard totals query failed');
    return [{ total_agents: 0, total_interactions: 0, total_systems: 0, total_skills: 0 }];
  });

  c.header('Cache-Control', 'public, max-age=300');

  return c.json({
    generated_at: new Date().toISOString(),
    period: '7d',
    totals: totals[0] ?? { total_agents: 0, total_interactions: 0, total_systems: 0, total_skills: 0 },
    systems: systems.map(s => ({
      system_id: s.system_id,
      system_type: s.system_type,
      agent_count: s.agent_count,
      total_interactions: s.total_interactions,
      failure_rate: s.failure_rate,
      anomaly_rate: s.anomaly_rate,
      median_duration_ms: s.median_duration_ms,
    })),
    skills: skills.map(s => ({
      skill_name: s.skill_name,
      skill_source: s.skill_source,
      agent_count: s.agent_count,
      interaction_count: s.interaction_count,
      anomaly_signal_count: s.anomaly_signal_count,
      anomaly_signal_rate: s.anomaly_signal_rate,
    })),
  });
});

export { app as leaderboardRoute };
