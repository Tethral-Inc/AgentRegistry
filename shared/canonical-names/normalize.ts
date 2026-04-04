import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const seedData: Record<string, string[]> = _require('./seed.json');

const reverseMap = new Map<string, string>();

for (const [canonical, variants] of Object.entries(seedData)) {
  reverseMap.set(canonical, canonical);
  for (const variant of variants) {
    reverseMap.set(variant, canonical);
  }
}

export function normalizeSystemId(systemId: string): string {
  const lower = systemId.toLowerCase();
  return reverseMap.get(lower) || lower;
}
