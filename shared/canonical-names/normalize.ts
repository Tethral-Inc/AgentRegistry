const seedData: Record<string, string[]> = {
  'mcp:github': ['mcp:github-server', 'mcp:github-mcp', 'mcp:gh'],
  'mcp:slack': ['mcp:slack-server', 'mcp:slack-mcp'],
  'mcp:filesystem': ['mcp:fs', 'mcp:file-system', 'mcp:filesystem-server'],
  'mcp:postgres': ['mcp:postgresql', 'mcp:pg', 'mcp:postgres-server'],
  'mcp:sqlite': ['mcp:sqlite3', 'mcp:sqlite-server'],
  'mcp:brave-search': ['mcp:brave', 'mcp:brave-search-server'],
  'mcp:puppeteer': ['mcp:puppeteer-server', 'mcp:browser'],
  'mcp:memory': ['mcp:memory-server'],
  'api:openai.com': ['api:api.openai.com'],
  'api:anthropic.com': ['api:api.anthropic.com'],
  'api:stripe.com': ['api:api.stripe.com'],
  'platform:clawhub': ['platform:clawhub.ai', 'platform:claw-hub'],
};

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
