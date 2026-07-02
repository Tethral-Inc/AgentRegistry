# ACR: Claims-vs-Reality Audit, Engineering Spec, and Adoption Plan

**Date:** 2026-07-02
**Method:** Live drive of the production MCP (`@tethral/acr-mcp@2.11.4`, agent `acr_c238e3345772`, 1,247 lifetime receipts), direct curl of `https://acr.nfkey.ai`, Vercel production runtime logs, `origin/master` source (post PR #13, deployed 14:26 UTC today), and CI workflow inspection.
**Verdict in one line:** Capture and identity genuinely work; almost every *interpretive* claim in the README is either broken live, structurally impossible for hook-captured data, or has no scheduled executor — and the failure mode is still "renders as healthy."

---

## Part 1 — Audit: every README claim, verified live

### Claim-by-claim verdicts

| # | README claim | Verdict | Live evidence (2026-07-02) |
|---|---|---|---|
| 1 | "Registers agents — zero-config identity, persistent across sessions" | ✅ **TRUE** | `anthropic-amber-orca`, registered 2026-04-14, 46 days active, hook self-bootstrap + state file works. |
| 2 | "Logs interactions — every external tool call, with timing, status, chain position, anomaly signals" | ⚠️ **HALF** | Timing: yes (618 hook receipts this week). Status: **failures structurally invisible** — 0 failures in 636 calls because the hook only sees surface `is_error` (`acr-hook/src/cli.ts:60-66`); network/timeout/API failures never reach PostToolUse. Chain position, retry, queue wait, tokens: **never populated** — the hook can't emit them ([http.ts:7-27](../packages/acr-hook/src/http.ts)), and nothing calls `log_interaction` in practice. |
| 3 | "Builds interaction profiles" | ✅ **TRUE** | Profile counts are real and consistent with raw receipts. |
| 4 | "Surfaces the friction lens — chain analysis, retry overhead, population drift, directional friction" | ⚠️ **QUARTER** | Per-target latency/wait: works. But **81% of reported "wait time" is human think-time** from legacy receipts (`platform:askuserquestion` 314.7s + `platform:workflow` 302.5s); chain overhead is *always* 0.0s (needs `queue_wait_ms`, hook can't emit it); retry waste *always* empty; directional friction *always* empty; population comparison is "1 agent" (you) for most targets. Three of the five headline features are structurally dead for hook-only capture and render as `0`/`None` instead of "not measurable". |
| 5 | "Anomaly signal notifications — if we observe anomalies affecting a component in your composition, we notify that agent" | ❌ **BROKEN** | Dispatch matches `skill_subscriptions.skill_hash` (SHA-256, auto-subscribed at registration — [register.ts:353](../packages/ingestion-api/src/routes/register.ts)) against signals keyed by **raw target name** (`skill:gh-issues` → `"gh-issues"`, [skill-threat-update.ts:46](../packages/intelligence/anomaly/skill-threat-update.ts)). A name never equals a hash → receipt-driven signals can never reach a subscriber. Additionally `watch-evaluation` (the `set_watch` path) **is not scheduled in any workflow**. Live: `gh-issues` has 4 anomaly signals; my agent has 18 skill subscriptions; notifications received: 0, ever. |
| 6 | (Implicit) "A green lens result means healthy" | ❌ **STILL INVERTED** | `get_coverage` renders **"9 rules Covered — OK" + all counts 0** while `get_profile` says 1,247 receipts — the flagship June-26 false-green, still live *after* PR #13 deployed. Two stacked causes: (a) the fixed SQL **still throws** on prod CockroachDB — `incompatible COALESCE expressions: unsupported binary operator: <float> / <int>` (code 22023, in Vercel logs at 14:35 and 14:39) from the `chain_coverage` expression; (b) the server now correctly returns `degraded: true`, but **the published MCP 2.11.4 predates the degraded renderer** — PR #13 didn't bump the version, so the client fix was never published and every install renders zeros as OK. |
| 7 | "Network status — the HIBP/COVID-tracker view" | ⚠️ **MISLEADING** | 24h totals say 11 agents / 78 interactions; per-system rows say `platform:structuredoutput — 74 agents, 74 interactions` (cumulative rollup presented beside windowed totals, and exactly 1 interaction per agent = ephemeral-agent churn, not a fleet). "DATA MAY BE STALE" banner fires whenever the network is merely *quiet* for 30 min: the freshness probe reads `MAX(last_seen_at)` (= last receipt) and labels it "last aggregation" ([aggregation-freshness.ts:35-55](../packages/ingestion-api/src/helpers/aggregation-freshness.ts)) — a **false-red**: cron ran successfully 10 min before the warning. |
| 8 | "Skill registry that we update continuously" | ⚠️ **POOR** | Search for "pdf" returns 354 results, effectively all `0 agents, 0 interactions`, including junk names like `.claude/skills/api-versioning/SKILL.md` and spam-adjacent entries. The one "elevated anomaly" skill network-wide (`gh-issues`) is 4 signals over 4 interactions — 100% rate from noise-level volume, broadcast to every agent's `check_environment`. |
| 9 | "Data retention: receipts 90 days then archived; registrations soft-expired after 90 days" | ❌ **NOT RUNNING** | `data-archival` and `agent-expiration` handlers exist ([cron.ts:56-57](../packages/ingestion-api/src/routes/cron.ts)) but **no workflow schedules them**. Scheduled jobs are only: system-health-aggregate, chain-analysis (15 min), skill-threat-update (2×/hr), friction-baseline-compute (daily), agent-baseline-compute + agent-anomaly-detect (anomaly-tick). `pattern-detection` and `watch-evaluation` also never run. The privacy policy's retention promises are currently fiction. |
| 10 | Docs/tool-surface accuracy | ❌ **DRIFTED** | README tells users to call `getting_started` (doesn't exist — it's `orient_me`) and lists `acknowledge_threat` (it's `acknowledge_signal`). Quickstart leads with the MCP, but the actual entry point since v0.4.0 is `acr-hook init` (no MCP needed). The architecture diagram's "Background Jobs: notification dispatch" doesn't exist as described (see #5, #9). |

### What actually works today (worth saying plainly)

- **Identity + self-bootstrap** (`acr-hook init`, Ed25519 PoP register, shared state file, no manual API key) — solid.
- **Volume capture** via the hook — real receipts, correct timing, correct target taxonomy post-PR #5/#13.
- **Profile counts** and the raw per-target latency table in friction.
- **CI plumbing** — lens crons fire on schedule, e2e smoke reuses a stable agent (no churn added), deploys work.

### The five systemic root causes

Every finding above traces to one of these; the spec in Part 2 is organized against them.

1. **No dialect-true CI.** Unit tests mock the DB. Production is CockroachDB. The *same coverage query* has now failed three consecutive times for three different dialect reasons (`?` misdiagnosis → `!= '{}'::jsonb` → `float / int` in COALESCE), each error hidden behind the previous one. Nothing in CI would catch a fourth.
2. **Fail-open rendering.** Query error → `.catch → []` → zeros → threshold rules pass vacuously → "Covered — OK" at HTTP 200. PR #13 added `degraded: true` server-side, but the *rules array is still returned alongside it*, so any client that doesn't understand `degraded` (i.e., every published client) still renders false-green. Fail-safe currently depends on a client upgrade that never shipped.
3. **No shared contracts.** Receipts-in-window predicates, target taxonomy, and *skill identity* (name vs SHA-256 hash) are each reimplemented per lens/job. The name-vs-hash split alone kills the product's flagship promise (notifications).
4. **No release discipline.** Server fixes merge and auto-deploy; client fixes (mcp-server, acr-hook) merge **without version bumps** and never reach npm. Result: server and client permanently disagree about the contract. Your own machine runs an unpublished local hook build; everyone else's `0.4.0` lacks the interactive carve-out.
5. **Capability dishonesty at the lens level.** Sections that are structurally impossible for hook-captured data (retry overhead, chain overhead, directional friction) render as `0` / `None` — indistinguishable from "measured and clean" — instead of "not measurable from this capture path."

---

## Part 2 — Engineering spec

Priorities: **P0 = the product is lying until fixed** (this week). **P1 = the product is misleading** (next 2 weeks). **P2 = the product is unpolished.**

### P0-1 · Fix the live coverage query (one line) and sweep for siblings

`packages/ingestion-api/src/routes/coverage.ts` — the `chain_coverage` expression:

```sql
-- broken on CRDB: float / int inside COALESCE
COALESCE(COUNT(*) FILTER (WHERE chain_id IS NOT NULL)::float / NULLIF(COUNT(*), 0), 0)
-- fix: cast both operands and the fallback
COALESCE(COUNT(*) FILTER (WHERE chain_id IS NOT NULL)::float8 / NULLIF(COUNT(*), 0)::float8, 0.0)
```

Then sweep every lens/cron query for the same class: `grep -rn "::float\|COALESCE" packages/ingestion-api packages/intelligence` and normalize all mixed-type divisions and COALESCE branches.

**Acceptance:** live `GET /api/v1/agent/{id}/coverage` returns `degraded: false` and `total_receipts ≈ profile.total_receipts`.

### P0-2 · CI gate against a real CockroachDB

New job in CI: `cockroachdb/cockroach` single-node (`start-single-node --insecure`) as a service container → run all migrations → seed ~50 synthetic receipts (mixed sources, statuses, categories, chains) → **hit every lens route** and assert: HTTP 200, `degraded !== true`, and non-zero counts where seeds guarantee data.

This one job would have caught: GROUPING SETS, multi-COUNT(DISTINCT), the jsonb `!=`, the float/int COALESCE, migration 000011's partial-index predicate, and the stale unique index. Six historical production breaks, one CI job.

**Acceptance:** revert the P0-1 fix locally → CI fails.

### P0-3 · Fail-safe must not require a client upgrade

When `degraded === true`, the server must **not** return an evaluable `rules` array. Return `rules: []` plus `rules_status: "unavailable"` (or 503). Old clients then render an empty/odd state instead of a confident green. Apply the same rule to all 8 degraded-capable lenses.

**Principle to encode in review guidelines:** *a reliability fix that only works on upgraded clients is not shipped.*

### P0-4 · Release discipline for the client packages

- Any PR touching `packages/mcp-server`, `packages/acr-hook`, or the SDKs **must** bump that package's version — enforce with a CI check (`git diff` on package dirs vs version field).
- Publish workflow runs on every master push and publishes any package whose version ≠ npm's `latest`.
- **Immediately:** bump + publish `@tethral/acr-mcp@2.12.0` (degraded renderer) and `@tethral/acr-hook@0.5.0` (interactive carve-out) — both fixes are merged but unpublished, which is why production behavior didn't change today.

### P0-5 · Repair the notification promise (skill identity contract)

Decision: **`skill_hash` is the canonical skill identity everywhere.** Add a `skill_aliases (skill_name → skill_hash)` mapping maintained by the crawler/registry. `skill-threat-update` resolves `skill:<name>` receipt targets through the alias table before grouping; unresolvable names increment a logged/monitored counter instead of silently keying a parallel namespace. Schedule `watch-evaluation` (see P0-6).

**Acceptance (E2E, in CI):** seed an anomaly-flagged receipt on a skill an agent is subscribed to → `skill_notifications` row exists → `get_notifications` shows it. This is the product's flagship claim; it currently has zero end-to-end coverage.

### P0-6 · Schedule the phantom jobs, or delete the claims

Add to `lens-aggregation.yml` routing: `data-archival` + `agent-expiration` (daily, with the 02:15 tick), `watch-evaluation` + `pattern-detection` (hourly). If a job is deliberately not run, delete its handler and the README/privacy claims that depend on it. No handler without a schedule; no claim without a handler.

### P0-7 · Separate "pipeline broken" from "network quiet"

Add `job_heartbeats (job_name, last_run_at, rows_written)` — every cron handler upserts on completion. `check_environment` / network-status then report two independent facts:
- *Aggregation last ran 10 min ago (wrote 0 rows)* — pipeline health, stale only if the heartbeat is old.
- *Last receipt observed 93 min ago* — network activity, reported neutrally, never as a pipeline warning.

Kills today's false-red ("stale" 10 minutes after a successful run).

### P1-8 · One shared receipts-in-window contract

`@acr/shared/receipt-window.ts`: a single exported SQL fragment + TS builder defining the canonical predicate (time column = `created_at`, source semantics incl. `claude-code-hook`, `source != 'environmental'` exclusion, failure = `status != 'success'`). All lenses import it. Add the **count-coherence contract test** to the CRDB CI job: profile, friction, coverage, failure-registry, composition-diff computed over identical seeds must agree on receipt counts. (This was the June audit's 1007/9/15/10/18 divergence; PR #13 narrowed it, the contract prevents regression.)

### P1-9 · Capability-honest friction lens

- Sections needing fields the hook can't emit (retry overhead, chain overhead, directional amplification) render **"n/a — requires log_interaction fields (retry_count / queue_wait_ms / preceded_by); hook capture can't measure this"** instead of `0.0s` / `None`.
- Expand `INTERACTIVE_TOOLS` beyond `{AskUserQuestion, ExitPlanMode}`: add the workflow/task-wait family (live data shows `platform:workflow` at 302s median is human/orchestration wait, currently 40% of the report).
- **One-time backfill** instead of waiting on a TTL that doesn't run: `UPDATE interaction_receipts SET duration_ms = NULL WHERE target_system_id IN ('platform:askuserquestion','platform:exitplanmode','platform:workflow') AND duration_ms > 60000`. Until then, every friction report's top-two lines are think-time.
- State failure-visibility honestly in coverage: a fixed line — *"failure visibility: surface errors only (hook is downstream of Claude Code's error boundary)"* — so 0 failures reads as "0 visible failures."

### P1-10 · Coherent network stats

- Per-system rows and 24h totals must use the same window, or the cumulative rollup must be labeled *"since first observation."*
- Exclude ephemeral agents from population baselines and agent counts: e.g. `HAVING COUNT(*) >= 5 receipts AND age(first_seen) > 24h`. Today "74 agents" ≈ 74 one-shot registrations; baselines computed on churn are noise presented as a population.
- Gate all "you vs network" comparisons on a minimum population of non-ephemeral agents (N ≥ 5); below it, print *"network too small — you are the baseline."*

### P1-11 · Skill registry quality gate

Crawler: reject entries without a plausible name/description (path-like names, empty descriptions), dedupe by hash, store `(hash, name, source)`. Search: rank signal-bearing skills first; `search_skills` should not return 354 zero-signal rows for "pdf". Tracker/`check_environment`: elevate a skill only at `reporters ≥ 3 distinct non-ephemeral agents AND interactions ≥ 20` — today's `gh-issues (4 signals / 4 interactions)` network-wide banner is noise amplification, the exact opposite of HIBP credibility.

### P2-12 · README truth pass

Fix tool names (`orient_me`, `acknowledge_signal`), lead with the hook quickstart, delete or clearly future-tense every capability that isn't verified by the E2E suite (see Part 3 for the rewrite shape). Rule going forward: **a capability may appear in the README only if an E2E test exercises it.** The e2e-smoke pattern (do → read back → assert) is the template; extend it to notifications (P0-5) and coverage.

---

## Part 3 — Make it dead-simple for others

The June work already built the right entry point (`acr-hook init`, self-bootstrap, SessionEnd card, no API key). The remaining problem is **what strangers see**: a README that leads with the wrong path, 30 MCP tools of context cost, lenses that need a fleet the network doesn't have, and empty states indistinguishable from broken states.

### 1. One quickstart, sixty seconds, no decisions

```
npm i -g @tethral/acr-hook && acr-hook init
```

Close the session; the readout card appears. That's the entire pitch and the entire setup. The MCP moves to an "Advanced: query lenses from inside your agent" section. (Today's README leads with the MCP config block and a 4-step checklist referencing a tool that no longer exists.)

### 2. Shrink the default MCP surface: 5 tools, not 30

Thirty tool schemas in every agent's context window is real adoption friction — ironic for a friction-measurement product. Default server exposes: `orient_me`, `log_interaction`, `get_friction_report`, `summarize_my_agent`, `get_notifications`. Everything else (corridors, compensation, composition-diff, watches, skill tools…) loads behind an `ACR_ADVANCED=1` env or a `more_lenses` discovery tool. Power users lose nothing; every new install gets a surface a model can actually choose from.

### 3. Lead with day-one solo value; gate fleet features

Personal observability works with a fleet of one: self-trend (this week vs last), top time sinks, slowest targets, session cards. Population baselines, network status, anomaly propagation need a fleet that doesn't exist yet. Restructure both the README and the default readouts around that split:

- **"What you get today"** — the card, friction-on-your-own-data, trend vs yourself.
- **"What lights up as the network grows"** — baselines, drift, anomaly notifications, with the honest gate from P1-10 ("you are the baseline").

Until then, drop the HIBP/COVID framing from the top of the README — it describes the aspirational network, not the product, and it's the part the audit found most broken (notifications). Credibility with early adopters is the scarce resource.

### 4. Three-state honesty as a product rule

Every lens output is exactly one of: **(a) data** — numbers; **(b) not enough data** — with the one concrete action that changes it; **(c) degraded** — "a query failed; this is not an all-clear." Never zeros-as-OK (P0-3 enforces server-side), never `0.0s` for "can't measure" (P1-9). This is the same discernability promise ACR makes about *agents*, applied to itself.

### 5. Trust plumbing for a telemetry hook

`acr-hook remove` (clean uninstall, restores settings backup), `acr-hook status` (what's captured, where it goes, last receipt), and a working deletion path (`DELETE /api/v1/agent/{id}` honoring the privacy policy — which today promises retention behavior that never runs, P0-6). People will not install an always-on capture hook from a project whose privacy page is aspirational.

### 6. Measure adoption with ACR itself

Success metric: **TTFR — time to first readout** (init → first SessionEnd card), target < 1 session. Instrument the init funnel as ACR receipts (`platform:acr-init` events). Dashboard the funnel: installs → successful init → first card → second-day return. The "fleet problem" is unsolvable blind; this makes it visible.

---

## Suggested sequence

1. **Today:** P0-1 (one-line SQL) + P0-4 publishes (2.12.0 / 0.5.0) — this alone makes the live product stop lying.
2. **This week:** P0-2 CRDB CI, P0-3 fail-safe, P0-6 schedules, P0-7 heartbeats, P0-5 notification keying + E2E.
3. **Next 2 weeks:** P1 batch (shared window contract, friction honesty + backfill, network coherence, registry gate).
4. **Then:** README rewrite + adoption plan (Part 3), which is only credible once Parts 1–2 stop being true.
