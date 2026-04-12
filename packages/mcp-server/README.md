# @tethral/acr-mcp

MCP server for the [ACR](https://acr.nfkey.ai) (Agent Composition Records) network. Log agent interactions, build an interaction profile, and query it through behavioral lenses. Get notified if ACR observes that your composition may be jeopardized.

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

## What It Does

ACR is an **interaction profile registry** — not a security product, not a skill store.

1. **Agent registers** — composition is recorded (what skills, MCPs, tools it has)
2. **Agent logs interactions** — every external tool call, API request, or MCP interaction
3. **Signals compile into an interaction profile** — timing, chain position, retries, anomaly flags, and more
4. **Lenses interpret the profile** — friction is the first and most developed lens (bottlenecks, chain overhead, retry waste, population baselines)
5. **Anomaly signal notifications** — if ACR observes anomaly signals affecting a component in your composition, you get a notification. We're not a security check — we register and propagate signals, like HIBP or contact tracing.

## Tools (14)

### Interaction logging (the foundation)
| Tool | Purpose |
|------|---------|
| `log_interaction` | Record an interaction — every lens depends on this. Call after every external tool call, API request, or MCP interaction. |
| `get_interaction_log` | Raw interaction history with network context (target health, baselines, anomaly signals). |

### Friction lens
| Tool | Purpose |
|------|---------|
| `get_friction_report` | Query the friction lens of your interaction profile. Top-target breakdown with p95 latencies, chain analysis, retry overhead, population drift. |

### Identity & composition
| Tool | Purpose |
|------|---------|
| `get_my_agent` | Your agent identity, provider, status, environment context. |
| `register_agent` | Explicit registration (auto-registration is the default on first call). |
| `update_composition` | Update your composition without re-registering. Preserves agent identity. |

### Anomaly signal notifications
| Tool | Purpose |
|------|---------|
| `check_environment` | Active anomaly signals and network observations. Call on startup. |
| `get_notifications` | Unread anomaly signal notifications about components in your composition. |
| `acknowledge_threat` | Acknowledge a notification after reviewing with your operator. Expires in 30 days. |

### Network observation
| Tool | Purpose |
|------|---------|
| `get_network_status` | Network-wide observation dashboard — agent/system totals, signal rates, skill anomalies, escalations. |
| `get_skill_tracker` | Adoption and anomaly signals for skills observed by the network. |

### Lookups
| Tool | Purpose |
|------|---------|
| `check_entity` | Ask the network what it knows about a specific skill, agent, or system. |
| `search_skills` | Query the network's knowledge of a skill by name. |
| `get_skill_versions` | Version history for a skill hash — which version you're on, how it has changed. |

## About the Skill Registry

ACR maintains an observation layer on skills that exist in public registries (npm, GitHub, etc.). We update it continuously. **We are not a security check.** If we observe anomaly signals affecting a component in an agent's composition, we propagate that observation as a notification. Because we do not track the agent's owner, we have no mechanism to notify them beyond the agent's activities.

Agents don't get skills from ACR — we observe skills that already exist in the ecosystem and keep track of behavioral signals tied to them.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ACR_API_URL` | `https://acr.nfkey.ai` | API endpoint |
| `ACR_RESOLVER_URL` | Same as API URL | Resolver endpoint |

## Data Collection

ACR collects interaction **metadata only**: target system names, timing, status, and provider class. No request/response content, API keys, prompts, or PII is collected. We intentionally don't track the agent's owner. [Full terms](https://acr.nfkey.ai/terms).

## License

MIT
