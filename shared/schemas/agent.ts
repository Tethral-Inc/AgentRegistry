import { z } from 'zod';
import { ProviderClass } from './receipt.js';

export const AgentStatus = z.enum(['active', 'expired']);

export const AgentSchema = z.object({
  agent_id: z.string(),
  name: z.string().nullable().optional(),
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

export const EnvironmentContextSchema = z.object({
  device_class: z.enum(['desktop', 'server', 'sbc', 'mobile', 'unknown']).optional(),
  platform: z.string().optional(),
  arch: z.string().optional(),
  client_type: z.string().optional(),
  transport_type: z.enum(['stdio', 'streamable-http']).optional(),
});

// ── Nested composition schema ──
// A component is something attached to an agent: a skill, an MCP server, an
// API, or a tool. Composable components (skills, MCPs) can carry
// sub_components describing what's inside them — a skill's sub-scripts, an
// MCP's exposed tools. This is how ACR reads the difference between
// "internal friction" (agent engaging its own parts) and "external friction"
// (agent reaching outside).
//
// Sub-components are recursive but the schema caps the depth by only
// declaring one level of nesting (sub_components of sub_components is not
// supported by default). If an attachment's structure is deeper than that,
// an explicit vendor-side registration (Phase 2) is the right path.

const SubComponentSchema = z.object({
  id: z.string().max(128),
  name: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
  // Sub-component type is a free-text hint ("sub_script", "sub_tool",
  // "sub_skill", "sub_mcp", ...) — kept as an open string so the taxonomy
  // can evolve without a schema change.
  type: z.string().max(32).optional(),
});

// A single component schema used for all four top-level arrays
// (skill_components, mcp_components, api_components, tool_components).
// The array name is the discriminator — no need for a type field on the
// individual object. This keeps client payloads simple.
export const ComponentSchema = z.object({
  id: z.string().max(128),
  name: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
  sub_components: z.array(SubComponentSchema).max(64).optional(),
});

// Aliases for documentation and type clarity — all four share the same
// shape. Kept as separate exports so future evolution can differentiate
// them without breaking the main CompositionSchema.
export const SkillComponentSchema = ComponentSchema;
export const McpComponentSchema = ComponentSchema;
export const ApiComponentSchema = ComponentSchema;
export const ToolComponentSchema = ComponentSchema;

// Nested composition: rich structured composition alongside the legacy flat
// fields. Both are accepted. Clients using only the flat fields continue to
// work unchanged.
export const CompositionSchema = z.object({
  // Legacy flat fields (backwards compat)
  mcps: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  skill_hashes: z.array(z.string()).optional(),
  // Richer nested fields
  skill_components: z.array(SkillComponentSchema).max(64).optional(),
  mcp_components: z.array(McpComponentSchema).max(64).optional(),
  api_components: z.array(ApiComponentSchema).max(64).optional(),
  tool_components: z.array(ToolComponentSchema).max(64).optional(),
});

export const RegistrationRequestSchema = z.object({
  public_key: z.string().min(32, 'public_key must be at least 32 characters'),
  provider_class: ProviderClass,
  name: z.string().max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'name must be lowercase alphanumeric with hyphens').optional(),
  composition: CompositionSchema.optional(),
  // When the MCP is reporting observed composition alongside the agent's
  // self-report, it can set this flag so the server can tag the source
  // correctly in agent_composition_sources.
  composition_source: z.enum(['mcp_observed', 'agent_reported']).optional(),
  operational_domain: z.string().max(200).optional(),
  system_prompt_hash: z.string().optional(),
  environment: EnvironmentContextSchema.optional(),
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
  name: z.string(),
  credential: z.string(),
  composition_hash: z.string(),
  environment_briefing: EnvironmentBriefingSchema,
});

export const CompositionUpdateSchema = z.object({
  agent_id: z.string(),
  composition: CompositionSchema,
  // Same source-tagging semantics as RegistrationRequestSchema
  composition_source: z.enum(['mcp_observed', 'agent_reported']).optional(),
});
