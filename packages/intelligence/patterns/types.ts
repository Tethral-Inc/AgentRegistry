/**
 * Shared types for the pattern-detection job.
 *
 * Detectors are pure functions: they take the per-agent input bundle
 * the cron handler pre-fetched and return either null (no pattern
 * detected) or a `PatternDetection` the handler upserts into
 * `agent_patterns`. Keeping them pure makes them trivial to unit-test
 * without a DB, and keeps detection latency bounded by the single
 * shared query pass the handler does per agent.
 */

export type PatternType =
  | 'composition_staleness'
  | 'retry_burst'
  | 'lens_call_spike'
  | 'skill_version_drift';

export interface TargetUsage {
  target_system_id: string;
  call_count: number;
  retry_count: number;
}

export interface LensCallSample {
  // Lens calls are surfaced via `log_interaction` receipts whose
  // `target_system_id` starts with `mcp:acr:` — the MCP-self class.
  // The detector doesn't care about the exact shape of the target
  // string, only the per-period counts the handler already rolled up.
  this_period: number;
  prior_period: number;
}

export interface DeclaredSkill {
  skill_hash: string;
  skill_name: string | null;
  current_hash_in_network: string | null; // latest observed hash from skill_catalog, or null if unknown
}

export interface DetectionInput {
  agent_id: string;
  // Composition freshness
  composition_updated_at: Date | null;
  declared_targets: Set<string>; // mcp_components ∪ api_components (normalized)
  // Recent observed traffic (last 7 days)
  recent_targets: TargetUsage[];
  // Lens-call tracking (last 7 days vs the 7 days before)
  lens_calls: LensCallSample;
  // Skill drift
  declared_skills: DeclaredSkill[];
  // Context for confidence weighting
  total_receipts_last_7d: number;
}

export interface PatternDetection {
  pattern_type: PatternType;
  confidence: number; // 0.0 – 1.0
  title: string;      // one-line, operator-facing
  message: string;    // one or two sentences, operator-facing
  metadata: Record<string, unknown>; // pattern-specific supporting data
}

/**
 * Minimum confidence before a detection is surfaced on MCP tools.
 * Detectors are free to emit below this — the UI layer filters. This
 * mirrors the friction-report threshold pattern: compute raw, filter
 * at render.
 */
export const SURFACE_CONFIDENCE_THRESHOLD = 0.6;
