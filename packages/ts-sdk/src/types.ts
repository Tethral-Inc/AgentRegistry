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



// --- Registration ---

export interface RegistrationRequest {
  /** base64url-encoded raw 32-byte Ed25519 public key (43 chars). */
  public_key: string;
  /** Unix-ms when the client signed the payload. Must be within 5 min of server time. */
  registration_timestamp_ms: number;
  /**
   * base64url-encoded raw 64-byte Ed25519 signature over
   * `register:v1:${public_key}:${registration_timestamp_ms}`. The
   * `signRegistrationRequest` helper produces this for you.
   */
  signature: string;
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

/** Unsigned body — caller passes this to `signRegistrationRequest` along with a private key. */
export type UnsignedRegistrationRequest = Omit<
  RegistrationRequest,
  'registration_timestamp_ms' | 'signature'
>;

/** base64url-encoded Ed25519 keypair (raw 32-byte values). */
export interface AgentKeypair {
  publicKey: string;
  privateKey: string;
}

export interface RegistrationResponse {
  agent_id: string;
  credential: string;
  composition_hash: string;
  environment_briefing: {
    connected_systems: Array<{
      name: string;
      type: string;
      failure_rate: number;
      anomaly_rate: number;
      anomaly_signal_count: number;
      agent_population: number;
    }>;
    skill_signals: Array<{
      skill_hash: string;
      skill_name?: string;
      anomaly_signal_count: number;
      agent_count: number;
      first_seen: string;
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
    tokens_used?: number;
    // Capture-surface expansion (migration 000016). All optional.
    substitution_of?: string;
    decision_tokens?: number;
    result_used?: boolean;
    context_bytes?: number;
    prompt_cache_hit_ratio?: number;
  };
  anomaly: {
    flagged: boolean;
    category?: AnomalyCategory;
    detail?: string;
  };
  chain_id?: string;
  chain_position?: number;
  preceded_by?: string;
  /**
   * Descriptive classification fields for the interaction. All optional,
   * all content-free. Known dimensions are listed below; the taxonomy is
   * evolving, so additional dimensions are accepted too.
   */
  categories?: {
    target_type?: string;           // e.g. "api.llm_provider", "mcp.database"
    activity_class?: string;        // "language", "math", "visuals", "creative", "deterministic", "sound"
    interaction_purpose?: string;   // "read", "write", "search", "generate", "transform", "acknowledge"
    workflow_role?: string;         // "initial", "intermediate", "recovery", "cleanup"
    workflow_phase?: string;        // "plan", "act", "reflect"
    data_shape?: string;            // "tabular", "text", "binary", "structured_json", "stream", "image", "audio"
    criticality?: string;           // "core", "enrichment", "debug"
    [key: string]: string | undefined;
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
  anomaly_signal_count?: number;
  anomaly_signal_rate?: number;
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
  agent_count?: number;
  anomaly_signal_count?: number;
  anomaly_signal_rate?: number;
  last_crawled_at: string | null;
  content_changed_at: string | null;
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
  anomaly_signal_count?: number;
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
  /**
   * Burst-union of active time across the scope — the denominator of
   * friction_percentage. Rendering it makes the ratio interpretable
   * ("3% of 4h" ≠ "3% of 40s").
   */
  active_span_ms: number;
  friction_percentage: number;
  total_failures: number;
  failure_rate: number;
  /** Sum of tokens_used across all receipts in the period, when reported. */
  total_tokens_used?: number;
  /** Tokens spent on failed calls — the "wasted" portion. */
  wasted_tokens?: number;
}

export interface CategoryBreakdownRow {
  category: string;
  interaction_count: number;
  total_duration_ms: number;
  failure_count: number;
}

export interface TransportBreakdownRow {
  transport: string;
  interaction_count: number;
  total_duration_ms: number;
}

export interface SourceBreakdownRow {
  source: string;
  interaction_count: number;
}

export interface ErrorCodeBreakdownRow {
  error_code: string;
  count: number;
  /** Target that saw this error most often (empty if nothing failed). */
  top_target: string;
  top_target_count: number;
}

export interface ClassificationBreakdownRow {
  /** The specific field varies by dimension — one of activity_class /
   *  target_type / interaction_purpose lives on each row. */
  activity_class?: string;
  target_type?: string;
  interaction_purpose?: string;
  interaction_count: number;
  total_duration_ms: number;
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
  status_breakdown?: Record<string, number>;
  percentile_rank?: number;
  wasted_tokens?: number;
  /** Network-wide rates for the same target, from the system_health table. */
  network_failure_rate?: number;
  network_anomaly_rate?: number;
  network_agent_count?: number;
  network_interaction_count?: number;
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
  /** Retries detected at the transport boundary (failure + same-target within detection window). */
  implicit_retries?: number;
  /** Retries explicitly reported via retry_count on log_interaction. */
  explicit_retries?: number;
  /** Window (seconds) used to detect implicit retries. */
  detection_window_seconds?: number;
  /** Pro-tier only — undefined on free-tier responses. */
  top_retry_targets?: Array<{
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
  }>;
}

export interface FrictionReport {
  agent_id: string;
  /** Display name of the agent (when resolvable). */
  name?: string;
  scope: 'session' | 'day' | 'yesterday' | 'week';
  period_start: string;
  period_end: string;
  summary: FrictionSummary;
  by_category: CategoryBreakdownRow[];
  /** Failures grouped by error_code, top 10 by count. */
  by_error_code: ErrorCodeBreakdownRow[];
  top_targets: TargetFriction[];
  by_transport: TransportBreakdownRow[];
  by_source: SourceBreakdownRow[];
  by_activity_class: ClassificationBreakdownRow[];
  by_target_type: ClassificationBreakdownRow[];
  by_interaction_purpose: ClassificationBreakdownRow[];
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
