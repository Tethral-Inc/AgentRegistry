import type { Env } from '../types.js';
import { getCached, setCache } from '../lib/kv-cache.js';
import { dbQuery } from '../lib/db.js';

interface SkillRow {
  skill_hash: string;
  skill_name: string | null;
  skill_source: string | null;
  agent_count: number;
  interaction_count: number;
  anomaly_signal_rate: number;
  threat_level: string;
  first_seen_at: string;
  last_updated: string;
}

interface SkillResponse {
  found: boolean;
  skill_hash: string;
  skill_name?: string;
  skill_source?: string;
  agent_count?: number;
  interaction_count?: number;
  anomaly_rate?: number;
  threat_level?: string;
  first_seen?: string;
  last_seen?: string;
}

export async function handleSkillLookup(
  hash: string,
  env: Env,
): Promise<SkillResponse> {
  const cacheKey = `skill:${hash}`;

  // Check KV cache first
  const cached = await getCached<SkillResponse>(env.SKILL_CACHE, cacheKey);
  if (cached && !cached.stale) {
    return cached.data;
  }

  // Cache miss or stale - query database
  try {
    const rows = await dbQuery<SkillRow>(
      env.COCKROACH_CONNECTION_STRING,
      `SELECT skill_hash, skill_name, skill_source, agent_count,
       interaction_count, anomaly_signal_rate, threat_level,
       first_seen_at::text AS first_seen_at, last_updated::text AS last_updated
       FROM skill_hashes WHERE skill_hash = $1`,
      [hash],
    );

    if (rows.length === 0) {
      const notFound: SkillResponse = { found: false, skill_hash: hash };
      // Cache not-found briefly to avoid repeated lookups
      await setCache(env.SKILL_CACHE, cacheKey, notFound);
      return notFound;
    }

    const row = rows[0]!;
    const response: SkillResponse = {
      found: true,
      skill_hash: row.skill_hash,
      skill_name: row.skill_name ?? undefined,
      skill_source: row.skill_source ?? undefined,
      agent_count: row.agent_count,
      interaction_count: row.interaction_count,
      anomaly_rate: row.anomaly_signal_rate,
      threat_level: row.threat_level,
      first_seen: row.first_seen_at,
      last_seen: row.last_updated,
    };

    await setCache(env.SKILL_CACHE, cacheKey, response);
    return response;
  } catch {
    // On DB failure, return stale cache if available
    if (cached) {
      return cached.data;
    }
    throw new Error('Database unavailable and no cached data');
  }
}
