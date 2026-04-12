import type { Env } from '../types.js';
import { getCached, setCache } from '../lib/kv-cache.js';
import { dbQuery } from '../lib/db.js';

interface SignalRow {
  skill_hash: string;
  skill_name: string | null;
  anomaly_signal_count: number;
  anomaly_signal_rate: number;
  agent_count: number;
  first_seen_at: string;
}

interface SkillSignalEntry {
  skill_hash: string;
  skill_name?: string;
  anomaly_signal_count: number;
  anomaly_signal_rate: number;
  agent_count: number;
  first_seen: string;
}

const SIGNAL_CACHE_KEY = 'signals:elevated';

export async function handleActiveThreats(
  env: Env,
): Promise<SkillSignalEntry[]> {
  // Short TTL for signal data (1 minute)
  const cached = await getCached<SkillSignalEntry[]>(env.THREAT_STATE, SIGNAL_CACHE_KEY);
  if (cached && !cached.stale) {
    return cached.data;
  }

  try {
    const rows = await dbQuery<SignalRow>(
      env.COCKROACH_CONNECTION_STRING,
      `SELECT skill_hash, skill_name, anomaly_signal_count,
       anomaly_signal_rate, agent_count,
       first_seen_at::text AS first_seen_at
       FROM skill_hashes
       WHERE anomaly_signal_count > 0
       ORDER BY anomaly_signal_count DESC
       LIMIT 50`,
      [],
    );

    const entries: SkillSignalEntry[] = rows.map((r) => ({
      skill_hash: r.skill_hash,
      skill_name: r.skill_name ?? undefined,
      anomaly_signal_count: r.anomaly_signal_count,
      anomaly_signal_rate: r.anomaly_signal_rate,
      agent_count: r.agent_count,
      first_seen: r.first_seen_at,
    }));

    await setCache(env.THREAT_STATE, SIGNAL_CACHE_KEY, entries);
    return entries;
  } catch {
    if (cached) {
      return cached.data;
    }
    throw new Error('Database unavailable and no cached data');
  }
}
