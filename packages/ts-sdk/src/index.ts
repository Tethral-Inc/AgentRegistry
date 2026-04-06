import type {
  RegistrationRequest,
  RegistrationResponse,
  InteractionReceipt,
  SkillCheckResponse,
  FrictionReport,
} from './types.js';

export type {
  RegistrationRequest, RegistrationResponse, InteractionReceipt,
  SkillCheckResponse, FrictionReport, ProviderClass, TargetSystemType,
  InteractionCategory, InteractionStatus, AnomalyCategory, ThreatLevel,
  FrictionSummary, TargetFriction,
} from './types.js';

export interface ACRClientConfig {
  apiUrl?: string;
  resolverUrl?: string;
}

export class ACRClient {
  private apiUrl: string;
  private resolverUrl: string;

  constructor(config: ACRClientConfig = {}) {
    this.apiUrl = config.apiUrl ?? process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';
    this.resolverUrl = config.resolverUrl ?? this.apiUrl;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new ACRError(data.error?.code ?? 'UNKNOWN', data.error?.message ?? 'Request failed', res.status);
    return data as T;
  }

  private async get<T>(path: string, useResolver = false): Promise<T> {
    const base = useResolver ? this.resolverUrl : this.apiUrl;
    const res = await fetch(`${base}${path}`);
    const data = await res.json();
    if (!res.ok) throw new ACRError(data.error?.code ?? 'UNKNOWN', data.error?.message ?? 'Request failed', res.status);
    return data as T;
  }

  async register(request: RegistrationRequest): Promise<RegistrationResponse> {
    return this.post('/api/v1/register', request);
  }

  async submitReceipt(receipt: Omit<InteractionReceipt, 'receipt_id'>): Promise<{ accepted: number; receipt_ids: string[] }> {
    return this.post('/api/v1/receipts', receipt);
  }

  async submitReceipts(receipts: Omit<InteractionReceipt, 'receipt_id'>[]): Promise<{ accepted: number; receipt_ids: string[] }> {
    return this.post('/api/v1/receipts', { receipts });
  }

  async updateComposition(agentId: string, composition: {
    skills?: string[];
    skill_hashes?: string[];
  }): Promise<{ composition_hash: string; snapshot_id: string }> {
    return this.post('/api/v1/composition/update', { agent_id: agentId, composition });
  }

  async checkSkill(hash: string): Promise<SkillCheckResponse> {
    return this.get(`/v1/skill/${hash}`, true);
  }

  async checkAgent(agentId: string): Promise<{ found: boolean; agent_id: string; status?: string; provider_class?: string }> {
    return this.get(`/v1/agent/${agentId}`, true);
  }

  async getSystemHealth(systemId: string): Promise<{ found: boolean; system_id: string; health_status?: string }> {
    return this.get(`/v1/system/${encodeURIComponent(systemId)}/health`, true);
  }

  async getActiveThreats(): Promise<Array<{ threat_level: string; skill_hash: string; skill_name?: string }>> {
    return this.get('/v1/threats/active', true);
  }

  async getFrictionReport(agentId: string, scope: 'session' | 'day' | 'week' = 'day'): Promise<FrictionReport> {
    return this.get(`/api/v1/agent/${agentId}/friction?scope=${scope}`);
  }

  async getHealth(): Promise<{ status: string; database: string; timestamp: string }> {
    return this.get('/api/v1/health');
  }
}

export class ACRError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'ACRError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export { ACRClient as default };
