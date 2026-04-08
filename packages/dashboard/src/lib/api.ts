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
  topSystems: Array<{ system_id: string; interaction_count: number; health_status: string }>;
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
  threat_level: string | null;
  agent_count: number | null;
  quality_score: number | null;
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
  threat_level: string | null;
  agent_count: number | null;
}

export interface SkillSearchResult {
  skills: SkillCatalogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export async function searchSkills(query: string, options?: {
  source?: string; category?: string; threat_level?: string;
  limit?: number; offset?: number; sort?: string;
}): Promise<SkillSearchResult> {
  const params = new URLSearchParams({ q: query });
  if (options?.source) params.set('source', options.source);
  if (options?.category) params.set('category', options.category);
  if (options?.threat_level) params.set('threat_level', options.threat_level);
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
