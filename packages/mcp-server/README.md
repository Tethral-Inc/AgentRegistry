# @tethral/acr-mcp

MCP server for the [ACR](https://acr.nfkey.ai) (Agent Composition Records) network. Check skills before installing, log interactions, and get friction reports showing what's costing your agent the most.

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

That's it. The server auto-registers your agent on first use.

## Tools

| Tool | Description | Required Params |
|------|-------------|----------------|
| `log_interaction` | Log an external interaction | `target_system_id`, `category`, `status` |
| `check_entity` | Check if a skill/agent/system is known | `entity_type`, `entity_id` |
| `get_friction_report` | See what's costing you the most | (none — uses auto-assigned ID) |
| `check_environment` | Get network threat overview | (none) |
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
