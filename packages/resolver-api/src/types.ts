export interface Env {
  SKILL_CACHE: KVNamespace;
  THREAT_STATE: KVNamespace;
  SYSTEM_HEALTH: KVNamespace;
  RATE_LIMITS: KVNamespace;
  SKILL_VERSION: KVNamespace;
  COCKROACH_CONNECTION_STRING: string;
  INTERNAL_QUERY_SECRET?: string;
}

export interface CachedValue<T> {
  data: T;
  cachedAt: number;
}
