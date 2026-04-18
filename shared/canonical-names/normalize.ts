/**
 * Canonical system_id normalization.
 *
 * Two passes:
 *   1. Structural normalization — strip protocol, path, port, fragment,
 *      query, trailing slash, and lowercase. For api: IDs, strip a
 *      leading "api." or "www." subdomain since those rarely disambiguate
 *      anything at the observability-graph level (api.openai.com and
 *      openai.com are the same thing to us).
 *   2. Seed-map lookup — a hand-maintained alias table mapping common
 *      variants (github-server, github-mcp, postgresql, pg, …) to a
 *      canonical id. Consulted AFTER structural normalization so both
 *      kinds of noise compose: `API:api.OpenAI.com/v1/chat/completions`
 *      first collapses to `api:openai.com`, then passes through the seed
 *      map unchanged.
 *
 * The goal is consistent target IDs across ingests so every aggregation
 * (friction targets, network baselines, composition diff, chain analysis)
 * sees the same target the same way regardless of which client emitted
 * the receipt.
 */

const seedData: Record<string, string[]> = {
  // --- MCP servers ---
  'mcp:github': ['mcp:github-server', 'mcp:github-mcp', 'mcp:gh'],
  'mcp:slack': ['mcp:slack-server', 'mcp:slack-mcp'],
  'mcp:filesystem': ['mcp:fs', 'mcp:file-system', 'mcp:filesystem-server'],
  'mcp:postgres': ['mcp:postgresql', 'mcp:pg', 'mcp:postgres-server'],
  'mcp:sqlite': ['mcp:sqlite3', 'mcp:sqlite-server'],
  'mcp:brave-search': ['mcp:brave', 'mcp:brave-search-server'],
  'mcp:puppeteer': ['mcp:puppeteer-server', 'mcp:browser'],
  'mcp:playwright': ['mcp:playwright-server', 'mcp:playwright-mcp'],
  'mcp:memory': ['mcp:memory-server'],
  'mcp:notion': ['mcp:notion-server', 'mcp:notion-mcp'],
  'mcp:linear': ['mcp:linear-server', 'mcp:linear-mcp'],
  'mcp:jira': ['mcp:jira-server', 'mcp:atlassian-jira'],
  'mcp:gdrive': ['mcp:google-drive', 'mcp:gdrive-server'],
  'mcp:fetch': ['mcp:fetch-server', 'mcp:http-fetch'],
  'mcp:sequential-thinking': ['mcp:seq-think', 'mcp:sequential'],
  'mcp:everything': ['mcp:everything-server'],
  'mcp:supabase': ['mcp:supabase-server', 'mcp:supabase-mcp'],
  'mcp:vercel': ['mcp:vercel-server', 'mcp:vercel-mcp'],

  // --- API endpoints ---
  // Canonical form is the stripped hostname (no leading api.). The
  // api.* variants are kept here for defense-in-depth in case the
  // structural pass is ever disabled, but the main win is that the
  // structural pass will usually produce the canonical form directly.
  'api:openai.com': ['api:api.openai.com'],
  'api:anthropic.com': ['api:api.anthropic.com'],
  'api:stripe.com': ['api:api.stripe.com'],
  'api:github.com': ['api:api.github.com'],
  'api:googleapis.com': ['api:www.googleapis.com'],
  'api:vercel.com': ['api:api.vercel.com'],
  'api:supabase.co': ['api:api.supabase.co'],
  'api:cloudflare.com': ['api:api.cloudflare.com'],
  'api:linear.app': ['api:api.linear.app'],
  'api:notion.com': ['api:api.notion.com'],
  'api:slack.com': ['api:api.slack.com', 'api:slack.com/api'],
  'api:discord.com': ['api:discord.com/api', 'api:discordapp.com'],
  'api:atlassian.com': ['api:api.atlassian.com'],

  // --- Platforms ---
  'platform:clawhub': ['platform:clawhub.ai', 'platform:claw-hub'],
  'platform:openclaw': ['platform:openclaw.ai', 'platform:open-claw'],
};

const reverseMap = new Map<string, string>();

for (const [canonical, variants] of Object.entries(seedData)) {
  reverseMap.set(canonical, canonical);
  for (const variant of variants) {
    reverseMap.set(variant, canonical);
  }
}

const KNOWN_TYPES = new Set(['mcp', 'api', 'agent', 'skill', 'platform']);

/**
 * Structurally clean the name portion of a system_id. Called after
 * splitting the `type:name` tuple. Pure — no seed-map involvement.
 */
function structurallyNormalizeName(type: string, rawName: string): string {
  let name = rawName.trim();

  // Strip URL protocol if someone accidentally pasted a full URL in.
  name = name.replace(/^https?:\/\//, '');

  // Strip path, query, fragment — keep only the host portion.
  const slash = name.indexOf('/');
  if (slash !== -1) name = name.slice(0, slash);
  const qmark = name.indexOf('?');
  if (qmark !== -1) name = name.slice(0, qmark);
  const hash = name.indexOf('#');
  if (hash !== -1) name = name.slice(0, hash);

  // Strip port (host:port).
  const portSep = name.indexOf(':');
  if (portSep !== -1) name = name.slice(0, portSep);

  // For api: (and platform: hostnames), strip the most common noise
  // subdomains. api.openai.com and openai.com are the same target to
  // us; www.googleapis.com and googleapis.com are the same.
  if (type === 'api' || type === 'platform') {
    name = name.replace(/^api\./, '');
    name = name.replace(/^www\./, '');
  }

  return name;
}

/**
 * Normalize a `{type}:{name}` system_id to its canonical form. Does
 * structural cleanup + seed-map lookup. Idempotent — passing in an
 * already-canonical id returns it unchanged.
 */
export function normalizeSystemId(systemId: string): string {
  if (!systemId) return systemId;

  const lower = systemId.toLowerCase().trim();
  const sep = lower.indexOf(':');

  // Input without a type prefix — we can't safely structurally normalize
  // (don't know if it's api/mcp/platform), so just consult the seed map
  // and fall through.
  if (sep === -1) {
    return reverseMap.get(lower) ?? lower;
  }

  const type = lower.slice(0, sep);
  const rawName = lower.slice(sep + 1);

  // Unknown type prefix — treat as opaque, still apply seed lookup.
  if (!KNOWN_TYPES.has(type)) {
    return reverseMap.get(lower) ?? lower;
  }

  const cleanName = structurallyNormalizeName(type, rawName);
  const structurallyNormalized = `${type}:${cleanName}`;

  return reverseMap.get(structurallyNormalized) ?? structurallyNormalized;
}
