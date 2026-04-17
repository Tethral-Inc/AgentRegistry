# ACR — Agent Composition Records

**A behavioral registry and observation network for AI agents.** Agents register their composition, log their interactions, and query behavioral profiles through lenses. If we observe anomaly signals affecting an agent's composition, we notify the agent.

[![npm](https://img.shields.io/npm/v/@tethral/acr-mcp)](https://www.npmjs.com/package/@tethral/acr-mcp)
[![npm](https://img.shields.io/npm/v/@tethral/acr-sdk)](https://www.npmjs.com/package/@tethral/acr-sdk)

## What ACR Is

ACR is an **interaction profile registry**. Agents log what they do (external tool calls, API requests, MCP interactions). Those signals compile into a behavioral profile over time, which you can query through **lenses** — each lens a different way of interpreting the same underlying signals.

The **friction lens** is the first one shipped: bottleneck detection, chain overhead analysis, retry waste, population baselines, directional friction between targets. More lenses (reliability, quality) are on the roadmap.

ACR is **not a security product**. We don't evaluate skills, test for compromise, or block anything. We're closer to HIBP or contact tracing: we register events and propagate notifications. If we observe anomaly signals affecting an agent's composition, we notify the agent. We don't track the agent's owner, so we have no mechanism to notify them beyond the agent's activities.

## What ACR Does

- **Registers agents** — zero-config identity, composition tracking, persistent across sessions
- **Logs interactions** — every external tool call an agent makes, with timing, status, chain position, anomaly signals
- **Builds interaction profiles** — raw signals compiled over time into the behavioral record for each agent
- **Surfaces the friction lens** — where your agent is losing time and tokens, with chain analysis, retry overhead, population drift, and directional friction
- **Anomaly signal notifications** — if ACR observes anomalies affecting a component in an agent's composition, we notify that agent

## The Skill Registry

We maintain a registry of agent skills that we update continuously. **We are not a security check.** If we observe anomaly signals affecting a skill in an agent's composition, we notify the agent. Because we do not track the agent's owner, we have no mechanism to notify them beyond the agent's activities.

Agents don't get skills from ACR — we observe skills that already exist in the ecosystem (via public registries like npm and GitHub) and keep track of behavioral signals tied to them.

## Add to Claude Code (30 seconds)

Add this to your Claude Code settings (`.claude/settings.json` or via IDE):

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

Your agent auto-registers, gets a name (e.g. `anthropic-amber-fox`), and starts building its interaction profile on the first `log_interaction` call.

## Get started in 4 steps

1. **Add to Claude Code** — paste the config snippet above (30 seconds)
2. **Call `get_my_agent`** — get your dashboard link, API key, and a health snapshot
3. **Call `log_interaction` after every external tool call** — every lens depends on these signals
4. **Call `summarize_my_agent` after a session** — see where your time went

Not sure where you are? Call `getting_started` for a personalised checklist.

## Add to Any Agent (SDK)

```bash
npm install @tethral/acr-sdk    # TypeScript/Node.js
pip install tethral-acr          # Python
```

```typescript
import { ACRClient } from '@tethral/acr-sdk';

const acr = new ACRClient();

// Register your agent's composition
const reg = await acr.register({
  public_key: 'your-agent-key-here-min-32-chars',
  provider_class: 'anthropic',
  composition: { skill_hashes: ['hash1', 'hash2'] },
});

// Log an interaction (this is the foundation — everything else flows from this)
await acr.logInteraction({
  target_system_id: 'mcp:github',
  category: 'tool_call',
  status: 'success',
  duration_ms: 340,
});

// Query the friction lens of your profile
const friction = await acr.getFrictionReport(reg.agent_id, { scope: 'day' });

// Check for anomaly signal notifications
const notifs = await acr.getNotifications(reg.agent_id);
```

## What Agents See

### Friction lens output (example)
```
Friction Report for anthropic-amber-fox (day)

── Summary ──
  Interactions: 847
  Total wait: 132.4s
  Friction: 14.2% of active time
  Failures: 12 (1.4% rate)

── Top Targets ──
  mcp:github (mcp_server)
    214 calls | 38.1% of wait time
    median 280ms | p95 1840ms
    vs population: 42% slower than baseline (volatility 1.8)
```

### Jeopardy notification (example)
```
You have 1 unread notification:

[HIGH] Component in your composition reported anomalies
   A skill in your current composition has been reported with
   suspicious activity across multiple agents in the network.
   Review with your operator before continuing use.
```

## MCP Tools

| Tool | What it does |
|------|-------------|
| `log_interaction` | Log an interaction — the foundation for everything |
| `get_friction_report` | Query the friction lens of your interaction profile |
| `get_interaction_log` | Raw interaction history with network context |
| `get_network_status` | The COVID-tracker / HIBP view for agent infrastructure |
| `get_my_agent` | Your agent identity and registration state |
| `check_environment` | Active compromise flags and network health on startup |
| `get_notifications` | Unread anomaly signal notifications for your composition |
| `acknowledge_threat` | Acknowledge a notification after reviewing it |
| `update_composition` | Update your composition without re-registering |
| `register_agent` | Explicit registration (auto-registration is default) |
| `check_entity` | Ask the network what it knows about a skill/agent/system |
| `get_skill_tracker` | Adoption and anomaly signals for tracked skills |
| `get_skill_versions` | Version history for a skill hash |
| `search_skills` | Query the network's knowledge of a skill by name |

## Architecture

```
Agents (Claude, OpenClaw, custom)
  |
  +--> MCP Server (@tethral/acr-mcp)
  |      or SDK (@tethral/acr-sdk / tethral-acr)
  |
  +--> Resolver API (Cloudflare Workers, edge-cached)
  |      Lookups, composition checks, notification feed
  |
  +--> Ingestion API (Vercel serverless)
  |      Registration, interaction receipts, friction queries, notifications
  |
  +--> CockroachDB (distributed SQL)
  |      Interaction profiles, agent registry, skill observation data
  |
  +--> Background Jobs
         Skill observation crawlers
         Anomaly signal computation
         Friction baseline computation
         Notification dispatch
```

## Data Collection

ACR collects **interaction metadata only**: target system names, timing, status, chain context, and provider class. No request/response content, API keys, prompts, or PII is collected. Your interaction profile is visible only to you. Population baselines use aggregate statistics.

[Full terms](https://acr.nfkey.ai/terms)

## Privacy Policy

**What we collect:**
- Target system names (e.g., `mcp:github`, `api:stripe.com`)
- Interaction timing (duration, timestamps, queue wait, retry count)
- Interaction status (success, failure, timeout, partial)
- Agent provider class (e.g., `anthropic`, `openai`)
- Composition hashes (SHA-256 of SKILL.md content)
- Chain context (`chain_id`, `chain_position`, `preceded_by`)
- Agent-reported anomaly flags (category only, no payload)

**What we do NOT collect:**
- Request or response content/payloads
- API keys, tokens, or credentials
- Prompts, completions, or conversation content
- Personally identifiable information (PII)
- File contents or user data
- Agent owner identity (we intentionally don't track the human behind the agent)

**Data usage:**
- Your interaction profile: visible only to the agent that generated it
- Population baselines: aggregated statistics, no individual data shared
- Jeopardy notifications: delivered to agents whose composition is affected
- Skill observation: only publicly available skill metadata is indexed

**Data retention:**
- Interaction receipts: 90 days, then archived to daily summaries
- Skill observation data: retained while the skill is observed
- Notifications: retained for 90 days
- Agent registrations: soft-expired after 90 days of inactivity

**Third-party sharing:** None. ACR does not sell, share, or transfer interaction data to third parties.

**Contact:** security@tethral.com

[Full terms](https://acr.nfkey.ai/terms)

## Run the Test Harness

```bash
node scripts/test-agent-lifecycle.mjs
```

Simulates a full agent lifecycle: register, log interactions, query the friction lens, check for notifications.

## Development

```bash
pnpm install                    # Install dependencies
pnpm build                      # Build all packages
pnpm test:unit                  # Run unit tests
node scripts/run-migration.mjs up      # Run DB migrations
node scripts/test-agent-lifecycle.mjs  # Run integration test
```

## License

MIT

## Links

- **API**: https://acr.nfkey.ai
- **npm (MCP)**: [@tethral/acr-mcp](https://www.npmjs.com/package/@tethral/acr-mcp)
- **npm (SDK)**: [@tethral/acr-sdk](https://www.npmjs.com/package/@tethral/acr-sdk)
- **PyPI**: [tethral-acr](https://pypi.org/project/tethral-acr/)
