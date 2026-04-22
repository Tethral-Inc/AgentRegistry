import { createHash } from 'node:crypto';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashSkillFile(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return sha256(normalized);
}

export function computeCompositionHash(componentHashes: string[]): string {
  const sorted = [...componentHashes].sort();
  return sha256(sorted.join(':'));
}

/**
 * Derive the flat list of identity-bearing hashes from a Composition
 * payload so `computeCompositionHash` sees every component, not just the
 * legacy flat `skill_hashes`.
 *
 * Pre-2.5.0 the ingestion-api hashed only `composition.skill_hashes`, so
 * an agent reporting rich-only composition (skill_components etc.) got a
 * constant `sha256('')` — every update looked like the same composition
 * and nothing could be attributed to a version bump or a new MCP. This
 * helper fixes that by folding every composition field into a stable
 * contribution string:
 *
 *   - `skill_hashes[i]`        → use as-is (already an identity hash)
 *   - `skills[i]`              → sha256("skill:<name>")
 *   - `mcps[i]` / `tools[i]`   → sha256("mcp:<name>" | "tool:<name>")
 *   - `*_components[i]`        → sha256("<type>:<id>@<version>")
 *   - `*_components[i].sub_components[j]`
 *                             → sha256("<type>:<parent.id>:<sub.id>@<version>")
 *
 * Backwards-compat property: a caller that sends only `skill_hashes`
 * produces the same list (and therefore the same composition_hash) as
 * the old logic — so existing agents see no hash churn.
 */
export function extractCompositionComponentHashes(composition: {
  skills?: string[];
  skill_hashes?: string[];
  mcps?: string[];
  tools?: string[];
  skill_components?: Array<{
    id: string; version?: string;
    sub_components?: Array<{ id: string; version?: string }>;
  }>;
  mcp_components?: Array<{
    id: string; version?: string;
    sub_components?: Array<{ id: string; version?: string }>;
  }>;
  api_components?: Array<{
    id: string; version?: string;
    sub_components?: Array<{ id: string; version?: string }>;
  }>;
  tool_components?: Array<{
    id: string; version?: string;
    sub_components?: Array<{ id: string; version?: string }>;
  }>;
}): string[] {
  const hashes: string[] = [];

  // Flat legacy — skill_hashes are already identity-bearing; the name
  // arrays carry only a label, so we namespace them per type to avoid
  // "skill foo" colliding with "mcp foo".
  for (const h of composition.skill_hashes ?? []) hashes.push(h);
  for (const n of composition.skills ?? []) hashes.push(sha256(`skill:${n}`));
  for (const n of composition.mcps ?? []) hashes.push(sha256(`mcp:${n}`));
  for (const n of composition.tools ?? []) hashes.push(sha256(`tool:${n}`));

  const addRich = (
    kind: 'skill' | 'mcp' | 'api' | 'tool',
    list: Array<{
      id: string; version?: string;
      sub_components?: Array<{ id: string; version?: string }>;
    }> | undefined,
  ) => {
    for (const c of list ?? []) {
      hashes.push(sha256(`${kind}:${c.id}@${c.version ?? ''}`));
      for (const s of c.sub_components ?? []) {
        hashes.push(sha256(`${kind}:${c.id}:${s.id}@${s.version ?? ''}`));
      }
    }
  };

  addRich('skill', composition.skill_components);
  addRich('mcp', composition.mcp_components);
  addRich('api', composition.api_components);
  addRich('tool', composition.tool_components);

  return hashes;
}

export function generateAgentId(publicKey: string, timestamp: number): string {
  const hash = sha256(`${publicKey}:${timestamp}`);
  return `acr_${hash.substring(0, 12)}`;
}

const ADJECTIVES = [
  'amber', 'azure', 'bold', 'bright', 'calm', 'clear', 'cool', 'coral',
  'crisp', 'dark', 'deep', 'dusk', 'fair', 'fast', 'fine', 'fleet',
  'frost', 'glad', 'gold', 'green', 'grey', 'haze', 'iron', 'jade',
  'keen', 'lark', 'lean', 'lime', 'live', 'mild', 'mint', 'neon',
  'nova', 'pale', 'pine', 'pure', 'rare', 'rose', 'ruby', 'rust',
  'sage', 'silk', 'slim', 'soft', 'star', 'teal', 'true', 'warm',
  'west', 'wild',
];

const ANIMALS = [
  'bear', 'crow', 'deer', 'dove', 'duck', 'eagle', 'elk', 'falcon',
  'finch', 'fox', 'frog', 'goat', 'hawk', 'heron', 'horse', 'ibis',
  'jay', 'kite', 'lark', 'lion', 'lynx', 'mink', 'moth', 'newt',
  'orca', 'otter', 'owl', 'panda', 'pike', 'puma', 'quail', 'raven',
  'robin', 'seal', 'shrike', 'snake', 'squid', 'stork', 'swan', 'tiger',
  'toad', 'trout', 'viper', 'vole', 'wasp', 'whale', 'wolf', 'wren',
  'yak', 'zebra',
];

export function generateAgentName(providerClass: string, publicKey: string): string {
  const hash = sha256(`name:${publicKey}`);
  const adjIdx = parseInt(hash.substring(0, 8), 16) % ADJECTIVES.length;
  const animalIdx = parseInt(hash.substring(8, 16), 16) % ANIMALS.length;
  return `${providerClass}-${ADJECTIVES[adjIdx]}-${ANIMALS[animalIdx]}`;
}

export function generateReceiptId(
  emitterAgentId: string,
  targetSystemId: string,
  timestampMs: number,
): string {
  const hash = sha256(`${emitterAgentId}:${targetSystemId}:${timestampMs}`);
  return `rcpt_${hash.substring(0, 12)}`;
}
