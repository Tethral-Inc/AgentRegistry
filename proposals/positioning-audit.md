# ACR Positioning Audit & Enhancement Backlog

**Date:** 2026-04-10
**Purpose:** Reconcile marketing claims with verified code reality; reframe positioning around the actual primary value (friction analysis); enumerate security enhancements needed before "safety registry" claims are defensible.

---

## Part 1: What ACR Actually Is (Code-Verified)

### Value hierarchy by code weight

| Rank | Feature | Lines | Status |
|------|---------|-------|--------|
| 1 | **Friction analysis** | ~1,000+ | Production-quality. Biggest feature. |
| 2 | **Skill catalog / discovery** | ~645 | Working. 354 skills indexed. |
| 3 | **Interaction logging (core ingest)** | ~148 | Working. No auth (see gaps). |
| 4 | **Threat content scanning** | ~400 (scanner + backfill) | Regex-only. Catches obvious threats. |
| 5 | **Network health / anomaly aggregation** | ~350 | Working. Threshold-based. |
| 6 | **Agent identity / registration** | ~300 | Working. Auto-registers. |

### The actual product

ACR is **an observability and friction analysis network for AI agents**, with secondary features for skill discovery and community-sourced threat signals.

- **Primary value:** Answer "what's costing my agent the most time and money?" with real data from logged interactions — bottlenecks by target, chain analysis, retry overhead, population baselines, directional friction.
- **Secondary value:** Searchable catalog of 354 crawled AI agent skills with threat pattern scores.
- **Tertiary value:** Community-sourced threat signals from agents that report anomalies on skills they've used.

---

## Part 2: Claim Audit

Each claim is graded:
- ✅ **DEFENSIBLE** — matches code
- ⚠️ **OVERSTATED** — partially true, needs softening
- ❌ **NOT DEFENSIBLE** — remove or rewrite

### Root README current claims

| Current Claim | Grade | Evidence / Fix |
|---------------|-------|----------------|
| "**The safety registry for AI agent skills**" | ⚠️ | "Safety" implies stronger protections than the code provides. Reframe as "observability + threat signal network." |
| "Think VirusTotal for agent ecosystems" | ❌ | VirusTotal runs 70+ AV engines + sandboxed execution. ACR runs 20 regex patterns. Remove this analogy. |
| "403+ skills indexed" | ❌ | Actual count is **354**. Update. |
| "Content security scanning — 20+ threat patterns detect prompt injection, data exfiltration, code execution before you install" | ✅ | True — `content-scanner.ts` has 20 patterns covering these categories. Keep. |
| "Blocked skills — dangerous content is redacted and blocked. Agents are warned." | ⚠️ | Redaction happens at API-view time only (`skill-catalog.ts:414-425`). DB row is intact. Reword to "Flagged skills with critical findings have their content redacted from API responses." |
| "Friction reports — what's costing your agent the most time and money" | ✅ | True and well-implemented (507 lines in `friction.ts`). Promote this to the lede. |
| "Threat notifications — agents subscribed to their installed skills get alerted when threats are detected" | ✅ | `notifications.ts` + `threat-feed.ts` implement this. Keep. |

### packages/mcp-server/README claims

| Current Claim | Grade | Evidence / Fix |
|---------------|-------|----------------|
| "Safety registry for AI agent skills" | ⚠️ | Same as above. |
| "search 403+ skills" | ❌ | 354. Update. |
| "detect threats, block dangerous content" | ⚠️ | Reword: "Flag skills with known threat patterns; block content at the API layer for critical findings." |

### server.json description

| Current | Grade | Fix |
|---------|-------|-----|
| "Safety registry for AI agent skills. Search 403+ skills, detect threats, block dangerous content, get friction reports, track interaction chains." | ⚠️ | Reframe: "Friction analysis and skill reputation network for AI agents. Log interactions, get friction reports, analyze chain overhead, search 350+ crawled skills, check skills against community threat signals." |

---

## Part 3: Reframed Positioning

### One-sentence pitch

> **ACR is a friction analysis and skill reputation network for AI agents — see what's costing your agents the most time and money, and check skills against community threat signals before installing them.**

### Three-line pitch

> ACR answers two questions for anyone running AI agents:
> 1. **Where is my agent wasting time?** Friction reports break down bottlenecks by target system, retry overhead, chain analysis, and how your agent compares to the population baseline.
> 2. **Is this skill safe to install?** 354+ skills crawled from npm and GitHub, scanned for 20+ known threat patterns, with community-sourced anomaly reports from agents that have used them.

### Feature list (reordered)

1. **Friction analysis** (core)
   - Bottleneck detection by target system
   - Chain overhead analysis (multi-step workflows)
   - Retry and failure tracking
   - Population baselines (how you compare to other agents using the same targets)
   - Directional friction (does calling A slow down B?)

2. **Interaction logging** (foundation)
   - Zero-config agent identity
   - Automatic middleware instrumentation
   - Chain tracking with `chain_id` / `preceded_by`
   - Transport-aware (stdio / HTTP)

3. **Skill discovery** (catalog)
   - 354 skills crawled from npm and GitHub
   - Full-text search with filters (source, category, threat level)
   - Version history tracking
   - Quality and scan score metadata

4. **Threat signals** (reputation layer)
   - 20 regex patterns scan every crawled skill for prompt injection, data exfil, code execution, obfuscation
   - Community anomaly reports surface skills with suspicious behavior in the wild
   - Hardcoded known-bad list for egregious threats
   - Notifications when installed skills get flagged

---

## Part 4: Security & Enhancement Backlog

### Verified gaps (code-confirmed)

These are limitations of the current implementation, not theoretical risks.

#### Critical gaps

1. **No receipt authentication** (`receipts.ts:17-44`)
   - `emitter.agent_id` is taken verbatim from the request body
   - No JWT verification, no signature check
   - Impact: anyone can submit receipts claiming to be any agent; threat signals can be poisoned by fake anomaly reports
   - **Fix:** Ed25519 receipt signing by agents, verify against registered public key

2. **Rate limit is per-IP, not per-agent** (`rate-limiter.ts:44-49`)
   - Keyed on `x-forwarded-for` header (spoofable)
   - 100 req/min per IP
   - Impact: an attacker with 100 IPs × 100 agents can submit 10,000 receipts/min
   - **Fix:** Per-agent-id rate limit in addition to per-IP

3. **No receipt deduplication**
   - Receipt ID is deterministic from `(agent_id, target, timestamp_ms)` but timestamp is client-supplied
   - Attacker can submit near-duplicate receipts at different millisecond timestamps to inflate counts
   - **Fix:** Dedupe by `(agent_id, target, category)` per hour; reject replays

#### High gaps

4. **Scan score is cumulative, not threshold-based** (`content-scanner.ts:35-40`)
   - Skill with 1 critical finding = 75 (warned)
   - Skill with 13 low findings = 0 (blocked)
   - Impact: a skill with real exfil code may score higher than a skill missing its author field
   - **Fix:** Threshold-based logic — ANY critical finding → blocked regardless of other score

5. **Block is view-time only** (`skill-catalog.ts:414-425`)
   - Only `skill_content` field is nulled in API response
   - Raw content remains in the database
   - Impact: DB compromise or unprotected endpoint exposes everything
   - **Fix:** Delete content from `skill_catalog.skill_content` on block; keep only hash for re-detection

6. **No AST analysis**
   - Regex alone is trivially bypassed by whitespace, comments, unicode, base64
   - Impact: determined attackers can publish malicious skills that pass scanning
   - **Fix:** Add JS/TS/Python AST parsing for `eval`, `exec`, `spawn`, `process.env`, dynamic `require`/`import`

#### Medium gaps

7. **No human review / curation**
   - All skills auto-crawled from npm and GitHub
   - Impact: typosquatting and brand-new malicious packages enter the catalog immediately
   - **Fix:** Optional "verified" tier with human review, or quarantine period for brand-new skills

8. **No retroactive removal protocol**
   - If a skill is discovered malicious post-publish, there's no SLA or mechanism to notify agents that installed it
   - **Fix:** Notification + versioned threat advisories

9. **PyPI and Clawhub crawlers empty**
   - Both sources show 0 skills in the catalog
   - Either the crawlers aren't running or they haven't found content
   - **Fix:** Verify crawler schedules in Vercel cron or Cloudflare Workers

10. **Hardcoded threat intel list** (`clawhub-crawl.ts:3-11`)
    - `known_malicious_authors`, `known_c2_ips` are hardcoded
    - Impact: can't update without a code push; ignores dynamic network signals
    - **Fix:** Move to a threat feed table that's updated from network signals and external feeds

### Future enhancements (not gaps, but worth doing)

11. Friction tier: **seed systems catalog** with well-known API targets (GitHub, Stripe, OpenAI, Anthropic, AWS) so `check_entity` returns useful metadata from day one, even before agents have logged traffic against them.

12. Friction tier: **Per-model baselines** — break down friction comparisons by LLM provider (Claude vs GPT vs Gemini) to show which models are most efficient against each target.

13. Skill tier: **Verified badges** for skills from known-good authors (e.g., official MCP servers from `modelcontextprotocol` org).

14. Spec: **Follow up on `priorityHint` proposal** once it lands, migrate from `_meta.priorityHint` to the standardized annotation field.

---

## Part 5: Doc Changes Required

Files that need updating for honest positioning:

1. **`README.md`** (root) — reframe intro, fix "403+" → "354", remove VirusTotal analogy
2. **`packages/mcp-server/README.md`** — same
3. **`server.json`** — update description for Official Registry
4. **`smithery.yaml`** — check for description field
5. **`packages/mcp-server/package.json`** — check description field
6. **Landing page** (if exists at `public/` or similar) — same reframe

All updates will:
- Lead with friction analysis
- Mention skills as the catalog/discovery feature
- Present threat detection as community signals + regex scanning, not "safety registry"
- Use accurate numbers (354)
- Link to this document for the honest breakdown
