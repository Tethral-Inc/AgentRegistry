# ACR MCP Roadmap

**Scope:** Combined cleanup (from [`AUDIT.md`](./AUDIT.md)) + user-facing improvements, sequenced across 11 releases. This document is the single source of truth for what ships when. [`CLEANUP_PLAN.md`](./CLEANUP_PLAN.md) remains as the execution detail for cleanup-only phases; this roadmap references it where they intersect.

**Target start version:** 2.4.1
**Target end version:** 2.9.0
**Total engineering scope:** ~25-32 days
**Decision status:** All five open decisions locked (see [Locked decisions](#locked-decisions)).

---

## Release table

| # | Release | Theme (one-sentence user-visible change) | Cleanup phases | UX moves | Est |
| --- | --- | --- | --- | --- | --- |
| **A** | **v2.5.0** | *"HTTP transport and attribution are correct."* | Cleanup 0 + 1 + 2 + 3 | — | 3-4d |
| **B** | **v2.5.1** | *"Every lens tells me what to do next and what changed since last time."* | — | Moves 1, 3, 6, 7 | 2-3d |
| **C** | **v2.5.2** | *"Verdicts show their math; descriptions match behavior."* | Cleanup 5 + 6 | — | 0.5d |
| **D** | **v2.5.3** | *"All tools authenticate consistently."* | Cleanup 7 | — | 0.5d |
| **E** | **v2.6.0** | *"First interaction with the MCP is immediately useful."* | — | Move 4 | 2-3d |
| **F** | **v2.6.1** | *"Output is self-describing and paginatable."* | Cleanup 8 + 9 | — | 3-4d |
| **G** | **v2.7.0** | *"The MCP has a clear front door."* | Cleanup 10 | Move 2 | 4-5d |
| **H** | **v2.7.1** | *"Mutations show diffs; empty states route somewhere useful."* | Cleanup 11 | — | 1-2d |
| **I** | **v2.7.2** | *"Config, env vars, and background work are all principled."* | Cleanup 12 | — | 0.5d |
| **J** | **v2.8.0** | *"The MCP volunteers patterns, not just answers them."* | — | Move 5 | 5-7d |
| **K** | **v2.9.0** | *"Insights are shareable with teammates."* | — | Move 8 | 3-4d |
| **Parked** | server-only | Ingest enforcement flip (SHADOW_MODE, per-check) | Cleanup 4 | — | separate ops track |

---

## Locked decisions

These were open in the cleanup plan; now locked in their MCP-revised form. No further design required.

1. **Registration failure surface:** `isError: true` + actionable message. `log_interaction` specifically retries transparently in-process before surfacing `isError`, so the receipt-collection loop is never broken by transient failures. Other tools surface `isError` immediately.
2. **SHADOW_MODE flip sequence:** IP_CHURN → VOLUME_CAP → QUARANTINE. **Parked until 3+ months of shadow data and per-check surfaced-feedback paths are in place** (quarantine notifications, `429`-style retry-after responses). Not a v2.x milestone.
3. **`acknowledge_threat` deprecation window:** 90 calendar days minimum, regardless of version count. Alias dual-registered in v2.7.0, removed no earlier than 90 days later (first MINOR release after the calendar threshold).
4. **Friction-verdict thresholds:** Hardcoded in `config/friction-thresholds.ts`. **No env override.** Threshold values rendered inline in the verdict output so operators see the math that fired.
5. **`RECEIPT_SOURCES` exposure:** Zod `.enum()` in the `source` parameter schema, valid values enumerated in the tool description. Same rule applies to `LENS_SCOPES` and every other enum. New source types require a deliberate MCP version bump — that's a feature, not a bug.

---

## Release detail

### Release A — v2.5.0 *"HTTP transport and attribution are correct"*

**User-visible:** Nothing changes for stdio users. HTTP transport users start getting correct attribution — their receipts no longer leak across concurrent sessions.

**Engineering scope:**
- **Cleanup Phase 0** — test harness (HTTP session-isolation integration test, SessionState unit tests, stdio happy-path integration test).
- **Cleanup Phase 1** — `getSession` factory split across 18 tool factories + `server.ts:124-149` + `self-log.ts` (AsyncLocalStorage re-entrancy guard) + `fetch-observer.ts` (WeakSet-keyed idempotency) + `whats-new.ts:57`. Drops every `defaultSession` import from `src/tools/`.
- **Cleanup Phase 2** — `ensureRegistered` retry with exponential backoff + typed `RegistrationFailedError` + `isError: true` surface in every tool's handler. Drops `pseudo_<hex>` fallback.
- **Cleanup Phase 3** — `provider_class: 'unknown'` fixes (fetch-observer + environmental), `composition_hash` extended to rich composition, `get_trend` ratio/delta-fraction verified against server contract.

**Acceptance:**
- `tests/integration/mcp-http-session-isolation.test.ts` passes (fails on master before this release).
- No `defaultSession` references remain in `src/tools/`.
- No `pseudo_` strings remain in `src/`.
- `grep "provider_class: 'unknown'"` returns zero hits.
- Unit tests for composition-hash stability across rich/flat.
- Unit test for `get_trend` percentage math asserts render matches server contract.

**Resolves 🔴 Big findings:** B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B15, B18 (13 of 23).

**Risk:** Medium. Wide file-touch surface. Mitigated by test harness landing first.

---

### Release B — v2.5.1 *"Every lens tells me what to do next and what changed since last time"*

**User-visible:** Every lens output gets four visible improvements at once:

1. **Next-action footer.** Each tool ends with a concrete "→ Next action: call `get_X` to ..." line derived from the lens's own data.
2. **Delta rendering.** Every lens shows "since your last call" deltas. Friction "47.3% (**+12pp from yesterday**)."
3. **Notification header.** First line of every lens output: "⚠ 2 new signals since your last call." Silent if zero.
4. **Dashboard link footer.** Every lens ends with "Full view: https://dashboard.acr.nfkey.ai/agent/<id>/<lens>?range=..." — opens the richer web surface.

**Engineering scope:**
- Server-side: `last_queried_at` per agent per lens endpoint. Cheap addition to the existing request-logging path.
- New helper: `src/utils/next-action.ts` with per-lens heuristics (high failure rate → failure registry; high retry count → skill tracker; etc.).
- New helper: `src/utils/delta-render.ts` that takes `(current, previous) → "+12pp"` or `"-0.3x"` formatted strings.
- Apply both helpers to all 8 lens tools (`get_friction_report`, `get_trend`, `get_coverage`, `get_failure_registry`, `get_stable_corridors`, `get_network_status`, `get_revealed_preference`, `get_compensation_signatures`) plus `whats_new`, `summarize_my_agent`, `get_my_agent`.
- Add unread-notifications one-line-header render via existing `/notifications` endpoint.
- Dashboard link: `renderDashboardLink(agentId, lens, range)` utility.

**Acceptance:**
- Every lens tool's output ends with a next-action line unless the tool is in an explicit "healthy, no action needed" state.
- Second call to same lens within 24h renders delta values.
- Every tool call shows unread count in the header.
- Dashboard link appears on every lens.

**Resolves 🟡 Small-bucket clusters:** C11 (empty-state next actions — most of it).

**Risk:** Low. Additive rendering changes on top of correct Phase A attribution.

---

### Release C — v2.5.2 *"Verdicts show their math; descriptions match behavior"*

**User-visible:** Friction-report verdicts now include the threshold values and the comparison math, not just the conclusion. Tool descriptions match what tools actually do (no more "all lenses" overclaim).

**Engineering scope:**
- **Cleanup Phase 5** — `config/friction-thresholds.ts` module extracts the magic numbers. `docs/friction-verdict-thresholds.md` explains the calibration. Verdict render includes "fired because yours=7.2%, net=2.1%, threshold: net>5% ratio>2x."
- **Cleanup Phase 6** — `get_my_agent` `TOOL_MENU` includes all 26 tools with a CI guard. `summarize_my_agent` description accurately says "profile + friction + coverage snapshot." `get_interaction_log` single-receipt path returns the matching receipt or a clear not-found. `log_interaction` `.join` guard on `receipt_ids`.

**Acceptance:**
- Friction verdict output includes threshold values + comparison math.
- Unit test: every tool description is consistent with its schema (CI guard).
- `tests/unit/tool-menu.test.ts` passes.

**Resolves 🔴 Big findings:** B12, B13, B14, B16, B17 (5 more, total 18/23).

**Risk:** Very low.

---

### Release D — v2.5.3 *"All tools authenticate consistently"*

**User-visible:** Every tier-gated endpoint call carries auth. Thin `check_entity` branches for agents/systems get expanded to parity with skill rendering.

**Engineering scope:**
- **Cleanup Phase 7** — `src/utils/fetch-json-authed.ts` helper. Every `fetch(url)` in `src/tools/` routed through it. `check_entity` agent/system render branches expanded. CI grep-guard against unauthed `fetch` in tier-gated paths.

**Acceptance:**
- No `fetch(` calls in `src/tools/*.ts` against tier-gated endpoints without auth.
- `check_entity` renders equivalent detail for all three entity types (or explicit server-side TODO with ticket link for missing server fields).

**Resolves 🔴 Big findings:** B19, B20, B21 (3 more, total 21/23).

**Risk:** Low. Mechanical.

---

### Release E — v2.6.0 *"First interaction with the MCP is immediately useful"*

**User-visible:** Installing the MCP for the first time no longer shows "pre-signal — thin sample" on every lens call. New agents see cohort data from environmental baselines immediately, with clear framing that it's their cohort, not their own data yet.

**Engineering scope:**
- Server-side: environmental baseline aggregation endpoint returning "typical performance for agents in your cohort" keyed on `provider_class`.
- MCP-side: on any lens call where the agent's own sample is thin (`<10` interactions), prepend a "Your cohort's typical performance:" section with baseline data, followed by the agent's own (thin) section.
- New tool: `orient_me` — replaces/supplements `getting_started`. Takes the current state (agent just registered / has some data / steady-state) and returns the right next action for each.
- Environmental probe improvements: cover Google/Azure/AWS/Bedrock endpoints, not just Anthropic/OpenAI/GitHub (small-bucket finding from AUDIT).

**Acceptance:**
- A fresh MCP install against a fresh agent produces useful lens output on first call (no "pre-signal" black hole).
- `orient_me` routes correctly from three initial states (new / some data / steady-state).
- Environmental probe covers 6 provider families.

**Resolves:** The biggest UX gap in the product.

**Risk:** Medium. Server-side cohort endpoint is new; needs design around privacy (cohort-aggregated, never individual agent).

---

### Release F — v2.6.1 *"Output is self-describing and paginatable"*

**User-visible:** Tool outputs render consistently (dividers, arrows, truncation), list-returning tools accept `cursor` input, parameter enums are visible to LLMs.

**Engineering scope:**
- **Cleanup Phase 8** — safe-render helpers (`truncHash`, `fmtRatio`, `fmtDate`), style module (section, arrow, bullet), source/prefix/limit constants, composition-empty helper, scope enum.
- **Cleanup Phase 9** — confidence tag coverage audit (fix wrong-denominator bug in `get_skill_tracker`), cursor pagination on list tools, description accuracy audit with CI guard.

**Acceptance:**
- Grep-level consistency: one divider style, one arrow style, one hash-truncation pattern across all tools.
- Every list-returning tool accepts `cursor` and renders next-page instruction when a cursor is returned.
- Confidence tags applied against the correct denominator.
- `tool-descriptions.test.ts` CI guard passes.

**Resolves 🟡 Small-bucket clusters:** C1, C4, C5, C6, C9, C10, C12, C13, C14, C15 (10 of 16).

**Risk:** Low. All mechanical.

---

### Release G — v2.7.0 *"The MCP has a clear front door"*

**User-visible:** The MCP now has 4-5 obvious entry-point tools for ~95% of use cases. The 26 underlying tools stay registered but become "advanced." All `threat` terminology renames to `signal`.

**Engineering scope:**
- **Cleanup Phase 10** — terminology rename across MCP tools, server fields, DB columns. Dual-register `acknowledge_threat` as alias for `acknowledge_signal`; 90-day deprecation clock starts at 2.7.0 release date.
- **UX move 2** — front-door tools:
  - `whats_happening` — daily orientation; wraps whats_new + summarize + notifications.
  - `investigate(focus: "latency" | "failures" | "coverage" | "drift" | "skills")` — routes to the right lens based on focus.
  - `manage(action: "update" | "configure" | "register")` — composition + config.
  - `help` — smart routing based on current state (replaces `getting_started`).
  - The 26 existing tools stay, but their descriptions point to the front-door tool: *"For most use cases, start with `investigate`. Call this directly for fine-grained X."*

**Acceptance:**
- Four front-door tools registered and documented as primary entry points.
- 26 underlying tools stay but each description references its front-door parent.
- `acknowledge_threat` alias in place with deprecation warning.
- DB migration landed with dual-column write path.

**Resolves 🟡 Small-bucket cluster:** C7 (terminology). Resolves UX move 2.

**Risk:** Medium-high. Biggest breaking change of the roadmap. Mitigated by: (a) 90-day deprecation, (b) alias preservation, (c) front-door tools are additive, existing tools still work.

---

### Release H — v2.7.1 *"Mutations show diffs; empty states route somewhere useful"*

**User-visible:** `update_composition` and `register_agent` return diffs showing what changed. Every empty state has a next action.

**Engineering scope:**
- **Cleanup Phase 11** — truncated-ID render standard (12 chars + `verbose: true` escape), empty-state next-action on every "no data" branch, mutation diffs on `update_composition` / `acknowledge_signal` / `register_agent`, ensureRegistered error-message propagation.

**Acceptance:**
- Every mutation tool returns a diff in its response.
- No empty-state branch renders without either a next-action or an explicit "this is healthy" marker.

**Resolves 🟡 Small-bucket clusters:** C3, C8, C11 (remainder), C16 (4 of 16).

**Risk:** Low.

---

### Release I — v2.7.2 *"Config, env vars, and background work are all principled"*

**User-visible:** Minimal; mostly operator-facing hygiene.

**Engineering scope:**
- **Cleanup Phase 12** — `envBool()` helper, `server` device-class bucket with real heuristic, version-check memoization across sessions, graceful abort of background promises on session close, extended env-var documentation in `server.json`, `docs/composition-observation.md` phase-2 plan.

**Acceptance:**
- All env-var booleans accept `1|0|true|false|yes|no`.
- `server` device class detected correctly from `KUBERNETES_SERVICE_HOST` or `AWS_EXECUTION_ENV`.
- Version check hits npm once per process, not per session.
- Session teardown cancels in-flight background fetches.
- `server.json` lists all user-facing env vars.

**Resolves 🟡 Small-bucket clusters:** Cross-cutting hygiene items.

**Risk:** Very low.

---

### Release J — v2.8.0 *"The MCP volunteers patterns, not just answers them"*

**User-visible:** The MCP surfaces proactive nudges on `get_my_agent` and `whats_happening`:

- "Your composition hasn't updated in 4 days but you've called 3 new tools. Run `manage(action: update)`?"
- "You've retried api:slack.com 7 times in 2 hours. Your peers route that traffic through X."
- "Your friction report calls spiked 3x this week — something worrying?"

**Engineering scope:**
- Server-side: per-agent pattern detection as a background job. Runs every N hours against each active agent; detects N named patterns (composition staleness, retry burst, lens-call spike, skill version drift). Stores detected patterns in a new `agent_patterns` table.
- MCP-side: `get_my_agent` and `whats_happening` fetch active patterns and surface them in a "Things we noticed" section.
- Calibration: each pattern ships with a confidence score; low-confidence patterns don't surface until calibration data confirms them.
- Dismiss flow: users can dismiss a pattern ("not useful") — dismissals feed back into calibration.

**Acceptance:**
- At least 4 named patterns implemented and calibrated.
- Pattern detection runs as background job with no impact on tool-call latency.
- Dismiss flow records and affects future surfacing.

**Resolves:** UX move 5. Biggest single engineering investment of the roadmap.

**Risk:** High for false-positive rate. Mitigated by: (a) confidence calibration, (b) dismiss flow, (c) starting with obvious-high-signal patterns only.

---

### Release K — v2.9.0 *"Insights are shareable with teammates"*

**User-visible:** Every lens output gets a "Share this view: https://acr.nfkey.ai/s/<short-id>" footer that produces a read-only snapshot anyone can open in the dashboard. Users can `set_watch(lens, target, threshold)` to get notified when something crosses a line.

**Engineering scope:**
- Server-side: snapshot endpoint that stores a lens query + result (JSON) under a short id. Read-only, expires after 30 days, auth-optional for public snapshots.
- MCP-side: every lens renders the shareable URL.
- New tool: `set_watch(lens, target, threshold, condition)` — creates a persistent watch. Server-side evaluates watches every N minutes; matches create a notification.
- `get_notifications` includes watch-match notifications alongside anomaly signals.

**Acceptance:**
- Shareable URLs work for every lens.
- Watch creation, evaluation, notification loop verified end-to-end.
- Dashboard renders read-only snapshots correctly.

**Resolves:** UX move 8.

**Risk:** Low-medium. Snapshot privacy model needs care (default scope, expiry, share-with-org vs. public).

---

### Parked — Server ingest enforcement

**Cleanup Phase 4** ships as a **server-side-only** change when the conditions are met:

- ≥3 months of shadow-mode anomaly data collected and reviewed.
- Per-check surfaced-feedback paths in place (notification when quarantined, `429`-style retry-after header with reason code when volume-capped).
- Ops runbook for rollback scenarios written.

Then: flip IP_CHURN first via env var (`ACR_SHADOW_IP_CHURN=false`), observe 1-2 weeks, then VOLUME_CAP, then QUARANTINE. Not gated on MCP release cadence; parallel track.

---

## Done state (end of v2.9.0)

A new user's experience:

1. **Install:** `npx @tethral/acr-mcp`. First tool call returns useful cohort-calibrated data within 30 seconds.
2. **Discovery:** 4 front-door tools (`whats_happening`, `investigate`, `manage`, `help`) cover 95% of use cases. The 26 underlying tools are available for advanced use.
3. **Orientation:** Every tool output ends with a concrete next action.
4. **Temporal context:** Every lens shows what changed since last call.
5. **Notifications:** Unread signal count surfaces on every response header.
6. **Proactive:** The MCP volunteers 4+ named patterns when it notices something.
7. **Sharing:** Every lens view has a shareable URL.
8. **Watches:** Users can set thresholds and get notified on crossings.
9. **Correctness:** HTTP transport and stdio both attribute receipts correctly. Every signal is consistent across agents (no env-tunable verdicts).
10. **Honesty:** Terminology matches the thesis — "signal," not "threat"; verdicts show their math; no synthetic labels.

## Execution status

This file is the source of truth for what's shipped, in-progress, and planned. Each release section will be updated in-place with:
- ✅ when the release ships (git tag, npm version, changelog link).
- 🚧 when actively in progress (feature branch link).
- 📋 when planned but not started.

All releases currently: 📋 (post-2.4.1).

---

## How to work the roadmap

Execute releases in strict order A → K. Within a release, the engineering scope bullets above are the PR checklist. Each release:

1. Has a CHANGELOG entry in `packages/mcp-server/CHANGELOG.md` in the existing 2.x.y style — headline + bullet scope.
2. Bumps `packages/mcp-server/package.json` and `server.json` to the target version.
3. Merges to `master`.
4. Tags `v<version>` to trigger `publish.yml`.
5. Updates the release's section in this document to ✅ with the tag link.

Commits within a release reference both the audit finding (`AUDIT.md:<line>`) and the release section (`MCP_ROADMAP.md#release-<letter>`) in the body.
