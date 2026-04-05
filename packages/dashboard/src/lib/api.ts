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

export interface OperatorMetrics {
  agentId: string;
  status: string;
  lastActive: string;
  receiptCount: number;
  topFrictionTarget: string;
  frictionPercentage: number;
}
