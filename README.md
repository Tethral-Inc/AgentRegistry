# ACR — Agent Composition Records

**A behavioral registry for AI agents.** ACR captures every external tool call your agent makes, compiles those signals into an interaction profile, and shows you where the time went — starting with a readout card at the end of every session.

[![npm](https://img.shields.io/npm/v/@tethral/acr-hook)](https://www.npmjs.com/package/@tethral/acr-hook)
[![npm](https://img.shields.io/npm/v/@tethral/acr-mcp)](https://www.npmjs.com/package/@tethral/acr-mcp)
[![npm](https://img.shields.io/npm/v/@tethral/acr-sdk)](https://www.npmjs.com/package/@tethral/acr-sdk)

## Get started (60 seconds, Claude Code)

```bash
npm i -g @tethral/acr-hook && acr-hook init
```

That's the whole setup. The hook mints an identity for your agent (no account, no API key to manage), wires itself into Claude Code's tool hooks, and captures every tool call automatically. When your next session ends, a card prints in your terminal:

```
── ACR session card ──
  142 tool calls | 4.1% of active time waiting
  Top sinks: platform:bash 38s · mcp:github 12s
  Full report: https://dashboard.acr.nfkey.ai/agents/…
```

Uninstall any time with `acr-hook remove` (restores your settings backup).

## What ACR is

ACR is an **interaction profile registry**. Agents log what they do (tool calls, API requests, MCP interactions); those signals compile into a behavioral profile you query through **lenses** — each lens a different way of reading the same underlying receipts.

The **friction lens** is the first one shipped: per-target latency and failure breakdowns, time sinks, trend against your own history. More lenses exist for coverage, revealed preference (declared vs actually-used composition), failures, trends, and stability.

ACR is **not a security product**. It doesn't evaluate skills, test for compromise, or block anything. It records events and propagates notifications: if the network observes anomaly signals on a component in your agent's composition, your agent gets a notification. You decide if it matters.

## What works today vs. what grows with the network

ACR is honest about its own maturity. Every lens tells you which of three states it's in: real data, not-enough-data (with the action that changes it), or degraded (a query failed — rendered as *unavailable*, never as a healthy zero).

**Works on day one, fleet of one:**
- Automatic capture of every tool call (timing, status, target) via the hook
- The friction lens on your own data: time sinks, per-target latency/failure, session cards
- Trend against your own history (this week vs last)
- Coverage: which signals you're populating, and which lenses that unlocks

**Lights up as the network grows** (population features are gated on a minimum of 5 persistent agents per target — below that, lenses say "you are the baseline" instead of inventing a comparison):
- Population baselines ("42% slower than the network on `api:openai.com`")
- Network status: system health across the fleet, worst-first
- Anomaly signal notifications: ≥3 distinct agents reporting anomalies on ≥20 interactions of a component you declare → you get notified

**What the hook cannot see** (and the lenses say so instead of showing zeros):
- Deep failures — the hook observes surface errors only; network/timeout/auth failures that never reach the tool-result boundary don't appear. `0 failures` means `0 visible failures`.
- Retry counts, queue wait, chain structure, token usage — only agents that call `log_interaction` with those fields populate them. Hook-only profiles render those sections as **n/a**, not as clean zeros.

## Add the MCP server (optional, for querying lenses from inside your agent)

The hook captures; the MCP server lets your agent *read* its own profile and log richer signals. One command in Claude Code:

```bash
claude mcp add acr -s user -- npx -y @tethral/acr-mcp@latest
```

Or for any MCP client (Cursor, Continue, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "acr": {
      "command": "npx",
      "args": ["-y", "@tethral/acr-mcp@latest"]
    }
  }
}
```

The hook and the MCP share the same identity file — either bootstraps the other. Not sure where to start? Call `orient_me`.

### Core MCP tools

| Tool | What it does |
|------|-------------|
| `orient_me` | Where am I, what should I do next — state-aware routing |
| `log_interaction` | Log an interaction with rich fields (retry_count, chain_id, tokens_used…) |
| `get_friction_report` | The friction lens: where time and tokens go |
| `summarize_my_agent` | End-of-session summary |
| `get_notifications` | Unread anomaly-signal notifications for your composition |
| `get_my_agent` | Identity, dashboard link, registration state |

Beyond these, the server exposes the full lens set (`get_coverage`, `get_trend`, `get_revealed_preference`, `get_failure_registry`, `get_composition_diff`, `get_stable_corridors`, `get_network_status`, `check_environment`, `whats_new`, …), composition management (`register_agent`, `update_composition`, `acknowledge_signal`), and the skill registry (`search_skills`, `check_entity`, `get_skill_tracker`, `get_skill_versions`, `set_watch`).

## Add to any agent (SDK)

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

// Log an interaction (the foundation — every lens reads these)
await acr.logInteraction({
  target_system_id: 'mcp:github',
  category: 'tool_call',
  status: 'success',
  duration_ms: 340,
});

// Query the friction lens
const friction = await acr.getFrictionReport(reg.agent_id, { scope: 'day' });

// Check for anomaly signal notifications
const notifs = await acr.getNotifications(reg.agent_id);
```

## Anomaly signal notifications

An **anomaly signal** is a behavioral pattern observed across multiple unrelated agents — not a security alert. When you register (or update your composition), ACR subscribes you to the components you declare. If the network later observes elevated anomaly signals on one of them — at least 3 distinct reporting agents across at least 20 interactions — a notification is delivered to your agent:

```
[HIGH] Component in your composition reported anomalies
   3 agents reported anomalies across 41 interactions.
   Anomaly rate: 34.1%. Review with your operator before continuing use.
```

This path is exercised end-to-end in CI (see `scripts/db-contract-test.mjs`): seeded anomaly reports on a subscribed skill must produce a notification, or the build fails. ACR doesn't track the human behind an agent, so notifications reach the agent, not the owner.

## The skill registry

ACR observes skills that already exist in public registries (npm, GitHub) and tracks behavioral signals tied to them: adoption counts, anomaly signals, version history. It is not a catalog you install from and not a security check — it records what the network observed. Search ranks signal-bearing skills first; catalog entries without a usable identity are rejected at crawl time.

## Architecture

```
Agents (Claude, OpenClaw, custom)
  |
  +--> Capture hook (@tethral/acr-hook — primary capture path)
  |      PreToolUse/PostToolUse receipts, SessionEnd card
  |
  +--> MCP Server (@tethral/acr-mcp) or SDK (@tethral/acr-sdk / tethral-acr)
  |      Lens queries, log_interaction, notifications
  |
  +--> Resolver API (Cloudflare Workers, edge-cached)
  |      Lookups, composition checks, notification feed
  |
  +--> Ingestion API (Vercel serverless)
  |      Registration, interaction receipts, lens queries, notifications
  |
  +--> CockroachDB (distributed SQL)
  |      Interaction profiles, agent registry, skill observation data
  |
  +--> Scheduled jobs (GitHub Actions -> /api/cron/*)
         system-health aggregation + chain analysis (15 min)
         skill signal computation + watch evaluation + pattern detection (30 min)
         friction baselines + data archival + agent expiration (daily)
         Every run writes a heartbeat; /health reports pipeline liveness
         separately from network activity.
```

## Data collection

ACR collects **interaction metadata only**: target system names, timing, status, chain context, and provider class. No request/response content, API keys, prompts, or PII. Your interaction profile is visible only to you; population baselines use aggregate statistics over persistent agents.

**What we collect:** target system names (`mcp:github`, `api:stripe.com`), interaction timing (duration, timestamps, queue wait, retry count), interaction status, agent provider class, composition hashes (SHA-256 of SKILL.md content), chain context, agent-reported anomaly flags (category only).

**What we do NOT collect:** request/response payloads, credentials, prompts or completions, PII, file contents, or the identity of the human behind the agent.

**Retention** (enforced by the scheduled `data-archival` and `agent-expiration` jobs): interaction receipts 90 days then archived to daily summaries; notifications 90 days; agent registrations soft-expired after 90 days of inactivity; skill observation data retained while the skill is observed.

**Third-party sharing:** none. **Contact:** security@tethral.com · [Full terms](https://acr.nfkey.ai/terms)

## Test harnesses

```bash
node scripts/test-agent-lifecycle.mjs   # full agent lifecycle against the live API
node scripts/e2e-smoke.mjs              # do -> read-back loop through the default lens (runs in CI on schedule)
node scripts/db-contract-test.mjs       # every migration, cron, and lens against a real CockroachDB (runs in PR CI)
```

The db-contract harness exists because unit tests mock the database while production runs CockroachDB — dialect differences broke the same lens query three separate times before it was added. Every lens route must return 200, non-degraded, and counts that match the seeded data; the notification promise is asserted end-to-end.

## Development

```bash
pnpm install                    # Install dependencies
pnpm build                      # Build all packages
pnpm test:unit                  # Run unit tests
node scripts/run-migration.mjs up      # Run DB migrations
```

**Release rule:** changing `packages/mcp-server`, `packages/acr-hook`, or an SDK requires a version bump (PR CI enforces it), and merges to master auto-publish any bumped package. A merged fix that never ships to npm is a fix that never happened.

**Optional: dogfood ACR while working on this repo.** Copy [`.mcp.json.example`](.mcp.json.example) to `.mcp.json` and any MCP-aware client opening this directory will load the published `@tethral/acr-mcp`. Opt-in by design: `.mcp.json` is gitignored so contributors are never enrolled implicitly. To test local MCP changes, point `command` at `node` and `args` at `./packages/mcp-server/dist/cli/stdio.js` after `pnpm build`.

## License

MIT

## Links

- **API**: https://acr.nfkey.ai
- **npm (hook)**: [@tethral/acr-hook](https://www.npmjs.com/package/@tethral/acr-hook)
- **npm (MCP)**: [@tethral/acr-mcp](https://www.npmjs.com/package/@tethral/acr-mcp)
- **npm (SDK)**: [@tethral/acr-sdk](https://www.npmjs.com/package/@tethral/acr-sdk)
- **PyPI**: [tethral-acr](https://pypi.org/project/tethral-acr/)
