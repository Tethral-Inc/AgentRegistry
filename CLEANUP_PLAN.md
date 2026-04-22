# ACR MCP Cleanup Plan

**Derived from:** [`AUDIT.md`](./AUDIT.md) (2026-04-21)
**Target surface:** `packages/mcp-server` v2.4.1 + direct server endpoints in `packages/ingestion-api`
**Commit convention:** `type(scope): summary` with trailing `Refs AUDIT.md:<line>` when the commit resolves a numbered finding.
**Test runner:** `pnpm test` (vitest, tests live in `tests/unit` and `tests/integration`).
**Release cadence:** PATCH bumps for polish, MINOR bumps for architectural phases. Each merged phase ships to npm + the MCP registry via the existing `publish.yml` workflow on tag push.

---

## Principles

1. **B1 first, everything else after.** The `getSession` factory split is the load-bearing finding. Fixing it dissolves seven other Tier-A findings; landing anything else first risks a re-write when B1 arrives.
2. **One phase, one PR, one release.** Each phase below is scoped to merge cleanly and ship independently. Don't batch unrelated phases into one PR.
3. **No finding is closed without a test.** If the bug could regress, a test must exist that would have caught it. Bugs in the hot path get integration tests; bugs in pure functions get unit tests. If a fix genuinely can't be tested (e.g., a cosmetic divider change), note that in the commit body with a one-line reason.
4. **Net-simpler changes.** A fix that removes code is preferred to a fix that adds code. Extract helpers only when the same pattern appears three or more times.
5. **Ship behind an env var when the blast radius is operational.** B22 (shadow-mode) and the ingest-rate cap (B23) must roll forward through env-var flips, not merge-time flag changes, so we can ratchet enforcement live without re-deploying.
6. **AUDIT.md is stable.** Fixes reference audit-line numbers; the audit file itself is append-only. When a finding is resolved, strike it through in the Big/Small bucket tables rather than deleting it, so the timeline is preserved.
7. **User-facing tool descriptions and the MCP registry manifest are part of the release.** A fix that changes tool behavior must also update the description, the schema, `server.json` (if user-visible), and the CHANGELOG for that version.

---

## Phase roadmap

| Phase | Scope | Release | Size | Findings resolved |
| --- | --- | --- | --- | --- |
| **0** | Test harness + CI prerequisites | — | 0.5d | (enables 1+) |
| **1** | `getSession` factory split | **2.5.0** | 1–2d | B1, B2, B3, B5, B6, B7, B11 (7) |
| **2** | `ensureRegistered` hardening | **2.5.1** | 0.5d | B4 |
| **3** | Signal correctness | **2.5.2** | 0.5d | B8, B9, B10, B18 |
| **4** | Server ingest hardening | **server only** | 0.5d | B22, B23 |
| **5** | Verdict calibration + thresholds | **2.5.3** | 0.5d | B16, B17 |
| **6** | Tool description/menu/output bugs | **2.5.4** | 1d | B12, B13, B14, B15 |
| **7** | Auth harmonization | **2.5.5** | 0.5d | B19, B20, B21 |
| **8** | Small-bucket mechanical sweeps | **2.6.0** | 2–3d | Small clusters C1, C2 (done), C4, C6, C10, C13, C14, C15 |
| **9** | Confidence + pagination + enum drift | **2.6.1** | 1d | C5, C9, C12 |
| **10** | Terminology rename pass | **2.7.0** | 2d + migration | C7 |
| **11** | UX + docs sweeps | **2.7.1** | 1d | C3, C8, C11, C16 |
| **12** | Cross-cutting hygiene | **2.7.2** | 0.5d | env-var helper, `server` device bucket, `observeComposition` stub plan, version-check memoization |

**Total engineering:** roughly 12–14 working days across 10 releases. Phases 1–7 (MCP 2.5.x series) close out every 🔴 Big finding. Phases 8–12 (2.6.x–2.7.x) close the small bucket.

---

## Phase 0 — Test harness prerequisites

**Goal:** Have the tests in place that Phase 1 needs to prove correctness. Without this, Phase 1's session-isolation fixes can't be regression-proofed.

**Changes:**
- Add `tests/integration/mcp-http-session-isolation.test.ts`. Spin up two concurrent HTTP transports (reuse the pattern in `http.ts`), call `log_interaction` from each with distinct agent IDs + provider_class, assert that each session's receipts land with the correct attribution. This test must **fail against master** (proves B1/B3).
- Add `tests/unit/session-state.test.ts` covering `SessionState` in isolation: chain rotation on idle, provider class resolution, deep-composition default, version-check setter/getter. ~15 tests.
- Add `tests/integration/mcp-stdio-happy-path.test.ts` that runs the MCP against a mock API and exercises `register_agent`, `log_interaction`, `get_friction_report`. Prevents regressions on the stdio path during later phases.

**Acceptance:** All three new test files added. `pnpm test` passes on master with the isolation test skipped (expected-fail); isolation test runs and fails with a clear assertion that identifies the `defaultSession` leak.

**Risk:** Low. Pure additive change.

---

## Phase 1 — `getSession` factory split (2.5.0)

**Goal:** Resolve B1 and the six Tier-A findings it subsumes.

**Changes:**
1. Change every tool factory in `src/tools/*.ts` to accept `getSession: () => SessionState` as a parameter in addition to (or instead of) `apiUrl`. Use the existing `update_composition` / `get_notifications` / `acknowledge_threat` / `configure_deep_composition` call shape as the template.
2. In each tool handler, replace every `defaultSession.<x>` reference with `getSession().<x>`. Drop the `import { defaultSession } from '../session-state.js'` line where no longer needed.
3. In `src/server.ts`, update the 18 tool-registration calls at lines 124-149 to pass `() => session` as the trailing argument.
4. In `src/middleware/self-log.ts`, replace `let selfLogging = false` (line 17) with an `AsyncLocalStorage<boolean>` re-entrancy guard, mirroring the `fetch-observer` pattern (B5). Remove the `state.agentId ?? defaultSession.agentId` fallback (line 46); if `state.agentId` is null, drop the self-log emission and count it via a debug metric (B6).
5. In `src/middleware/fetch-observer.ts`, replace the module-level `installed` boolean (line 45) with a `WeakSet<SessionState>` keyed on the session. Idempotency becomes per-session, which matches HTTP transport semantics (B7).
6. In `src/tools/whats-new.ts:57`, change `defaultSession.versionCheck` to `getSession().versionCheck` (B11).
7. Delete or gate `src/state.ts` — the file-level `ACR_API_URL` and `defaultSession` getters become dead code for HTTP transport. If kept for stdio backward compat, document as `@deprecated use session factory`.

**Acceptance:**
- Phase 0's `mcp-http-session-isolation.test.ts` now passes.
- `pnpm typecheck` passes. No tool file imports `defaultSession` (grep assertion).
- Existing unit tests still green.
- CHANGELOG entry `2.5.0 — HTTP transport session isolation` written in the style of the 2.4.x entries.

**Risk:** Medium. Touches every tool file. Mitigated by: (a) mechanical change with one template, (b) typecheck catches missing arguments, (c) the new isolation test validates behavior, (d) the existing stdio integration test prevents regressions on the single-session path.

**Out of scope (deliberate):** No description changes, no terminology changes, no new features. This PR is strictly the factory thread-through.

---

## Phase 2 — `ensureRegistered` hardening (2.5.1)

**Goal:** Resolve B4 — stop emitting receipts under `pseudo_<hex>` when the register POST fails.

**Changes:**
1. In `src/session-state.ts:ensureRegistered` (around line 141-180): add a bounded retry loop (3 attempts with exponential backoff, total cap 5s) using `AbortSignal.timeout`. If all retries fail, throw a typed `RegistrationFailedError` instead of falling back to `pseudo_`.
2. Catch `RegistrationFailedError` in every tool's top-level handler. Return a tool result with `isError: true` and a user-facing message: "ACR registration failed — receipts for this session will not be attributed. Check network and retry: `check_environment`". Do NOT silently emit.
3. Remove the `pseudo_<hex>` fallback entirely. If telemetry shows a nonzero rate of failures that are *not* network-caused (e.g., server rejecting due to schema drift), add a separate path after telemetry is collected.
4. Add `tests/unit/ensure-registered.test.ts`: covers success, network failure → retry success, network failure → retry failure → typed error, malformed server response → typed error.

**Acceptance:**
- Grep confirms `pseudo_` no longer appears in `src/`.
- The new test covers all four paths.
- At least one tool (pick `log_interaction`) demonstrates the typed-error surface in an integration test.

**Risk:** Medium. Changes failure semantics for every tool. Mitigated by: (a) explicit error surface is better than silent failure, (b) the retry makes transient-failure rate go down, not up, (c) test coverage across paths.

---

## Phase 3 — Signal correctness (2.5.2)

**Goal:** Fix the four findings where computed values are wrong or attribution is lost.

**Changes:**
1. **B8 — `fetch-observer.ts:187`.** Replace `provider_class: 'unknown'` with `provider_class: session.providerClass`. Session is already in scope via the closure.
2. **B9 — `probes/environmental.ts:108`.** Same fix: `provider_class: session.providerClass`.
3. **B10 — `register-agent.ts:39-42`.** Update `computeCompositionHash` to accept rich composition (`skill_components`, `mcp_components`, `api_components`, `tool_components`) as well as flat `skill_hashes`. Canonicalize by stable JSON shape (sorted keys, sorted arrays). Add unit test that two equivalent rich compositions hash identically and that rich vs. flat agree when they describe the same set.
4. **B18 — `get-trend.ts:70`.** Read the server's actual response schema (likely in `packages/ingestion-api/src/routes/trend.ts`). Verify whether `latency_change_ratio` is a ratio (1.15) or a delta-fraction (0.15). Fix whichever side is wrong; add unit test asserting the render formula matches the contract. Document the chosen convention in a one-line schema comment.

**Acceptance:**
- `grep -r "provider_class: 'unknown'" packages/mcp-server/src/` returns zero hits.
- New unit test for composition-hash stability across rich/flat.
- New unit test for trend percentage math.
- Friction-report / trend tool output looks identical before and after for an agent with `provider_class: 'anthropic'` (visual spot-check).

**Risk:** Low. Small, isolated changes. B18 requires verifying server contract — do this before touching the render.

---

## Phase 4 — Server ingest hardening (server-side release)

**Goal:** Resolve B22 and B23 without breaking tenants.

This phase does **not** ship an MCP release. It ships a change to `packages/ingestion-api`.

**Changes:**
1. **B22 — `SHADOW_MODE`.** Replace the hardcoded `const SHADOW_MODE = true` (`receipts.ts:22`) with `process.env.ACR_SHADOW_MODE !== 'false'`. Default stays `true` (no behavior change on deploy). Add a follow-up ops ticket: "Flip `ACR_SHADOW_MODE=false` in prod on <date>". Individual anomaly checks should also honor a per-check override (`ACR_SHADOW_QUARANTINE`, `ACR_SHADOW_VOLUME_CAP`, `ACR_SHADOW_IP_CHURN`) so enforcement can be ratcheted check-by-check.
2. **B23 — `HARD_HOURLY_CAP`.** Replace the `const HARD_HOURLY_CAP = 10_000` with `parseInt(process.env.ACR_HARD_HOURLY_CAP ?? '10000', 10)`. Add a per-tenant override via a `tenants.hard_hourly_cap` column (or equivalent config table); if the table has a row for the incoming agent's tenant, that value takes precedence.
3. Document both in `packages/ingestion-api/README.md` under a new "Environment variables" section if none exists.
4. Add `tests/integration/ingest-shadow-mode.test.ts` covering: shadow-on (anomaly logged, not blocked), shadow-off (anomaly blocked), per-check shadow (quarantine off, volume-cap on).

**Acceptance:**
- Deploy to prod with defaults unchanged (`SHADOW_MODE=true`, cap=10k). No behavior change.
- Ops runbook entry added: "To enforce X, set env var Y".
- Integration test demonstrates the flip works.

**Risk:** Low to merge (defaults unchanged). Medium to flip in prod later — but that flip is reversible via env var.

---

## Phase 5 — Verdict calibration + thresholds (2.5.3)

**Goal:** Resolve B16 and B17. Externalize the friction-report verdict thresholds so they're documented, tunable, and reviewable.

**Changes:**
1. Create `packages/mcp-server/src/config/friction-thresholds.ts` exporting:
   ```ts
   export const FRICTION_VERDICT = {
     NETWORK_WIDE_MIN_PCT: 20,
     YOUR_CONFIG_MIN_ABSOLUTE_PCT: 5,
     YOUR_CONFIG_RELATIVE_MULTIPLIER: 2,
     YOUR_CONFIG_NET_CEILING_PCT: 5,
   } as const;
   ```
2. Refactor `get-friction-report.ts:308-319` to import these constants and drop the magic numbers.
3. Write `docs/friction-verdict-thresholds.md` (one page) explaining: what each threshold means, how it was chosen, what would change if it were tuned, how to override via env var if that becomes needed.
4. Reference the doc from both the tool description and a code comment above the constants.
5. Unit test: each threshold boundary produces the expected verdict ("config/network" vs "network-wide" vs no verdict).

**Acceptance:**
- Magic numbers gone from `get-friction-report.ts`.
- Doc file exists and is linked from the tool description.
- Unit test covers boundaries.

**Risk:** Very low. No behavior change; just moves numbers to a named constant and documents.

---

## Phase 6 — Tool description/menu/output bugs (2.5.4)

**Goal:** Resolve B12 (stale tool menu), B13 (description overclaim), B14 (wrong fallback render), B15 (unguarded `.join`).

**Changes:**
1. **B12 — `get-my-agent.ts` `TOOL_MENU`.** Add `get_revealed_preference`, `get_compensation_signatures`, `get_composition_diff`, `getting_started`. Group them sensibly (advanced lenses vs. onboarding). Add a CI check in `tests/unit/tool-menu.test.ts` that asserts the menu set equals the registered-tools set from `server.ts`.
2. **B13 — `summarize-my-agent.ts`.** Either (a) expand coverage to include trend, failure-registry, stable-corridors OR (b) rename the tool's description to "profile + friction + coverage snapshot". Option (b) is faster and preserves the tool's tight scope; option (a) is more work but delivers on the existing claim. Recommend (b) for this phase; file a follow-up for (a) if product wants it.
3. **B14 — `get-interaction-log.ts:77-79`.** When `receipt_id` is passed but the server returns a list, pick the matching receipt by ID (iterate `data.receipts` and match on `id`). If no match, surface "Receipt `<id>` not found" rather than returning 5 unrelated items.
4. **B15 — `log-interaction.ts:179`.** Guard `data.receipt_ids` with the same `Array.isArray` check that line 168 uses. If absent, render `Logged ${N} receipt(s)` without the id list.
5. Unit tests for each.

**Acceptance:**
- `tool-menu.test.ts` passes.
- `log_interaction` returns a clean success message when `receipt_ids` is null (new unit test).
- `get_interaction_log` with a specific receipt ID returns exactly that receipt or a clear not-found message (new integration test against a mock API).

**Risk:** Low. Localized per-file changes.

---

## Phase 7 — Auth harmonization (2.5.5)

**Goal:** Resolve B19, B20, B21 — the systematic missing auth headers across Group 3 & 7 tools, plus the `check_entity` render divergence.

**Changes:**
1. Create `src/utils/fetch-json-authed.ts` exporting `fetchJsonAuthed(url, session, init?)`. Wraps `fetch`, attaches `getAuthHeaders()` from the session, falls back cleanly on missing key, returns typed JSON or a clear error.
2. Route every `fetch(url)` call in `src/tools/*.ts` through `fetchJsonAuthed` where the server endpoint is tier-gated. Sites identified in audit: `check_entity:31,39`, `check_environment:18,19`, `search_skills:29`, `get_skill_tracker:23,38`, `get_skill_versions:18,59,67`, `get_network_status:19`.
3. If any endpoint is genuinely public (no tier gating), leave it on `fetch` but add a code comment justifying it and link to the server route. Decision per endpoint goes into a one-paragraph note in `packages/mcp-server/src/tools/README.md` (create if missing).
4. **B21 — `check-entity.ts` three-branch render divergence.** Expand the `agent` and `system` render branches to parity with `skill`: surface target counts, recent activity, anomaly signal summary, last-seen. If the server doesn't return those fields for agents/systems, add a server-side follow-up ticket rather than fake signals client-side.
5. Integration tests for each of the four fetch sites (one for each entity type plus search_skills / get_skill_tracker / get_skill_versions / get_network_status).

**Acceptance:**
- Every call to a tier-gated endpoint carries auth.
- Render parity across entity types (or explicit server-side TODO with ticket link).
- CI asserts no `fetch(` calls remain in `src/tools/*.ts` against ACR endpoints without going through `fetchJsonAuthed` (grep-based lint).

**Risk:** Low. Mechanical refactor + one render expansion.

---

## Phase 8 — Small-bucket mechanical sweeps (2.6.0)

**Goal:** Land the high-ROI theme clusters from AUDIT.md's small bucket.

These are one-module-one-PR-each changes. Merge in order; each is independent.

### 8.1 — C1 null-guards & safe-render (`src/utils/safe-render.ts`)

Extract: `truncHash(h: string | null | undefined, len = 12)`, `fmtRatio(n: number | null, kind: 'delta-fraction' | 'ratio')`, `fmtDate(iso: string | null)`, `kvPairs(obj: Record<string, unknown>)`. Audit grep identifies 10+ sites. Apply the helper at every site.

### 8.2 — C4 style consistency (`src/utils/render-style.ts`)

Extract: `section(title)` → `── ${title} ──`, `arrow()` → `→`, `bullet()` → `•`. Normalize all tool output. **One exception:** operator-facing operational output (e.g., the verdict line in `get_friction_report`) can stay ASCII-only for clean terminal paste.

### 8.3 — C13 source enum + C15 prefix constants (`src/constants.ts`)

```ts
export const RECEIPT_SOURCES = { AGENT: 'agent', SERVER: 'server', OBSERVER: 'fetch-observer', ENVIRONMENTAL: 'environmental' } as const;
export const CHAIN_PREFIXES = { SESSION: 's-', SERVER: 'srv-' } as const;
export const AGENT_PREFIXES = { REAL: 'acr_', PSEUDO: 'pseudo_' } as const;
export const SELF_LOG_TARGET = 'mcp:acr-registry';
```

Replace string literals across: `log-interaction.ts`, `self-log.ts`, `fetch-observer.ts`, `environmental.ts`, `receipts.ts`, `receipts-read.ts`, `session-state.ts`, `register-agent.ts`.

### 8.4 — C14 composition-empty helper (`src/utils/is-composition-empty.ts`)

Single function used by `get_my_agent`, `get_notifications`, `summarize_my_agent`, `get_composition_diff`.

### 8.5 — C6 truncation limits (`src/utils/render-limits.ts`)

```ts
export const TOP_N = { DENSE: 10, DEFAULT: 5, SPARSE: 3 } as const;
```

Replace ad-hoc numbers across friction-report, failure-registry, stable-corridors, whats-new, composition-diff.

### 8.6 — C10 scope enum (`src/constants.ts` addition)

```ts
export const LENS_SCOPES = ['session', 'day', 'yesterday', 'week', 'month', 'all'] as const;
export type LensScope = typeof LENS_SCOPES[number];
```

Every lens tool's Zod schema imports and uses this enum. Harmonize missing values (e.g., `get_trend` gains `session`, or it's explicitly excluded with a comment).

**Acceptance for Phase 8:** `pnpm typecheck` + full test suite green. No behavior changes. CHANGELOG entry lists the 6 extracted modules.

**Risk:** Low. All mechanical, all covered by existing tests. The change is net line-count negative.

---

## Phase 9 — Confidence + pagination + description drift (2.6.1)

**Goal:** C5, C9, C12.

### 9.1 — C5 Confidence tag coverage

Audit every "% rate" or "N samples" render. For each, decide: (a) apply `confidence(N)` tag against the denominator the stat is calculated over, OR (b) add a companion `(N samples)` suffix, OR (c) drop the tag if the stat is not sample-dependent. Fix the wrong-denominator bug in `get-skill-tracker.ts:57,84` by applying the tag to `signalCount`, not `interactionCount`. Import `PRE_SIGNAL_MAX` / `DIRECTIONAL_MAX` from `utils/confidence.ts` in every caller that uses the tag; drop per-file magic thresholds.

### 9.2 — C9 cursor pagination

Add `cursor: z.string().optional()` input to: `get_interaction_log`, `search_skills`, `get_skill_tracker`, `get_notifications`. Thread through to the server URL as `?cursor=`. Render "Next page: cursor=..." in the tool output when `data.next_cursor` is present. Drop "Increase limit to see more" messages that don't apply.

### 9.3 — C12 description accuracy audit

One-pass review of every tool description. Cross-check against actual schema and handler behavior. Fix drift in: `get_coverage` (add field examples), `search_skills` (tighten `source` description or enforce enum), plus others noted in audit.

Add `tests/unit/tool-descriptions.test.ts` that asserts each description references the correct parameter names and doesn't contain obvious overclaim strings ("all lenses" → compare to actual call count).

**Acceptance:** New tests green. `tool-descriptions.test.ts` forms an ongoing guardrail.

**Risk:** Low.

---

## Phase 10 — Terminology rename pass (2.7.0)

**Goal:** Resolve C7 — pick "anomaly signal" as the canonical user-facing term and rename threat/notification/scan.

This is the largest small-bucket cluster because it crosses the MCP ↔ server boundary and touches the database.

**Changes:**
1. **Catalogue.** Grep for `threat`, `Threat`, `THREAT`, `notification_type`, `scan_score` across MCP, ingestion-api, and SQL migrations. Produce a before/after rename table.
2. **Database migration.** Add columns with new names, backfill from old, keep both for one release cycle. Drop old columns in the release **after** this one (2.7.1 or later).
3. **Server endpoints.** Add new endpoint paths (`/api/v1/anomaly-signals/...`). Keep old paths aliased for one release cycle. Deprecation header on old.
4. **MCP tools.** Rename `acknowledge_threat` → `acknowledge_signal`. `check_entity`'s `threat_patterns` field → `anomaly_pattern_categories`. `check_environment`'s threats endpoint → anomaly-signals endpoint. Tool descriptions updated. CHANGELOG is explicit about the rename.
5. **Compatibility notes.** Because this is a breaking rename, the CHANGELOG entry for 2.7.0 must be explicit: "Tool `acknowledge_threat` renamed to `acknowledge_signal`. Old name remains registered as a deprecated alias for this release only; will be removed in 2.8.0."

**Acceptance:**
- Migration applied; both schemas present.
- MCP tools respond under new names; old names work with a deprecation warning in the response.
- Integration tests cover both paths.
- 2.8.0 roadmap ticket: "Drop deprecated aliases".

**Risk:** Medium. Crosses three layers. Mitigated by: (a) one release of dual-write/dual-read, (b) explicit deprecation warnings, (c) end-to-end integration tests before the rename goes live.

---

## Phase 11 — UX + docs sweeps (2.7.1)

**Goal:** Resolve C3 (ensureRegistered helper already fixed in Phase 2 — just propagate messaging), C8 (truncated ID disclosure), C11 (empty-state next actions), C16 (mutation diffs).

**Changes:**
1. **C8 — truncated IDs.** Standardize inline render to 12 chars + `...`, support `verbose: true` param across `register_agent`, `check_entity`, `get_skill_tracker`, `get_skill_versions` to reveal full IDs in a footer. Shorten overly-long IDs in `get_notifications:62` to match.
2. **C11 — empty-state next actions.** Every `if (list.length === 0) return noDataMessage` branch gets either a next-tool link ("Tip: call `get_X` to ...") or an explicit "this is a healthy state" marker. Sites: friction-report population drift, coverage all-green, failure-registry no-failures, whats-new nothing-degraded.
3. **C16 — mutation diffs.** `update_composition`, `acknowledge_threat`, `register_agent` return a diff in their response — `{ added: [...], removed: [...], unchanged: [...] }` for composition; `{ acknowledged_at, was_already_acknowledged }` for signals. Operators can verify the change without a follow-up read.
4. **C3 propagation.** Every tool that calls `ensureRegistered` surfaces the Phase 2 typed error consistently. Minor: the error message should include "try `check_environment` to verify network" in the message body.

**Acceptance:** UX smoke test — run an agent through a register → update → query flow and confirm the output is self-explanatory at each step.

**Risk:** Low.

---

## Phase 12 — Cross-cutting hygiene (2.7.2)

**Goal:** Wrap up the cross-cutting findings that didn't fit elsewhere.

**Changes:**
1. **Env-var helper.** `src/utils/env-bool.ts` accepting `'1' | '0' | 'true' | 'false' | 'yes' | 'no'` case-insensitively. Route every `process.env.ACR_*` boolean read through it. Fixes the naming-convention drift called out in Cross-cutting #9.
2. **`server` device bucket.** Extend `env-detect.ts:inferDeviceClass` with a real `server` branch. Heuristic: if `process.env.KUBERNETES_SERVICE_HOST` or `AWS_EXECUTION_ENV` is set, return `server`. Else fall through to the memory-based default. Document the heuristic inline.
3. **`observeComposition` Phase-2 plan.** Write `docs/composition-observation.md` outlining what the Phase-2 host-plugin integration looks like (Claude Code plugin, Cursor plugin, etc.). The stub stays `{}`; this is just the plan.
4. **Version-check memoization.** In `server.ts`, hoist `checkLatestVersion` into a module-level memoized promise so HTTP transport's per-session `createAcrServer` doesn't re-hit npm each session. One `Promise<VersionCheckResult>` per process. Existing test covers the correctness; add one test asserting `fetch` was called once across N `createAcrServer` calls.
5. **Graceful shutdown of background promises.** In `server.ts`, track the env-probe and version-check promises on the server instance. When `server.close()` fires, `AbortController.abort()` both. Prevents receipts from landing against a torn-down HTTP session.
6. **Env-var documentation.** Extend `server.json:environmentVariables` to list every MCP-consumed env var. Currently only `ACR_API_URL` is documented; ship at minimum `ACR_DISABLE_FETCH_OBSERVE`, `ACR_DISABLE_ENV_PROBE`, `ACR_DISABLE_VERSION_CHECK`, `ACR_DEEP_COMPOSITION`, `ACR_RESOLVER_URL`.

**Acceptance:** All 🟡 small findings in the cross-cutting section of AUDIT.md either closed or explicitly punted with a ticket reference.

**Risk:** Very low.

---

## Risk register

| Risk | Phase | Mitigation |
| --- | --- | --- |
| Phase 1 regression breaks stdio users | 1 | Phase 0's stdio happy-path integration test; release candidate on npm `next` tag first |
| Phase 2 flips tools from silent-fail to error-surface — agents may see errors they didn't before | 2 | CHANGELOG is explicit. Error message is actionable. Retry-with-backoff reduces transient errors before they surface. |
| Phase 4 prod flip (shadow-mode off) breaks ingest for high-volume tenants | 4 | Per-check shadow overrides allow ratcheting one enforcement at a time. Ops runbook has a rollback (env-var flip). |
| Phase 10 rename pass breaks agents using the old `acknowledge_threat` | 10 | One release of dual-register under both names with deprecation warning in response. Removal only in 2.8.0. |
| Tests don't exist for most tools yet | all | Phase 0 adds the core harness. Each later phase adds tests for what it touches. Full coverage isn't the bar; "the fix has a test" is. |
| A finding closed in one phase re-regresses when a later phase refactors the same file | all | Every closed finding has a test. Test guards the fix. |

---

## Test strategy

Each phase must answer: *"What test would have caught the bug this phase resolves?"*

- **Unit tests** (`tests/unit/`): pure functions, parsing, rendering, math. Fast. No mocks beyond what vitest provides.
- **Integration tests** (`tests/integration/`): tool-level behavior against a mock ACR server (the server-side endpoints have their own integration tests already). Use the HTTP transport path when the test exercises session isolation.
- **CI grep checks**: for architectural rules that don't fit a runtime test. Example: "no `fetch(` in `src/tools/` that doesn't go through `fetchJsonAuthed`" is a grep + assertion in CI.
- **Manual smoke tests**: each MCP release candidate runs through the basic agent flow (register → update → log → friction-report → notifications) against dev API. Documented in `docs/release-smoke.md` (create in Phase 0 if missing).

Don't retrofit tests to a fix after landing. The test goes into the same PR as the fix.

---

## Release shape

Every MCP release follows the existing pattern:

1. CHANGELOG entry at the top of `packages/mcp-server/CHANGELOG.md` in the style of 2.4.x entries (headline, bulleted changes, "Breaking: none" or explicit break notes).
2. Version bump in `packages/mcp-server/package.json` and `server.json` (both must match — `publish.yml:54-57` enforces this).
3. PR merged to `master`.
4. Tag `v<version>` pushed.
5. `publish.yml` picks up the tag, builds, publishes to npm + MCP registry via GitHub OIDC (no manual steps).
6. Optional: announce via dashboard notification for material changes (phase 1, 2, 10).

**Phase 4 (server-side)** follows the server's own release cadence — no MCP publish.

---

## Open questions / decisions pending

These should be resolved before the phase that depends on them lands:

1. **[Phase 2]** When `ensureRegistered` fails, should tools return `isError: true` (MCP-protocol error) or a text response with an error message? MCP clients vary in how they render each. **Recommend:** `isError: true` with the message in content — clients should render it, but clients that don't still see the text.
2. **[Phase 4]** What's the prod flip-date for `ACR_SHADOW_MODE=false`? Needs ops sign-off + a plan for the first week of enforcement. **Recommend:** flip per-check in this order: `IP_CHURN` first (lowest blast radius), `VOLUME_CAP` second, `QUARANTINE` last.
3. **[Phase 10]** Should `acknowledge_threat` be kept as a permanent alias for agents that memorized the name, or truly deprecated? **Recommend:** deprecate through 2.8.0, remove in 2.9.0. Six-month-minimum deprecation window.
4. **[Phase 5]** Should friction-verdict thresholds be env-var overridable from day one, or only after we have real-world data showing the defaults are wrong? **Recommend:** env-var-overridable from day one (cost is low, ops flexibility is valuable).
5. **[Phase 8.3]** Is it worth exposing `RECEIPT_SOURCES` to consumers (e.g., in the tool description for `get_interaction_log`'s `source` filter)? **Recommend:** yes — include the enum values in the `source` filter's `.describe()`.

---

## Post-cleanup state (definition of done)

When all 12 phases are complete:

- Every 🔴 Big finding in AUDIT.md is either **resolved** (code change shipped + test) or **explicitly deferred** (ticketed with a dated review). No 🔴 finding is silently dropped.
- Every 🟡 theme cluster has either a merged extraction PR or a one-paragraph "won't fix, here's why" note appended to AUDIT.md.
- The MCP is on **v2.7.2** (from 2.4.1 → seven MINOR bumps across eleven MCP releases).
- `tests/` has roughly 40–60 additional tests covering the surfaces that had no tests before.
- `docs/` has three new docs: `friction-verdict-thresholds.md`, `composition-observation.md`, `release-smoke.md`.
- CI has at least three new grep-based architectural guards: no `defaultSession` in tools, no unauthed fetch in tier-gated tools, tool-menu-matches-registration.
- `AUDIT.md` closing section appended: "**Resolution summary:** X of Y 🔴 findings closed, Z deferred. A of B 🟡 clusters closed, C deferred."

---

## How to pick this up

Start with Phase 0. It takes half a day and every later phase depends on it. After Phase 0, Phases 1 through 7 must land in order — each depends on the last for behavior parity. Phases 8 through 12 are independent and can be parallelized if more than one engineer is on it.

Every commit in this cleanup references `AUDIT.md:<line>` for the finding being resolved, plus `CLEANUP_PLAN.md#phase-<N>` for context. That way the history is auditable end-to-end.
