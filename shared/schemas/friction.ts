import { z } from 'zod';

export const FrictionScope = z.enum(['session', 'day', 'week']);

export const FrictionSummarySchema = z.object({
  total_interactions: z.number(),
  total_wait_time_ms: z.number(),
  friction_percentage: z.number(),
  total_failures: z.number(),
  failure_rate: z.number(),
});

export const TargetFrictionSchema = z.object({
  target_system_id: z.string(),
  target_system_type: z.string(),
  interaction_count: z.number(),
  total_duration_ms: z.number(),
  proportion_of_total: z.number(),
  failure_count: z.number(),
  median_duration_ms: z.number(),
});

export const FrictionReportSchema = z.object({
  agent_id: z.string(),
  scope: FrictionScope,
  period_start: z.string(),
  period_end: z.string(),
  summary: FrictionSummarySchema,
  top_targets: z.array(TargetFrictionSchema).max(10),
});

/**
 * Sprint 4 additions (not built in v0):
 */
export const ComponentFrictionSchema = TargetFrictionSchema.extend({
  vs_baseline: z.number(),
  volatility: z.number(),
  p95_duration_ms: z.number(),
});

export const ChainAnalysisSchema = z.object({
  chain_count: z.number(),
  avg_chain_length: z.number(),
  total_chain_overhead_ms: z.number(),
  top_patterns: z.array(z.object({
    pattern: z.array(z.string()),
    frequency: z.number(),
    avg_overhead_ms: z.number(),
  })).optional(),
});

export const DirectionalPairSchema = z.object({
  source_target: z.string(),
  destination_target: z.string(),
  avg_duration_when_preceded: z.number(),
  avg_duration_standalone: z.number(),
  amplification_factor: z.number(),
  sample_count: z.number(),
});

export const RetryOverheadSchema = z.object({
  total_retries: z.number(),
  total_wasted_ms: z.number(),
  top_retry_targets: z.array(z.object({
    target_system_id: z.string(),
    retry_count: z.number(),
    avg_duration_ms: z.number(),
    wasted_ms: z.number(),
  })).max(5),
});

export const PopulationDriftSchema = z.object({
  targets: z.array(z.object({
    target_system_id: z.string(),
    current_median_ms: z.number(),
    baseline_median_ms: z.number(),
    drift_percentage: z.number(),
    direction: z.enum(['improving', 'stable', 'degrading']),
  })),
});

// ── Attribution labels ──
// Server-computed labels that describe where cost landed on a call. The
// MCP maps these labels to plain-English sentences via a deterministic
// template library. The rhetorical invariant: subject of attribution
// sentences is "your interaction profile" or "your composition" — never
// "you". The profile is an entity with behaviors; the user isn't at
// fault for its output.

export const AttributionCostSide = z.enum([
  'profile_dominant',    // most cost on the agent's profile side
  'target_dominant',     // most cost on the target's side
  'balanced',            // roughly 50/50
  'transmission_gap',    // cost is in the handoff between sides
  'insufficient_data',   // not enough receipts to label confidently
]);

export const AttributionMagnitude = z.enum([
  'low', 'moderate', 'high', 'severe',
]);

export const AttributionCostPhase = z.enum([
  'preparation',
  'processing',
  'queueing',
  'handoff',
  'unknown',
]);

export const AttributionLabelSchema = z.object({
  target_system_id: z.string(),
  cost_side: AttributionCostSide,
  cost_phase: AttributionCostPhase.optional(),
  magnitude_category: AttributionMagnitude,
  /** Server-supplied recommendation text to render verbatim. Never MCP-invented. */
  recommended_action: z.string().max(240).nullable().optional(),
  /** Raw proportions for drilldown display. */
  profile_side_proportion: z.number().min(0).max(1).nullable().optional(),
  target_side_proportion: z.number().min(0).max(1).nullable().optional(),
});
