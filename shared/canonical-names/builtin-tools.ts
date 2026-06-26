/**
 * Canonical target_system_id for Claude Code built-in tools.
 *
 * This is the single source of truth for how a built-in tool name maps onto
 * the target id that appears on receipts. The host-side hook
 * (@tethral/acr-hook, packages/acr-hook/src/map-tool.ts) emits these exact
 * ids when it captures a tool call; the composition-target extractor
 * (packages/ingestion-api/src/lib/composition-targets.ts) must resolve a
 * *declared* built-in tool name to the SAME id, or the declared-vs-called
 * lenses (revealed-preference, composition-diff) can never match — every
 * declaration shows as bound_uncalled and every call as called_unbound
 * (the "67 bound / 0 called" failure).
 *
 * The hook keeps a structural copy of this mapping because it must stay
 * dependency-free / standalone (it cannot import @acr/shared, which pulls in
 * the DB layer). Keep the two in sync: this table is the canonical one.
 *
 * Keys are lowercased so lookup is case-insensitive — composition authors
 * keep the source casing ("Bash") while receipts are normalized to lower.
 */
export const BUILTIN_TOOL_TARGETS: Record<string, string> = {
  bash: 'platform:bash',
  read: 'platform:fs-read',
  write: 'platform:fs-write',
  edit: 'platform:fs-edit',
  glob: 'platform:fs-glob',
  grep: 'platform:fs-grep',
  task: 'agent:subagent',
  todowrite: 'platform:todo',
  notebookedit: 'platform:notebook-edit',
  websearch: 'api:web-search',
  webfetch: 'api:webfetch',
};

/**
 * Resolve a Claude Code built-in tool name to its canonical target id, or
 * null if the name is not a known built-in (i.e. it is an MCP-hosted tool or
 * something else). Case-insensitive.
 */
export function canonicalTargetForBuiltinTool(toolName: string): string | null {
  if (!toolName) return null;
  return BUILTIN_TOOL_TARGETS[toolName.trim().toLowerCase()] ?? null;
}
