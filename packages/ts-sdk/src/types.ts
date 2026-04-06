/**
 * ACR SDK Type Definitions
 *
 * Standalone interfaces mirroring the ACR API schema.
 * No external dependencies — these are plain TypeScript types.
 */

export type ProviderClass =
  | 'anthropic' | 'openai' | 'google' | 'openclaw' | 'langchain'
  | 'crewai' | 'autogen' | 'custom' | 'unknown';

export type TargetSystemType =
  | 'mcp_server' | 'api' | 'agent' | 'skill' | 'platform' | 'unknown';

export type InteractionCategory =
  | 'tool_call' | 'delegation' | 'data_exchange' | 'skill_install'
  | 'commerce' | 'research' | 'code' | 'communication';

export type InteractionStatus =
  | 'success' | 'failure' | 'timeout' | 'partial';

export type AnomalyCategory =
  | 'unexpected_behavior' | 'data_exfiltration' | 'prompt_injection'
  | 'malformed_output' | 'excessive_latency' | 'unauthorized_access' | 'other';

export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

// --- Registration ---

export interface RegistrationRequest {
  public_key: string;
  provider_class: ProviderClass;
  composition?: {
    mcps?: string[];
    tools?: string[];
    skills?: string[];
    skill_hashes?: string[];
  };
  operational_domain?: string;
  system_prompt_hash?: string;
}

export interface RegistrationResponse {
  agent_id: string;
  credential: string;
  composition_hash: string;
  environment_briefing: {
    connected_systems: Array<{
      name: string;
      type: string;
      health_status: string;
      anomaly_count: number;
      agent_population: number;
    }>;
    active_threats: Array<{
      threat_level: string;
      component_hash: string;
      description: string;
      first_reported: string;
    }>;
  };
}

// --- Receipts ---

export interface InteractionReceipt {
  receipt_id?: string;
  emitter: {
    agent_id: string;
    composition_hash?: string;
    provider_class: ProviderClass;
  };
  target: {
    system_id: string;
    system_type: TargetSystemType;
  };
  interaction: {
    category: InteractionCategory;
    duration_ms?: number;
    status: InteractionStatus;
    request_timestamp_ms: number;
    response_timestamp_ms?: number;
  };
  anomaly: {
    flagged: boolean;
    category?: AnomalyCategory;
    detail?: string;
  };
}

// --- Skill Check ---

export interface SkillCheckResponse {
  found: boolean;
  skill_hash: string;
  skill_name?: string;
  skill_source?: string;
  agent_count?: number;
  interaction_count?: number;
  anomaly_rate?: number;
  threat_level?: ThreatLevel;
  first_seen?: string;
  last_seen?: string;
}

// --- Friction ---

export interface FrictionSummary {
  total_interactions: number;
  total_wait_time_ms: number;
  friction_percentage: number;
  total_failures: number;
  failure_rate: number;
}

export interface TargetFriction {
  target_system_id: string;
  target_system_type: string;
  interaction_count: number;
  total_duration_ms: number;
  proportion_of_total: number;
  failure_count: number;
  median_duration_ms: number;
  vs_baseline?: number;
  volatility?: number;
  p95_duration_ms?: number;
}

export interface FrictionReport {
  agent_id: string;
  scope: 'session' | 'day' | 'week';
  period_start: string;
  period_end: string;
  summary: FrictionSummary;
  top_targets: TargetFriction[];
  population_comparison?: {
    total_agents_in_period: number;
    baselines_available: number;
  };
  tier: string;
}
