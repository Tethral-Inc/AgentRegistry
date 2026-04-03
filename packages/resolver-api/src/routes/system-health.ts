import type { Env } from '../types.js';
import { getCached, setCache } from '../lib/kv-cache.js';
import { dbQuery } from '../lib/db.js';

interface HealthRow {
  system_id: string;
  system_type: string;
  total_interactions: number;
  distinct_agent_count: number;
  anomaly_rate: number;
  median_duration_ms: number | null;
  health_status: string;
}

interface SystemHealthResponse {
  found: boolean;
  system_id: string;
  system_type?: string;
  total_interactions?: number;
  distinct_agents?: number;
  anomaly_rate?: number;
  median_duration_ms?: number;
  health_status?: string;
}

export async function handleSystemHealth(
  systemId: string,
  env: Env,
): Promise<{ data: SystemHealthResponse; stale: boolean }> {
  const cacheKey = `health:${systemId}`;

  const cached = await getCached<SystemHealthResponse>(env.SYSTEM_HEALTH, cacheKey);
  if (cached && !cached.stale) {
    return { data: cached.data, stale: false };
  }

  try {
    const rows = await dbQuery<HealthRow>(
      env.COCKROACH_CONNECTION_STRING,
      `SELECT system_id, system_type, total_interactions,
       distinct_agent_count, anomaly_rate, median_duration_ms, health_status
       FROM system_health WHERE system_id = $1`,
      [systemId],
    );

    if (rows.length === 0) {
      const notFound: SystemHealthResponse = { found: false, system_id: systemId };
      return { data: notFound, stale: false };
    }

    const row = rows[0]!;
    const response: SystemHealthResponse = {
      found: true,
      system_id: row.system_id,
      system_type: row.system_type,
      total_interactions: row.total_interactions,
      distinct_agents: row.distinct_agent_count,
      anomaly_rate: row.anomaly_rate,
      median_duration_ms: row.median_duration_ms ?? undefined,
      health_status: row.health_status,
    };

    await setCache(env.SYSTEM_HEALTH, cacheKey, response);
    return { data: response, stale: false };
  } catch {
    if (cached) {
      return { data: cached.data, stale: true };
    }
    throw new Error('Database unavailable and no cached data');
  }
}
