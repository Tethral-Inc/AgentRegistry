import { z } from 'zod';

export const SkillHashSchema = z.object({
  skill_hash: z.string(),
  skill_name: z.string().optional(),
  skill_source: z.string().optional(),
  first_seen_at: z.string(),
  agent_count: z.number(),
  interaction_count: z.number(),
  anomaly_signal_count: z.number(),
  anomaly_signal_rate: z.number(),
  last_updated: z.string(),
});

export const SkillCheckResponseSchema = z.object({
  found: z.boolean(),
  skill_hash: z.string(),
  skill_name: z.string().optional(),
  skill_source: z.string().optional(),
  agent_count: z.number().optional(),
  interaction_count: z.number().optional(),
  anomaly_signal_count: z.number().optional(),
  anomaly_signal_rate: z.number().optional(),
  first_seen: z.string().optional(),
  last_seen: z.string().optional(),
  // Catalog-enriched fields (when catalog data is available)
  description: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  is_current_version: z.boolean().optional(),
  current_hash: z.string().optional(),
  versions_behind: z.number().optional(),
  skill_status: z.string().optional(),
});

// =============================================================================
// Skill Catalog schemas
// =============================================================================

export const SkillStatusEnum = z.enum(['active', 'archived', 'removed', 'flagged']);

export const SkillCatalogSchema = z.object({
  skill_id: z.string().uuid(),
  skill_name: z.string(),
  skill_source: z.string(),
  source_url: z.string(),
  current_hash: z.string().nullable(),
  description: z.string().nullable(),
  version: z.string().nullable(),
  author: z.string().nullable(),
  tags: z.array(z.string()),
  requires: z.array(z.string()),
  category: z.string().nullable(),
  content_snippet: z.string().nullable(),
  status: SkillStatusEnum,
  agent_count: z.number().optional(),
  last_crawled_at: z.string().nullable(),
  content_changed_at: z.string().nullable(),
  // External scanner passthrough (ACR didn't produce these)
  threat_patterns: z.array(z.string()).optional(),
  scan_score: z.number().optional(),
});

export const SkillSearchRequestSchema = z.object({
  query: z.string().min(1).max(200),
  source: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: SkillStatusEnum.optional().default('active'),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export const SkillSearchResultSchema = z.object({
  skills: z.array(SkillCatalogSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const SkillVersionEntrySchema = z.object({
  skill_hash: z.string(),
  version: z.string().nullable(),
  previous_version: z.string().nullable(),
  change_type: z.string(),
  detected_at: z.string(),
  anomaly_signal_count: z.number().optional(),
  agent_count: z.number().optional(),
});

export const SkillVersionHistorySchema = z.object({
  skill_id: z.string().uuid(),
  skill_name: z.string(),
  skill_source: z.string(),
  current_version: z.string().nullable(),
  versions: z.array(SkillVersionEntrySchema),
});

export const SkillNotificationSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string(),
  skill_hash: z.string(),
  notification_type: z.enum(['threat_blocked', 'threat_warning', 'version_update']),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string(),
  message: z.string(),
  read: z.boolean(),
  acknowledged: z.boolean(),
  created_at: z.string(),
});
