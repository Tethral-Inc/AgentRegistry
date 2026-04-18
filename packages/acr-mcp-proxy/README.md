# @tethral/acr-mcp-proxy

Transparent stdio MCP proxy that emits ACR receipts for every tool call
passing through. Observation at the JSON-RPC boundary — no modifications
to the wrapped server required.

## Why

`@tethral/acr-mcp` observes MCP activity from the ACR server's own tools.
This proxy observes *other* MCP servers — GitHub, Slack, filesystem, or
any third-party server — by sitting between Claude (or any MCP client)
and the real server.

Every `tools/call` round-trip produces a receipt with
`source='mcp-proxy'`, `target=mcp:<name>`, `status`, `duration_ms`, and
the invoked tool_name as a category. The receipt picks up a chain_id
from server-side chain inference automatically.

## Install

```bash
npm install -g @tethral/acr-mcp-proxy
```

## Use

Wrap the real MCP command with this proxy. Put the real command after
a `--` separator.

```
npx @tethral/acr-mcp-proxy --name github -- npx @modelcontextprotocol/server-github
```

Flags:

- `--name <id>`: what to report as `system_id` (becomes `mcp:<id>`).
  If omitted, derived from the wrapped command's basename.

## Claude Code config

Before:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"]
    }
  }
}
```

After (wrapped):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "@tethral/acr-mcp-proxy",
        "--name", "github",
        "--",
        "npx", "@modelcontextprotocol/server-github"
      ]
    }
  }
}
```

## Transparent by design

- stdout/stderr from the wrapped server pass through unchanged.
- Malformed JSON-RPC lines pass through without being observed.
- If `~/.claude/.acr-state.json` isn't present or ACR is unreachable,
  the proxy still forwards traffic — observation is best-effort, the
  underlying MCP always works.
- Exit code mirrors the wrapped server's exit code.

## What's observed

Only JSON-RPC `tools/call` methods produce receipts. `initialize`,
`tools/list`, `ping`, and other setup/metadata methods are forwarded
but not observed. The rationale: `tools/call` is where the real work
happens; the rest is wiring noise.
