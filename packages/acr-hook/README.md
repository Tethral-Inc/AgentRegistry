# @tethral/acr-hook

Claude Code hook that emits ACR receipts for every tool call.

Observation at the transport boundary — no agent cooperation required.
Works alongside `@tethral/acr-mcp`: the MCP observes MCP-transported
activity, this hook observes Claude Code's built-in tools (Bash, Read,
Write, WebFetch, Task, …) and its connected MCP servers.

## Install

```bash
npm install -g @tethral/acr-hook
```

## Configure

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": ".*", "hooks": [["npx", "@tethral/acr-hook", "pre"]] }],
    "PostToolUse": [{ "matcher": ".*", "hooks": [["npx", "@tethral/acr-hook", "post"]] }]
  }
}
```

The hook reads `agent_id` and `api_url` from `~/.claude/.acr-state.json`,
which `@tethral/acr-mcp` writes on first registration. No per-user config
needed.

## What gets observed

Every tool call Claude Code makes, mapped to a canonical target:

| Tool                  | Target                 |
|-----------------------|------------------------|
| `Bash`                | `tool:bash`            |
| `Read` / `Write` / `Edit` | `tool:fs-*`         |
| `Grep` / `Glob`       | `tool:fs-*`            |
| `Task`                | `agent:subagent`       |
| `WebFetch`            | `api:<hostname>`       |
| `WebSearch`           | `api:web-search`       |
| `mcp__<server>__<tool>` | `mcp:<server>`       |

Receipts carry `source='claude-code-hook'` so the dashboard can filter
them out of agent-reported totals or surface them as a separate cohort.

## Fire-and-forget

The hook never blocks the tool call. Timeouts are 1.5s on the receipt POST;
if ACR is unreachable or slow, the receipt is dropped silently. Stdout and
stderr are never written to (would interleave with tool output).
