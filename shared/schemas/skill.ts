import { z } from 'zod';

export const ThreatLevel = z.enum(['none', 'low', 'medium', 'high', 'critical']);

export const SkillHashSchema = z.object({
  skill_hash: z.string(),
  skill_name: z.string().optional(),
  skill_source: z.string().optional(),
  first_seen_at: z.string(),
  agent_count: z.number(),
  interaction_count: z.number(),
  anomaly_signal_count: z.number(),
  anomaly_signal_rate: z.number(),
  threat_level: ThreatLevel,
  last_updated: z.string(),
});

export const SkillCheckResponseSchema = z.object({
  found: z.boolean(),
  skill_hash: z.string(),
  skill_name: z.string().optional(),
  skill_source: z.string().optional(),
  agent_count: z.number().optional(),
  interaction_count: z.number().optional(),
  anomaly_rate: z.number().optional(),
  threat_level: ThreatLevel.optional(),
  first_seen: z.string().optional(),
  last_seen: z.string().optional(),
});
