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
