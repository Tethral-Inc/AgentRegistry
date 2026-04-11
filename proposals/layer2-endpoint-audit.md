# Layer 2 Endpoint Audit — ACR × Friction Observer

**Date:** 2026-04-10
**Purpose:** Given ACR's primary charge (map agent interaction signals, then figure out what's valuable for users and what to give away vs charge for), audit what ACR's ingestion API layer currently exposes vs. what the Friction Observer package can produce. Identify which observer outputs can become Layer 2 endpoints, which tier each belongs to, and what a free-tier progression looks like.

**Scope:** The MCP stays thin — this doc is entirely about server-side Layer 2 endpoints the MCP would fetch from. No new tools on the MCP side.

---

## Context: the two products operate differently

| Property | Friction Observer | ACR |
|----------|------------------|-----|
| Input source | Bounded chaos experiments on controlled target pairs | Passive self-reported receipts from agents in the wild |
| Window structure | Baseline → prime → interaction → post (explicit episodes) | Single receipts, optionally linked by `chain_id` |
| Signal depth | Multi-plane: field, field_channels, relational, representation, state, delta | Flat: duration, status, retries, queue_wait, anomaly_flagged, chain position |
| Output timing | Post-hoc from bounded runs | Real-time aggregation over rolling windows |
| Experimental control | Yes (stimulus campaigns, fault injection) | No |
| Canonical TriST claims | Yes (deformation, geometry, memory/order) | Not derivable without episode structure |

**This matters for tiering.** The observer's canonical TriST constructs (deformation profile, interaction shape profile, memory order profile, response geometry profile) **can't be directly computed from ACR's current receipt schema**. They require episode-structured data with explicit baseline/interaction/post windows.

What ACR *can* compute from receipts is closer to the observer's "watch mode" signals plus the operator-facing summaries (`interaction_impact_map`, `operator_hotspots`, `process_ownership_map`, `healthy_corridor_report`, `friction_surface`). Those layers don't require the episode structure — they can be built from receipts + rolling aggregation.

This means:

- **Free/progression tiers** draw from observer concepts that transfer cleanly to receipt-based analysis
- **Premium tier** draws from observer concepts that transfer with adaptation
- **Enterprise / custom tier** requires the agent to submit richer episode-structured data (a new feature), or for Tethral to run experiments against the target on the user's behalf

---

## Observer output inventory

Full list of 29 analysis modules and 25+ named artifacts produced by the Friction Observer. Each is evaluated for whether ACR can produce an equivalent from receipt data alone, produce a simplified version, or requires episode-structured input the MCP doesn't capture.

### Tier A — Transfers cleanly (produce from receipts)

| Observer artifact | What it contains | ACR equivalent available? |
|---|---|---|
| `interaction_profile.json` | feature coverage, maturity_state, coverage_state, interaction episode count | **Yes.** Simplified form: receipt count, distinct target count, scope coverage, maturity state computed from receipt volume |
| `friction_surface.json` | `candidate_friction_surface_0_1`, interaction_overhead_ms aggregates, platform queue/retry/repairs/branches summaries, downstream recovery | **Partially.** Interaction overhead and queue/retry summaries are derivable today. Downstream recovery and branching would need chain-aware aggregation |
| `operator_hotspots.json` | ranked boundary-level hotspots with recommended next tests | **Yes, simplified.** Top targets ranked by wait_time + failure_rate + anomaly_rate. Next-test recommendations would be hardcoded templates initially |
| `healthy_corridor_report.json` | boundaries that are stable and low-friction — the "what's working" surface | **Yes.** Targets below friction threshold AND below anomaly threshold AND above sample count |
| `interaction_catalog.json` | observed interaction patterns | **Yes.** Distinct target_system_id × category combinations |
| `interaction_failure_registry.json` | failure records grouped by pattern | **Yes.** Failure receipts grouped by target + error_code |
| `cost_pattern_catalog.json` | recurring cost patterns | **Yes.** Recurring (target, category, anomaly_category) triples over time |
| `downstream_impact_profile.json` | current_burden vs downstream_burden | **Yes.** Current-target friction vs chain-downstream friction using `chain_id` / `preceded_by` |
| `regime_fingerprint_profile.json` | "does this pattern look novel or match a previous regime" | **Yes.** Time-windowed rolling patterns compared to historical fingerprints |
| `trend_regime_summary.json` | improving / worsening / stable trend state per target | **Yes.** Period-over-period comparison of target aggregates |
| `run_history_index.json` | same topology observed across runs | **Yes.** Distinct daily snapshots per agent per target |
| `collector_recommendations.json` | "you should log X differently" | **Yes.** "Too few receipts with chain_id" → "Add chain tracking" |
| `compatibility_profile.json` | "is the reading comparable enough for claims" | **Yes.** Sample count + maturity thresholds |
| `coverage_profile.json` | data sufficiency | **Yes.** Receipt count, distinct targets, distinct categories |
| `uncertainty_profile.json` | confidence / active information requirements | **Yes.** Derived from sample size and variance |

### Tier B — Requires adaptation (simplified form only)

| Observer artifact | Why adaptation needed | ACR adapted form |
|---|---|---|
| `deformation_profile.json` | Requires baseline/interaction/post windows per pair | **Directional friction from chain_id** already captures part of this: "calling A makes B slower by 2.3x" = observational deformation |
| `degradation_effect_matrix.py` | Requires experimental arms (observe vs modulate) | **Observational form:** cross-provider comparison of same target (does Claude see this target degrade differently than GPT?) |
| `response_variability_profile.json` | Requires response-surface sampling | **Observational form:** p50/p95/p99 of duration + stddev over rolling window |
| `signal_work_map.py` | Requires work ledger from platform_action rows | **Observational form:** aggregate retries + queue_wait across receipts as "where work is piling up" |
| `memory_order_profile.json` | Requires repeated identical sequences with controlled windows | **Observational form:** chain-pattern frequency with per-pattern avg overhead — partial carry-forward signal |
| `environment_profile.json` | Requires hardware/runtime collectors | **Observational form:** provider_class + transport_type + user-agent-style summary from env-detect |
| `intervention_map.py` | Requires declared interventions with before/after markers | **Observational form:** natural changepoints in target metrics with no declared intervention = "degradation detected on date X" |

### Tier C — Doesn't transfer (premium only, if ever)

These require episode-structured input or experimental control that agent self-reporting can't provide:

| Observer artifact | Blocker |
|---|---|
| `interaction_shape_profile.json` | Multi-plane field / relational / representation observation |
| `response_geometry_profile.json` | Mahalanobis distance needs comparable-space learned distribution from controlled trials |
| `response_surface.json` | Full response-as-function-of-stimulus |
| `signal_qualification.json` | Claim-state gating requires control suite to have executed |
| `signal_control_suite.json` | Independent stream controls |
| `experiment_protocol_manifest.json` | Explicit experimental windowing |
| `bounded_chaos_baseline.json` | Calibration lane with chaos injection |
| `interaction_topology_map.json` | Requires stable component topology with hop ordering — partially derivable from chain data but not canonical |
| `proposal_contract_impact.py` | Requires proposal/prime stage distinction |
| `representation_transition.py` | Requires state vs delta plane separation |
| `response_binding_audit.py` | Requires interaction binding ledger |
| `plane_field_inventory.py` | Requires plane frame schema |
| `system_1_profile.json` / `system_2_profile.json` | Dual-system profiling from explicit participant targets |
| `stimulus_response_catalog.json` | Requires stimulus campaign execution |
| `forecast_validation_report.json` | Requires backtesting history and forecast mature enough to evaluate |
| `future_risk_readout.json` | Only meaningful if forecast has evidence backing |
| `upgrade_readiness.json` | Requires deployment state vs target |

---

## Current ACR Layer 2 audit (what exists)

### Endpoints already shipped

| Endpoint | Observer equivalent | Tier split today |
|----------|---------------------|------------------|
| `GET /api/v1/agent/{id}/friction?scope=...` | **interaction_profile + friction_surface + operator_hotspots (partial)** | Free: summary + top 3 targets + by_category + by_transport + by_source + chain_analysis. Paid: top 10 targets with baselines, population_comparison, retry_overhead, population_drift, directional_pairs, chain_patterns |
| `GET /api/v1/agent/{id}/receipts` | `interaction_stream_log.jsonl` | All tiers |
| `GET /api/v1/agent/{id}/notifications` | Jeopardy notifications (ACR-specific, no observer equivalent) | All tiers |
| `GET /api/v1/network/status` | `observatory_summary.json` (partial) | All tiers |
| `GET /api/v1/network/skills` | Skill adoption + anomaly surfacing (ACR-specific) | All tiers |
| `GET /api/v1/skill-catalog/search?q=...` | n/a (ACR-specific) | All tiers |
| `POST /api/v1/receipts` | ingest `interaction_stream_log` | All tiers |
| `POST /api/v1/register` | n/a | All tiers |

**Observation:** The current `/friction` endpoint is already doing a lot. It's roughly equivalent to a merged `friction_surface + operator_hotspots + interaction_catalog` report. The paid-tier additions (population comparison, retry overhead, directional pairs) correspond to observer concepts like `downstream_impact_profile` and observational `intervention_map`.

**What's missing** is conceptual structure around what all this means, plus several operator-facing artifacts that would add immediate free-tier value without premium cost.

---

## Layer 2 endpoint gap analysis

Endpoints ACR should add (in priority order), with tier mapping:

### 1. `GET /api/v1/agent/{id}/healthy-corridors` — **FREE** ⭐

**Observer analogue:** `healthy_corridor_report.json`
**What it returns:** List of targets where the agent is consistently stable — low friction, low anomaly rate, sufficient sample count.
**Why free:** Tells the user "here's what's working." Pure reassurance + preservation signal. Low compute, high psychological value.
**Progression angle:** Free tier sees count + list of stable targets. Paid tier adds "and here's what's keeping them stable" (variance breakdown, baseline comparison).

```json
{
  "agent_id": "...",
  "scope": "day",
  "corridor_count": 8,
  "corridors": [
    {
      "target": "api:stripe.com",
      "interaction_count": 142,
      "median_duration_ms": 210,
      "failure_rate": 0.0,
      "anomaly_rate": 0.0,
      "reason": "stable_low_friction"
    }
  ]
}
```

### 2. `GET /api/v1/agent/{id}/coverage` — **FREE** ⭐

**Observer analogue:** `coverage_profile.json` + `interaction_profile.json` coverage section
**What it returns:** "How much data do you have, and is it enough to draw conclusions?"
**Why free:** Teaches users the shape of their profile. Tells them what to log more of. Self-serve onboarding quality check.
**Progression angle:** Free shows receipt count, distinct targets, distinct categories, maturity state (warmup / calibrating / stable_candidate), coverage state (uninitialized / narrow / observed). Paid adds "features missing for full population comparison" and specific recommendations.

```json
{
  "agent_id": "...",
  "scope": "day",
  "receipt_count": 847,
  "distinct_targets": 12,
  "distinct_categories": 5,
  "chain_coverage": 0.34,
  "maturity_state": "calibrating",
  "coverage_state": "narrow",
  "recommendations": [
    "Add chain_id to sequential tool calls to unlock chain analysis"
  ]
}
```

### 3. `GET /api/v1/agent/{id}/failure-registry` — **FREE** ⭐

**Observer analogue:** `interaction_failure_registry.json`
**What it returns:** Failures grouped by target, with error codes and anomaly categories.
**Why free:** Actionable. An agent operator can look at failure patterns and fix things immediately.
**Progression angle:** Free shows grouped failures + error codes. Paid adds "similar failures observed across the population" and "failure pattern matches known regime X."

```json
{
  "failures": [
    {
      "target": "mcp:github",
      "count": 14,
      "error_codes": { "429": 8, "504": 6 },
      "most_common_category": "tool_call",
      "median_duration_when_failed_ms": 3200
    }
  ],
  "total_failures": 14,
  "failure_rate": 0.016
}
```

### 4. `GET /api/v1/agent/{id}/trend?scope=week&compare=previous` — **FREE (light) / PAID (deep)** ⭐

**Observer analogue:** `trend_regime_summary.json` + `run_history_index.json`
**What it returns:** Is your agent's friction improving, worsening, or stable compared to the previous period? Per-target trend direction.
**Why a split tier:** Free tier gets directional trend arrows (up/down/stable) on top targets. Paid tier gets magnitude, rate of change, and population-drift overlay.

```json
{
  "agent_id": "...",
  "current_period": "day",
  "comparison_period": "previous_day",
  "overall_trend": "stable",
  "per_target": [
    { "target": "mcp:github", "trend": "worsening", "magnitude": null },
    { "target": "api:stripe.com", "trend": "stable", "magnitude": null }
  ]
}
```

Paid adds `magnitude` (percentage change), `significance` (z-score), and `population_overlay` (is this happening to everyone?).

### 5. `GET /api/v1/agent/{id}/regime` — **FREE (novel/recurring flag) / PAID (full fingerprint)**

**Observer analogue:** `regime_fingerprint_profile.json`
**What it returns:** "Does your current friction pattern look like anything you've seen before?"
**Why a split tier:** Free gets boolean "this looks familiar vs new." Paid gets the full fingerprint match with similarity scores.

### 6. `GET /api/v1/agent/{id}/cost-patterns` — **PROGRESSION (FREE light / PAID deep)**

**Observer analogue:** `cost_pattern_catalog.py`
**What it returns:** Recurring cost patterns across your agent's lifecycle.
**Why a split tier:** Free sees top 3 recurring patterns by receipt volume. Paid sees full catalog with pattern drift analysis.

### 7. `GET /api/v1/agent/{id}/changepoints` — **PAID**

**Observer analogue:** Observational `intervention_map` — natural changepoints detected without declared intervention.
**What it returns:** "On date X your friction profile for target Y changed significantly, and no intervention was recorded. Here's what changed."
**Why paid:** Compute-heavy (requires historical analysis), high signal value, differentiates ACR from basic observability tools.

### 8. `GET /api/v1/agent/{id}/process-ownership` — **PAID**

**Observer analogue:** `process_ownership_map.json`
**What it returns:** Groups your top friction hotspots by process family (queueing, retry, transport, etc.) with owner tags if the agent has declared a topology.
**Why paid:** Requires an ownership registry input the free tier won't have.

### 9. `GET /api/v1/agent/{id}/degradation-matrix` — **PAID**

**Observer analogue:** Observational form of `degradation_effect_matrix.py`
**What it returns:** Cross-provider comparison of the same target — does Claude see this target degrade differently than GPT? Useful for identifying provider-specific issues.
**Why paid:** Requires cross-agent aggregation and provider-class partitioning.

### 10. `GET /api/v1/network/observatory-summary` — **FREE (public view)**

**Observer analogue:** `observatory_summary.json`
**What it returns:** A single page describing the state of the ACR network — total agents, total systems observed, number of corridors vs hotspots, recent trends.
**Why free (public):** Marketing and demonstration. The HIBP equivalent of "breach counter on the homepage."

### 11. `GET /api/v1/agent/{id}/profile` — **FREE** ⭐

**Observer analogue:** `interaction_profile.json` (the top-level profile with episode count + planes + maturity)
**What it returns:** The agent's interaction profile — a single object that summarizes "what is known about this agent's behavior."
**Why free:** This is the missing concept in ACR's UI. Right now agents can query friction directly but there's no "my profile" view that says "you've logged 847 interactions across 12 targets, coverage is narrow, maturity is calibrating, you have 8 healthy corridors and 3 hotspots — here's the summary."

**Note:** This is arguably the most important endpoint to add. It gives the interaction profile concept a concrete home in the API.

### 12. `GET /api/v1/agent/{id}/lens/{lens_name}` — **FUTURE, multi-tier**

**Observer analogue:** The lens system itself — each lens reads the profile differently.
**What it returns:** A specific lens output. `friction` already exists. Other lenses to add over time: `reliability`, `cost` (tokens/dollars), `quality`, `vulnerability`.
**Why future:** Placeholder endpoint to architect for. Don't build multiple lenses yet — build the URL shape so clients can add lenses without breaking.

---

## Proposed tier structure (updated)

### Free tier — "your own profile, actionable interpretation"

Everything the free user needs to feel the system is useful on day one:

- `log_interaction` ingest (unlimited, fire-and-forget)
- `GET /agent/{id}/profile` — the summary view
- `GET /agent/{id}/friction` (simplified) — summary + top 3 targets + category breakdown
- `GET /agent/{id}/healthy-corridors` — what's working
- `GET /agent/{id}/coverage` — maturity + data sufficiency
- `GET /agent/{id}/failure-registry` — grouped failures with error codes
- `GET /agent/{id}/trend` (directional only) — improving/worsening/stable
- `GET /agent/{id}/regime` (familiarity boolean only)
- `GET /agent/{id}/cost-patterns` (top 3)
- `GET /agent/{id}/notifications` — jeopardy alerts
- `GET /agent/{id}/interactions` — raw receipt history (current period)
- `GET /network/observatory-summary` — public network state

### Paid tier — "your profile + the population, deeper"

Everything free + analytical depth that requires population data or historical comparison:

- `GET /agent/{id}/friction` (full) — top 10 with baselines, population_comparison, retry_overhead, population_drift, directional_pairs, chain_patterns
- `GET /agent/{id}/trend` (with magnitude + significance + population overlay)
- `GET /agent/{id}/regime` (full fingerprint + match scores)
- `GET /agent/{id}/cost-patterns` (full catalog + drift)
- `GET /agent/{id}/changepoints` — detected behavioral breaks
- `GET /agent/{id}/degradation-matrix` — cross-provider comparison
- `GET /agent/{id}/process-ownership` — if topology is declared
- Historical scopes beyond current period
- API access with higher rate limits

### Premium tier — "observer-class analysis on declared episodes"

Everything paid + anything that requires the agent to submit richer data or Tethral to run analysis against the target directly:

- Episode-structured reporting (agents submit explicit baseline/interaction/post windows)
- Observational memory-order profile
- Full directional friction with decomposed cost
- Scheduled analysis runs
- Raw signal export
- Private target analysis with stimulus campaigns run by Tethral

### Enterprise / custom — "Tethral runs the Friction Observer"

- Deployment of the actual Friction Observer package against the customer's systems
- Canonical TriST outputs (deformation profile, interaction shape profile, memory order profile, response geometry profile, response surface)
- Intervention guidance with declared before/after markers
- Forecast validation with backtesting
- Custom process ownership mapping
- Dedicated analysis sessions

---

## Free-tier progression — what a user feels in their first week

The goal you stated: "provide value to free users, something they feel like they could action on if they had the right tools, and maybe a little more information. Treat it as a progression, not as much a gate."

Here's what a free user sees as they log more interactions:

### Day 1 — after first `log_interaction`
- Profile: "You've logged 5 interactions across 2 targets. Maturity: warmup. Coverage: uninitialized. Call log_interaction after every external call to build your profile."
- Friction: empty state message — "Not enough data yet. Keep logging."
- Healthy corridors: empty
- Failures: empty
- Notifications: empty

### Day 1 — after ~50 interactions
- Profile: "50 interactions across 4 targets. Maturity: warmup. Coverage: narrow."
- Friction: "Summary unlocked. 4 targets shown without baselines. Biggest cost: mcp:github at 45% of wait time."
- Healthy corridors: "2 corridors detected." (e.g., "api:internal.company.com is stable")
- Failures: "0 failures in current period."
- Coverage recommendations: "Add chain_id to sequential calls to unlock chain analysis."

### Day 2 — after ~200 interactions
- Profile: "200 interactions across 6 targets. Maturity: calibrating. Coverage: narrow → observed transition."
- Friction: Full category breakdown now visible. Chain analysis available. First trend data (day-over-day) showing directional arrows.
- Healthy corridors: "4 corridors stable."
- Failures: "3 failures, 1 error code pattern detected" (e.g., mcp:github 429s)
- Trend: "Your friction for mcp:github is worsening (directional, upgrade for magnitude)."
- Regime: "This looks familiar — matches your pattern from yesterday."

### Week 1 — after ~1000 interactions
- Profile: "1,247 interactions across 9 targets. Maturity: stable_candidate. Coverage: observed."
- Friction: Top 3 targets fully mapped. Full chain_analysis. By-transport and by-source breakdowns.
- Healthy corridors: "6 corridors, including api:stripe.com (no variance in 3 days)."
- Failures: Grouped failure registry with per-target error code breakdown.
- Trend: Week-over-week directional comparison for each top target.
- Cost patterns: "Top 3 recurring cost patterns identified." (Free shows 3, paid shows all.)
- **Upgrade nudge:** "Your profile is stable. Upgrade to see baselines, population comparison, and directional friction between targets."

Throughout the progression:
- **Every free response includes a `progression_state` field** indicating where the user is on the maturity curve and what's newly unlocked
- **Every free response includes a `next_signal_available_at` hint** showing what they'd unlock next if they kept logging
- **Nothing is gated harshly** — instead, fields are empty with an explanation, or marked as "upgrade_only" with a short teaser

This is the "progression, not a gate" pattern the user asked for.

---

## Recommendations — what to build first

### Priority 1 — build these as free endpoints (unlock free-tier progression)

1. **`GET /agent/{id}/profile`** — the interaction profile concept given a home. Core to the new framing. Low compute.
2. **`GET /agent/{id}/healthy-corridors`** — the "what's working" surface. High psychological value, low compute.
3. **`GET /agent/{id}/coverage`** — coverage + maturity state. Teaches users what to log.
4. **`GET /agent/{id}/failure-registry`** — grouped failures. Actionable.
5. **`GET /agent/{id}/trend` (directional only)** — day-over-day direction. Teases upgrade.

All five share the same data source ACR already has. Combined, they probably add ~1,500 lines of server-side code. No new ingest schema needed.

### Priority 2 — add to paid tier

6. **`GET /agent/{id}/changepoints`** — detected behavioral breaks. Differentiates ACR from plain observability.
7. **`GET /agent/{id}/regime`** — fingerprint matching.
8. **`GET /agent/{id}/degradation-matrix`** — cross-provider comparison.
9. **`GET /agent/{id}/trend` (deep)** — magnitude + population overlay.

### Priority 3 — enterprise / custom path

10. **Episode-structured reporting** — new MCP tool `log_episode` or a new ingestion endpoint that accepts episode records (baseline/interaction/post windows). Only makes sense if a paying customer wants the observer-class outputs.
11. **Tethral-operated Friction Observer runs** — deploy the observer package against the customer's systems, deliver canonical TriST artifacts as a service.

### Priority 4 — network-level product

12. **`GET /network/observatory-summary`** — public-facing network state. Marketing surface.

---

## Things to watch out for

### 1. Don't overclaim observer concepts ACR can't produce

The observer's canonical TriST outputs (`deformation_profile`, `interaction_shape_profile`, `memory_order_profile`, `response_geometry_profile`) **cannot be derived from ACR's current receipt schema**. Don't mention them in free-tier copy, don't mention them in paid-tier copy, and be careful about mentioning them in premium-tier copy without qualifying that they require episode-structured input OR a Tethral-operated observer run.

### 2. The "lens" vocabulary needs to be used carefully

I was using "lens" to mean "a way of reading the profile" — friction, reliability, sophistication, quality, vulnerability. After reading the observer package, I think the right framing is:

- **Surfaces** — operator-facing summary outputs from a profile (hotspots, corridors, impact map, ownership map, next tests). This is what users want to see.
- **Profiles** — the underlying data structures (interaction profile, response variability profile, environment profile, coverage profile, uncertainty profile).
- **Claims** — gated assertions derived from profiles with signal qualification (geometry claim, shape claim, deformation claim).

The observer uses "surfaces" for what I was calling "lenses" — the visual tiles on the dashboard. A surface is a read-only view of a profile. A profile is the data. Claims are opinions derived from profiles with gating.

**Recommendation:** Don't use "lens" in user-facing copy unless you're committing to the framing. "Surfaces" or "views" may be closer to the observer's vocabulary.

### 3. Observer's "watch" vs "post-hoc" split is load-bearing

The operator table explicitly warns: *"do not treat watch-mode fluctuation math as equivalent to the derived deformation, interaction-shape, or memory/order layer."*

ACR's receipt-derived outputs are structurally closer to watch mode than to post-hoc canonical. That's fine — watch mode outputs are useful and that's what agent operators actually want day-to-day. But we should never claim receipt-derived outputs are canonical TriST outputs. They're not.

### 4. The receipt schema is the bottleneck

Observer modules assume:
- Explicit participant targets (source vs target)
- Episode lifecycle stages (baseline, prime, proposal, interaction, post, cooldown, washout)
- Multi-plane observation (field, relational, representation, state, delta)
- Declared interventions with before/after markers

ACR receipts have:
- `target_system_id`, `target_system_type`, `category`, `status`, `duration_ms`
- `chain_id`, `chain_position`, `preceded_by`
- `anomaly_flagged`, `anomaly_category`
- `queue_wait_ms`, `retry_count`, `error_code`, `response_size_bytes`

**Gap:** No explicit episode lifecycle. No baseline vs interaction window distinction. No declared intervention markers. No participant role beyond emitter/target.

**If you want to unlock Tier B / C observer outputs**, the receipt schema needs to grow. Options:

- **Option 1 (lightweight):** Add optional `episode_id` and `episode_stage` fields to the receipt schema. Agents that want richer analysis can submit episode-tagged receipts. Agents that don't still work fine.
- **Option 2 (heavier):** Add a separate `POST /episodes` endpoint with full episode structure. Use receipts for the "live stream" and episodes for the "bounded run" analysis.
- **Option 3 (enterprise):** Tethral operates Friction Observer against the customer's systems directly, bypasses the receipt layer entirely for canonical outputs.

I'd lean Option 1 — minimal change, opt-in, backward compatible.

### 5. The dashboard — deferred until after approval

The observer package ships a dashboard (`observatory_surface_pack.py`, 956 lines) with a 2x6 tile grid across 4 surface packs (system_1, system_2, interaction, environment). Each pack has 10-12 named tiles like `overview_card`, `coverage_summary`, `top_feature_means`, `stability_flags`, `friction_locations`. This is a well-developed visual language.

ACR's current dashboard in `packages/dashboard/` is Next.js with a few pages. It's far simpler than the observer dashboard and uses different vocabulary.

**After you approve parts 2 and 3 and we're into phase 1**, the dashboard work would be to either:
- Port the tile pattern into the ACR dashboard (reuse the observer's surface pack registry concept)
- Keep the ACR dashboard lightweight and link to full observer dashboards for premium customers
- Build a hybrid: free tier gets a simplified tile grid; premium gets the full 2x6 per-surface-pack view

I'll hold on this until you've reviewed the Layer 2 work.

---

## Open questions for you to decide

Before I write the architectural principles doc (phase 1) or touch any code, I need your calls on:

1. **Episode schema extension (y/n)** — do we add optional `episode_id` / `episode_stage` fields to receipts now to future-proof for observer-class analysis, or hold until a customer asks for it?

2. **Tier boundaries** — is the free/paid/premium/enterprise split I proposed the right shape? Or do you want a different cut?
   - Specifically: should `trend` (with magnitude) be free or paid? I'm leaning "directional is free, magnitude is paid" — which is genuinely a progression feel — but you might want magnitude to be free too.
   - Specifically: should `changepoints` be paid or premium? I put it at paid because the compute is manageable and it's a strong differentiator.

3. **"Lens" vs "surface" vocabulary** — the observer uses "surface" consistently. I've been using "lens." Which should user-facing copy use? I prefer "lens" for the conceptual framing ("a way of reading the profile") but "surface" might be the more precise term given that surfaces are read-only views in the observer.

4. **Priority 1 endpoints — build order** — of the five free endpoints I'm recommending (profile, healthy-corridors, coverage, failure-registry, trend-directional), which should ship first? I'd suggest: `profile` → `coverage` → `healthy-corridors` → `failure-registry` → `trend`. Profile first because it's the conceptual anchor; coverage second because it teaches users what to log; then the actionable outputs.

5. **Network-level observatory summary as public-facing** — do we want a public unauthenticated endpoint at `/api/v1/network/observatory-summary` that shows the overall state of the ACR network? Like a HIBP-style breach counter for the homepage? This is a decision about whether we want a marketing surface for the network itself.

6. **"Collector recommendations" feature** — the observer has a `collector_recommendations` module that tells operators "you should log X differently." Should ACR implement an analog that returns recommendations like "add chain_id to your tool calls" or "you're not logging API interactions, only MCP tool calls — add log_interaction for HTTP requests too"? I put it in coverage recommendations but it could be its own endpoint.

7. **Episode vs profile — naming conflict** — the observer uses "episode" for what I've been calling an "interaction profile entry." The observer's "interaction profile" is the *aggregate* (all episodes compiled into a behavioral record). I don't want to overload terms. Should I match the observer's vocabulary (episodes compile into a profile) or keep the ACR naming where "interaction profile" = the full record and we pick a different name for the individual unit?

---

## Summary — the short version

ACR's current friction endpoint already produces a simplified `operator_hotspots + friction_surface + interaction_catalog` equivalent. The biggest free-tier gains are not new analytical depth — they're **structural**:

- A `/profile` endpoint that gives the interaction profile concept a home
- A `/healthy-corridors` endpoint that rewards users for what's working
- A `/coverage` endpoint that teaches them what to log
- A `/failure-registry` endpoint that's immediately actionable
- A `/trend` endpoint with directional arrows

These five endpoints unlock the "progression, not a gate" free tier experience with minimal new compute and no new ingest schema. They correspond to observer concepts that transfer cleanly to receipt-based analysis.

Premium and enterprise tiers draw from observer concepts that require episode-structured input OR Tethral-operated observer runs against the target. Be careful not to claim canonical TriST outputs (deformation profile, interaction shape profile, memory order profile, response geometry profile) are available from the free/paid ACR product — they're not derivable from agent self-reporting alone.

The MCP stays thin regardless of tier. All value flows through Layer 2 endpoints returning pre-digested JSON. The MCP's job is to call them and render the text.

Review this, answer the 7 open questions, and I'll write the architectural principles doc (phase 1) + the dashboard exploration.
