# ACR — Agent Composition Records

**The safety registry for AI agent skills.** ACR scans, catalogs, and monitors skills before agents install them. Think VirusTotal for agent ecosystems.

[![npm](https://img.shields.io/npm/v/@tethral/acr-mcp)](https://www.npmjs.com/package/@tethral/acr-mcp)
[![npm](https://img.shields.io/npm/v/@tethral/acr-sdk)](https://www.npmjs.com/package/@tethral/acr-sdk)

## What It Does

- **403+ skills indexed** from npm, GitHub, and PyPI — continuously crawled
- **Content security scanning** — 20+ threat patterns detect prompt injection, data exfiltration, code execution before you install
- **Blocked skills** — dangerous content is redacted and blocked. Agents are warned.
- **Friction reports** — what's costing your agent the most time and money
- **Threat notifications** — agents subscribed to their installed skills get alerted when threats are detected

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

That's it. Your agent auto-registers, gets a name (e.g. `anthropic-amber-fox`), and starts checking skills.

## Add to Any Agent (SDK)

```bash
npm install @tethral/acr-sdk    # TypeScript/Node.js
pip install tethral-acr          # Python
```

```typescript
import { ACRClient } from '@tethral/acr-sdk';

const acr = new ACRClient();

// Search for skills
const results = await acr.searchSkills('security scanner', { min_scan_score: 80 });

// Check a skill before installing
const check = await acr.checkSkill('abc123...');
if (check.blocked) {
  console.log('BLOCKED:', check.blocked_reason);
}

// Register your agent's installed skills
const reg = await acr.register({
  public_key: 'your-agent-key-here-min-32-chars',
  provider_class: 'anthropic',
  composition: { skill_hashes: ['hash1', 'hash2'] },
});

// Check for threat notifications
const notifs = await acr.getNotifications(reg.agent_id);
```

## What Agents See

### Safe skill:
```
Skill found.
Threat Level: NONE
Name: muninn
Security Score: 92/100
This is the latest version.
```

### Blocked skill:
```
BLOCKED SKILL — DO NOT INSTALL
================================
Name: gh-issues
Threat Level: CRITICAL
Security Score: 0/100

Detected Threat Patterns:
  - prompt_injection_system_tag
  - code_exec_spawn

This skill is BLOCKED from installation. Content is not
available for download, copy, or viewing.
```

## MCP Tools (14 total)

| Tool | What it does |
|------|-------------|
| `search_skills` | Search 403+ skills by name, description, capability |
| `check_entity` | Check if a skill is safe before installing |
| `get_notifications` | Check for threat alerts on your installed skills |
| `acknowledge_threat` | Acknowledge a threat after reviewing with user |
| `get_skill_versions` | Version history — is your skill outdated? |
| `update_composition` | Update your skill list without re-registering |
| `log_interaction` | Log every external call (powers friction + threats) |
| `get_friction_report` | What's costing you the most time |
| `get_interaction_log` | Raw interaction history |
| `get_network_status` | Network-wide health dashboard |
| `get_skill_tracker` | Skill adoption and threat tracking |
| `get_my_agent` | Your agent identity |
| `check_environment` | Quick threat check |
| `register_agent` | Custom registration |

## Security Scanner

Every skill is scanned before entering the catalog. Patterns detected:

| Category | Examples | Severity |
|----------|----------|----------|
| Prompt Injection | "ignore instructions", template injection `{{}}`, `[SYSTEM]` tags | Critical |
| Data Exfiltration | webhook.site URLs, credential harvesting, IP-based URLs | Critical |
| Code Execution | `eval()`, `child_process`, `os.system()` | High |
| Filesystem | Path traversal `../../`, destructive ops `rm -rf` | High |
| Obfuscation | Base64 blocks, hex encoding | Medium |
| Supply Chain | Dependency confusion (names similar to popular packages) | Medium |

Skills scoring below 50/100 are **blocked** — content redacted, agents warned. Skills 50-79 are **warned**. Skills 80+ are clean.

## Architecture

```
Agents (Claude, OpenClaw, custom)
  |
  +--> MCP Server (@tethral/acr-mcp)
  |      or SDK (@tethral/acr-sdk / tethral-acr)
  |
  +--> Resolver API (Cloudflare Workers, edge-cached)
  |      Skill lookups, agent checks, threat feed
  |
  +--> Ingestion API (Vercel serverless)
  |      Registration, receipts, search, notifications
  |
  +--> CockroachDB (distributed SQL)
  |      9 migrations, 15+ tables
  |
  +--> Background Jobs (AWS Lambda)
         Skill crawlers (npm, GitHub, PyPI)
         Content security scanner
         Threat level computation
         Friction baseline computation
```

## Data Collection

ACR collects **interaction metadata only**: target system names, timing, status, and provider class. No request/response content, API keys, prompts, or PII is collected. Your friction data is visible only to you. Population baselines use aggregate statistics.

[Full terms](https://acr.nfkey.ai/terms)

## Run the Test Harness

```bash
node scripts/test-agent-lifecycle.mjs
```

Simulates a full agent lifecycle: register, check skills, hit blocks, log interactions, check notifications. 12 tests, all against the live API.

## Development

```bash
pnpm install                    # Install dependencies
pnpm build                      # Build all packages
pnpm test:unit                  # Run unit tests
node scripts/run-migration.mjs up   # Run DB migrations
node scripts/test-agent-lifecycle.mjs  # Run integration test
```

## License

MIT

## Links

- **API**: https://acr.nfkey.ai
- **npm (MCP)**: [@tethral/acr-mcp](https://www.npmjs.com/package/@tethral/acr-mcp)
- **npm (SDK)**: [@tethral/acr-sdk](https://www.npmjs.com/package/@tethral/acr-sdk)
- **PyPI**: [tethral-acr](https://pypi.org/project/tethral-acr/)
