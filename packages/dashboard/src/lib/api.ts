const API_URL = process.env.NEXT_PUBLIC_ACR_API_URL ?? 'https://acr.nfkey.ai';
const RESOLVER_URL = process.env.NEXT_PUBLIC_ACR_RESOLVER_URL ?? API_URL;

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return res.json() as Promise<T>;
}

export async function fetchResolver<T>(path: string): Promise<T> {
  const res = await fetch(`${RESOLVER_URL}${path}`);
  return res.json() as Promise<T>;
}

export interface DashboardStats {
  totalAgents: number;
  activeAgents: number;
  totalReceipts24h: number;
  activeThreats: number;
  topSystems: Array<{ system_id: string; interaction_count: number; failure_rate: number; anomaly_rate: number }>;
}

// Skill Catalog types & helpers

export interface SkillCatalogEntry {
  skill_id: string;
  skill_name: string;
  skill_source: string;
  source_url: string;
  current_hash: string | null;
  description: string | null;
  version: string | null;
  author: string | null;
  tags: string[];
  requires: string[];
  category: string | null;
  content_snippet: string | null;
  status: string;
  agent_count: number | null;
  anomaly_signal_count: number | null;
  anomaly_signal_rate: number | null;
  scan_score: number | null;
  last_crawled_at: string | null;
  content_changed_at: string | null;
  skill_content?: string | null;
  versions?: SkillVersionEntry[];
  related_skills?: Array<{ skill_id: string; skill_name: string; skill_source: string; version: string | null }>;
}

export interface SkillVersionEntry {
  skill_hash: string;
  version: string | null;
  previous_version: string | null;
  change_type: string;
  detected_at: string;
  anomaly_signal_count: number | null;
  agent_count: number | null;
}

export interface SkillSearchResult {
  skills: SkillCatalogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export async function searchSkills(query: string, options?: {
  source?: string; category?: string;
  limit?: number; offset?: number; sort?: string;
}): Promise<SkillSearchResult> {
  const params = new URLSearchParams({ q: query });
  if (options?.source) params.set('source', options.source);
  if (options?.category) params.set('category', options.category);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  return fetchAPI(`/api/v1/skill-catalog/search?${params}`);
}

export async function getSkillDetail(skillId: string): Promise<SkillCatalogEntry> {
  return fetchAPI(`/api/v1/skill-catalog/${skillId}`);
}

export async function browseSkills(options?: {
  source?: string; sort?: string; limit?: number; cursor?: string;
}): Promise<{ skills: SkillCatalogEntry[]; next_cursor: string | null }> {
  const params = new URLSearchParams();
  if (options?.source) params.set('source', options.source);
  if (options?.sort) params.set('sort', options.sort);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.cursor) params.set('cursor', options.cursor);
  return fetchAPI(`/api/v1/skill-catalog?${params}`);
}

export interface OperatorMetrics {
  agentId: string;
  status: string;
  lastActive: string;
  receiptCount: number;
  topFrictionTarget: string;
  frictionPercentage: number;
}

// Network Observatory

export interface NetworkStatusResponse {
  timestamp: string;
  stale: boolean;
  totals: {
    active_agents: number;
    active_systems: number;
    interactions_24h: number;
    anomaly_rate_24h: number;
  };
  systems: Array<{
    system_id: string;
    system_type: string;
    total_interactions: number;
    agent_count: number;
    failure_rate: number;
    anomaly_rate: number;
    median_duration_ms: number | null;
    p95_duration_ms: number | null;
  }>;
  threats: Array<{
    skill_hash: string;
    skill_name: string | null;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
    agent_count: number;
    first_seen: string;
    last_updated: string;
  }>;
  recent_escalations: Array<{
    target: string;
    anomaly_count: number;
    agents_affected: number;
    detected_at: string;
    providers_affected?: string[];
    anomaly_categories?: string[];
  }>;
}

export interface ObservatorySummary {
  active_agents_24h: number;
  interactions_24h: number;
  targets_tracked: number;
  systems_observed: number;
  skills_with_signals: number;
}

export async function getNetworkStatus(): Promise<NetworkStatusResponse> {
  return fetchAPI('/api/v1/network/status');
}

export async function getObservatorySummary(): Promise<ObservatorySummary> {
  return fetchAPI('/api/v1/network/observatory-summary');
}

// Agent Profile

export interface AgentProfileResponse {
  agent_id: string;
  name: string | null;
  provider_class: string | null;
  operational_domain: string | null;
  composition_hash: string | null;
  composition_summary: { skill_count: number; mcp_count: number; tool_count: number };
  registered_at: string;
  last_active_at: string;
  counts: {
    total_receipts: number;
    receipts_last_24h: number;
    distinct_targets: number;
    distinct_categories: number;
    distinct_chains: number;
    days_active: number;
    first_signal_at: string | null;
    last_signal_at: string | null;
  };
  composition_delta: {
    mcp_only: string[];
    agent_only: string[];
    last_observed_at: string | null;
    last_reported_at: string | null;
  } | null;
  tier: string;
}

export async function getAgentProfile(id: string): Promise<AgentProfileResponse> {
  return fetchAPI(`/api/v1/agent/${id}/profile`);
}

// Friction Dashboard

export interface FrictionResponse {
  agent_id: string;
  name: string | null;
  scope: string;
  period_start: string;
  period_end: string;
  summary: {
    total_interactions: number;
    total_wait_time_ms: number;
    friction_percentage: number;
    total_failures: number;
    failure_rate: number;
  };
  by_category: Array<{ category: string; interaction_count: number; total_duration_ms: number; failure_count: number }>;
  top_targets: Array<{
    target_system_id: string;
    target_system_type: string;
    interaction_count: number;
    total_duration_ms: number;
    proportion_of_total: number;
    failure_count: number;
    median_duration_ms: number;
    p95_duration_ms?: number;
    status_breakdown?: Record<string, number>;
    vs_baseline?: number | null;
    volatility?: number;
    recent_anomalies?: Array<{ category: string | null; detail: string | null; timestamp: string }>;
  }>;
  by_transport: Array<{ transport: string; interaction_count: number; total_duration_ms: number }>;
  by_source: Array<{ source: string; interaction_count: number }>;
  chain_analysis?: {
    chain_count: number;
    avg_chain_length: number;
    total_chain_overhead_ms: number;
    top_patterns?: Array<{ chain_pattern: string[]; frequency: number; avg_overhead_ms: number }>;
  };
  directional_pairs?: Array<{
    source_target: string;
    destination_target: string;
    avg_duration_when_preceded: number;
    avg_duration_standalone: number;
    amplification_factor: number;
    sample_count: number;
  }>;
  tier: string;
}

export async function getAgentFriction(id: string, scope: string): Promise<FrictionResponse> {
  return fetchAPI(`/api/v1/agent/${id}/friction?scope=${scope}`);
}

// Public Leaderboard

export interface LeaderboardResponse {
  generated_at: string;
  period: string;
  totals: {
    total_agents: number;
    total_interactions: number;
    total_systems: number;
    total_skills: number;
  };
  systems: Array<{
    system_id: string;
    system_type: string;
    agent_count: number;
    total_interactions: number;
    failure_rate: number;
    anomaly_rate: number;
    median_duration_ms: number | null;
  }>;
  skills: Array<{
    skill_name: string | null;
    skill_source: string | null;
    agent_count: number;
    interaction_count: number;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
  }>;
}

export async function getLeaderboard(): Promise<LeaderboardResponse> {
  return fetchAPI('/api/v1/network/leaderboard');
}
