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
    queue_wait_ms?: number;
    retry_count?: number;
    error_code?: string;
    response_size_bytes?: number;
  };
  anomaly: {
    flagged: boolean;
    category?: AnomalyCategory;
    detail?: string;
  };
  chain_id?: string;
  chain_position?: number;
  preceded_by?: string;
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
  // Catalog-enriched fields
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  tags?: string[];
  is_current_version?: boolean;
  current_hash?: string;
  versions_behind?: number;
  skill_status?: string;
}

// --- Skill Catalog ---

export interface SkillCatalogEntry {
  skill_id: string;
  skill_name: string;
  skill_source: string;
  source_url: string;
  current_hash: string | null;
  skill_content?: string | null;
  description: string | null;
  version: string | null;
  author: string | null;
  tags: string[];
  requires: string[];
  category: string | null;
  content_snippet: string | null;
  status: string;
  threat_level?: ThreatLevel;
  agent_count?: number;
  last_crawled_at: string | null;
  content_changed_at: string | null;
  quality_score?: number;
  threat_patterns?: string[];
  scan_score?: number;
  versions?: SkillVersionEntry[];
}

export interface SkillVersionEntry {
  skill_hash: string;
  version: string | null;
  previous_version: string | null;
  change_type: string;
  detected_at: string;
  threat_level?: ThreatLevel;
  agent_count?: number;
}

export interface SkillVersionHistory {
  skill_id: string;
  skill_name: string;
  skill_source: string;
  current_version: string | null;
  versions: SkillVersionEntry[];
}

export interface SkillSearchResult {
  skills: SkillCatalogEntry[];
  total: number;
  limit: number;
  offset: number;
}

// --- Skill Notifications ---

export interface SkillNotification {
  id: string;
  agent_id: string;
  skill_hash: string;
  notification_type: 'threat_blocked' | 'threat_warning' | 'version_update';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  message: string;
  read: boolean;
  acknowledged: boolean;
  created_at: string;
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

export interface ChainAnalysis {
  chain_count: number;
  avg_chain_length: number;
  total_chain_overhead_ms: number;
  top_patterns?: Array<{
    pattern: string[];
    frequency: number;
    avg_overhead_ms: number;
  }>;
}

export interface DirectionalPair {
  source_target: string;
  destination_target: string;
  avg_duration_when_preceded: number;
  avg_duration_standalone: number;
  amplification_factor: number;
  sample_count: number;
}

export interface RetryOverhead {
  total_retries: number;
  total_wasted_ms: number;
  top_retry_targets: Array<{
    target_system_id: string;
    retry_count: number;
    avg_duration_ms: number;
    wasted_ms: number;
  }>;
}

export interface PopulationDrift {
  targets: Array<{
    target_system_id: string;
    current_median_ms: number;
    baseline_median_ms: number;
    drift_percentage: number;
    direction: 'improving' | 'stable' | 'degrading';
  }>;
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
  chain_analysis?: ChainAnalysis;
  directional_pairs?: DirectionalPair[];
  retry_overhead?: RetryOverhead;
  population_drift?: PopulationDrift;
}
