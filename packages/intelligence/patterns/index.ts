/**
 * pattern-detection cron handler.
 *
 * Runs every hour (see `vercel.json` + `cron.ts`). For each agent
 * active in the last 7 days, builds a DetectionInput from a small
 * bounded set of queries and runs the four detectors. Upserts matches
 * into `agent_patterns`, one row per (agent_id, pattern_type). Rows
 * that no longer match (detector returned null) are cleared, so the
 * table reflects the current state — MCP reads see the live truth
 * rather than last week's detections.
 *
 * The handler's guardrails:
 *   - `ACTIVE_WINDOW_DAYS` gates agents by recent activity so we don't
 *     pay for agents that haven't interacted in weeks.
 *   - `MAX_AGENTS_PER_RUN` bounds runtime on the cron (Vercel edge
 *     timeouts). If the agent population exceeds this, the cron
 *     processes a rolling window ordered by last_active_at DESC, so
 *     the most-recently-active agents are always covered.
 *   - Each detector runs inside a try/catch so one bad detection
 *     can't take out the whole agent's pass.
 *
 * Data contract: the handler always re-evaluates; detectors are
 * stateless. An upsert replaces the previous row for a given
 * (agent_id, pattern_type), preserving only `dismissed_at` /
 * `dismiss_reason` when the operator has dismissed the prior pattern
 * (see the upsert SQL). If the detector stops firing, we leave the
 * dismissed row in place so it doesn't resurrect.
 */

import { query, execute, createLogger } from '@acr/shared';
import { detectCompositionStaleness } from './composition-staleness.js';
import { detectRetryBurst } from './retry-burst.js';
import { detectLensCallSpike } from './lens-call-spike.js';
import { detectSkillVersionDrift } from './skill-version-drift.js';
import type {
  DetectionInput,
  PatternDetection,
  PatternType,
  TargetUsage,
  DeclaredSkill,
} from './types.js';

const log = createLogger({ name: 'pattern-detection' });

const ACTIVE_WINDOW_DAYS = 7;
const MAX_AGENTS_PER_RUN = 1000;
const DETECTORS: Array<(input: DetectionInput) => PatternDetection | null> = [
  detectCompositionStaleness,
  detectRetryBurst,
  detectLensCallSpike,
  detectSkillVersionDrift,
];
const ALL_PATTERN_TYPES: PatternType[] = [
  'composition_staleness',
  'retry_burst',
  'lens_call_spike',
  'skill_version_drift',
];

interface ActiveAgentRow {
  agent_id: string;
  composition_updated_at: string | null;
  reported_components: Record<string, unknown> | null;
}

interface TargetRow {
  agent_id: string;
  target_system_id: string;
  call_count: number;
  retry_count: number;
}

interface LensRow {
  agent_id: string;
  this_period: number;
  prior_period: number;
}

interface SkillCatalogLookup {
  skill_hash: string;
  skill_name: string | null;
  current_hash: string | null;
}

export async function handler() {
  try {
    const agents = await query<ActiveAgentRow>(
      `SELECT
         a.agent_id AS "agent_id",
         s.recorded_at::text AS "composition_updated_at",
         s.reported_components AS "reported_components"
       FROM agents a
       LEFT JOIN LATERAL (
         SELECT recorded_at, reported_components
         FROM composition_snapshots
         WHERE agent_id = a.agent_id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) s ON true
       WHERE a.status = 'active'
         AND a.last_active_at >= now() - INTERVAL '${ACTIVE_WINDOW_DAYS} days'
       ORDER BY a.last_active_at DESC
       LIMIT $1`,
      [MAX_AGENTS_PER_RUN],
    );

    if (agents.length === 0) {
      log.info('No active agents — nothing to evaluate');
      return { statusCode: 200, body: JSON.stringify({ scanned: 0, detected: 0 }) };
    }

    const agentIds = agents.map((a) => a.agent_id);

    // Bulk fetch per-target call + retry counts for the last 7 days.
    const targetRows = await query<TargetRow>(
      `SELECT
         emitter_agent_id AS "agent_id",
         target_system_id AS "target_system_id",
         COUNT(*)::INT AS "call_count",
         COALESCE(SUM(CASE WHEN retry_count > 0 THEN retry_count ELSE 0 END), 0)::INT AS "retry_count"
       FROM interaction_receipts
       WHERE emitter_agent_id = ANY($1)
         AND created_at >= now() - INTERVAL '7 days'
       GROUP BY emitter_agent_id, target_system_id`,
      [agentIds],
    );

    // Bulk fetch lens calls this period vs prior period.
    // Lens calls are MCP-self receipts — transport_type='mcp_self' on the receipt,
    // or target_system_id prefixed with 'mcp:acr:'. We accept either shape to be
    // robust against source-tag migrations.
    const lensRows = await query<LensRow>(
      `SELECT
         emitter_agent_id AS "agent_id",
         COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days')::INT AS "this_period",
         COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '14 days'
                           AND created_at <  now() - INTERVAL '7 days')::INT AS "prior_period"
       FROM interaction_receipts
       WHERE emitter_agent_id = ANY($1)
         AND created_at >= now() - INTERVAL '14 days'
         AND (target_system_id LIKE 'mcp:acr:%' OR target_system_type = 'mcp_self')
       GROUP BY emitter_agent_id`,
      [agentIds],
    );

    // Build a skill-catalog lookup for every declared skill hash across
    // the batch. Small join avoids N+1 per-agent lookups.
    const declaredHashes = new Set<string>();
    for (const a of agents) {
      const comp = (a.reported_components ?? {}) as Record<string, unknown>;
      const hashes = (comp.skill_hashes as string[] | undefined) ?? [];
      for (const h of hashes) declaredHashes.add(h);
    }
    const skillLookup = new Map<string, SkillCatalogLookup>();
    if (declaredHashes.size > 0) {
      const catalogRows = await query<{ declared_hash: string; skill_name: string | null; current_hash: string | null }>(
        `WITH declared AS (
           SELECT unnest($1::STRING[]) AS declared_hash
         )
         SELECT
           d.declared_hash AS "declared_hash",
           sc.skill_name AS "skill_name",
           sc.current_hash AS "current_hash"
         FROM declared d
         LEFT JOIN skill_catalog sc ON sc.current_hash = d.declared_hash
                                    OR sc.previous_hash = d.declared_hash`,
        [Array.from(declaredHashes)],
      );
      for (const row of catalogRows) {
        skillLookup.set(row.declared_hash, {
          skill_hash: row.declared_hash,
          skill_name: row.skill_name,
          current_hash: row.current_hash,
        });
      }
    }

    // Index bulk rows by agent_id.
    const targetsByAgent = new Map<string, TargetUsage[]>();
    for (const r of targetRows) {
      const arr = targetsByAgent.get(r.agent_id) ?? [];
      arr.push({
        target_system_id: r.target_system_id,
        call_count: r.call_count,
        retry_count: r.retry_count,
      });
      targetsByAgent.set(r.agent_id, arr);
    }
    const lensByAgent = new Map<string, { this_period: number; prior_period: number }>();
    for (const r of lensRows) {
      lensByAgent.set(r.agent_id, { this_period: r.this_period, prior_period: r.prior_period });
    }

    let detected = 0;
    let cleared = 0;

    for (const a of agents) {
      try {
        const input = buildInput(a, targetsByAgent.get(a.agent_id) ?? [],
          lensByAgent.get(a.agent_id) ?? { this_period: 0, prior_period: 0 },
          skillLookup);

        const firedTypes = new Set<PatternType>();

        for (const detect of DETECTORS) {
          let detection: PatternDetection | null = null;
          try {
            detection = detect(input);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            log.warn({ agentId: a.agent_id, detector: detect.name, err: msg }, 'Detector threw');
            continue;
          }
          if (!detection) continue;

          firedTypes.add(detection.pattern_type);

          // Upsert. If a dismissed row already exists, DO UPDATE keeps
          // dismissed_at/dismiss_reason so the operator's decision
          // sticks — the row is refreshed but stays dismissed.
          await execute(
            `INSERT INTO agent_patterns (
               agent_id, pattern_type, confidence, title, message, metadata,
               detected_at, expires_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, now(), now() + INTERVAL '30 days')
             ON CONFLICT (agent_id, pattern_type) DO UPDATE SET
               confidence = EXCLUDED.confidence,
               title = EXCLUDED.title,
               message = EXCLUDED.message,
               metadata = EXCLUDED.metadata,
               detected_at = EXCLUDED.detected_at,
               expires_at = EXCLUDED.expires_at`,
            [
              a.agent_id,
              detection.pattern_type,
              detection.confidence,
              detection.title,
              detection.message,
              JSON.stringify(detection.metadata),
            ],
          );
          detected += 1;
        }

        // Clear rows for pattern types that didn't fire this pass. Keep
        // dismissed rows intact — only drop non-dismissed ones so a
        // pattern that goes quiet disappears from the UI without
        // resurrecting an operator's prior dismissal.
        const missing = ALL_PATTERN_TYPES.filter((t) => !firedTypes.has(t));
        if (missing.length > 0) {
          const res = await execute(
            `DELETE FROM agent_patterns
             WHERE agent_id = $1
               AND pattern_type = ANY($2)
               AND dismissed_at IS NULL`,
            [a.agent_id, missing],
          );
          cleared += res;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        log.warn({ agentId: a.agent_id, err: msg }, 'Pattern detection failed for agent');
      }
    }

    log.info({ scanned: agents.length, detected, cleared }, 'Pattern detection complete');
    return {
      statusCode: 200,
      body: JSON.stringify({ scanned: agents.length, detected, cleared }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err: msg }, 'Pattern detection failed');
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}

function buildInput(
  agent: ActiveAgentRow,
  targets: TargetUsage[],
  lens: { this_period: number; prior_period: number },
  skillLookup: Map<string, { skill_hash: string; skill_name: string | null; current_hash: string | null }>,
): DetectionInput {
  const comp = (agent.reported_components ?? {}) as Record<string, unknown>;
  const mcps = ((comp.mcp_components as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === 'string');
  const apis = ((comp.api_components as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === 'string');
  // Tools aren't targets per se, but if the composition lists api:*-shaped
  // identifiers under `tools` they're effectively declared targets. Keep
  // the union permissive to reduce false positives on the staleness side.
  const tools = ((comp.tools as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === 'string');
  const declaredTargets = new Set<string>([...mcps, ...apis, ...tools]);

  const declaredHashes = ((comp.skill_hashes as unknown[] | undefined) ?? [])
    .filter((x): x is string => typeof x === 'string');
  const declaredSkills: DeclaredSkill[] = declaredHashes.map((h) => {
    const lookup = skillLookup.get(h);
    return {
      skill_hash: h,
      skill_name: lookup?.skill_name ?? null,
      current_hash_in_network: lookup?.current_hash ?? null,
    };
  });

  const totalReceipts = targets.reduce((sum, t) => sum + t.call_count, 0);

  return {
    agent_id: agent.agent_id,
    composition_updated_at: agent.composition_updated_at
      ? new Date(agent.composition_updated_at)
      : null,
    declared_targets: declaredTargets,
    recent_targets: targets,
    lens_calls: lens,
    declared_skills: declaredSkills,
    total_receipts_last_7d: totalReceipts,
  };
}
