# @tethral/acr-mcp

MCP server for the [ACR](https://acr.nfkey.ai) (Agent Composition Records) network. Safety registry for AI agent skills — search 403+ skills, detect threats, block dangerous content, get notifications.

## Quick Start

Add to Claude Code (`.claude/settings.json`):

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

Or run directly:

```bash
npx @tethral/acr-mcp          # stdio transport
npx @tethral/acr-mcp-http     # HTTP transport
```

Your agent auto-registers on first use and gets a human-readable name (e.g. `anthropic-amber-fox`).

## What Happens Automatically

1. Agent registers and gets an ID
2. `log_interaction` is called after every external tool call (the tool description instructs the agent)
3. Friction reports, threat detection, and network health data populate from logged interactions
4. When the agent checks a skill before installing, ACR returns safety data, blocks dangerous skills, and warns about risks

## Tools (14)

### Skill Safety
| Tool | Purpose |
|------|---------|
| `search_skills` | Search 403+ skills by name, description, or capability. Filter by source, category, threat level, security score. |
| `check_entity` | Check if a skill/agent/system is safe. Returns security score, threat patterns, blocked status, version freshness. |
| `get_skill_versions` | Version history for a skill — is your version current? How many versions behind? |

### Notifications
| Tool | Purpose |
|------|---------|
| `get_notifications` | Check for unread threat alerts on your installed skills. Call on startup. |
| `acknowledge_threat` | Acknowledge a threat notification after reviewing with the user. Expires in 30 days. |

### Composition
| Tool | Purpose |
|------|---------|
| `update_composition` | Update your skill list without re-registering. Preserves agent identity. |
| `register_agent` | Custom registration with skill hashes, provider class, environment context. |

### Observability
| Tool | Purpose |
|------|---------|
| `log_interaction` | Log every external call. Powers friction reports and threat detection. |
| `get_friction_report` | What's costing you the most time — per-target breakdown with p95 latencies. |
| `get_interaction_log` | Raw interaction history with filters (target, category, status, anomaly). |
| `get_network_status` | Network dashboard — active agents, system health, threats, escalations. |
| `get_skill_tracker` | Skill adoption tracking with cross-provider anomaly correlation. |
| `get_my_agent` | Your agent identity, provider, status, environment context. |
| `check_environment` | Quick health check — active threats and network status. |

## Security Scanner

Every skill in the catalog is scanned with 20+ regex patterns before agents can access it:

- **Critical**: Prompt injection, data exfiltration, credential harvesting, known C2 IPs
- **High**: Code execution (`eval`, `child_process`), filesystem traversal, destructive ops
- **Medium**: Obfuscation (base64, hex), excessive permissions, dependency confusion
- **Low**: Missing metadata (author, version, description), oversized content

Skills scoring **below 50/100** are **BLOCKED** — content redacted, agents see a clear warning with threat patterns. Skills 50-79 are warned. 80+ are clean.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ACR_API_URL` | `https://acr.nfkey.ai` | API endpoint |
| `ACR_RESOLVER_URL` | Same as API URL | Resolver endpoint |

## Data Collection

ACR collects interaction **metadata only**: target system names, timing, status, and provider class. No request/response content, API keys, prompts, or PII is collected. [Full terms](https://acr.nfkey.ai/terms).

## License

MIT
