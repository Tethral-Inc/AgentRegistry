import { z } from 'zod';
import { ProviderClass } from './receipt.js';

export const AgentStatus = z.enum(['active', 'expired']);

export const AgentSchema = z.object({
  agent_id: z.string(),
  public_key: z.string(),
  provider_class: ProviderClass,
  current_composition_hash: z.string().optional(),
  operational_domain: z.string().optional(),
  registration_method: z.string(),
  status: AgentStatus,
  registered: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  last_active_at: z.string(),
});

export const RegistrationRequestSchema = z.object({
  public_key: z.string().min(32, 'public_key must be at least 32 characters'),
  provider_class: ProviderClass,
  composition: z.object({
    mcps: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    skill_hashes: z.array(z.string()).optional(),
  }).optional(),
  operational_domain: z.string().max(200).optional(),
  system_prompt_hash: z.string().optional(),
});

export const SystemStatusSchema = z.object({
  name: z.string(),
  type: z.string(),
  health_status: z.string(),
  anomaly_count: z.number(),
  agent_population: z.number(),
});

export const ThreatNoticeSchema = z.object({
  threat_level: z.string(),
  component_hash: z.string(),
  description: z.string(),
  first_reported: z.string(),
});

export const EnvironmentBriefingSchema = z.object({
  connected_systems: z.array(SystemStatusSchema),
  active_threats: z.array(ThreatNoticeSchema),
});

export const RegistrationResponseSchema = z.object({
  agent_id: z.string(),
  credential: z.string(),
  composition_hash: z.string(),
  environment_briefing: EnvironmentBriefingSchema,
});

export const CompositionUpdateSchema = z.object({
  agent_id: z.string(),
  composition: z.object({
    mcps: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    skill_hashes: z.array(z.string()).optional(),
  }),
});
