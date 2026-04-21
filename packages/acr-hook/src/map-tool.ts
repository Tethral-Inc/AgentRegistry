/**
 * Maps a Claude Code tool invocation (tool_name + tool_input) onto the
 * ACR receipt shape: target_system_id, target_system_type, interaction
 * category, and a rough activity classification.
 *
 * Heuristic, not exhaustive. Unknown tools default to `tool:<name>` and
 * `system_type='tool'`. The MCP tool namespace `mcp__<server>__<tool>`
 * is parsed out so receipts aggregate cleanly by MCP server.
 */

export type MappedTarget = {
  target_system_id: string;
  target_system_type: 'mcp_server' | 'api' | 'agent' | 'skill' | 'platform' | 'unknown';
  category: 'tool_call' | 'delegation' | 'data_exchange' | 'research' | 'code' | 'communication';
  activity_class?: string;
  interaction_purpose?: string;
  data_shape?: string;
};

const BUILTIN_TOOL_MAP: Record<string, MappedTarget> = {
  Bash: {
    target_system_id: 'tool:bash',
    target_system_type: 'platform',
    category: 'code',
    activity_class: 'deterministic',
    interaction_purpose: 'execute',
  },
  Read: {
    target_system_id: 'tool:fs-read',
    target_system_type: 'platform',
    category: 'data_exchange',
    activity_class: 'deterministic',
    interaction_purpose: 'read',
    data_shape: 'text',
  },
  Write: {
    target_system_id: 'tool:fs-write',
    target_system_type: 'platform',
    category: 'data_exchange',
    activity_class: 'deterministic',
    interaction_purpose: 'write',
    data_shape: 'text',
  },
  Edit: {
    target_system_id: 'tool:fs-edit',
    target_system_type: 'platform',
    category: 'code',
    activity_class: 'deterministic',
    interaction_purpose: 'transform',
    data_shape: 'text',
  },
  Glob: {
    target_system_id: 'tool:fs-glob',
    target_system_type: 'platform',
    category: 'data_exchange',
    activity_class: 'deterministic',
    interaction_purpose: 'search',
  },
  Grep: {
    target_system_id: 'tool:fs-grep',
    target_system_type: 'platform',
    category: 'data_exchange',
    activity_class: 'deterministic',
    interaction_purpose: 'search',
  },
  Task: {
    target_system_id: 'agent:subagent',
    target_system_type: 'agent',
    category: 'delegation',
    activity_class: 'language',
    interaction_purpose: 'delegate',
  },
  TodoWrite: {
    target_system_id: 'tool:todo',
    target_system_type: 'platform',
    category: 'tool_call',
    activity_class: 'deterministic',
    interaction_purpose: 'write',
  },
  NotebookEdit: {
    target_system_id: 'tool:notebook-edit',
    target_system_type: 'platform',
    category: 'code',
    interaction_purpose: 'transform',
  },
  WebSearch: {
    target_system_id: 'api:web-search',
    target_system_type: 'api',
    category: 'research',
    activity_class: 'language',
    interaction_purpose: 'search',
    data_shape: 'text',
  },
};

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Parse an MCP tool name of the form `mcp__<server>__<tool>` into
 * the server identifier. Returns null for non-MCP names.
 */
function parseMcpServerFromToolName(toolName: string): string | null {
  const m = /^mcp__([^_]+(?:_[^_]+)*)__[^_]+/.exec(toolName);
  if (!m) return null;
  // Claude Code uses `mcp__<server_id>__<tool>` — collapse UUID server
  // IDs into a generic `mcp:<first8>` label so receipts don't fan out
  // on per-connection UUIDs, but keep human-readable server names as-is.
  const raw = m[1];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) {
    return raw.slice(0, 8);
  }
  return raw;
}

export function mapTool(toolName: string, toolInput: unknown): MappedTarget {
  // WebFetch — extract host from url for per-host aggregation
  if (toolName === 'WebFetch' && toolInput && typeof toolInput === 'object') {
    const url = (toolInput as Record<string, unknown>).url;
    if (typeof url === 'string') {
      const host = hostFromUrl(url);
      if (host) {
        return {
          target_system_id: `api:${host}`,
          target_system_type: 'api',
          category: 'research',
          activity_class: 'language',
          interaction_purpose: 'read',
          data_shape: 'text',
        };
      }
    }
    return {
      target_system_id: 'api:webfetch',
      target_system_type: 'api',
      category: 'research',
      activity_class: 'language',
      interaction_purpose: 'read',
    };
  }

  // MCP tool name → per-server target
  const mcpServer = parseMcpServerFromToolName(toolName);
  if (mcpServer) {
    return {
      target_system_id: `mcp:${mcpServer}`,
      target_system_type: 'mcp_server',
      category: 'tool_call',
      interaction_purpose: 'read',
    };
  }

  // Built-in tools
  const builtin = BUILTIN_TOOL_MAP[toolName];
  if (builtin) return builtin;

  // Unknown — fall through to generic
  return {
    target_system_id: `tool:${toolName.toLowerCase()}`,
    target_system_type: 'unknown',
    category: 'tool_call',
  };
}

/**
 * Summarize tool_input to a 48-char fingerprint string, used as a
 * cross-check for the Pre/Post pairing. Not posted to ACR — purely
 * local.
 */
export function summarizeToolInput(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    return s.length <= 48 ? s : s.slice(0, 48);
  } catch {
    return '';
  }
}
