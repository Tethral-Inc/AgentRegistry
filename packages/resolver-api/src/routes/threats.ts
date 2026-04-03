import type { Env } from '../types.js';
import { getCached, setCache } from '../lib/kv-cache.js';
import { dbQuery } from '../lib/db.js';

interface ThreatRow {
  threat_level: string;
  skill_hash: string;
  skill_name: string | null;
  anomaly_signal_count: number;
  first_seen_at: string;
}

interface ThreatEntry {
  threat_level: string;
  skill_hash: string;
  skill_name?: string;
  anomaly_signal_count: number;
  first_seen: string;
}

const THREAT_CACHE_KEY = 'threats:active';

export async function handleActiveThreats(
  env: Env,
): Promise<ThreatEntry[]> {
  // Short TTL for threat data (1 minute)
  const cached = await getCached<ThreatEntry[]>(env.THREAT_STATE, THREAT_CACHE_KEY);
  if (cached && !cached.stale) {
    return cached.data;
  }

  try {
    const rows = await dbQuery<ThreatRow>(
      env.COCKROACH_CONNECTION_STRING,
      `SELECT threat_level, skill_hash, skill_name, anomaly_signal_count,
       first_seen_at::text AS first_seen_at
       FROM skill_hashes
       WHERE threat_level IN ('high', 'critical')
       ORDER BY first_seen_at DESC
       LIMIT 50`,
      [],
    );

    const threats: ThreatEntry[] = rows.map((r) => ({
      threat_level: r.threat_level,
      skill_hash: r.skill_hash,
      skill_name: r.skill_name ?? undefined,
      anomaly_signal_count: r.anomaly_signal_count,
      first_seen: r.first_seen_at,
    }));

    await setCache(env.THREAT_STATE, THREAT_CACHE_KEY, threats);
    return threats;
  } catch {
    if (cached) {
      return cached.data;
    }
    throw new Error('Database unavailable and no cached data');
  }
}
