import type { CachedValue } from '../types.js';

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const STALE_TTL_SECONDS = 3600; // 1 hour (stale data kept for fallback)

export async function getCached<T>(
  kv: KVNamespace,
  key: string,
): Promise<{ data: T; stale: boolean } | null> {
  const raw = await kv.get(key, 'text');
  if (!raw) return null;

  const cached: CachedValue<T> = JSON.parse(raw);
  const ageMs = Date.now() - cached.cachedAt;
  const stale = ageMs > DEFAULT_TTL_SECONDS * 1000;

  return { data: cached.data, stale };
}

export async function setCache<T>(
  kv: KVNamespace,
  key: string,
  data: T,
): Promise<void> {
  const value: CachedValue<T> = {
    data,
    cachedAt: Date.now(),
  };
  await kv.put(key, JSON.stringify(value), {
    expirationTtl: STALE_TTL_SECONDS,
  });
}
