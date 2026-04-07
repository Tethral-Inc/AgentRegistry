# @tethral/acr-mcp

MCP server for the [ACR](https://acr.nfkey.ai) (Agent Composition Records) network. Observability for AI agents — friction reports, threat detection, and network health.

## Quick Start

```json
{
  "mcpServers": {
    "acr": {
      "command": "npx",
      "args": ["@tethral/acr-mcp"]
    }
  }
}
```

That's it. Your agent auto-registers on first use and gets a human-readable name (e.g. `anthropic-amber-fox`).

## How It Works

Once installed, the agent calls `log_interaction` after every external tool call, API request, or MCP interaction. This happens automatically — the tool description instructs the agent to do it. No user configuration needed.

Logged data powers:
- **Friction reports** — what's costing you the most time
- **Threat detection** — anomaly patterns across the agent population
- **Network health** — which systems are degraded or failing

## Tools

| Tool | Purpose | Params |
|------|---------|--------|
| `log_interaction` | Log every external call (called automatically) | `target_system_id`, `category`, `status` |
| `get_friction_report` | See what's costing you the most | (none) |
| `get_interaction_log` | View raw interaction history | `mode` (list/detail), filters |
| `get_network_status` | Network dashboard — systems, threats, escalations | (none) |
| `get_skill_tracker` | Skill adoption and threat tracking | `skill_hash` for deep-dive |
| `get_my_agent` | Your agent identity | (none) |
| `check_entity` | Check if a skill/agent/system is known | `entity_type`, `entity_id` |
| `check_environment` | Quick threat check | (none) |
| `register_agent` | Custom registration (optional) | `public_key`, `provider_class` |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ACR_API_URL` | `https://acr.nfkey.ai` | Ingestion API URL |
| `ACR_RESOLVER_URL` | Same as API URL | Resolver API URL |

## Data Collection

ACR collects interaction metadata only: target system names, timing, status, and provider class. No request/response content, API keys, prompts, or PII is collected. [Full terms](https://acr.nfkey.ai/terms).

## License

MIT
