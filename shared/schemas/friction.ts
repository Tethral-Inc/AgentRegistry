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
