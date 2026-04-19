import { z } from 'zod';

/**
 * Compensation-signature window. Only 'day' and 'week' are supported
 * because chain_analysis is precomputed at those windows by the
 * background job. A "month" or "yesterday" view would require either
 * an on-the-fly recomputation or a separate precomputation job.
 */
export const CompensationWindow = z.enum(['day', 'week']);
export type CompensationWindowT = z.infer<typeof CompensationWindow>;

export const CompensationPatternSchema = z.object({
  pattern_hash: z.string(),
  chain_pattern: z.array(z.string()),
  frequency: z.number(),
  pattern_stability: z.number(),   // 0..1
  share_of_chains: z.number(),     // 0..1 (alias)
  avg_overhead_ms: z.number(),
  fleet_agent_count: z.number().nullable(),     // how many other agents run this pattern
  fleet_total_frequency: z.number().nullable(), // total occurrences across the fleet
});

export const CompensationReportSchema = z.object({
  agent_id: z.string(),
  name: z.string().nullable(),
  window: CompensationWindow,
  computed_at: z.string().nullable(),
  summary: z.object({
    total_chains: z.number(),
    distinct_patterns: z.number(),
    agent_stability: z.number(), // 0..1
  }),
  patterns: z.array(CompensationPatternSchema),
});
