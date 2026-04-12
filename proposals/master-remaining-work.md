# Master Remaining Work — Single Source of Truth

**Created:** 2026-04-11
**Last updated:** 2026-04-12
**Purpose:** Full system audit and cleanup inventory. If context is lost, start here.

---

## What's done

| What | Commit | Status |
|------|--------|--------|
| Item 1 — Category schema migration | `77f9680` | Done |
| Item 2 — Two-source composition capture | `3abc3ff` | Done |
| Item 3 — Composition update cadence | `2959bd5` | Done |
| Item 4 — Attribution phrasing + maturity | `32ed41d` | Done |
| Item 5 — 60s correlation window | `1eba3c1` | Done |
| Alignment round 1 — synthetic labels, server-side narrative | `97fa135` | Done |
| Alignment round 2 — inherited label consumers, content gating, resolver synthesis | `797787c` | Done |
| Round 3a — MCP presenter tools (11 files) | `8f69b99` | Done |
| Round 3b — Ingestion API + resolver API routes (8 files) | `8a04a57` | Done |
| Round 3c — Intelligence job producers (4 files) | `3030154` | Done |
| Round 3d — Dashboard, SDKs, docs (11 files) | `ba90a56` | Done |
| Round 4 — Test harness fix (144/144 green) | `b35a9c2` | Done |

---

## Design decisions — ALL DECIDED 2026-04-11

ACR's job is to understand the interaction profile of AI agents. It is not a threat detector. The semantics around "threat" and "health" are synthetic judgments ACR has no business making.

### D1: Drop `threat_level` and `health_status` DB columns. ✅ DECIDED

Drop them. Migration to remove. The raw signals they were derived from (`anomaly_signal_count`, `anomaly_signal_rate`, `failure_rate`, `agent_count`) already exist in the same tables. Clean all consumers first, then migrate.

### D2: `threat_level` replacement → raw signals already in the DB. ✅ DECIDED

`anomaly_signal_count`, `anomaly_signal_rate`, `agent_count` (distinct reporters). Consumers see numbers. No enum.

### D3: `health_status` replacement → raw signals already in the DB. ✅ DECIDED

`failure_rate`, `anomaly_rate`, `distinct_agent_count`, `median_duration_ms`. Already in the table.

### D4: "jeopardy" → "anomaly signals". ✅ DECIDED

Not a threat, not jeopardy, not a warning. ACR observed anomaly signals from the network. That's the term.

### D5: `threat-feed.ts` → rewrite as "skills with elevated anomaly signals". ✅ DECIDED

Filter by `anomaly_signal_count > 0` or let client specify a threshold. Rename the endpoint.

### D6: `resolver-api/threats.ts` → same treatment. ✅ DECIDED

Rename, filter by raw signal threshold, or merge into skill lookup. No "threats" endpoint — there are no threats, there are observations.

### D7: `quality_score` → replace with raw booleans. ✅ DECIDED

`has_name`, `has_description`, `has_version`, `has_author`, `content_length`. The weighted sum hides the inputs. Let the client see what's there and what's missing.

### D8: `scan_score` and `threat_patterns` → keep, label as external scanner output. ✅ DECIDED

ACR didn't produce them. Return them clearly attributed: `scanner_output: { score, patterns }`. ACR is passing through what another tool said, not making the claim itself.

### D9: SDK → keep. ✅ DECIDED

Use cases: Phase 2 Claude Code plugin, non-MCP agents, CI/CD pipelines. SDKs must be cleaned alongside the APIs they consume.

### D10: `maturity_state` → replace with raw numbers. ✅ DECIDED

Return `total_receipts`, `distinct_targets`, `days_active`. The client renders a progress bar if it wants. ACR doesn't decide when a profile is "mature" — it reports how much data it has.

---

## The two synthetic label producers

Everything flows from two intelligence jobs. They are the source.

### Producer 1: `intelligence/anomaly/skill-threat-update.ts`

**Writes:** `skill_hashes.threat_level`

**Hidden thresholds (lines 24-30):**
```
critical:  reporterCount >= 50 AND anomalyRate >= 0.60
high:      reporterCount >= 25 AND anomalyRate >= 0.40
medium:    reporterCount >= 10 AND anomalyRate >= 0.25
low:       reporterCount >=  3 AND anomalyRate >= 0.10
none:      everything else
```

**Also writes:** `anomaly_signal_count`, `anomaly_signal_rate`, `agent_count`, `interaction_count` — these are raw.

**Also triggers:** Notifications to subscribed agents for high/critical (lines 161-181).

### Producer 2: `intelligence/anomaly/system-health-aggregate.ts`

**Writes:** `system_health.health_status`

**Hidden thresholds (lines 15-20):**
```
flagged:    anomalyRate >= 0.30
unhealthy:  failureRate >= 0.15 OR anomalyRate >= 0.15
healthy:    failureRate < 0.05 AND anomalyRate < 0.05
degraded:   everything else
```

**Also writes:** `failure_rate`, `anomaly_rate`, `anomaly_signal_count`, `median_duration_ms` — these are raw.

### Producer 3: `intelligence/maintenance/skill-catalog-crawl.ts`

**Writes:** `skill_catalog.threat_level`, `skill_catalog.quality_score`, `skill_catalog.scan_score`, `skill_catalog.threat_patterns`

**Hidden rules:**
- `threat_level`: critical if in KNOWN_BAD list or scanner says critical; else mirrors scanner severity
- `quality_score`: weighted sum (name +10, description +20, version +15, author +10, tags +5, category +5, requires +5, content +10, no threats +10)
- `scan_score` and `threat_patterns`: passthrough from external scanner
- Also sets `status = 'flagged'` if threat_level is critical/high

**Also writes:** `skill_name`, `version`, `author`, `description`, `tags`, `category`, `content_snippet` — these are raw metadata.

### Producer 4: `intelligence/maintenance/clawhub-crawl.ts`

Same pattern as skill-catalog-crawl — INSERT/UPDATE `threat_level` on crawled skills.

---

## All consumers, by layer

### Layer 1: MCP Presenter Tools (11 files)

These render data to agents. Highest user visibility.

| File | Synthetic output | Line(s) |
|------|-----------------|---------|
| `acknowledge-threat.ts` | "jeopardy" in description | desc |
| `check-environment.ts` | `threat_level.toUpperCase()` badge, "jeopardy" in desc, "No active threats detected" | 26, desc, 29 |
| `check-entity.ts` | "Exercise caution" advice, `blocked_reason` conditional, "This is the latest version" verdict | 55, 89, 98 |
| `get-friction-report.ts` | "jeopardy notifications" in desc | desc |
| `get-interaction-log.ts` | `health_status.toUpperCase()` badge, STATUS_TRANSLATIONS lookup, ANOMALY_TRANSLATIONS lookup, "within normal range" verdict | 187, 128, 176, 154-164 |
| `get-network-status.ts` | `health_status.toUpperCase()` badge, `threat_level.toUpperCase()` badge, "jeopardy" in desc, stale warning | 40, 60, desc, 24 |
| `get-notifications.ts` | severity emoji badges, severity.toUpperCase(), "jeopardy" in desc, "Review recommended" advice, threat recommendation narrative | 34-35, desc, 42-44 |
| `get-skill-tracker.ts` | `threat_level.toUpperCase()` badge, threat_level filter param, "Cross-provider correlation: YES" verdict | 51, 11-12, 106 |
| `get-skill-versions.ts` | `threat_level.toUpperCase()` badge, "OUTDATED" verdict, "Consider updating" recommendation | 86, 47, 51 |
| `log-interaction.ts` | "jeopardy notifications" in desc, composition staleness narrative | desc, 171-172 |
| `register-agent.ts` | `threat_level.toUpperCase()` badge, "jeopardy" in DATA_NOTICE | 114, 6 |

### Layer 2: Ingestion API Routes (7 files with synthetic labels)

| File | Endpoint | Synthetic field(s) | Line(s) |
|------|----------|-------------------|---------|
| `friction.ts` | GET /agent/:id/friction | `health_status` in target enrichment | 305, 311, 325 |
| `network-skills.ts` | GET /network/skills | `threat_level` in SELECT, response, ORDER BY CASE, filter param | 11-13, 31-33, 44-60 |
| `network-status.ts` | GET /network/status | `health_status` in systems, `threat_level` in threats, `stale` boolean, ORDER BY CASE | 49, 59-65, 89, 96, 98-103 |
| `notifications.ts` | GET/POST subscriptions | `min_threat_level` in subscription table (user-provided, stored) | 159 |
| `threat-feed.ts` | GET /threats/feed | `threat_level` in SELECT + WHERE filter | 39, 50 |
| `receipts-read.ts` | GET /agent/:id/receipts | `health_status` in network context join | 70 |
| `register.ts` | POST /register | `health_status` in briefing, `threat_level` in threats, WHERE filter, narrative description | 136, 154, 169, 174, 176 |

### Layer 3: Resolver API Routes (2 files)

| File | Endpoint | Synthetic field(s) | Line(s) |
|------|----------|-------------------|---------|
| `system-health.ts` | GET /v1/system/:id/health | `health_status` passthrough from DB | 12, 23, 60 |
| `threats.ts` | GET /v1/threats/active | `threat_level` + WHERE IN ('high','critical') gating | 6, 14, 38, 45 |

### Layer 4: Intelligence Jobs (4 files — the producers)

| File | What it writes | Hidden thresholds |
|------|---------------|-------------------|
| `skill-threat-update.ts` | `threat_level` to skill_hashes | reporterCount/anomalyRate matrix |
| `system-health-aggregate.ts` | `health_status` to system_health | failureRate/anomalyRate thresholds |
| `skill-catalog-crawl.ts` | `threat_level`, `quality_score`, status to skill_catalog | scanner + known-bad list + quality weights |
| `clawhub-crawl.ts` | `threat_level` to skill_hashes | same as skill-catalog-crawl |

### Layer 5: Dashboard (4 files)

| File | Synthetic rendering |
|------|-------------------|
| `skills/page.tsx` | ThreatBadge (color-coded threat_level), QualityBar (color-coded quality_score) |
| `skills/[id]/page.tsx` | ThreatBadge, QualityBreakdown ('Good'/'Fair'/'Low'), "blocked by content security scanner" text |
| `internal/page.tsx` | StatusCard ('Healthy'/'Down'), threat_level border colors |
| `lib/api.ts` | Type definitions + query params for both labels |

### Layer 6: SDKs (2 packages)

| File | Synthetic types/methods |
|------|----------------------|
| `ts-sdk/src/types.ts` | `ThreatLevel` enum, `threat_level` in SkillCheckResponse/SkillCatalogEntry/SkillVersionEntry, `health_status` in RegistrationResponse |
| `ts-sdk/src/index.ts` | `checkSkill()` returns threat_level, `getSystemHealth()` returns health_status, `getActiveThreats()` returns threat_level, `searchSkills()` accepts threat_level filter |
| `python-sdk/client.py` | `check_skill()`, `get_system_health()`, `get_active_threats()`, `search_skills(threat_level=...)` |

### Layer 7: Docs and public files (4 files)

| File | Synthetic language |
|------|-------------------|
| `mcp-server/README.md` | "jeopardy notifications", threat_level interpretation guide |
| `openclaw-skill/SKILL.md` | "jeopardy", threat_blocked/threat_warning types, threat_level interpretation |
| `ingestion-api/public/lookup.html` | threat_level color rendering CSS + display |

---

## Clean routes (no synthetic labels)

These routes are already clean — raw data only:

- `health.ts` — liveness check
- `agents.ts` — agent lookup
- `skill-version.ts` — version lookup
- `api-keys.ts` — key management
- `observatory-summary.ts` — raw counts, explicitly comments "no synthetic labels"
- `composition.ts` — composition update
- `profile.ts` — computed deltas but transparent
- `stable-corridors.ts` — transparent filters with `filter_applied` disclosure
- `coverage.ts` — transparent rules with condition/inputs/triggered disclosure
- `trend.ts` — transparent deltas, explicitly comments "no synthetic direction label"
- `failure-registry.ts` — raw failure aggregations
- `receipts.ts` — raw receipt storage + skill signals
- `skill-catalog.ts` — cleaned in round 2 (except scan_score/threat_patterns which are external scanner passthrough)
- `internal-query.ts` — transparent proxy
- `trist.ts` — placeholder (narrative text but it's a stub)

---

## Execution plan

### Round 3a — MCP Presenter Tools
**Scope:** 11 files in `packages/mcp-server/src/tools/`
**What:** Replace all threat_level/health_status badge rendering with raw signal counts. Remove "jeopardy" language. Remove "Exercise caution" / "Review recommended" / "Consider updating" advice text. Remove STATUS_TRANSLATIONS and ANOMALY_TRANSLATIONS lookups. Remove "Cross-provider correlation: YES" verdict.
**Depends on:** D4 (jeopardy replacement term)

### Round 3b — Ingestion API + Resolver API Routes
**Scope:** 9 files
**What:** Drop threat_level and health_status from SELECT/response. Replace with raw signals. Fix WHERE clauses that filter on labels.
**Depends on:** D1 (column fate), D5 (threat-feed survival), D6 (resolver threats survival)

### Round 3c — Intelligence Jobs (Producers)
**Scope:** 4 files
**What:** Stop writing synthetic labels. Keep writing raw signals. Or: expose the thresholds in the response alongside the raw data.
**Depends on:** D1 (column fate), D7 (quality_score), D8 (scan_score)

### Round 3d — Dashboard + SDKs + Docs
**Scope:** ~10 files
**What:** Replace ThreatBadge with raw signal display. Remove threat_level/health_status from SDK types. Rewrite docs.
**Depends on:** All of the above (last layer to change)

### Round 4 — Test Harness
**Scope:** 7 failing tests in `tests/integration/skill-catalog.test.ts`
**What:** Add DB stub/DI for test pool. Options documented in `open-items-plan.md` "Known debt" section.
**Independent of round 3.**

## Completed (as of 2026-04-12)

**Alignment revert complete.** No remaining synthetic label debt.

- Migration 000013 executed against live CockroachDB. Columns dropped.
- notifications.ts updated to use `min_anomaly_signals` (INT) and `severity`.
- open-items-plan.md reconciled.
- Live API verified: zero synthetic labels in any response.

---

## Next: Build roadmap

Priority-ordered. Each item is independent unless noted.

### P0 — Layer 2 MCP presenter tools (biggest gap)

The ingestion API has 5 endpoints that agents cannot reach because no MCP tools exist for them. These are the lenses that make ACR useful as an interaction profile registry. Without them, the only lens is friction.

| MCP tool to build | Endpoint it wraps | What it shows the agent |
|-------------------|-------------------|------------------------|
| `get_profile` | `GET /agent/:id/profile` | Full agent profile: identity, composition summary, composition delta (MCP-observed vs agent-reported), receipt counts, target counts, days active |
| `get_coverage` | `GET /agent/:id/coverage` | Signal coverage: which fields the agent populates on receipts, transparent rules with conditions/inputs/triggered booleans |
| `get_stable_corridors` | `GET /agent/:id/stable-corridors` | Reliable interaction paths: targets with zero failures, low variance, high sample count. Transparent filter thresholds disclosed in response |
| `get_failure_registry` | `GET /agent/:id/failure-registry` | Failure breakdown: per-target failure counts, status codes, error codes, categories, median duration when failed |
| `get_trend` | `GET /agent/:id/trend` | Per-target latency and failure rate deltas over time: current vs previous period, raw percentage change |
| `summarize_my_agent` | Composite: profile + friction + coverage | Single-read overview of the agent's interaction profile across all available lenses |

**Files to create:**
- `packages/mcp-server/src/tools/get-profile.ts`
- `packages/mcp-server/src/tools/get-coverage.ts`
- `packages/mcp-server/src/tools/get-stable-corridors.ts`
- `packages/mcp-server/src/tools/get-failure-registry.ts`
- `packages/mcp-server/src/tools/get-trend.ts`
- `packages/mcp-server/src/tools/summarize-my-agent.ts`
- `packages/mcp-server/src/server.ts` — register the new tools

**Pattern:** Each tool follows the same structure as `get-friction-report.ts`: resolve agent ID, fetch the endpoint, format the response as plain text, return. No computation, no labels, no advice — render raw data.

### P1 — Publish MCP + SDKs

The MCP server has been heavily modified (alignment revert removed all synthetic labels, renamed methods) but hasn't been published. Agents installing `@tethral/acr-mcp` from npm get the old version.

**Tasks:**
- Bump version in `packages/mcp-server/package.json`
- `npm publish` for `@tethral/acr-mcp`
- Bump + publish `@tethral/acr-sdk` (ts-sdk) — `getActiveThreats()` renamed to `getActiveSignals()`, `ThreatLevel` type removed
- Bump + publish `tethral-acr` (python-sdk) — `get_active_threats()` renamed to `get_active_signals()`
- Update installation docs

### P2 — Deploy resolver API to Cloudflare Workers

`packages/resolver-api/src/routes/skill.ts` and `threats.ts` were updated in rounds 2 and 3b. The resolver runs on Cloudflare Workers — separate from Vercel. Needs `wrangler deploy`.

**Tasks:**
- Verify `wrangler.toml` is configured
- `npx wrangler deploy` from `packages/resolver-api/`
- Verify resolver endpoints return clean data (no `threat_level`)

### P3 — Phase 2: Claude Code plugin

Compulsory composition tracking via file watching. Full design in `open-items-plan.md` lines 1058-1175.

**Package:** `packages/claude-code-plugin/`
**What it does:** Watches `~/.claude/settings.json` and `~/.claude/skills/**/*.md` for changes, POSTs composition updates directly to the ingestion API. Separate from the MCP — both talk to the server independently.
**Estimated scope:** 7-10 days focused work.
**Triggers to start:** Paying customer request, high `composition_stale` rates, or new Claude Code hook API.

### P4 — Monetization infrastructure

The friction endpoint has tier gating (`isPaidTier` check in `friction.ts`) but no actual payment flow.

**Tasks:**
- Stripe integration for API key provisioning
- Paid tier unlocks: full top-target list (10 vs 3), baseline comparisons, population drift, directional pairs, retry overhead
- API key management UI (currently just the `/api-keys` route)
- Landing page pricing section

### P5 — Dashboard expansion

The dashboard currently only has the skill catalog browser and an internal metrics page.

**Future pages:**
- Agent profile viewer (wraps `/agent/:id/profile`)
- Friction dashboard (wraps `/agent/:id/friction`)
- Network observatory (wraps `/network/status` and `/network/observatory-summary`)

---

## Infrastructure notes

| Component | Hosting | Deploy method |
|-----------|---------|---------------|
| Ingestion API | Vercel (Hono serverless) | `vercel deploy --prod` or git push (git integration may need reconnecting) |
| Resolver API | Cloudflare Workers | `wrangler deploy` from `packages/resolver-api/` |
| Database | CockroachDB Serverless | Connection string in Vercel production env vars |
| DNS | Cloudflare | `acr.nfkey.ai` proxied through Cloudflare to Vercel |
| MCP Server | npm (`@tethral/acr-mcp`) | `npm publish` from `packages/mcp-server/` |
| TS SDK | npm (`@tethral/acr-sdk`) | `npm publish` from `packages/ts-sdk/` |
| Python SDK | PyPI (`tethral-acr`) | `python -m build && twine upload` from `packages/python-sdk/` |
| Intelligence jobs | TBD (Lambda / Vercel cron) | Not currently deployed on a schedule |
| Dashboard | Vercel (Next.js) | Separate Vercel project or same with path routing |

## Env vars (Vercel production)

| Var | Status | Purpose |
|-----|--------|---------|
| `COCKROACH_CONNECTION_STRING` | Active | DB connection |
| `INTERNAL_QUERY_SECRET` | Active (optional) | Resolver proxy auth, falls back to conn string prefix |
| `SLACK_WEBHOOK_URL` | Placeholder (`YOUR_SECRET_VALUE_GOES_HERE`) | Intelligence job alerts — set a real URL or delete |
| `TETHRAL_SIGNING_KEY_SEED` | Active (optional) | Deterministic JWT signing — set for stable keys across deploys |
