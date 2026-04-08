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
  // Catalog-enriched fields
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  tags?: string[];
  is_current_version?: boolean;
  current_hash?: string;
  versions_behind?: number;
  skill_status?: string;
  scan_score?: number;
  threat_patterns?: string[];
  blocked?: boolean;
  blocked_reason?: string;
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

    // Enrich with catalog data if available
    if (row.skill_hash) {
      try {
        const catalogRows = await dbQuery<{
          description: string | null;
          version: string | null;
          author: string | null;
          category: string | null;
          tags: string[] | null;
          skill_source: string | null;
          current_hash: string | null;
          status: string | null;
          total_versions: string;
          scan_score: number | null;
          threat_patterns: string[] | null;
        }>(
          env.COCKROACH_CONNECTION_STRING,
          `SELECT sc.description, sc.version, sc.author, sc.category, sc.tags,
                  sc.skill_source, sc.current_hash, sc.status,
                  sc.scan_score, sc.threat_patterns,
                  (SELECT COUNT(*)::text FROM skill_version_history WHERE skill_id = sc.skill_id) as total_versions
           FROM skill_catalog sc
           JOIN skill_hashes sh ON sh.catalog_skill_id = sc.skill_id
           WHERE sh.skill_hash = $1
           LIMIT 1`,
          [row.skill_hash],
        );

        if (catalogRows.length > 0) {
          const cat = catalogRows[0]!;
          response.description = cat.description ?? undefined;
          response.version = cat.version ?? undefined;
          response.author = cat.author ?? undefined;
          response.category = cat.category ?? undefined;
          response.tags = cat.tags ?? undefined;
          response.skill_status = cat.status ?? undefined;
          response.scan_score = cat.scan_score ?? undefined;
          response.threat_patterns = cat.threat_patterns ?? undefined;

          // CRITICAL: Override threat_level from scan results when skill is flagged.
          // The skill_hashes.threat_level is reactive (anomaly-based), but the catalog
          // status is proactive (content-scanned). Flagged = blocked.
          if (cat.status === 'flagged') {
            const scanScore = cat.scan_score ?? 100;
            if (scanScore < 50) response.threat_level = 'critical';
            else if (scanScore < 70) response.threat_level = 'high';
            else response.threat_level = 'medium';
            response.blocked = true;
            response.blocked_reason = 'Content security scan detected threat patterns. This skill is blocked from installation.';
          }

          const isCurrent = row.skill_hash === cat.current_hash;
          response.is_current_version = isCurrent;
          if (!isCurrent && cat.current_hash) {
            response.current_hash = cat.current_hash;
            // Count versions behind
            const totalVersions = parseInt(cat.total_versions, 10);
            response.versions_behind = Math.max(0, totalVersions - 1);
          }
        }
      } catch {
        // Catalog enrichment is non-blocking
      }
    }

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
