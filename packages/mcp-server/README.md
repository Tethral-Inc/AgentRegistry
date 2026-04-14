# @tethral/acr-mcp

MCP server for the [ACR](https://acr.nfkey.ai) (Agent Composition Records) network. Log agent interactions, build an interaction profile, and query it through behavioral lenses.

## Quick Start

Add to your project (`.mcp.json`):

```json
{
  "mcpServers": {
    "acr": {
      "command": "npx",
      "args": ["-y", "@tethral/acr-mcp@2.0.3"]
    }
  }
}
```

Or run directly:

```bash
npx @tethral/acr-mcp          # stdio transport
npx @tethral/acr-mcp-http     # HTTP transport
```

Your agent auto-registers on first use and gets a human-readable name (e.g. `anthropic-amber-fox`). Call `get_my_agent` to see your agent ID, API key, and dashboard link.

## What It Does

ACR is an **interaction profile registry** — not a security product, not a skill store.

1. **Agent registers** — composition is recorded (what skills, MCPs, tools it has)
2. **Agent logs interactions** — every external tool call, API request, or MCP interaction
3. **Signals compile into an interaction profile** — timing, chain position, retries, anomaly flags
4. **Lenses interpret the profile** — friction, coverage, stable corridors, failure registry, trend
5. **Anomaly signal notifications** — if ACR observes anomaly signals affecting a component in your composition, you get a notification

## Tools (21)

### Your agent
| Tool | Purpose |
|------|---------|
| `get_my_agent` | Your agent ID, API key, dashboard link, and menu of available lenses. The entry point to ACR. |
| `register_agent` | Explicit registration with composition. Auto-registration is the default on first call. |
| `update_composition` | Update your composition without re-registering. Preserves agent identity. |
| `configure_deep_composition` | Privacy control: enable/disable sub-component capture for this session. |

### Interaction logging
| Tool | Purpose |
|------|---------|
| `log_interaction` | Record an interaction. Call after every external tool call, API request, or MCP interaction. Every lens depends on this. |
| `get_interaction_log` | Paginated interaction history with network context. |

### Behavioral lenses
| Tool | Purpose |
|------|---------|
| `get_friction_report` | Where time and tokens are lost: top targets, chain overhead, retry waste, population baselines. |
| `get_profile` | Full interaction profile: identity, counts, composition summary, composition delta. |
| `summarize_my_agent` | One-read overview across profile, friction, and coverage lenses. |
| `get_coverage` | Signal completeness: which fields you populate on receipts, which you don't. |
| `get_stable_corridors` | Reliably fast interaction paths: zero failures, low variance, high sample count. |
| `get_failure_registry` | Per-target failure breakdown: status codes, error codes, categories. |
| `get_trend` | Latency and failure rate changes: current vs previous period, raw deltas. |

### Anomaly signal notifications
| Tool | Purpose |
|------|---------|
| `check_environment` | Active anomaly signals and network observations. Call on startup. |
| `get_notifications` | Unread anomaly signal notifications about components in your composition. |
| `acknowledge_threat` | Acknowledge a notification after reviewing with your operator. Expires in 30 days. |

### Network observation
| Tool | Purpose |
|------|---------|
| `get_network_status` | Network-wide dashboard: agent/system totals, signal rates, skill anomalies, escalations. |
| `get_skill_tracker` | Adoption and anomaly signals for skills observed by the network. |

### Lookups
| Tool | Purpose |
|------|---------|
| `check_entity` | Ask the network what it knows about a specific skill, agent, or system. |
| `search_skills` | Query the network's knowledge of a skill by name. |
| `get_skill_versions` | Version history for a skill hash. |

## Dashboard

View your agent's profile and friction analysis at [dashboard.acr.nfkey.ai](https://dashboard.acr.nfkey.ai). Requires your agent ID and API key (shown by `get_my_agent`).

The [public leaderboard](https://dashboard.acr.nfkey.ai/leaderboard) shows anonymous aggregate data — most used MCP servers, reliability rankings, skill adoption — no auth required.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ACR_API_URL` | `https://acr.nfkey.ai` | API endpoint |
| `ACR_RESOLVER_URL` | Same as API URL | Resolver endpoint |
| `ACR_DEEP_COMPOSITION` | `true` | Set to `false` to disable sub-component capture |
| `ACR_DASHBOARD_URL` | `https://dashboard.acr.nfkey.ai` | Dashboard URL shown in get_my_agent |

## Data Collection

ACR collects interaction **metadata only**: target system names, timing, status, and provider class. No request/response content, API keys, prompts, or PII is collected. We intentionally don't track the agent's owner. [Full terms](https://acr.nfkey.ai/terms).

## License

MIT
