# ACR MCP Quality Audit

**Version audited:** `@tethral/acr-mcp@2.4.1`
**Date:** 2026-04-21
**Scope:** 26 tools + all supporting code (middleware, probes, session state, utils, state shim, version-check, server factory, entry points) + direct server endpoints
**Mode:** Read-only — this file catalogues findings; fixes land in follow-up commits that reference `AUDIT.md:L<line>`.

## Three dimensions

1. **Quality** — does the signal say what we claim? (math, edge cases, type safety, agreement with server)
2. **Accessibility** — can you find and read it? (descriptions, schemas, output clarity, error messages)
3. **Utility** — does knowing it change what you do? (write the "If I see X, then I do Y" sentence; if Y is vague, flag)

## Fix buckets

- 🔴 **Big** — wrong numbers, broken edge cases, unchoosable tools, output leading to wrong actions, missing signal the tool claims
- 🟡 **Small** — typos, jargon, inconsistent formatting, dead sections, missing confidence tags, minor UX

No finding is too small to catalogue.

---

## Table of contents

- [Executive summary](#executive-summary) _(filled in at end)_
- [Group 1: Identity & onboarding](#group-1-identity--onboarding)
- [Group 2: Core logging](#group-2-core-logging)
- [Group 3: Primary lenses](#group-3-primary-lenses)
- [Group 4: Advanced lenses](#group-4-advanced-lenses)
- [Group 5: Composition management](#group-5-composition-management)
- [Group 6: Notifications](#group-6-notifications)
- [Group 7: Safety & registry](#group-7-safety--registry)
- [Cross-cutting findings](#cross-cutting-findings) _(supporting code, patterns across tools)_
- [🔴 Big bucket](#-big-bucket)
- [🟡 Small bucket](#-small-bucket)

---

## Executive summary

### Headline

**The MCP is production-quality in its primary function (emitting receipts, rendering lenses) but has a single architectural bug that corrupts every HTTP-transport session's attribution.** Fixing it is mechanical: change 18 tool factory signatures to accept `getSession: () => SessionState` and drop the `defaultSession` imports. That one change resolves seven of the 23 🔴 Big findings and the majority of the HTTP-transport-leak class of bugs.

Beyond that single fix, findings split into three groups: (1) a handful of real quality bugs (wrong math, hardcoded magic numbers, silent-failure modes), (2) a larger set of small polish issues (null-guards, dividers, arrow styles, truncation limits), and (3) a wide set of accessibility/UX gaps (missing next-actions, drifting terminology, stale tool menus).

### Numbers

| Category | Count |
| --- | --- |
| 🔴 Big findings | 23 (Tier A: 7, B: 8, C: 3, D: 5) |
| 🟡 Small findings | ~230 (collapse to 16 theme clusters) |
| Independent fixes after collapsing | ~17 Big + 16 Small-bucket sweeps |
| Files audited | 37 (every file in `packages/mcp-server/src/`) |
| Tools audited | 26 of 26 |

### Top 5 priority fixes

1. **[B1 — `getSession` factory split]** `server.ts:124-149`. Change 18 tool factories to accept a session. Fixes B2, B3, B5, B6, B7, B11 along with it. Estimated: 1 day of mechanical work + test coverage for HTTP transport concurrency.
2. **[B22 + B23 — server shadow-mode tripwires]** `packages/ingestion-api/src/routes/receipts.ts:22,25`. `SHADOW_MODE = true` and `HARD_HOURLY_CAP = 10_000` are hardcoded. Convert both to env vars with explicit defaults. Shadow-mode needs a flip-date or a per-check opt-out so we can ratchet enforcement live.
3. **[B4 — `ensureRegistered` silent degradation]** `session-state.ts:160`. Ghost-agent receipts are being emitted in the field right now whenever the register POST fails. Surface the failure on the next tool call, or refuse to proceed with a clear error. Bounded retries with backoff.
4. **[B18 — `get_trend` ratio/delta-fraction ambiguity]** `get-trend.ts:70`. One of the tool render or the server contract is off by 100x. Verify which, fix the wrong side. This is user-facing math that operators may already be acting on incorrectly.
5. **[B8 + B9 — `provider_class: 'unknown'` copy-paste]** `fetch-observer.ts:187` and `probes/environmental.ts:108`. Session is already in scope in both; one-line fix each. Corrupts cohort-rank math for every observer-heavy agent today.

### Headline patterns

- **HTTP transport is half-supported.** The factory pattern exists (four tools use it correctly), but 18 tools still read `defaultSession`. Under the stdio singleton this is harmless; under HTTP's per-session state this leaks identity, provider_class, chain_id, and version-check state across sessions. The fix is structural but not invasive.
- **`provider_class: 'unknown'` appears twice in observer/probe code when the session is already in scope.** Fix both sites, then grep the repo to make sure there isn't a third.
- **Group 5 (composition management) and Group 6 (notifications) are the cleanest tools in the MCP.** They use the factory pattern, handle empty states well, and have the best descriptions. They're the blueprint for fixing Groups 1-4.
- **Group 3 (primary lenses) has the strongest signal-per-call surface** — friction-report verdicts, coverage gaps, stable corridors — but hardcoded heuristics (B16, B17) and a probable math bug (B18) sit inside the verdict logic with no calibration surface.
- **Group 7 (safety & registry) has a systematic auth-header omission** across five tools. Either these endpoints are intentionally public (document it) or it's a copy-paste bug (fix it). Harmonize with one `fetchJsonAuthed` helper.
- **Tool descriptions drift from schemas and behavior.** `summarize_my_agent` claims "all lenses" but renders three of eight. `get_my_agent`'s menu lists 22 of 26 tools. Operators and LLMs both pick tools from these surfaces; stale descriptions become stale tool choices.
- **Environment variables use three different boolean conventions in the same codebase** (`=1`, `=true`, `!=='false'`). A single `envBool()` helper would prevent a class of future "I set it and it didn't work" bugs.
- **16 small-bucket theme clusters collapse ~230 individual findings.** Most are "extract one helper, apply in N places." Shipping these as small, scoped PRs is straightforward — each cluster is one reviewable unit.

### What we didn't find

- No security vulnerabilities in auth handling, token storage, or state-file format beyond the auth-header omissions in Group 7.
- No evidence that receipts are being lost at volume — correlation window, eager eviction, and hard cap all correctly implemented.
- No signs that the receipts-read query path has injection vectors (parameterized queries throughout).
- No findings in `middleware/correlation-window.ts` (cleanest file in the Group 2 set).
- No real concerns in `utils/strip-sub-components.ts` or `utils/resolve-agent-id.ts` beyond micro-polish.

### Working the audit

The per-tool sections below are ordered to match the actual file layout under `src/tools/`. Each tool has Quality / Accessibility / Utility subsections, with 🔴 findings first and 🟡 findings after. Cross-cutting findings live in their own section and should be read *before* diving into per-tool fixes — understanding the `getSession` split dissolves half of what looks like unrelated tool bugs.

Then:
- **🔴 Big bucket** — ordered by severity (Tier A → D), each finding with a file+line anchor and a one-line handle.
- **🟡 Small bucket** — organized as a navigation index (per-tool counts + anchors) plus 16 theme clusters. The clusters describe the mechanical shape of the fix; the per-tool sections have file+line detail.

Commits landing against this audit should reference `AUDIT.md` lines. Findings are stable — adding fixes here doesn't require updating line numbers (each finding is labeled with its file+line).

---

---

## Group 1: Identity & onboarding

**Tools audited:** `register_agent`, `get_my_agent`, `getting_started`, `summarize_my_agent`
**Supporting code audited:** `state.ts`, `session-state.ts`, `acr-state-file.ts`, `strip-sub-components.ts`, `utils/resolve-agent-id.ts`
**Server endpoint audited:** `packages/ingestion-api/src/routes/register.ts`

### `register_agent` (`tools/register-agent.ts`)

**Quality**
- 🔴 **HTTP transport privacy leak.** Line 53: `const deep = defaultSession.deepComposition;` reads the stdio singleton. On HTTP transport with concurrent sessions, this reads the wrong session's deep-composition flag. An operator who disabled `deep` on session A will have their sub-components leaked if session B (with deep on) registers concurrently. Pattern to fix: `register_agent` needs the `getSession` factory like `update_composition`/`acknowledge_threat` use.
- 🔴 **Composition hash misrepresents rich composition.** `register.ts:39-42` computes `composition_hash` from `skill_hashes` only — ignores `skill_components`, `mcp_components`, `api_components`, `tool_components`. An agent with rich composition but no flat `skill_hashes` gets `computeCompositionHash([])` = the same constant hash every registration. Drift detection downstream will never fire for rich-composition changes.
- 🟡 Line 108: `s.skill_name || s.skill_hash?.substring(0, 16) + '...'` — when both are absent, renders literal `undefined...`. Guard or fallback label needed.
- 🟡 Line 93: `if (data.name) setAgentName(data.name)` — server always returns `name` (line 181 of register.ts), but the guard suggests it might be optional. Mismatch between tool expectation and server contract.
- 🟡 Line 95 `writeAcrStateFile(...)` duplicates the write that `SessionState.ensureRegistered` does at `session-state.ts:156`. Idempotent so harmless, but redundant.

**Accessibility**
- 🟡 Description is padded with ~200 chars of `DATA_NOTICE` legal text. Pushes meaningful signal below fold when an LLM is scanning descriptions. Move to a dedicated `privacy_policy` tool-meta or separate `get_data_policy` lookup.
- 🟡 `public_key` field `describe()` says "Agent public key or unique identifier (min 32 chars)" — no guidance on what format is expected or what the key is *for*. Auto-reg uses `pseudo_<hex>`; a user reading this doesn't know if they need an Ed25519 key or a random string.
- 🟡 `provider_class` enum fixed at 9 values (`anthropic`, `openai`, `google`, `openclaw`, `langchain`, `crewai`, `autogen`, `custom`, `unknown`). No `mistral`, `cohere`, `grok`, `xai`. Forces current users onto `custom` without explanation of the `custom` vs `unknown` distinction.
- 🟡 `"openclaw"` is in the enum — typo? Likely meant `openchat` or similar. (Could be intentional internal shorthand; flag for confirmation.)

**Utility**
- 🟡 `environment_briefing.skill_signals` renders counts but no action. "Skill X — 3 signals, 12 reporters" — what does the user do with that? Should end with "→ call `check_entity skill:<name>` for details" or "→ call `get_notifications`".
- 🟡 `connected_systems` length is computed but only shown as a count (line 102). No surface of which systems — could be a teaser for `get_network_status`.

---

### `get_my_agent` (`tools/get-my-agent.ts`)

**Quality**
- 🔴 **Tool menu is stale — 4 tools missing from the "grouped menu of all available tools".** `TOOL_MENU` (lines 6-13) lists 22 of 26 tools. Missing: `get_revealed_preference`, `get_compensation_signatures`, `get_composition_diff`, `getting_started`. Description claims "a grouped menu of all available tools" — overclaim. Users (and LLMs picking tools) won't discover these from `get_my_agent`.
- 🟡 Line 43: `fetch(\`${apiUrl}/api/v1/agent/${id}\`, ...)` uses raw `fetch()` while the other 4 sibling calls use `fetchJsonSafe`. If this raw fetch throws (network), `Promise.all` rejects and the whole response becomes an `Error:` line — the other 4 lenses' data is discarded. Convert to `fetchJsonSafe` so partial-health is still useful.
- 🟡 Line 50 type cast claims `name: string | null` — server contract always returns non-null. Type lie.
- 🟡 Line 131 `flags.slice(0, 3)` silently drops flags 4+. If 7 things are wrong, user sees 3 and thinks that's it. Render `"+N more — call get_friction_report for detail"` or similar.
- 🟡 Composition-empty detection (lines 98-108) only fires when ALL three counts are 0. An agent with 2 skills but 0 MCPs and 0 tools doesn't trigger the flag — probably correct, but the heuristic is implicit. Comment or make thresholds explicit.

**Accessibility**
- 🟡 Line 105: `"Composition empty — targeted notifications disabled"` — jargon. What makes a notification "targeted"? Contrast with what? Explain inline or link to `update_composition` docs.
- 🟡 Line 115: `"Coverage gaps: X — some lens data unavailable"` — vague. Which lens, which specific output is missing? Could surface 1-2 named consequences like `getting_started` does via `SIGNAL_COSTS`.
- 🟡 `TOOL_MENU` uses `·` separator between tools — fine, but inconsistent with other places using `, ` (comma-separated).

**Utility**
- 🟢 Dashboard link → high utility, user can click through.
- 🟢 Health flags are actionable ("call `update_composition`", "call `get_notifications`").
- 🟡 No "next suggested tool" surfaced (compare with `getting_started` which ends on `Next step: ...`). Entry-point tools should all end with explicit next action.

---

### `getting_started` (`tools/getting-started.ts`)

**Quality**
- 🟢 Clean fetchJsonSafe usage; no raw fetch.
- 🟢 `SIGNAL_COSTS` map translates signal names to human-readable consequences — excellent.
- 🟡 Line 113 uses `!` for partial coverage marker; steps 1-3 use `✗` for missing. Four-symbol vocabulary (`✓`/`✗`/`!`/`?`) is fine but the `!` specifically mixes in where `✗` could fit. Minor consistency.
- 🟡 Line 123 `"? Coverage data unavailable — call get_coverage for details"` — but `get_coverage` hits the same endpoint that just returned nothing. Dead-end advice.

**Accessibility**
- 🟢 Numbered steps + "Next step:" conclusion is textbook. Best entry-point tool in the MCP.
- 🟡 `agent_id` and `agent_name` input params describe themselves but don't say they're optional in the schema hint. Zod `.optional()` is implied; still worth being explicit.

**Utility**
- 🟢 Strong across the board. Every step ends with ✓ or a pushed action.
- 🟡 No dashboard link (compare `get_my_agent:64`). Could close the loop on "what does my profile look like once it's populated" by linking to the dashboard at the end.
- 🟡 `nextActions[0]` (line 131) shows only the first action — if both "log interactions" and "update composition" are missing, only one is surfaced. Consider listing top 2.

---

### `summarize_my_agent` (`tools/summarize-my-agent.ts`)

**Quality**
- 🔴 **Overclaim in description.** "Single-read overview of your interaction profile across all available lenses" — actually fetches only 3 of 8 lenses (profile, friction, coverage). Missing: trend, failure-registry, stable-corridors, revealed-preference, compensation-signatures, composition-diff, network-status. Either rename to "profile + friction + coverage snapshot" or expand coverage.
- 🟡 Line 59: `${c.total_receipts} receipts across ${c.distinct_targets} targets over ${c.days_active} day(s)` — no null guards. If server returns partial counts, `undefined receipts across undefined targets` renders.
- 🟡 Line 103: `friction_percentage` rendered with `.toFixed(1)` — no unit or context. Is 15.0 fifteen percent or 0.15? Check server (tentative: likely 0-100 percent; verify).
- 🟡 Line 110: `median ${t.median_duration_ms}ms` — but `t.median_duration_ms` could be missing for thin slices. Renders `median undefinedms`.

**Accessibility**
- 🟡 Section dividers use `-- Section --` — inconsistent with `── Section ──` (box-drawing) used in `whats_new`, `get_my_agent`. Unify to one style across all tools.

**Utility**
- 🟡 Doesn't surface a next action at the end. Compare `getting_started`'s "Next step:". User reads status, then has to guess which lens to call next.
- 🟢 Smart scope fallback (today → yesterday → week) is a great UX touch — don't lose it.

---

### Supporting code findings

#### `state.ts`
- 🔴 **All state.ts getters read `defaultSession` — incorrect for HTTP transport.** Tools that call `getAgentId()`, `getAgentName()`, `getApiKey()`, `getAuthHeaders()`, `ensureRegistered()` via `state.js` read the stdio singleton regardless of transport. For HTTP with per-session state, every Group 1+ tool that uses `state.js` is routing identity through the wrong session. Needs an AsyncLocalStorage-backed current-session shim, or the factory pattern (`getSession: () => SessionState`) applied across every tool consistently.
- 🟡 Line 8 `const ACR_API_URL = process.env.ACR_API_URL ?? ...` — frozen at module load. If `ACR_API_URL` is mutated at runtime (tests, programmatic control), `getApiUrl()` doesn't see it. Minor; compare server.ts which reads env at `createAcrServer` call.

#### `session-state.ts`
- 🔴 **Silent degradation on registration failure.** `ensureRegistered` (line 160) falls back to `pseudo_<hex>` when the POST fails. Subsequent tool calls then send receipts under this pseudo ID that the server has never seen. The agent operates as a ghost. Should either (a) retry with backoff, (b) surface the failure on the next tool call, or (c) refuse to proceed and let the tool return a clear error.
- 🟡 `ensureRegistered` (line 141) has no timeout, no retry. If the register endpoint hangs, first tool call hangs indefinitely. Add AbortSignal with a reasonable timeout (2-5s).
- 🟡 `CLIENT_TO_PROVIDER` (line 11) is hardcoded to 9 clients. No fallback mapping for new MCP clients (continue-dev variants, Cline forks). Add `'unknown' → 'unknown'` pathway and/or a generic `mcp-*` prefix handler.
- 🟡 Hydration from state file (line 120) doesn't verify the agent still exists server-side. If the agent was deleted or the user switched instances, we run against a stale ID.
- 🟡 Chain-id `s-` prefix (line 75) is documented only in the inline comment — no surfaced meaning anywhere. Compare with server-minted `srv-` and agent-supplied (no prefix). Minor: document the chain-id provenance scheme in a shared constants file.

#### `acr-state-file.ts`
- 🟡 Path hardcoded to `~/.claude/.acr-state.json` — Claude Code specific. Other MCP hosts (Cursor, Continue, Cline, Zed, etc.) won't place their host-plugin equivalent here. Either relocate to `~/.acr/state.json` (host-neutral) or document that this file is Claude-Code-host-integration-only.
- 🟡 `readAcrStateFile` has no schema validation. A corrupt or adversarial state file with `agent_id: {}` propagates the object where a string is expected. Validate shape before returning.
- 🟡 No file locking. Two concurrent MCP processes on the same machine race on write. In practice rare but not impossible.

#### `utils/resolve-agent-id.ts`
- 🟡 Line 14 `state: { getAgentId?: ..., getAgentName?: ... } = {}` — parameter is accepted but **never used**. Lines 32-33 call `getAgentId()` and `getAgentName()` imported from state.js directly, bypassing the injected `state` object. Dead parameter; delete or wire it in. (This was likely added for testability and forgotten.)
- 🟡 Line 20 `startsWith('acr_') || startsWith('pseudo_')` — if a future ID prefix is introduced (e.g., `srv-minted`), the heuristic silently breaks. Centralize the ID-prefix recogniser somewhere.

#### `strip-sub-components.ts`
- 🟢 Clean, generic, no issues.

---

### Group 1 summary

- **Big findings:** 6 (HTTP privacy leak in register_agent, composition_hash misrepresents rich composition, get_my_agent tool menu stale, summarize_my_agent description overclaims coverage, state.ts reads wrong session for HTTP, ensureRegistered silent degradation).
- **Small findings:** ~30 (see above).
- **Cross-cutting patterns observed:** (1) Many tools assume stdio singleton via `state.js` — HTTP transport support is half-done. (2) Tool menus and descriptions drift out of sync with actual tool inventory. (3) `-- Section --` vs `── Section ──` divider inconsistency across tools. (4) "next action" surfaced inconsistently across entry-point tools.

---

## Group 2: Core logging

**Tools audited:** `log_interaction`, `get_interaction_log`
**Supporting code audited:** `middleware/self-log.ts`, `middleware/correlation-window.ts`, `middleware/fetch-observer.ts`, `probes/environmental.ts`
**Server endpoints audited:** `packages/ingestion-api/src/routes/receipts.ts`, `packages/ingestion-api/src/routes/receipts-read.ts`

### `log_interaction` (`tools/log-interaction.ts`)

**Quality**
- 🔴 **HTTP transport privacy leak (same as Group 1).** Lines 91, 124, 150: `defaultSession.nextChainContext(nowMs)`, `defaultSession.providerClass`, `defaultSession.transportType` — reads the stdio singleton. On HTTP transport with concurrent sessions, the chain context is shared across unrelated agents (chain IDs leak), and every receipt is tagged with the wrong provider_class / transportType. This is the *most important* tool in the MCP to route through per-session state — every receipt attributed wrong corrupts every lens.
- 🔴 **`data.receipt_ids.join(', ')` at line 179 trusts what line 168 checks.** Line 168 guards `Array.isArray(data.receipt_ids)` for the correlation-window insert, but line 179 calls `.join(', ')` without the same guard. If the server returns `{accepted: N, receipt_ids: null}` or omits the field, the tool throws and the agent loses the `Logged N receipt(s)` confirmation — despite the receipt actually landing.
- 🟡 Line 134 `request_timestamp_ms: nowMs - (params.duration_ms ?? 0)` — subtracts duration from *now* to back-date the request. Correct if the tool call completed right before `log_interaction` is invoked, but has no idea how long the agent deliberated before calling `log_interaction` — any delay between the observed call finishing and the log emit shifts the recorded start time forward. Silent skew. Document or offer `request_timestamp_ms` as an explicit param.
- 🟡 `inferSystemType` at lines 7-14 — `api` maps to `api` but `skill` maps to `skill`, inconsistent with how `target.system_type` is used elsewhere. Verify server expects `api` vs `mcp_server`; the constant set here drifts from what the server normalizes to.
- 🟡 `categories` building (lines 109-116) hardcodes seven field names. If a new category field is added to the schema (common — schema already grew twice in 2.3+), it must be added in four places: schema, tool handler, server receipts.ts, lens renderers. No single source of truth.
- 🟡 Line 61 `tokens_used: z.number().int().min(0)` — 0 should probably not be rejected, but the tool also accepts 0 *and* treats it as "reported as zero" vs "not reported" identically. The friction report's wasted-token callout can't distinguish. Consider `.min(0)` but document the zero ambiguity.
- 🟡 Line 48 `error_code: z.string().max(50)` with example `"429"` — HTTP codes are usually integers in most systems. Pass-through is fine but the docstring should be explicit: "always a string, numeric codes stringified".

**Accessibility**
- 🟡 `TOOL_DESCRIPTION` is 24 lines / ~1200 chars. Scanning LLMs will drop off before reading the classification-field paragraph (the most under-used but most valuable feature). Split into a tight header (top 3 lines) + an optional `details` section, or move categorization guidance into `.describe()` on the relevant fields only.
- 🟡 `preceded_by` field has the longest `.describe()` in the whole MCP (line 52, ~250 chars) with inline example and anti-example. Hard to parse when the schema is rendered as a single block. Break into two sentences or move the "not a receipt ID" warning to a separate example line.
- 🟡 `anomaly_flagged` + `anomaly_detail` are documented near each other but their validation diverges — `anomaly_detail` has `.max(500)` and a "DO NOT include credentials" warning, while `anomaly_flagged` just says "something seemed wrong". An agent reading the schema cold may set `anomaly_flagged: true` with no detail, or include detail without flagging. No mutual-exclusion or co-presence hint.
- 🟡 The output `[ACR] Composition last updated N minute(s) ago` (line 203) is the only place a tool output uses the `[ACR]` prefix. Inconsistent with every other tool in the MCP. Either use it everywhere or nowhere.
- 🟡 Skill signals output (line 186 onward) renders raw counts without a "→ call `check_entity skill:<name>`" CTA. Compare with how `getting_started` links to next actions.

**Utility**
- 🟢 The two post-response surfaces (skill_signals + composition-age reminder) are the rare "log something, get something useful back" design — don't lose them.
- 🟢 Automatic chain & preceded_by injection reduces the reporting burden to zero for correctly-behaving agents.
- 🟡 When the server returns `skill_signals` with `anomaly_signal_count: 0`, line 185's check `data.skill_signals.length > 0` still renders the block. Renders "0 anomaly signals across 3 agents (0.0% rate)" — noise. Filter server-side or client-side for nonzero.
- 🟡 Composition-age reminder (line 203) fires *every* call past the server's threshold — no rate limit. An agent on minute 45 gets the reminder on every single tool call until it updates. Should throttle per-session (once per N minutes of MCP uptime) via `defaultSession`.
- 🟡 No feedback signal when the agent *didn't* call this tool but the server observed activity via fetch-observer. Could surface a per-session "you've logged 0 receipts manually but observer logged 12 — consider whether explicit logging still adds signal" in a later tool call.

---

### `get_interaction_log` (`tools/get-interaction-log.ts`)

**Quality**
- 🔴 **Receipt-id mismatch falls back silently to list.** Lines 77-79: if the caller passes `receipt_id` but the server returns a `receipts` array instead of a `receipt`, the tool "shows first item in detail" via `formatListDetailed(data.receipts.slice(0, 5), ...)`. That's **five items in list format**, not "first item in detail". The comment and behavior disagree — a user asking for a specific receipt gets up to 5 unrelated ones. Either trust the server 404, or actually pick the matching receipt by id.
- 🟡 Line 59: `fetch(...)` with raw `fetch` (not `fetchJsonSafe`). Same robustness gap as `get_my_agent`. Network hiccup → tool errors out entirely instead of returning a soft message.
- 🟡 Line 57 `params.set('anomaly', 'true')` but the schema field is `anomaly_only`. Two different names for the same thing across tool surface and API surface. Easy to break in the future.
- 🟡 Line 70 `data.name || agent_name || getAgentName() || resolvedDisplayName` — fourfold fallback chain. Works, but the priority order (server-declared name beats resolver output) means a server-side rename is reflected faster than a state-file rename. Document the precedence.
- 🟡 `since` is documented as ISO timestamp but not validated. Server likely rejects malformed values — the tool should validate at Zod level with `.datetime()` for faster feedback.

**Accessibility**
- 🟡 The description claims detail mode provides "full technical readout of a single interaction with network context" — accurate for `formatDetail` but misleading when the fallback path renders `formatListDetailed`. See Quality bullet above; the user thinks they got the feature when they got a different rendering.
- 🟡 Output uses `[timestamp] category -> target (type)` in list mode, `Receipt: <id>\n ====` in detail mode. Two distinct formatting dialects for the same data. Pick one; the list-mode pattern is easier to scan.
- 🟡 Line 100: "Use since/target/category filters or cursor to paginate" — but `cursor` is not an input field. Dead pagination advice; server returns `next_cursor` but the tool doesn't accept it.
- 🟡 `r.created_at` (line 113) used raw — relies on server returning a human-friendly string. Other tools use relative times ("3 minutes ago"). Inconsistent.
- 🟡 No filter for `chain_id` or `source` — you can't ask "show me only my environmental probe receipts" or "show me only chain srv-abc". Powerful filters already exist server-side (`source` param is honored by `receipts-read.ts`) but not exposed here.

**Utility**
- 🟢 `STATUS_TRANSLATIONS` spells out what each status actually means. Small but high-leverage readability win.
- 🟢 Baseline comparison ("2.3x baseline median") in detail mode is precisely the "if I see X, then I do Y" signal — a slow call compared to the local baseline says either the target is slow *today* or my code is slow, not both.
- 🟡 The "within normal range" branch (line 148) fires when ratio ≤ 2. That's a wide band — 1.9x baseline is called "normal" even when it's nearly double. Either tighten the band or add tiers ("close to baseline" / "elevated" / "much higher").
- 🟡 No `chain_id` rendering in list mode. An operator debugging a slow chain can't visually group receipts by chain — they have to infer from consecutive timestamps.

---

### Supporting code findings

#### `middleware/self-log.ts`
- 🔴 **Module-level `selfLogging` boolean races under HTTP transport.** Line 17: `let selfLogging = false` is module-scoped. With multiple concurrent HTTP sessions, session A setting `selfLogging = true` blocks session B's self-log entirely. Symptom: on HTTP deployments, self-log receipts drop under concurrency. Move to `AsyncLocalStorage` (like `fetch-observer`) or scope per-session.
- 🔴 **`defaultSession.agentId` fallback (line 46) defeats per-session isolation.** When `state.agentId` is null, falls back to the stdio singleton's agent. On HTTP transport this means session B's self-log can be emitted under session A's agentId — the receipt lands on the wrong agent.
- 🟡 Line 83 `target.system_id: 'mcp:acr-registry'` hardcoded. If the ACR instance is renamed or there are multiple ACR servers in the same process (unlikely but not impossible), the self-log receipts all collide on one target. Use the configured `apiUrl` host to derive.
- 🟡 Line 31-32: `status` is binary (`success` | `failure`), no `timeout` or `partial`. Tool handler timeouts get bucketed as `failure` — loses signal. Compare the richer taxonomy in `log_interaction`.
- 🟡 Line 50-51: `fireAndForgetLog(...).finally(() => { selfLogging = false })` — the reset happens in `finally`. If the emission promise is garbage-collected without running its callbacks (spec-compliant in some failure modes), `selfLogging` gets stuck `true` for the rest of the process lifetime, silently stopping all self-log emission. Use explicit timeout with guaranteed cleanup.
- 🟡 No retry, no backoff, no surface of emission failure. Fire-and-forget is correct for tool responsiveness, but emission-rate metrics should at least count drops.

#### `middleware/correlation-window.ts`
- 🟢 Cleanest file in the Group 2 set. Well-documented design choices, clear rationale for passive + eager-eviction + in-process.
- 🟡 Line 97: `Array.from(this.entries.values())` allocates on every `findPrecededBy` call. For a 500-entry window hit once per receipt, that's up to 500 allocations per tool call under load. Iterate the Map in reverse without copy by walking keys reversed, or maintain a separate ordered array.
- 🟡 `findPrecededBy` returns `target_system_id` of the match, **not** the matched receipt's id. The parameter in `log_interaction` is called `preceded_by` and its docstring (see Group 2 tool section) explicitly says "pass the target of the previous step, not a receipt ID" — matches behavior, but the return type name (`string | null`) doesn't convey "this is a target id". Rename to `findPrecededByTarget` or change the docstring of the `CorrelationEntry.target_system_id` field to "the value to store as preceded_by".
- 🟡 `windowMs` and `maxEntries` are constructor args but there's no env-var override. For operators debugging high-volume agents, they can't crank the window to 180s without code changes. Add `ACR_CORRELATION_WINDOW_MS` and `ACR_CORRELATION_MAX_ENTRIES`.
- 🟡 Hard-cap eviction (lines 69-77) drops oldest, but there's no log/counter when it fires. If it ever fires in prod, we'd never know. Silent overflow. Surface via `defaultSession` or a debug log.

#### `middleware/fetch-observer.ts`
- 🔴 **Hardcoded `provider_class: 'unknown'` at line 187.** The session is *already passed in* via `installFetchObserver({ session })`. Every observer-emitted receipt loses provider_class — which downstream corrupts the provider-class cohort rank (the "faster than 78% of anthropic peers" signal) for observer-heavy traffic. One-line fix: use `session.providerClass`.
- 🔴 **Install idempotency guard is module-level (line 45), breaks HTTP transport.** First session installs the observer wrapped with session A; second session calls `installFetchObserver` and the `if (installed) return false` short-circuits — session B's receipts are still emitted with session A's captured `session` variable via closure. Every observer receipt lands on session A's agent ID. Silent cross-session leakage.
- 🟡 Line 114-115: both `>=500` and `>=400` set `status = 'failure'` — the three-way branch could be collapsed but reads oddly as-is (second branch redundant with first given the ordering). Consider adding `status = 'partial'` for 4xx to distinguish server errors from client errors.
- 🟡 Line 132 re-entrancy guard runs emission under `inEmission.run(true, ...)` — correct. But `emitObservedReceipt` uses `unwrapped` directly (line 182), which would bypass the observer anyway. The ALS guard is belt-and-suspenders; either rely on one or the other and drop the dead one.
- 🟡 No emission rate limit. Observer sees every HTTP call, including chatty internal polling (e.g. a library probing its own health endpoint every 100ms). Could flood the receipts pipeline. Compare environmental probe which runs once per startup.
- 🟡 Line 194 `error_code: httpStatus ? String(httpStatus) : (errMessage ? 'NETWORK' : undefined)` — `NETWORK` is a synthetic code. Other parts of the code surface real codes like `ECONNREFUSED`. Decide: synthetic canonical set (NETWORK/TIMEOUT/HTTP_xxx) or pass-through errno names. Mixed.
- 🟡 Observer only looks at `init?.method` — doesn't handle `Request` objects where the method is on the request instance. Line 86-89 parses the URL correctly for Request, but line 124 reads `init?.method` which is `undefined` when the caller passes a pre-constructed Request. Defaults to GET.

#### `probes/environmental.ts`
- 🔴 **Hardcoded `provider_class: 'unknown'` at line 108.** Same as fetch-observer — `session` is already available (`session.providerClass` on line 143). One-line fix.
- 🟡 `DEFAULT_TARGETS` (line 29) is Anthropic + OpenAI + GitHub. No Google/Gemini, no Azure OpenAI endpoints, no AWS Bedrock, no Hugging Face. Coverage gap for non-OpenAI/Anthropic agents — their probes match none of what they actually call.
- 🟡 `ACR_ENV_PROBE_TARGETS` env var is documented only inline at the constants. Not surfaced in any tool description or the MCP README. Users discovering they need custom probes have to read the probe source.
- 🟡 No periodic re-probe. Baselines are captured once at startup. If an agent runs for 48 hours, the baseline is 48h old by the end and the network-between-probes has drifted. Consider periodic probes every 1-6 hours.
- 🟡 Line 68 `const ok = res.status < 500` — treats 401/403 as success on the premise that "target is reachable". Correct for reachability, but the friction report may later attribute these as "successful calls with 180ms latency" and mix them into the target's p50/p95 unless the server filters by `source='environmental'`. Verified server-side exclusion exists for chain inference (line 228 of receipts.ts) but confirm it for baseline computation too.
- 🟡 Line 120 `categories: { interaction_purpose: 'probe', criticality: 'baseline' }` — hardcoded. The rest of the MCP uses open-ended category strings; probe ones won't appear in any server-side category enum. Document these as reserved values.
- 🟡 `probeOne` returns `status: 'failure' | 'success' | 'timeout'` but line 112 passes `result.status === 'timeout' ? 'timeout' : result.status` — tautological, the conditional is `result.status` in both branches. Dead conditional.

#### Server: `packages/ingestion-api/src/routes/receipts.ts`

- 🔴 **`SHADOW_MODE = true` is hardcoded (line 22).** Every anomaly-on-ingest check (quarantine, volume cap, IP churn) logs-only and doesn't actually block. This is a staging/rollout posture that silently persists into prod. Either (a) make it an env var (`ACR_SHADOW_MODE`), (b) set a flip-date, or (c) ratchet individual checks out of shadow as confidence increases. As-is, no ingest protection is enforced.
- 🔴 **`HARD_HOURLY_CAP = 10_000` (line 25) is not configurable.** For enterprise tenants running fleets of agents, 10k/hr shared across the fleet is small. With shadow-mode on, this doesn't block yet — but the moment shadow flips, large tenants break. Needs env override + per-tenant override.
- 🟡 `CHAIN_INFERENCE_WINDOW_MS = 5 * 60 * 1000` (line 42) — matches the MCP session idle timeout. Coupled by coincidence; if one changes, should the other? Document the coupling or break it.
- 🟡 Line 228 and line 299 both check `(r.source ?? 'agent') !== 'environmental'` — same predicate twice. Extract a `isWorkflowSource(source)` helper so future source types (e.g. `hook`, `sidecar`) get handled consistently.
- 🟡 `mintServerChainId` prefix is `srv-` — documented only in inline comment (line 50-ish). MCP mints `s-`, agent sets raw. Three namespaces, documented in three different files. Consolidate in a shared constants module.
- 🟡 Per-IP churn threshold default 50/hr (line 31) — reasonable for individual devs, low for CI systems that rotate agent_ids per run. No per-tenant override.

#### Server: `packages/ingestion-api/src/routes/receipts-read.ts`
- 🟡 `limit` is clamped via `Math.min(Math.max(1, limit), 200)` — fine, but unbounded `offset` (cursor-based pagination) means an adversarial caller can request deep pages that are expensive on postgres. Add cursor depth limit or time-based pagination.
- 🟡 Detail mode fetches `system_health` + `friction_baselines` in two additional queries per detail call. Not cached. For hot detail views (debugger tailing receipts), N+1 pattern shows up fast.
- 🟡 No `chain_id` filter in the list query (verified by grep). Users debugging a chain have to fetch everything and filter client-side. Low effort to add; significant UX win.

---

### Group 2 summary

- **Big findings:** 7 — HTTP transport leak in log_interaction (chain/provider/transport); raw `.join` on unchecked receipt_ids; `get_interaction_log` receipt-id fallback renders 5 unrelated items; self-log module-level boolean race; self-log `defaultSession` fallback misattribution; fetch-observer hardcoded `provider_class: 'unknown'` and install idempotency leak; environmental probe hardcoded `provider_class: 'unknown'`; server `SHADOW_MODE=true` hardcoded and `HARD_HOURLY_CAP` not configurable.
- **Small findings:** ~35 (see above).
- **Cross-cutting patterns observed:**
  1. **`provider_class: 'unknown'` copy-paste bug appears in both fetch-observer and environmental probe.** Both had the session in scope but ignored it. Grep for `provider_class: 'unknown'` across the repo and fix every occurrence.
  2. **Transport boundary awareness is inconsistent.** `fetch-observer` uses `AsyncLocalStorage` for its re-entrancy guard (the right pattern); `self-log` uses a module-level boolean (the wrong pattern). Same problem, two solutions, different correctness.
  3. **Source enum has 4+ values (`agent`, `server`, `fetch-observer`, `environmental`) but no central definition.** Each file hardcodes its own string. A `const RECEIPT_SOURCES = {...}` in a shared module would prevent drift.
  4. **Hardcoded system_ids (`mcp:acr-registry`) and anti-patterns in chain-id prefix string literals (`srv-`, `s-`).** Move to a shared `constants.ts` so new surface areas don't reinvent.
  5. **Fire-and-forget emission patterns drop silently without metrics.** self-log, fetch-observer, environmental probe all eat emission failures. Observability gap — we don't know if 100% or 2% of observer receipts are landing.

---

---

## Group 3: Primary lenses

**Tools audited:** `get_friction_report`, `get_coverage`, `get_trend`, `get_profile`, `get_failure_registry`, `get_stable_corridors`, `get_network_status`
**Supporting code audited:** `utils/confidence.ts`

### `get_friction_report` (`tools/get-friction-report.ts`)

**Quality**
- 🔴 **Verdict thresholds are hardcoded heuristics (lines 311-319).** The "likely your config/network" verdict fires when `netPct < 5 && yoursPct >= 5 && yoursPct > netPct * 2` — three magic numbers (5, 5, 2x) with no justification in code or docs. "network-wide issue" threshold is `>= 20%` for both — another magic number. These verdicts drive operator decisions ("is this my problem or theirs?"); they deserve a documented calibration or `/docs/friction-verdict-thresholds.md` reference.
- 🔴 **Absolute-elevation floor patched into relative check (lines 308-312).** The code comment says "a single failure out of 10 interactions is 10% which trivially beats netPct*2 when netPct is 0.5%". The fix (`yoursPct >= 5`) is correct but still implicitly defines a "failure floor of 5%" that sits inside the verdict logic with no knob. Calibrate or expose.
- 🟡 Line 98 `friction_percentage > 100` annotation: handles parallel calls correctly, but the wording "wait exceeds active span" is technically accurate and functionally opaque. Operators reading this won't immediately know what it means for their agent.
- 🟡 Line 181 `Math.round(cat.total_duration_ms / cat.interaction_count)` — if `interaction_count` is 0, short-circuits to 0. But the guard is the ternary on line 181 itself. OK, but then line 209 and 215 don't apply the same guard when rendering per-activity and per-target-type averages — they do `(cat.total_duration_ms / 1000).toFixed(1)` directly. No divide-by-zero, but also no avg rendered. Inconsistent depth of detail by section.
- 🟡 Line 238 `t.median_duration_ms` and line 239 `t.p95_duration_ms` — rendered raw without null guard for median. If server omits median (sample-too-small), renders `median undefinedms`.
- 🟡 Line 243 `wastedMs = t.failure_count * t.median_duration_ms` — uses *median* to estimate wasted time, but actual failed calls could be faster or slower than median. Better: server returns `failed_call_duration_sum_ms` and MCP displays that directly. Current approximation can mislead by 2x in either direction.
- 🟡 Line 258 `t.vs_baseline.toFixed(2)` — ratio rendering has no interpretive context. "1.32" vs baseline — is that 32% slower or 32% faster? Compare with directional amplification which adds `x amplification` suffix.
- 🟡 Line 304-305 `yoursPct` vs `netPct` casts to percent for display but reconverts from a ratio. Rounding drift.
- 🟡 Chain `top_patterns` (line 131) uses `p.pattern.join(' -> ')` — arrows without spaces on one side and with spaces on the other inconsistent with the `source -> destination` render on line 143. Minor.
- 🟡 Tier rendering (line 76) defaults to "free" — if server returns "enterprise" or "trial", rendered as-is. No enumeration check, silent fallthrough for typos.

**Accessibility**
- 🟢 Report structure (summary → structural → per-target → population) is strong. Group 1 flagged this and it really is the best-organized lens output in the MCP.
- 🟢 `formatDuration` at line 8 produces clean output ("1h 12m", "42.3s"). Use this helper in other lens tools that render durations raw (trend, stable-corridors — see below).
- 🟡 Description is 290 chars, mostly pedagogy ("Friction is a continuum, not a verdict"). Good framing but pushes the `scope`/`source` guidance to the back. LLMs scanning for "when do I use this" land on philosophy first.
- 🟡 "Tip:" lines for empty sections (137, 148, 161) are excellent — exactly the "if I see X, then do Y" pattern. The `Population Drift` empty case (line 172) omits the tip, so the operator sees "No baseline-comparable targets" with no next action. Add a tip.
- 🟡 Output uses four divider styles in one report: `── Section ──` (most), `--` (none here, but used elsewhere), `=` (none here). Stable internally.
- 🟡 `(pre-signal — N samples)` renders repeatedly per row. Visually noisy when every chain has 1-2 samples. Consider compressing to a legend at the top with just the tag per row.

**Utility**
- 🟢 Verdict strings ("likely your config/network — most agents succeed here") translate numeric comparison into a decision. Strongest "if I see X, then Y" signal in any lens.
- 🟢 Error-code breakdown with dominant-target annotation ("401: 6 hits, mostly api:slack.com") is immediately actionable.
- 🟡 No "what changed since last report" surface. Compare with `get_trend`, which provides deltas but no context about what in `get_friction_report` would be different. Could auto-embed a 1-line trend summary at the top.
- 🟡 `top_patterns` shows chain shape + frequency but no baseline comparison ("this chain was new this week" vs "up 3x from last week"). Utility ceiling without temporal context.
- 🟡 The `by_transport` and `by_source` sections (lines 331-342) are diagnostic for developers but opaque for users. What does "stdio: 127 calls, 8.2s total" tell a non-operator? Either hide behind a verbose flag or contextualize.

---

### `get_coverage` (`tools/get-coverage.ts`)

**Quality**
- 🟡 Line 41 type cast claims `Array<{ signal, rule, observed, triggered }>` but no validation. If server adds or renames fields, silent undefined spread.
- 🟡 Line 37 type cast to `Record<string, unknown>` then line 40 re-casts signals to `Record<string, number>` — double unsafe. If any signal value is a string (e.g. "N/A"), `text += ${value}` still renders but downstream math or formatting breaks.
- 🟡 Line 59 `observed: ${JSON.stringify(r.observed)}` — `JSON.stringify` on an unknown object with no pretty-print. For `{target_type_count: 3, total_receipts: 12}` that's `{"target_type_count":3,"total_receipts":12}` — unreadable. Pretty-print or render inline as "target_type_count=3, total_receipts=12".

**Accessibility**
- 🟡 Description is decent but misses an example. "which fields you populate on your receipts" — what fields? An operator reading this cold doesn't know whether this audits `target_type`, `retry_count`, both, or something else. Add "e.g., target_type, chain_id, retry_count" to the description.
- 🟡 `Coverage Gaps` section (line 56) uses the word "triggered" to mean "flagged as a gap", which is backwards — "triggered" reads as "fired successfully". Rename to "Failed" or "Missing" or "Flagged".
- 🟡 `-- Section --` divider style, not `── Section ──`. Inconsistent with friction report.
- 🟡 No confidence tag, even though coverage is based on sample counts. A coverage gap flagged from 3 receipts is very different from one flagged from 3000.
- 🟡 No period disclosure — what time window is this coverage measured over? Server likely defaults to something, but user doesn't see it.

**Utility**
- 🟢 Rule-based transparency ("observed X/Y, triggered/not") is exactly the signal an operator needs to improve logging.
- 🟡 No "next action" — once the user sees `preceded_by` is 0/47, what tool do they call next? Point them to `log_interaction` schema or surface a copy-paste example.
- 🟡 No before/after after the user fixes a gap. Tool returns "gap still present" for 1-24h depending on server aggregation cadence. A "this gap will clear within N hours once you start populating" note would set expectations.

---

### `get_trend` (`tools/get-trend.ts`)

**Quality**
- 🔴 **`(latency_change_ratio * 100).toFixed(1)%` at line 70 — ratio rendered as percent drift.** If `latency_change_ratio` is already a delta-fraction (e.g. 0.15 = +15%), the math is correct. If it's a ratio (e.g. 1.15 = 1.15x), then the render shows "115.0%" when the real delta is +15%. Need to verify server contract matches the render math. Likely wrong for at least one.
- 🟡 Line 73 `(failure_rate_delta * 100).toFixed(1) pp` — `pp` (percentage points) is correct if `failure_rate_delta` is an absolute difference in rates. But a failure rate going from 2% to 5% has `failure_rate_delta = 0.03`, and `0.03 * 100 = 3.0 pp` — correct. Good.
- 🟡 Line 40 `displayName` fallback chain uses `(data.name as string) || agent_name || ...` — if server returns `name: null` explicitly, falls through; if server returns `name: ""`, falls through. Both OK. If server returns `name: undefined`, the cast succeeds but the `||` sees falsy. No bug but depends on server contract consistency.
- 🟡 Line 68 `deltaN = Math.min(currN, prevN)` — "weakest-period-wins" rule for confidence. Good, but undocumented at the tool level; an operator would never know why a delta with 500+500 gets flagged pre-signal when one period has 9.
- 🟡 Line 56-57: `curr` and `prev` pulled via `Record<string, unknown>` cast. `curr.receipt_count as number` — if server returns it as string, `number` cast succeeds silently to whatever TS infers, but arithmetic on strings propagates NaN. Minor robustness.

**Accessibility**
- 🟡 Description doesn't mention what the comparison window is. "current period to previous period" — with `scope=day`, is "previous period" yesterday, or the prior 7 days? The `rules.previous_window` field is rendered but only shows up after the user already called the tool.
- 🟡 No target filter. An operator interested in one target still sees all of them. Easy add.
- 🟡 No sort order documented. Are targets in significance order, alphabetical, or as-returned? Matters for scan readability.
- 🟡 Scope `session` is conspicuously missing compared to friction report (which has it). Intentional or gap?

**Utility**
- 🟢 Delta confidence tags pass through correctly — exactly the right behavior.
- 🟡 No summary line ("5 targets improved, 2 regressed, 1 pre-signal"). User has to scan targets to build this mental model. Cheap summary at the top would save them the work.
- 🟡 No directionality cue in delta rendering. "+15.0%" latency change — up is bad, but a user new to the tool might think up is good. Add `↑` / `↓` or `(slower)` / `(faster)` qualifier.

---

### `get_profile` (`tools/get-profile.ts`)

**Quality**
- 🟡 Line 37 `c = data.counts` cast with no validation. If server omits the `counts` block entirely (e.g. new agent, no activity), `c.total_receipts` crashes on undefined access at line 49. Needs null guard.
- 🟡 Line 44 `Composition hash: ${data.composition_hash}` — rendered raw, no truncation. If the hash is a SHA-256 that's 64 chars; user sees a wall of hex. Truncate to first 16 + `...`.
- 🟡 Line 65-66 `mcpOnly = delta.mcp_only as string[]` — casting unknown to `string[]` without validation. If server ever returns objects instead of strings (because a future iteration adds `{target, last_seen}`), `.join(', ')` renders `[object Object], [object Object]`.
- 🟡 `days_active` is rendered raw (line 54) with no tense/context. "Days active: 3" — across what period? Total lifetime, trailing 30 days, all time?

**Accessibility**
- 🟢 Clear dashboard-style layout, everything labelled.
- 🟡 No `scope` param. Other lenses let you window to today/yesterday/week. Profile is "all-time" by implication, but server could be doing something else; no way for the user to know.
- 🟡 No source filter. If an agent hasn't called `log_interaction` at all but self-log fired 12 times, profile shows 12 receipts — misleading without context that they were all MCP self-log.
- 🟡 Description mentions "composition delta (MCP-observed vs agent-reported)" but doesn't define "MCP-observed". A user reading cold wouldn't know this is the fetch observer / deep composition scanner.
- 🟡 Dividers are `-- Section --`, inconsistent with `── Section ──` in friction report.

**Utility**
- 🟢 Composition delta is a rare high-signal piece — "MCP sees but agent didn't report" is directly actionable (call `update_composition`).
- 🟡 No link to dashboard (other identity tools include it).
- 🟡 No "next action" based on the state. If composition_delta shows agent-reported items the MCP doesn't see, the next step is ambiguous — is the agent lying, or is the MCP not looking in the right place?

---

### `get_failure_registry` (`tools/get-failure-registry.ts`)

**Quality**
- 🟡 Line 42 `failures as Array<Record<string, unknown>>` — cast without validation. Every access on line 57-75 does another local cast. Cast tower.
- 🟡 Line 63 `Object.entries(statuses).map(...).join(', ')` — rendering unbounded. If there are 20 distinct status strings, the line explodes. Top-5 or wrap.
- 🟡 Line 67 same pattern for error_codes. `429=12, 500=8, 503=2, ECONNREFUSED=1, ENOTFOUND=1, ...` — could be 20+ codes. Cap.
- 🟡 Line 74 `median_duration_when_failed_ms` — server-provided median. What if sample is 1 failure? Median of 1 is trivially that number; no confidence tag. The tool applies confidence tag to `total_count` at line 59 but not to the median render.

**Accessibility**
- 🟡 Description is concise but lacks the "when to use this vs. get_friction_report" guidance. Both show failures; the distinction (registry = per-target detail, friction = cross-cutting) isn't obvious.
- 🟡 No filter by error_code, target, or category. Operator investigating one 429 source has to eyeball all.
- 🟡 Status breakdown rendered in camelCase-ish inline (`k=v`) — differs from `statuses: {key: value}` style elsewhere. Pick one inline format.

**Utility**
- 🟢 Status + error code + categories all in one place is the right mental model for "what broke".
- 🟡 No "compared to last week" signal. Is this failure rate new or chronic?
- 🟡 No "fixes observed" — if other agents historically resolved the same error_code at the same target by switching targets or retrying, that would be gold. Not in scope today but worth tracking as an enhancement.

---

### `get_stable_corridors` (`tools/get-stable-corridors.ts`)

**Quality**
- 🟡 Line 38 `source: 'agent' | 'server' | 'all'` param is sent but line 38's `displayName` fallback doesn't use `data.name` at all (compare with every other tool that does `(data.name as string) || agent_name || ...`). Either server doesn't return name here, or the tool drops it. Minor consistency.
- 🟡 Line 56 `data.match_count !== undefined ? data.match_count : matches.length` — the server-reported `match_count` can differ from `matches.length` when there's server-side truncation. If it differs, the user sees a count that doesn't match the visible rows with no explanation. Render both or flag truncation.
- 🟡 Line 65 `coefficient_of_variation` typeof check is good but renders 'N/A' — the rest of the MCP uses `—` or omits the line. Pick one missing-value convention.
- 🟡 No guard on `m.median_duration_ms` or `m.p95_duration_ms` being null. Renders `median nullms`.

**Accessibility**
- 🟢 `filter_applied` disclosure is the right move — no black-box thresholds.
- 🟡 Empty-state message (line 59) is long but doesn't tell the user *what threshold they missed*. "No targets met all filter criteria" — then surface which criterion cut out the most: "of 12 targets, 8 had failures, 2 had high variance, 2 had <10 samples". Requires server cooperation but massively more useful than the current message.
- 🟡 No sort order documented. By median ascending? By sample count?

**Utility**
- 🟡 Stable corridors are useful as a fallback discovery tool ("what's working?") but the signal is ambient — there's no "here's what you should route to next" inference. Low utility ceiling unless paired with a substitution recommendation.
- 🟡 `cv: 0.123` — operator-facing but most operators don't reason in coefficient of variation. Translate to "variance: low" or "variance: 12.3% of median".

---

### `get_network_status` (`tools/get-network-status.ts`)

**Quality**
- 🔴 **No auth header on line 19: `fetch(...)` called without `getAuthHeaders()`.** Every other lens tool includes auth. If server enforces per-tier gating on network status (likely — paid tier gets population baselines), unauthenticated calls either get generic data (silently different) or 401. Small copy-paste bug with security/tier implications.
- 🟡 Line 69 `th.skill_name || th.skill_hash.substring(0, 16) + '...'` — if skill_hash is shorter than 16 chars or missing, substring throws. Same pattern as `register_agent:108` (Group 1 finding).
- 🟡 Line 46 `.slice(0, 20)` silently truncates to top 20 systems. Line 57 tells the user there are more, which is good — but offers no filter or pagination to drill in. Add top_n param.
- 🟡 `data.stale` (line 30) — stale flag rendered but no timestamp of last refresh. "MAY BE STALE" with no way to know *how* stale.
- 🟡 Line 83 `providers_affected?.length > 0` then renders as `[a, b]` — array-to-string rendering without sort. Non-deterministic render if server returns in hash order.
- 🟡 Line 87 `anomaly_categories?.length > 0` — same unchecked join pattern.

**Accessibility**
- 🟡 Description calls it "observation dashboard" — but it's not a dashboard, it's a text summary. Mismatched expectation.
- 🟡 No `scope` param. Fixed 24h window. An operator investigating a multi-day incident has no longer view.
- 🟡 Anomaly signals section header (line 67) says "Skill Anomaly Signals" — but the field on receipts is `anomaly_flagged`, and the server-side escalation is `anomaly_escalation`. Three different naming dialects for the same concept.
- 🟡 No confidence tag on `skill anomaly_signal_count` rows — 3 signals from 1 reporter looks the same as 300 from 100.

**Utility**
- 🟡 "Recent Escalations" is the most actionable section but it doesn't link to `check_entity` or `acknowledge_threat`. Add a tip per escalation.
- 🟡 Systems list without percentile-in-class or "% worse than 7-day average" provides a point-in-time snapshot that decays fast. Add delta context.

---

### `utils/confidence.ts`

- 🟢 Thresholds (`<10`, `10-29`, `>=30`) are defensible and consistent with common statistical practice.
- 🟡 Tag format `(pre-signal — N samples)` — the em dash and lowercase tag make the output look like an aside. When a pre-signal is the dominant finding, it deserves more visual weight.
- 🟡 No distinction between "pre-signal because young" vs "pre-signal because rare target". Same label, different action. Future-friendly to add cause tagging.
- 🟡 Exported constants (`PRE_SIGNAL_MAX`, `DIRECTIONAL_MAX`) — good. But they aren't referenced in any test or doc. If a downstream tool ever special-cases on these thresholds, the logic is forked.

---

### Group 3 summary

- **Big findings:** 5 — friction report verdict thresholds are hardcoded magic numbers with no calibration doc; friction report absolute-elevation floor patched into relative check with no knob; trend `latency_change_ratio` render may mismatch server contract (percent vs multiplier ambiguity); network status missing `getAuthHeaders()` on fetch (tier-gating / auth leak).
- **Small findings:** ~55 (see above).
- **Cross-cutting patterns observed:**
  1. **Type casting tower.** Every lens tool does `as Record<string, unknown>` then per-field `as number`/`as string` casts. No runtime validation. A server schema change silently renders as `undefinedms` or `[object Object]` somewhere.
  2. **Missing-value rendering dialects drift.** `N/A`, `null`, `—`, `0`, blank line, omitted line — at least 5 conventions across the 7 tools. Pick one, enforce it.
  3. **Top-N truncation without drill-down.** `slice(0, 20)`, `slice(0, 3)`, `slice(0, 5)` appear in 4 tools with no way to see the tail. Either always surface a "more available" hint (network-status does this) or add pagination.
  4. **Ratio vs delta-fraction confusion.** `latency_change_ratio`, `vs_baseline`, `amplification_factor` — three tools render these with three different interpretations. Trend may be wrong; friction report uses `.toFixed(2)` with no suffix; directional amplification adds `x`. Standardize the type contracts or add a suffix convention.
  5. **No tool links to the next tool.** Stable corridors mentions failures without pointing to failure-registry. Network status escalations don't link to check_entity or acknowledge_threat. Failure registry doesn't point to friction report for ratio context. Entry-point tools (getting_started, get_my_agent) do this well; lenses don't.
  6. **Descriptions front-load philosophy, not usage.** "Friction is a continuum, not a verdict" is true and good — but scan-first readers need `when do I call this? with what params?` in the first sentence.

---

---

## Group 4: Advanced lenses

**Tools audited:** `get_revealed_preference`, `get_compensation_signatures`, `get_composition_diff`, `whats_new`

### `get_revealed_preference` (`tools/get-revealed-preference.ts`)

**Quality**
- 🟢 Strong design: four classification buckets (`bound_uncalled`, `bound_underused`, `bound_active`, `called_unbound`) are mutually exclusive and cover the full declared×actual matrix cleanly.
- 🟡 Line 98 `data.targets` iterated directly — no null guard. If server returns `{summary: {...}, targets: null}` (legit on empty days), crashes.
- 🟡 Line 99 `byClass[t.classification]?.push(t)` — silently drops rows with unknown classification. If server ever adds a fifth bucket (e.g. `binding_deprecated`), the tool renders it nowhere. Add a catchall group or warn on unknown.
- 🟡 Line 92 `Record<string, typeof data.targets>` — type inference depends on `data.targets`, which is typed as `any`. Weakens TS help.
- 🟡 Line 119 "called fewer than 3 times" — hardcoded threshold of 3 ("underused" boundary) that should match the server-side classifier. If the server ever changes its threshold, the rendered description drifts silently.

**Accessibility**
- 🟢 `TOOL_DESCRIPTION` explains the four buckets inline with a clear "only ACR can see both" framing. One of the best descriptions in the MCP.
- 🟢 `renderGroup` emits empty-safe output (line 104 short-circuits on empty items) — no noisy "0 entries" sections.
- 🟡 Description mentions `binding_source_disagreements` but the inline symbol is `⚠` (line 89) — rendered only when count > 0. Good, but the symbol is used once across all lens tools — inconsistent.
- 🟡 `binding_sources` (line 109) joined with `, ` and wrapped in `[bound by: ...]`. If an agent has 5+ sources (mcp_observed, agent_reported, manifest, runtime, future-additions), line gets long. Compact with prefix letters or cap.
- 🟡 `last_called` (line 112) rendered raw — no relative time. "(last 2026-04-14T03:22:18.000Z)" vs "(last 7 days ago)".

**Utility**
- 🟢 High utility lens. Answers "what's in my context that I'm not using?" with a crisp answer.
- 🟡 No cost estimate on `bound_uncalled` ("this many tokens per turn wasted on dead declarations"). Would turn descriptive into prescriptive.
- 🟡 No "would unblock X if declared" signal on `called_unbound`. Declared targets participate in network anomaly rollups — a user reading `called_unbound` doesn't see the benefit of fixing it. Explain in empty-section copy.

---

### `get_compensation_signatures` (`tools/get-compensation-signatures.ts`)

**Quality**
- 🟢 Agent-stability score definition (1 − normalized Shannon entropy) is principled and explained inline. Scoring method vs black box.
- 🟡 Line 83 `p.chain_pattern.join(' \u2192 ')` — unicode escape for `→`. Fine, but inconsistent — `get_friction_report` uses `' -> '` (ASCII) in the same context. Pick one.
- 🟡 `p.pattern_stability` and `p.share_of_chains` both rendered on same line (line 87). Are they the same thing? The description says pattern_stability *is* the share; rendering both as distinct stats is double-dipping and the display suggests they mean different things.
- 🟡 Line 94 `fleet_total_frequency` rendered without explanation. Is it total across all fleet agents, or per-agent average? Docstring silent.
- 🟡 Line 91 `p.fleet_agent_count === 1` branch reads "idiosyncratic (only you)" — implies the agent itself is counted. Verify server contract: is fleet_agent_count = total_agents (including this one) or excluding-self? Changes the interpretation of "2".

**Accessibility**
- 🟢 Description is explicit about the continuum-not-verdict framing and even tells the user how to cross-reference (friction report).
- 🟡 Tool description opens with "Query the compensation-signatures lens: how stereotyped is your chain-shape behavior" — "stereotyped" is technical jargon in a surface most users won't recognize. Swap for "repetitive" or "routine".
- 🟡 No empty-state hint for "0 distinct patterns but >0 chains" (all same target, no multi-step). Current empty-state only fires for `total_chains === 0`.
- 🟡 The long-tail interpretation ("low share + persistent frequency = possible compensation") is in the header text (line 80) but never rendered per-pattern. An automatic "this pattern fits the compensation profile" annotation when share < 10% and frequency > N would save the user the work.

**Utility**
- 🟢 Fleet comparison is the rare cross-agent signal — "only you run this pattern" vs "fleet-wide routine" is actionable.
- 🟡 No link to the friction report for specific target sequences. Reader identifies a compensation pattern and has to manually query friction for each target.
- 🟡 `avg_overhead_ms` rendered only when >0 (line 88). Overhead of 0 is also signal ("this chain has no measurable overhead"). Render always with context.

---

### `get_composition_diff` (`tools/get-composition-diff.ts`)

**Quality**
- 🟢 Strong typing via inline interfaces (`DeclaredUsed`, `DeclaredUnused`, `Undeclared`). Best-typed lens tool in the MCP.
- 🟢 Server response has a *declared* shape (line 53-67) — could be Zod but at least it's documented inline.
- 🟡 Line 89 sort by `interaction_count` descending. Correct, but sort mutates a copy (`[...]`) — fine. Line 113 does the same for `used_but_undeclared` but line 96 (declared_but_unused) doesn't sort at all, renders server order. Inconsistent.
- 🟡 Line 100-106: top 15 for declared_but_unused, line 113-118: top 15 for used_but_undeclared, line 89: top 10 for declared_and_used. Three different truncation limits with no explanation.
- 🟡 `c.declared_but_unused > 0 && c.declared_and_used === 0` (line 128) — "Nothing declared has been used. Check target_system_id mismatch" — the diagnostic is correct but the trigger condition is narrow (only fires when nothing declared has been used). What about the mixed case where 3/10 declared targets are used but 7 are unused due to naming mismatch? Silent.
- 🟡 `window_days` default is undefined in schema (line 28). Line 71 renders `last ${data.window_days} day(s)` — relies on server to apply the default. If server ever rejects missing window_days, tool breaks.

**Accessibility**
- 🟢 Empty-state triage (lines 122-130) is the gold standard in this codebase — four conditions, each with a specific next step.
- 🟡 `! Declared but unused` and `! Used but undeclared` — both use `!`. `✓ Declared and used` uses `✓`. Pairing is clean but the `!` is overloaded ("warning" or "attention"). Consider `△` for shadow-declarations vs `▽` for shadow-dependencies so they visually distinguish.
- 🟡 `Composition diff: ${displayName}` uses `=` divider, `-- Counts --` and `-- Declared and used --` use `--`. Inconsistent with `── Summary ──` elsewhere in advanced lenses.
- 🟡 `declared_source` label (line 72) — is that "mcp_observed", "agent_reported", or something else? Not explained. A user seeing `Declared source: mcp_observed` doesn't know if that's authoritative or fallback.

**Utility**
- 🟢 The three-bucket mental model matches revealed-preference but at the *composition* level (what you declared) vs the *binding* level (what you call). Complementary.
- 🟡 Overlap with `get_revealed_preference` is not called out. Both surface "declared but unused" and "called but undeclared". A user doesn't know which to call. Differentiate in descriptions: `get_composition_diff` is listing-level (every target), `get_revealed_preference` is classification-level (with stats + confidence).

---

### `whats_new` (`tools/whats-new.ts`)

**Quality**
- 🔴 **HTTP transport leak (line 57).** `renderUpgradeBanner(defaultSession.versionCheck)` reads the stdio singleton. Under HTTP transport with a session that has version-check disabled (`ACR_DISABLE_VERSION_CHECK=1` at session scope) or a different cached result, the banner renders from the wrong session. Same pattern as Group 1.
- 🟡 Line 36-41 uses `Promise.allSettled` → `safeJson` wrapper → `Promise.all`. Correct handling of partial failure (any individual endpoint failing shows "unavailable" rather than failing the whole tool). Nice.
- 🟡 Line 93-97 `targets.filter(...)` on `failure_rate_delta != null && delta > 0` — surfaces degradation only. Skips regressions in *latency* (agent slowdown without failure change). Should include both dimensions: "failure rate up" OR "latency up significantly".
- 🟡 Line 94-97 `as number | null` cast then arithmetic — if server returns a string (`"0.05"`), cast succeeds and arithmetic produces NaN, sort is unstable.
- 🟡 "today so far" and "yesterday" both hit `/friction?scope=day|yesterday`. Round-trips twice for related data. Server could offer a combined `/morning-briefing` endpoint.

**Accessibility**
- 🟢 Morning briefing format is the right mental model — high-density scannable summary.
- 🟡 Description is 195 chars and reads well, but doesn't call out that this is the ONE call to orient — tools like `get_my_agent` and `getting_started` serve similar "where am I" roles. A user doesn't know which to call when.
- 🟡 "Nothing degraded this week" branch (line 100) — but what if things *improved*? A 15pp failure rate drop is newsworthy. Currently silent.
- 🟡 `-- X --` style dividers inconsistent with `── X ──` in other advanced lenses (revealed-preference, compensation).
- 🟡 `Today so far` section (line 110) renders even at 3am when "today" is near-empty. Empty-state message "No activity yet today" fires correctly but the section header still prints. Consider skipping the section or framing as "Today (since midnight UTC)" to set expectations.

**Utility**
- 🟢 Notifications teaser ("N unread — call get_notifications") is exactly the kind of link the other lenses lack.
- 🟡 No "suggested next call" based on the morning state. If failures are up, point to failure_registry; if nothing degraded, point to stable_corridors; if new unread notifications, suggest acknowledge_threat workflow.
- 🟡 No week-over-week comparison for top-target cost. "Top cost: api:slack.com — 42% of wait" — is that the normal top cost, or a new dominator?

---

### Group 4 summary

- **Big findings:** 1 — `whats_new` HTTP transport leak for version-check banner.
- **Small findings:** ~30 (see above).
- **Cross-cutting patterns observed:**
  1. **The advanced lens tools are the best-written tools in the MCP.** Strongest descriptions (revealed-preference, composition-diff), best empty-state handling (composition-diff), most principled math explanation (compensation). They set a floor the primary lenses (Group 3) should rise to.
  2. **Truncation limits are everywhere and uncalibrated.** Top-10, top-15, top-20, top-3 — each tool picks its own. Standardize on a `TOP_N` constant or make it a param.
  3. **Unicode vs ASCII arrows drift.** `'→'` (compensation), `'->'` (friction), `·` (get_my_agent menu). Operators reading multiple lens outputs see three arrow dialects.
  4. **Cross-lens overlap isn't called out.** `get_composition_diff` and `get_revealed_preference` cover adjacent ground; operators need a guide. Consider a "when to use which lens" meta-doc or an `--overlap-with` hint in descriptions.
  5. **Threshold strings in description drift from server code.** "called fewer than 3 times" (revealed-preference) is a string that has to match the server's classifier. Move to a shared constants file and import.

---

---

## Group 5: Composition management

**Tools audited:** `update_composition`, `configure_deep_composition`
**Supporting code audited:** `strip-sub-components.ts`

### `update_composition` (`tools/update-composition.ts`)

**Quality**
- 🟢 Uses the `getSession` factory pattern (line 21) — correct per-session isolation. One of two tools in the MCP (with `acknowledge_threat`) that does HTTP transport right.
- 🟡 Line 46 `agent_id ?? getSession().agentId ?? await getSession().ensureRegistered(apiUrl)` — the `ensureRegistered` fallback inherits the silent-degradation problem from Group 1: if registration fails, returns `pseudo_<hex>` and this composition update lands on the pseudo agent, then the real agent never sees it.
- 🟡 `getSession()` called twice (line 46 then line 48). Not a correctness issue (session is stable across calls) but redundant.
- 🟡 Line 64 `composition_source: 'agent_reported'` — hardcoded. Distinct from the `mcp_observed` source used by the deep composition scanner. No way to override this at the tool level if a future integration wants to attribute composition to a different source.
- 🟡 Lines 79-85 `skillCount`/`toolCount` calculations sum flat + rich fields. If both `skills: ['a', 'b']` and `skill_components: [{id: 'a'}, {id: 'b'}]` are passed (the same skill represented two ways), count doubles. Dedupe by id or hash.
- 🟡 No schema validation on server response. `data.composition_hash` typed as optional but rendered raw at line 94. If server returns no hash, renders `Composition hash: undefined`.
- 🟡 Line 41 `annotations: { readOnlyHint: false, destructiveHint: false }` — but this tool *mutates* remote state (the agent's composition record). `destructiveHint: false` is technically correct (no data loss) but the lack of confirmation flow means an agent can accidentally wipe its composition by sending `{}`. Consider surfacing a "wiped N items" diff in the response.
- 🟡 Line 10 `id: z.string().max(128)` — no min length, no format validation. Empty-string IDs would pass. Add `.min(1)` guard.
- 🟡 `sub_components` at line 13 `max(64)` — silent truncation. If an agent tries to register 100 sub-components, Zod rejects. Error message will be Zod-default, not helpful. Custom message needed.

**Accessibility**
- 🟢 Description cleanly explains flat-vs-rich composition and the deep-capture implications.
- 🟡 Response format is plain text ("Composition updated successfully. Composition hash: X. Skills: 4. Tools/MCPs: 7.") — no diff against previous composition. User doesn't know what changed.
- 🟡 `deepNote` (line 87) is appended only when deep is OFF. When deep is ON and the caller provided sub_components, no confirmation that they landed. Symmetric framing would help.
- 🟡 No confirmation that `composition_hash` has actually changed from prior hash. If the update was a no-op, response looks identical to a successful change.

**Utility**
- 🟢 Preserves identity (line 94 explicitly confirms) — reassurance for users worried that re-registering would destroy state.
- 🟡 No "affected targets" signal. After update, which bindings newly appear/disappear from revealed-preference? User has to call revealed-preference separately.
- 🟡 Hash rendered in full (no truncation). Same issue as `get_profile`.

---

### `configure_deep_composition` (`tools/configure-deep-composition.ts`)

**Quality**
- 🟢 Uses `getSession` factory pattern — per-session isolation correct.
- 🟢 `previous === enabled` check (line 46) produces a "no change" note. Idempotency surface.
- 🟡 No persistence across MCP restarts. User disables deep-capture, restarts MCP, setting reverts to env-var default. Unexpected for a privacy control — should either persist to the state file or explicitly warn "this setting is session-scoped, restart resets it".
- 🟡 Line 40 `session.setDeepComposition(enabled)` — no feedback about whether any in-flight composition writes were affected. If the user called `update_composition` with sub-components *then* immediately toggled deep-composition off, the previous send already happened. Could return "N future reports affected".

**Accessibility**
- 🟢 Description is one of the clearest in the MCP — explains what the setting does, what the tradeoff is, and how else to set it.
- 🟢 Both enabled/disabled paths have a full explanation (lines 42-44). No confusing boolean confirmation like "deep: true".
- 🟡 No "current state" readout without changing. An agent reading the description knows *what* the setting is but not *what it's set to right now*. Expose a `get_deep_composition` or return current state when called with the same value.
- 🟡 Description never mentions the `update_composition` workflow — users don't know when this setting actually matters (only when sending sub_components).

**Utility**
- 🟡 Configuration tool, so utility is narrow by design. Works as intended.
- 🟡 No cross-link — setting deep-composition=false should probably mention "targets in `get_revealed_preference` will show coarser classification going forward".

---

### Supporting code: `strip-sub-components.ts`
- 🟢 Generic, small, correct. No findings.
- 🟡 Line 12 `const { sub_components: _, ...rest } = c;` — the `_` convention for "destructure and discard" is idiomatic but some linters flag it. Minor; ignore if ESLint isn't complaining.

---

### Group 5 summary

- **Big findings:** 0 — this group is the most correct in the MCP. Group 5 tools are the ones that already use `getSession` factory pattern, which is what Groups 1-4 mostly *don't* do.
- **Small findings:** ~15 (see above).
- **Cross-cutting patterns observed:**
  1. **`getSession` factory pattern works.** This is the blueprint for Group 1/2/4 fixes — apply here and proceed.
  2. **Mutation tools don't return diffs.** `update_composition`, `acknowledge_threat` (Group 6 later), `register_agent` all mutate state but surface only success/failure. A diff would let the operator verify the change.
  3. **Privacy controls don't persist.** `configure_deep_composition` is session-scoped; restart resets. For a privacy setting, silent reset is a surprise. Either persist to state file or prominently document session-scoping.

---

---

## Group 6: Notifications

**Tools audited:** `get_notifications`, `acknowledge_threat`

### `get_notifications` (`tools/get-notifications.ts`)

**Quality**
- 🟢 Uses `getSession` factory pattern — correct per-session isolation.
- 🟢 Parallel fetch of notifications + profile (line 23) — clean, no needless latency.
- 🟡 Line 19 `ensureRegistered` fallback inherits silent-degradation — same pattern as Group 1 / Group 5.
- 🟡 Line 28-34 type cast with no runtime validation. `severity: string` — if server sends `"info"`, `"warn"`, `"critical"`, `"info"`, they all render as-is. Schema drift on this boundary silently corrupts display.
- 🟡 Line 62 `n.created_at.split('T')[0]` — truncates ISO timestamp to date. Loses time-of-day. A critical notification from 2 hours ago looks identical to one from 3am. Use relative time ("3 hours ago") instead.
- 🟡 Profile-fetch failure (line 25 `.catch(() => null)`) silently disables the composition-empty hint. A user with composition *actually* empty but who hit a transient profile-endpoint error gets no hint. Minor.
- 🟡 No field for `notification_type` in rendered output despite line 31 including it in the type. Dead field.
- 🟡 Line 45 `compositionEmpty = skills === 0 && mcps === 0 && tools === 0` — same composition-empty heuristic as `get_my_agent` (Group 1 finding). Extract to shared helper.

**Accessibility**
- 🟢 Description explains what an anomaly signal IS (first sentence). Rare in this MCP.
- 🟢 Composition-empty hint at the bottom is the right place — after notifications, not before.
- 🟡 Description uses "anomaly signal" in the first sentence but the tool name is `get_notifications` (and the output says "unread notifications"). Three names for the same concept: signal / notification / anomaly. Pick one user-facing label.
- 🟡 Notification severity rendered in square brackets `[severity]` as the first visual element. If severity is "critical", `[critical]` is useful. If severity is "info", it still leads the line. Color coding or symbol would differentiate faster.
- 🟡 Line 62 `ID: ${n.id}` — rendered at full length. Notification IDs are probably UUIDs (36 chars). Truncate to first 8, full ID available if needed.
- 🟡 No pagination. If there are 50 unread notifications, all 50 render in one blob. Compare with `get_interaction_log` which has filters + cursor.
- 🟡 No filter by severity, type, or target. User can't ask "show me only critical notifications affecting my MCPs".

**Utility**
- 🟢 The anomaly-signal → acknowledge_threat flow is a complete loop (user reads, user acts).
- 🟡 No "affected target" surface per notification. Skill_hash is in the type but not rendered. User sees "Title: elevated anomaly signals" but not which skill/MCP.
- 🟡 No link to `check_entity` per notification ("call check_entity to see the signals driving this"). The acknowledge_threat next-step is implicit, not surfaced.

---

### `acknowledge_threat` (`tools/acknowledge-threat.ts`)

**Quality**
- 🟢 Uses `getSession` factory pattern — correct per-session isolation.
- 🟢 30-day expiration disclosed in response and description — transparent.
- 🟡 Line 19 `ensureRegistered` fallback — same silent-degradation concern as rest of MCP.
- 🟡 No validation that `notification_id` belongs to *this* agent. Server likely checks, but tool accepts any string and POSTs — could be noisy if an agent acknowledges a notification that isn't theirs.
- 🟡 No response confirmation that the acknowledgement actually registered — relies on `res.ok` only. If server returns `{success: false, error: null}` with 200, tool claims success.
- 🟡 Reason field `z.string().optional()` — no length limit. Adversarial input could POST a 10MB reason. Add `.max(500)` or similar.
- 🟡 `reason` content not echoed back. If user typos their reason, they have no way to verify what was stored.

**Accessibility**
- 🟢 Description explicitly says "acknowledging does not remove the observation from the network" — prevents misunderstanding.
- 🟢 Response re-states the limitation — redundant but valuable for audit trail.
- 🟡 No "acknowledged at" timestamp in response. Operator running through a list doesn't know if their acknowledgement was just processed or if it was already done earlier.
- 🟡 No bulk acknowledge. If an operator is reviewing 12 notifications after triage, they have to call this tool 12 times.
- 🟡 Description says "after reviewing it with your operator" — implies human-in-the-loop but no field to record *who* reviewed. The `reason` field is the closest surface.

**Utility**
- 🟢 Clear closing-the-loop tool. Small surface, single purpose, correct.
- 🟡 No "will re-notify if signal escalates" note. If the skill's anomaly count 2x's after acknowledge, does the notification re-fire? Ambiguous from the description.
- 🟡 No suggestion for *what else to do* beyond acknowledging. If a skill has elevated anomaly signals, the operator might want to call `update_composition` to remove it. Not surfaced.

---

### Group 6 summary

- **Big findings:** 0 — notifications group is correctly structured, uses factory pattern, handles errors gracefully.
- **Small findings:** ~22 (see above).
- **Cross-cutting patterns observed:**
  1. **Terminology trifecta: notification / anomaly signal / threat.** Tool names use all three (`get_notifications`, description "anomaly signal", `acknowledge_threat`). Pick one. "anomaly signal" is the most accurate framing (matches the actual semantics: "observation, not verdict").
  2. **Composition-empty heuristic is duplicated** across `get_notifications`, `get_my_agent`, `summarize_my_agent`, `get_composition_diff`. Extract to `utils/composition-empty.ts`.
  3. **`ensureRegistered` fallback pattern is pervasive and silent.** Every tool that uses it inherits the ghost-agent risk. The fix lives in `session-state.ts`, not in individual tools — but every tool benefits.

---

---

## Group 7: Safety & registry

**Tools audited:** `check_entity`, `check_environment`, `search_skills`, `get_skill_tracker`, `get_skill_versions`

### `check_entity` (`tools/check-entity.ts`)

**Quality**
- 🔴 **No auth header on any of the fetch calls (lines 31, 39).** The resolver is treated as public but the `/api/v1/skill-catalog/search` fallback inside check_entity is also called without auth. If the catalog is tier-gated server-side, unauthenticated requests either get degraded data or 401. Inconsistent with other tools.
- 🔴 **Three entity types, three silently diverged renderers.** `skill` branch has 40+ lines of rich rendering; `agent` branch has 4 lines; `system` branch has 8 lines. A user calling check_entity on an agent gets a thin response with no signals comparable to the skill path. Either enrich the agent/system paths or document why they're terse.
- 🟡 Line 32 `await res.json()` without checking `res.ok`. If resolver returns 502/503, `res.json()` either parses HTML-error into a non-spec object or throws. Neither path handled.
- 🟡 Line 64 `data.skill_hash?.slice(0, 16) ?? entity_id.slice(0, 16)` — if `entity_id` is shorter than 16 chars, slice returns the whole string without the trailing ellipsis, which renders weird ("Skill found: abc123...").
- 🟡 Line 81 `data.threat_patterns` — server field name includes "threat" but the tool description explicitly says "NOT a security check... records what has been observed". Server contract leaks "threat" terminology into this raw-observation tool. Rename server field to `anomaly_pattern_categories`.
- 🟡 Line 88 `scan_score` rendered raw. What's the scale, 0-100? 0-1? Unitless? User has no anchor.
- 🟡 Line 24 `url = ${resolverUrl}/v1/agent/${entity_id}` — no URL-encoding of entity_id. If an agent_id ever contains special chars (pseudo ID with `+`/`/`), malformed URL.

**Accessibility**
- 🟢 Description's "This is NOT a security check" framing is excellent — prevents misuse.
- 🟢 Similar-skills fallback when hash unknown (lines 37-50) is a thoughtful recovery path.
- 🟡 Three entity types with no way to discover valid entity_id formats. An agent_id format vs skill hash vs system_id — each requires a different way to find the value.
- 🟡 `data.found` check repeats three times (lines 35, 104, 116) — extract.
- 🟡 No link to `check_environment` or `search_skills` after "Unknown skill" empty state beyond the inline similar-list. Operator who queried a hash they expected to find has no next action.

**Utility**
- 🟢 Raw signal surface is the right model — report counts, not verdicts.
- 🟡 No comparison to fleet baseline. "43% anomaly rate" — is that high, low, or typical? Percentile among all tracked skills would make the number act on the user.
- 🟡 No historical trend. "Anomaly rate: 43%" — was it 5% yesterday? Big delta is actionable; flat number is less so.

---

### `check_environment` (`tools/check-environment.ts`)

**Quality**
- 🟡 Line 18-19 `await threatsRes.json(); await healthRes.json()` — neither checks `res.ok`. Silent failure mode: resolver down → `threats` becomes an error object, line 23 `Array.isArray(threats)` returns false, user sees "No elevated anomaly signals observed" when the network may be wildly on fire. False negatives.
- 🟡 Line 26 same `skill_hash.substring(0, 16) + '...'` pattern without null guard as `register_agent:108` and `get_network_status:69`. Grep-and-fix across the MCP.
- 🟡 No confidence tag on anomaly signal counts. 3 signals from 1 reporter renders the same as 300 from 100.
- 🟡 Line 21 `health.status ?? 'unknown'` — server field contract not documented. What values should appear here? "healthy" | "degraded" | "down"?

**Accessibility**
- 🟡 Description focuses on logging reminder ("Remember to call log_interaction...") more than what this tool *returns*. Weak when an LLM is deciding between tools.
- 🟡 No divider — flat text. Compare with `get_network_status` which uses `── Section ──`. Inconsistent across safety tools.
- 🟡 No counts for overall health ("N skills tracked, M active anomalies, baseline last refreshed X"). Surface-area of this tool is small.
- 🟡 `_meta.priorityHint: 0.8` — higher than `get_network_status` (0.7). But `get_network_status` is more comprehensive. Priority hint ordering may be inverted.

**Utility**
- 🟢 Fast startup orientation — good intent.
- 🟡 No link to `get_network_status` (fuller picture), `check_entity` (per-skill detail), or `get_notifications` (your signals). Endpoint tool without a next-hop.
- 🟡 Significant overlap with `get_network_status`. Both show active threats + totals. Hard to tell when to use which.

---

### `search_skills` (`tools/search-skills.ts`)

**Quality**
- 🟡 Line 29 no auth header on fetch. Same pattern as `check_entity` and `check_environment`.
- 🟡 Line 30-47 has a proper server-response typing (rare in this MCP — good). But `skills: [...]` is typed as non-null; if server returns `{skills: null, total: 0}`, line 49 `data.skills.length` throws.
- 🟡 Line 45 `content_changed_at` is in the type but never rendered. Dead field.
- 🟡 No confidence tag on signal counts per skill (lines 69-75). A skill with 1 interaction and 1 anomaly signal shows "100.0% anomaly rate" — technically true, statistically meaningless.
- 🟡 Line 85-87 "Increase limit to see more" — but the max is `50` (line 15). If the user asked for 50 and there are 500, "increase limit" isn't true. Should say "use a tighter query".

**Accessibility**
- 🟢 Filter set (source, category, min_agents, min_anomaly_signals) is well-thought-out.
- 🟡 Sort order not documented. Results come out in server-determined order.
- 🟡 `min_anomaly_signals` filter surfaces anomaly-heavy skills — good for auditing. But there's no *inverse* ("show me clean skills"). A filter like `max_anomaly_signals` or `max_anomaly_rate` would complete the set.
- 🟡 `source: z.string().optional()` — no enum. Description suggests "clawhub, github, npm" but the schema accepts anything. Lists drift.

**Utility**
- 🟢 Raw signals aggregation is the right approach — no hidden scoring.
- 🟡 No "similar to skill X" search. If the user has a hash, they have to use `check_entity` for similar-skill recovery. Merge the two paths.
- 🟡 No pagination via cursor — only `limit`. Can't iterate past 50.

---

### `get_skill_tracker` (`tools/get-skill-tracker.ts`)

**Quality**
- 🟡 Line 23, 38 no auth header — same pattern.
- 🟡 Line 53 `(s.skill_hash as string).substring(0, 16) + '...'` — no null guard. If both name and hash are missing, throws.
- 🟡 Line 55 `s.anomaly_signal_rate as number` — direct cast with no default. If server returns null, becomes NaN, line 57 `sigRate > 0` is false, so NaN branch doesn't render. Silent missing signal.
- 🟡 Line 84 uses `sigRate * 100` directly, no null guard either. Would render `NaN%` in the deep-dive path when rate is null.
- 🟡 Line 84 `confidence(interactionCount)` tagged on *anomaly rate*, but `interaction_count` is the total count, not the anomaly denominator. A skill with 10k interactions and 1 anomaly would show `(significant — 10000 samples)` on the 0.01% anomaly rate — that tag actually applies to the interaction count, not the rate. Confusing.

**Accessibility**
- 🟡 Description mentions "skill_hash" optional param but doesn't say how to get one. Link to `search_skills`.
- 🟡 Deep-dive mode and list mode are two distinct views glued into one tool. Consider `get_skill_tracker` vs `get_skill_detail` split.
- 🟡 `sort` enum has 3 options but no "anomaly_count" (absolute count). Users sorting by rate see dominant fractions from thin samples.
- 🟡 `next_cursor` returned but not acceptable as input. Dead pagination hook.

**Utility**
- 🟢 Cross-provider anomaly section (line 97) is a unique lens — "this skill fails for Anthropic agents but not OpenAI agents" is actionable.
- 🟡 Line 105 `>= 2` threshold: "2 providers reporting anomalies" appears as a line but the meaning is opaque. Is that a signal to act?
- 🟡 No "your version vs fleet" info. User uses skill X v1; fleet mostly uses X v2 with different anomaly profile. Deep-dive could surface this.

---

### `get_skill_versions` (`tools/get-skill-versions.ts`)

**Quality**
- 🟡 Line 18, 59, 67 no auth header — same pattern.
- 🟡 Line 57 skill_name used as a search query — fuzzy, may return wrong skill. If two skills share a name (different author), the first match wins and its versions are returned. Should key on skill_id, not name.
- 🟡 Line 86 `date = v.detected_at.split('T')[0]` — date-only render, loses time. Version bumps within the same day compress into one row visually.
- 🟡 Line 83 `isCurrent = v.skill_hash === skill_hash ? ' ← YOU' : ''` — arrow with text. Other tools in this group use `•` or `—`. Arrow is good but inconsistent.
- 🟡 Line 82 `for (const v of versionsData.versions)` — renders all versions. If a skill has 200 versions, all 200 print. No `slice` or filter.

**Accessibility**
- 🟡 `← YOU` marker is charming but may not render in all terminal settings (unicode arrow). Fallback to `<- YOU` or `*you*`.
- 🟡 No indication of chronological order (newest first? oldest first?). Server-determined.
- 🟡 No diff ("what changed in this version") — just change_type and signal count. Users curious about upgrade implications have to look elsewhere.

**Utility**
- 🟢 Version trail with per-version anomaly-signal counts is rare and useful.
- 🟡 No "recommended version" — fleet data available, could surface "92% of fleet on v2.4, your v1.8 is behind".
- 🟡 No link to `check_entity` for deep-dive on any specific version hash.

---

### Group 7 summary

- **Big findings:** 2 — `check_entity` has no auth on any fetch and three entity types diverge silently in render depth.
- **Small findings:** ~30 (see above).
- **Cross-cutting patterns observed:**
  1. **Auth headers are systematically missing in Group 7.** `check_entity`, `check_environment`, `search_skills`, `get_skill_tracker`, `get_skill_versions` all omit `getAuthHeaders()`. Two explanations: (a) these endpoints are genuinely public (then document), or (b) copy-paste error (then fix). Either way, harmonize.
  2. **`substring(0, 16) + '...'` pattern without null guard appears at least 5 times across the MCP** (check_entity, check_environment, get_network_status, register_agent, get_skill_tracker). Single utility `truncHash(h: string | null): string`.
  3. **"Threat" terminology leaks from server into MCP surface.** `threat_patterns`, `threats`, `check_environment`'s threat-list endpoint — MCP tool descriptions explicitly say "not a security check" but the underlying fields use threat-vocabulary. Full rename pass needed.
  4. **Confidence tag applied to the wrong denominator** in `get_skill_tracker:57,84` — tag reflects interaction count but annotates the anomaly rate. Tighten the mapping between the sample size and the stat the tag describes.
  5. **No cursor pagination honored across any of Group 7's list tools.** Server-side `next_cursor` is rendered but never accepted as input. Dead pagination hooks across the board.

---

---

## Cross-cutting findings

These are patterns and infrastructure issues that span multiple tools. Findings are keyed to files that don't fit in any one tool section: `server.ts`, `http.ts`, `index.ts`, `env-detect.ts`, `version-check.ts`, plus naming/configuration drift across the codebase.

### 1. The `getSession` factory split — root cause of the HTTP-transport leak cluster

**`server.ts:124-149`.** `createAcrServer` registers 22 tools. Exactly four of them receive `() => session` as a parameter (`update_composition`, `get_notifications`, `acknowledge_threat`, `configure_deep_composition`). The remaining eighteen are registered with `(server, apiUrl)` only — no session reference — which forces them to read `defaultSession` from module scope whenever they need identity, provider class, chain context, transport type, or version-check state.

Under stdio transport this is harmless because `defaultSession` is the single session. Under HTTP transport, `http.ts:82-83` correctly constructs a new `SessionState('streamable-http')` per session and passes it to `createAcrServer({ session })`, but the factory only threads that session into four tools. Every other tool continues to read `defaultSession` — i.e., the stdio singleton — for every request on every HTTP session. Under concurrent HTTP sessions this is a systematic cross-session leak of:
  - `defaultSession.agentId` / `apiKey` (auth and identity)
  - `defaultSession.providerClass` (cohort ranking, anomaly context)
  - `defaultSession.nextChainContext()` (chain_id and chain_position for receipts)
  - `defaultSession.transportType` (always reports `stdio` under HTTP)
  - `defaultSession.versionCheck` (upgrade banner shows the wrong session's state)

**Impact scope.** This single pattern is the root cause of every 🔴 "HTTP transport leak" finding in Groups 1-4: `log_interaction`, `get_my_agent`, `getting_started`, `whats_new`, `summarize_my_agent`, the self-log middleware, the fetch observer, and the environmental probe all route session-scoped state through `defaultSession`.

**Fix.** Change every tool factory signature to accept `getSession: () => SessionState` (or `session: SessionState`) and drop every `defaultSession` import from `src/tools/`. The `withSelfLogging` wrapper already threads `getSession` through — reuse that pattern. `state.ts` still exports `ensureRegistered(…)` against `defaultSession`; that module needs to be retired or taught to accept a session.

### 2. `state.ts` — parallel module-level config

**`state.ts:8`.** `const ACR_API_URL = process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';` is captured at import time and frozen for the process. `server.ts:94` reads the same env var into `apiUrl` but accepts an options override. Two sources of truth. If the hosting app mutates `process.env.ACR_API_URL` before calling `createAcrServer`, `server.ts` picks it up but `state.ts` does not.

**Line 46** (`ensureRegistered`) hardcodes `ACR_API_URL` and `defaultSession`. Anything that goes through this path can't participate in HTTP-transport session isolation. Callers of `ensureRegistered` (self-log middleware, fetch observer background register, env probe bootstrap) all inherit this global.

### 3. `http.ts` — transport-boundary setup is correct; tools don't honor it

**`http.ts:82-83`.** `new SessionState('streamable-http')` and `createAcrServer({ session })` are the right shape. The `transport.onclose` handler closes the MCP server and removes the session from the map. This file itself is correct. The HTTP transport leak is not a bug in `http.ts` — it's that `server.ts:124-149` doesn't propagate the session it just received.

Minor: **`http.ts:85-89`** — `transport.onclose` closes the server but does not cancel the two background promises fired by `createAcrServer` (env probe, version check). Under session churn those promises can still post receipts against a session that's already been torn down.

### 4. `index.ts` — trivial stdio entry point

**`index.ts`** (19 lines, not re-read) is a thin wrapper around `createAcrServer()` + `StdioServerTransport`. Nothing to flag.

### 5. `env-detect.ts` — unreachable enum variant, stub composition observer

**`inferDeviceClass` (line 16-24)** returns only `sbc` / `mobile` / `desktop` despite the `EnvironmentContext['device_class']` type explicitly listing `'server'` as a valid option. No branch maps memory size (or any signal) to `server`. The only way to get `device_class: 'server'` is via `ACR_DEVICE_CLASS=server` override. If "desktop" is the output for a 64 GB AWS EC2 host, cohort-by-device-class analytics downstream are lying.

**`inferDeviceClass` heuristic is also memory-only.** A laptop with 8 GB RAM and an EC2 instance with 8 GB RAM both bucket as `desktop`. This will hurt the moment we try to cohort "agents running on servers" vs "agents running on user laptops."

**`observeComposition` (line 56-63)** returns `{}`. This is the MCP-observed side of the two-source composition pattern — documented as a Phase-1 stub, but in practice every MCP-observed composition in production is blank. The `mcp_observed` composition source always has zero skills and zero MCPs, so any declared-vs-actual comparison that includes it looks like "agent has zero composition."

### 6. `version-check.ts` — clean, with two micro-findings

The implementation is the cleanest file in the codebase. Body-cap streaming (line 130-144), double-fallback for older runtimes (line 115-128), silent-on-all-failures (line 157), and injectable `fetchImpl` are all good. One real finding and one small one:

- **Pre-release tags equal production tags** under `parseSemver` (line 52: `.split(/[-+]/, 1)[0]`). The docstring acknowledges this is intentional so `2.4.1-beta` doesn't prompt a "downgrade" banner against `2.4.1` in the registry. But the same rule means a user running `2.4.1-beta.3` gets no notification when `2.4.1` ships. Fine while we don't ship betas; a trap the first time we do.
- **`parseSemver` rejects non-3-part versions** (line 54: `if (parts.length !== 3) return null`). npm's `/latest` always returns 3-part versions, so this never fires in practice — but if npm ever returns `2.4.1.1` (e.g., for a Windows-style version), the check silently no-ops forever.

### 7. Background-probe fan-out under HTTP transport

**`server.ts:158-169`** (env probe) and **`server.ts:177-184`** (version check) both fire on every `createAcrServer()` call. The version-check docstring says "once per process" (line 19 of `version-check.ts`), but the reality under HTTP transport is **once per session** — every new HTTP session spins up a new `createAcrServer`, which fires a new probe and a new version check. A hundred concurrent HTTP sessions = a hundred hits to `registry.npmjs.org/@tethral/acr-mcp/latest` plus `N × DEFAULT_TARGETS.length` env probe pings.

**Fix.** Hoist `checkLatestVersion` to a module-level memoized promise (or a static `VersionCheckResult` cache) so the result is genuinely process-wide, then `session.setVersionCheck(cached)` on each new session. Env probe can stay per-session if per-session baselines are wanted, but should be skipped on session re-create within a short window.

### 8. `__PACKAGE_VERSION__` is baked in at build time

**`server.ts:40, 104, 179`.** Uses the esbuild `--define` injection to get the current version. Fine mechanically. But it means:
- Any version comparison is between the build-time version and npm-registry-latest. If the source tree is ahead of the last build, the banner will show a stale "current" version.
- The MCP registry `server.json` version, the `package.json` version, and `__PACKAGE_VERSION__` can all drift independently. We caught one instance of this in the 2.3.2 release. The publish workflow has a guard (`publish.yml:54-57`) for package.json vs server.json, but nothing enforces that a tagged git release matches what's in `__PACKAGE_VERSION__` at the time of tag.

### 9. Environment variable naming and semantics drift

Boolean env vars use three different conventions in the same codebase:

| Variable | Truthy test | Default |
| --- | --- | --- |
| `ACR_DISABLE_VERSION_CHECK` | `=== '1'` | off |
| `ACR_DISABLE_FETCH_OBSERVE` | `=== '1'` | off |
| `ACR_DISABLE_ENV_PROBE` | `=== '1'` | off |
| `ACR_MCP_STATELESS` | `=== 'true'` | off |
| `ACR_DEEP_COMPOSITION` | `!== 'false'` | **on** (inverted) |

A user who sets `ACR_DISABLE_VERSION_CHECK=true` (reasonable guess) gets no opt-out. A user who sets `ACR_MCP_STATELESS=1` (reasonable guess) gets no stateless mode. A user who sets `ACR_DEEP_COMPOSITION=0` expecting to disable it gets deep composition enabled because `'0' !== 'false'`.

**Fix.** Ship a single `envBool(name, default)` helper that accepts `'1' | '0' | 'true' | 'false' | 'yes' | 'no'` case-insensitively. Route every boolean env var through it.

### 10. Env-var documentation surface

Only `ACR_API_URL` is documented in `server.json:20-27`. The other nine env vars (`ACR_RESOLVER_URL`, `ACR_DEEP_COMPOSITION`, `ACR_DEVICE_CLASS`, `ACR_PLATFORM`, `ACR_ARCH`, `ACR_DISABLE_FETCH_OBSERVE`, `ACR_DISABLE_ENV_PROBE`, `ACR_DISABLE_VERSION_CHECK`, `ACR_ENV_PROBE_TARGETS`, `ACR_MCP_HTTP_PORT`, `ACR_MCP_AUTH_TOKEN`, `ACR_MCP_STATELESS`, `ACR_DASHBOARD_URL`) are not in the registry manifest or the package description.

### 11. Session lifecycle has no graceful shutdown for in-flight work

Neither stdio nor HTTP transport waits for the two background promises in `createAcrServer` to settle before teardown. Under stdio this is fine (process exit discards them). Under HTTP, `server.close()` fires immediately on `transport.onclose`, but `await session.ensureRegistered(apiUrl)` inside the probe bootstrap can resolve after the transport is gone — its receipt POST then lands against a stale session.

### 12. `CorrelationWindow` is per-server-instance (good), but state is never persisted

**`server.ts:100`.** Correct: one window per session, not a module-level singleton. But: if the HTTP transport restarts (deployment, crash, SIGHUP), every in-flight chain loses its correlation window and chains get split artificially. Acceptable given a 60s window and an infrequent restart cadence — but worth noting alongside "server-side chain inference is authoritative."

### Summary of cross-cutting patterns

The dominant cross-cutting bug is the `getSession` factory split (#1): it causes the `defaultSession` leak in every tool that reads session-scoped state, and it shows up in approximately every 🔴 Big-bucket finding across Groups 1-4. Fixing it is a mechanical but wide-surface change: touch every tool factory, drop the `defaultSession` imports, re-run tests.

After that:
- `env-detect` needs a real `server` bucket (and ideally a real composition observer).
- Env-var conventions need a single helper.
- `version-check` / env-probe need process-level memoization.
- The baked-in `__PACKAGE_VERSION__` needs a tag-time invariant check.

None of these are catastrophic. The `getSession` fix is the only one that affects correctness — the others are consistency and hygiene.

---

## 🔴 Big bucket

Consolidated from the per-tool and cross-cutting sections. Ordered by severity: correctness-affecting first, then signal-corrupting, then operationally risky. One-line handle per finding; each links to the detailed write-up above.

### Tier A — corrupts identity, attribution, or privacy under HTTP transport

1. **[B1] `getSession` factory split (`server.ts:124-149`) — root cause.** 18 of 22 tools read `defaultSession` instead of receiving the session that HTTP transport constructs. Fixing this single pattern eliminates B2, B3, B8, B9, B11, B12, B13, B14.
2. **[B2] `register_agent` HTTP transport privacy leak.** `defaultSession.deepComposition` read at `register-agent.ts:53`; session A's "deep=off" gets overridden by session B's "deep=on", leaking sub-components.
3. **[B3] `log_interaction` HTTP transport leak.** Chain context, provider_class, transport_type all routed through `defaultSession` at `log-interaction.ts:91, 124, 150`. Corrupts *every receipt* under HTTP transport — which corrupts every lens downstream.
4. **[B4] `session-state.ts` silent degradation on registration failure.** `ensureRegistered` (line 160) falls back to `pseudo_<hex>` on POST failure. Receipts then land under a ghost agent the server never saw; all downstream aggregation is orphaned. Needs retry + surfaced failure, not silent fallback.
5. **[B5] `self-log` module-level `selfLogging` boolean races under HTTP (`self-log.ts:17`).** Session A setting it blocks session B's self-log entirely. Should use `AsyncLocalStorage` like `fetch-observer`.
6. **[B6] `self-log` `defaultSession.agentId` fallback (`self-log.ts:46`)** emits session B's receipt under session A's agent. Cross-session misattribution.
7. **[B7] `fetch-observer` install idempotency guard is module-level (`fetch-observer.ts:45`).** Second HTTP session gets a silent no-install; all its fetches are attributed to session A via the captured closure variable. Silent cross-session leakage.

### Tier B — corrupts signal without crossing sessions

8. **[B8] `fetch-observer` hardcoded `provider_class: 'unknown'` (`fetch-observer.ts:187`).** Session already in scope; one-line fix. Every observer-emitted receipt loses provider_class, which corrupts the "faster than X% of anthropic peers" cohort rank.
9. **[B9] `probes/environmental.ts:108` hardcoded `provider_class: 'unknown'`.** Same copy-paste as B8; same downstream cohort corruption.
10. **[B10] `register_agent` composition_hash ignores rich composition (`register.ts:39-42`).** Hash is computed from `skill_hashes` only. An agent with rich composition but no flat `skill_hashes` gets `computeCompositionHash([])` — a constant hash — every time. Drift detection never fires.
11. **[B11] `whats_new` upgrade banner HTTP leak (`whats-new.ts:57`).** `renderUpgradeBanner(defaultSession.versionCheck)` shows the wrong session's version state.
12. **[B12] `get_my_agent` tool menu is stale.** Description claims "a grouped menu of all available tools" but `TOOL_MENU` lists 22 of 26 tools — missing `get_revealed_preference`, `get_compensation_signatures`, `get_composition_diff`, `getting_started`. LLMs picking tools from this menu can't discover the newer lenses.
13. **[B13] `summarize_my_agent` description overclaims.** Says "all available lenses"; actually calls 3 of 8. Misleads both users and tool-selecting LLMs.
14. **[B14] `get_interaction_log` receipt-id fallback renders 5 unrelated items (`get-interaction-log.ts:77-79`).** Single-receipt query returns a 5-item list when the server returns `receipts` instead of `receipt`. Comment and behavior disagree. User sees wrong data, thinks it's correct.
15. **[B15] `log_interaction` `.join(', ')` on unchecked `receipt_ids` (`log-interaction.ts:179`).** Line 168 guards `isArray`, line 179 doesn't. If server returns `receipt_ids: null`, tool throws after the receipts actually landed — user sees an error, thinks nothing logged.

### Tier C — hardcoded heuristics, unverified ratios, undocumented math

16. **[B16] `get_friction_report` verdict thresholds are undocumented magic numbers (`get-friction-report.ts:311-319`).** The "config/network" vs "network-wide issue" verdict depends on `5`, `5`, `2x`, `20` with no calibration note. These verdicts drive operator decisions.
17. **[B17] `get_friction_report` absolute-elevation floor patched into relative check (`get-friction-report.ts:308-312`).** Implicit "5% failure floor" sits inside verdict logic with no knob.
18. **[B18] `get_trend` ratio vs delta-fraction ambiguity (`get-trend.ts:70`).** `(latency_change_ratio * 100).toFixed(1)%` — if server returns a ratio (1.15 = 15% slower), this renders "115.0%". If server returns a delta-fraction (0.15), renders "15.0%". Need to verify contract matches render; one is wrong by 100x.

### Tier D — auth / security / operational

19. **[B19] `get_network_status` calls its (tier-gated) endpoint without auth (`get-network-status.ts:19`).** Every other lens tool sends `getAuthHeaders()`. Either gets silently-degraded data or 401.
20. **[B20] Group 7 tools all omit auth headers (`check_entity`, `check_environment`, `search_skills`, `get_skill_tracker`, `get_skill_versions`).** Either these are genuinely public (document that) or copy-paste bug (fix). As-is, inconsistent with Group 3.
21. **[B21] `check_entity` three entity types diverge silently in render depth.** `skill` path: 40+ lines. `agent` path: 4 lines. `system` path: 8 lines. Same tool name, wildly different surface. Either enrich or document.
22. **[B22] Server `SHADOW_MODE = true` hardcoded (`receipts.ts:22`).** No ingest protection is enforced in prod. Staging-posture silently persisted to production. Needs env var + flip-date.
23. **[B23] Server `HARD_HOURLY_CAP = 10_000` not configurable (`receipts.ts:25`).** Shadow-mode hides it today. The day shadow flips, enterprise tenants break. Needs env override + per-tenant override.

### Severity summary

- **Tier A (7 findings)** — every HTTP transport session corrupts identity, chain, or privacy. Single architectural fix (B1) subsumes B2/B3/B5-B7; B4 is independent.
- **Tier B (8 findings)** — signal is wrong but sessions are correctly isolated. Mostly one-line provider_class fixes + copy/stale docs.
- **Tier C (3 findings)** — heuristics and math that could be wrong in prod *right now* and no one would notice. Verify against server and document calibration.
- **Tier D (5 findings)** — auth harmonization and the two shadow-mode tripwires.

Total: 23 🔴 Big findings. If B1 is fixed first, six other Tier-A findings are resolved along with it — the practical landing count is ~17 independent fixes.

---

## 🟡 Small bucket

The full 🟡 Small findings live in each per-tool section above (one bullet per finding, keyed to file + line number). This section is a navigation index and theme-cluster roll-up — tracking *patterns* that recur across tools so the next engineer can fix them in one sweep rather than tool-by-tool. Per-tool bullet totals are approximate (fence-post count).

### By tool — small-bucket counts and anchors

| Tool | Count | Anchor |
| --- | --- | --- |
| `register_agent` | ~5 | [Group 1](#group-1-identity--onboarding) |
| `get_my_agent` | ~7 | [Group 1](#group-1-identity--onboarding) |
| `getting_started` | ~5 | [Group 1](#group-1-identity--onboarding) |
| `summarize_my_agent` | ~5 | [Group 1](#group-1-identity--onboarding) |
| `state.ts` / `session-state.ts` / `acr-state-file.ts` | ~9 | [Group 1 supporting](#supporting-code-findings) |
| `log_interaction` | ~10 | [Group 2](#group-2-core-logging) |
| `get_interaction_log` | ~8 | [Group 2](#group-2-core-logging) |
| `middleware/self-log.ts` | ~4 | [Group 2 supporting](#middlewareself-logts) |
| `middleware/correlation-window.ts` | ~4 | [Group 2 supporting](#middlewarecorrelation-windowts) |
| `middleware/fetch-observer.ts` | ~5 | [Group 2 supporting](#middlewarefetch-observerts) |
| `probes/environmental.ts` | ~6 | [Group 2 supporting](#probesenvironmentalts) |
| `routes/receipts.ts` / `receipts-read.ts` | ~7 | [Group 2 supporting](#server-packagesingestion-apisrcroutesreceiptsts) |
| `get_friction_report` | ~10 | [Group 3](#group-3-primary-lenses) |
| `get_coverage` | ~7 | [Group 3](#group-3-primary-lenses) |
| `get_trend` | ~8 | [Group 3](#group-3-primary-lenses) |
| `get_profile` | ~6 | [Group 3](#group-3-primary-lenses) |
| `get_failure_registry` | ~6 | [Group 3](#group-3-primary-lenses) |
| `get_stable_corridors` | ~5 | [Group 3](#group-3-primary-lenses) |
| `get_network_status` | ~6 | [Group 3](#group-3-primary-lenses) |
| `utils/confidence.ts` | ~3 | [Group 3 supporting](#utilsconfidencets) |
| `get_revealed_preference` | ~7 | [Group 4](#group-4-advanced-lenses) |
| `get_compensation_signatures` | ~7 | [Group 4](#group-4-advanced-lenses) |
| `get_composition_diff` | ~6 | [Group 4](#group-4-advanced-lenses) |
| `whats_new` | ~5 | [Group 4](#group-4-advanced-lenses) |
| `update_composition` | ~9 | [Group 5](#group-5-composition-management) |
| `configure_deep_composition` | ~5 | [Group 5](#group-5-composition-management) |
| `strip-sub-components.ts` | ~1 | [Group 5 supporting](#supporting-code-strip-sub-componentsts) |
| `get_notifications` | ~11 | [Group 6](#group-6-notifications) |
| `acknowledge_threat` | ~10 | [Group 6](#group-6-notifications) |
| `check_entity` | ~7 | [Group 7](#group-7-safety--registry) |
| `check_environment` | ~7 | [Group 7](#group-7-safety--registry) |
| `search_skills` | ~6 | [Group 7](#group-7-safety--registry) |
| `get_skill_tracker` | ~8 | [Group 7](#group-7-safety--registry) |
| `get_skill_versions` | ~6 | [Group 7](#group-7-safety--registry) |
| Cross-cutting (`server.ts`, `env-detect.ts`, `version-check.ts`, env-vars) | ~12 | [Cross-cutting](#cross-cutting-findings) |

**Approximate total: ~230 🟡 Small findings.** The raw count is inflated by near-duplicates across tools (e.g., the `substring(0, 16) + '...'` null-guard bug counts once in each of five tools where it appears). The theme clusters below collapse these into the actual distinct work items.

### Theme clusters — "fix once, land everywhere"

The small-bucket findings collapse into a short list of recurring patterns. Each cluster groups every small finding that shares a root cause. Fixing the root once resolves all grouped findings.

#### C1. Null-guard and coerce-unknown patterns

Fallout from `Record<string, unknown>` casts and untrusted server JSON. Grep-and-fix sweep.

- `substring(0, 16) + '...'` without null guard: `register_agent:108`, `check_environment:26`, `get_network_status:69`, `get_skill_tracker:53`, `check_entity:64` (5 sites).
- `<field>.toFixed(N)` on a nullable number: `summarize_my_agent:103,110`, `get_friction_report:238-258`, `whats_new:94-97`, multiple others.
- `foo.bar.split('T')[0]` on optional ISO timestamps: `get_notifications:62`, `get_skill_versions:86`, others.
- `JSON.stringify(r.observed)` renders raw blob: `get_coverage:59`.
- **Fix:** Ship `utils/safe-render.ts` with `truncHash(h)`, `fmtRatio(r, kind)`, `fmtDate(iso)`, `kvPairs(obj)`. Route every affected render through it.

#### C2. Missing auth headers on `fetch(...)`

Group 7 tools call the API without `getAuthHeaders()`. Group 3's `get_network_status` has the same bug. Either the endpoints are public (document it) or it's a copy-paste bug (fix it).

- Sites: `check_entity:31,39`, `check_environment:18,19`, `search_skills:29`, `get_skill_tracker:23,38`, `get_skill_versions:18,59,67`, `get_network_status:19`.
- **Fix:** Add a single `fetchJsonAuthed(url, session)` helper. Convert every `fetch(url)` call in `src/tools/` to go through it.

#### C3. `ensureRegistered` silent-degradation fallout

Every tool that calls `ensureRegistered` inherits the `pseudo_<hex>` ghost-agent risk from B4. Not a new bug per tool — just a reminder that fixing B4 lifts this risk everywhere.

- Affected: `update_composition:46`, `get_notifications:19`, `acknowledge_threat:19`, `log_interaction`, fetch-observer bootstrap, env probe bootstrap.

#### C4. Divider and arrow inconsistency

Four divider styles and three arrow styles across the MCP's text output.

- Dividers: `── Section ──` (friction, revealed-preference, compensation, get_my_agent), `-- Section --` (coverage, whats_new, summarize_my_agent), no divider (check_environment), `===` block markers (get_interaction_log detail).
- Arrows: `→` (compensation), `->` (friction, check_environment), `·` (get_my_agent), `← YOU` (get_skill_versions).
- **Fix:** Define `render/style.ts` with `section(title)`, `arrow()`, `bullet()`. Every render module imports from it.

#### C5. Confidence tag coverage and placement

The confidence utility (`utils/confidence.ts`) is a good primitive, but its application is inconsistent.

- Tools that tag correctly: friction-report top patterns, directional pairs.
- Tools that tag to the wrong denominator: `get_skill_tracker:57,84` (count vs rate).
- Tools that don't tag at all despite having sample-size signal: `get_coverage` (per-rule), `search_skills` (per-skill), `check_environment` (per-anomaly-rate).
- Exported constants `PRE_SIGNAL_MAX` / `DIRECTIONAL_MAX` never imported by callers — each tool repeats the numeric thresholds inline.
- **Fix:** Audit every "% rate" or "N samples" render. Each should either apply the confidence tag against the denominator that the stat is calculated over, or render a companion `(N samples)` suffix.

#### C6. Truncation limit chaos

Tool outputs cap list renders at wildly different `top-N` values with no standard. Samples:

- `get_friction_report`: top-5, top-5, top-3.
- `get_failure_registry`: top-10.
- `get_stable_corridors`: top-5.
- `whats_new`: top-5 within 24h.
- `search_skills`: limit param default 20, max 50.
- `get_composition_diff`: top-10 / 15 / 15 (three different values in one tool).
- **Fix:** Define `render/limits.ts` exporting `TOP_N_DEFAULT`, `TOP_N_DENSE`, `TOP_N_SPARSE`. Tools pick a named constant; discussion happens in one place.

#### C7. Terminology drift: notification / anomaly signal / threat / scan

One concept, four user-facing labels, three file-level namespaces. Each label is justifiable on its own; the mix is not.

- `get_notifications` uses "notification".
- Notification *content* uses "anomaly signal".
- `acknowledge_threat`, `check_entity.threat_patterns`, `check_environment`'s `/threats` endpoint all use "threat".
- `scan_score` on check_entity is yet another term.
- Tool descriptions explicitly say "NOT a security check" — but the underlying field names and endpoint paths use threat-security vocabulary.
- **Fix:** Pick "anomaly signal" (the most accurate framing per the data model) and do a rename pass on every server field and tool-facing label. Keep `threat` only in historical database columns with migration.

#### C8. Truncated ID rendering without full-ID disclosure

Several tools render the first N chars of a UUID or hash + `...` but don't expose the full ID anywhere in the response. Makes audit-trail cross-referencing impossible.

- `get_notifications:62` (full UUID rendered — this one's the opposite problem, too long).
- `register_agent:108`, `check_entity:64`, `get_skill_tracker:53`, `get_skill_versions:82` (all truncate without option to expand).
- **Fix:** Settle on "12 chars for inline render, accept `verbose: true` param to surface full id in a footer." Apply consistently.

#### C9. Cursor pagination dead-end

Multiple tools render `next_cursor` from server responses but don't accept `cursor` as input — so users never get to page 2.

- Sites: `get_interaction_log:100`, `search_skills:85-87`, `get_skill_tracker:next_cursor`, `get_notifications` (no pagination at all despite N=50+ possible).
- **Fix:** Add a `cursor` input param to every list-returning tool that already sees `next_cursor` from the server. Document behavior in the description.

#### C10. `scope` enum drift

Primary lenses accept different scope values. Some accept `session`, some don't. Some accept `today`, others call it `day`, others `current`.

- `get_friction_report`, `get_trend`, `get_coverage`, `get_failure_registry`, `get_stable_corridors`, `whats_new` all have slightly different `scope` vocabularies.
- **Fix:** Define `const SCOPE_ENUM = ['session', 'day', 'yesterday', 'week', 'month', 'all']` once. Every lens tool's schema references it.

#### C11. Empty-state with no next action

Many tools render "no data" messages without a next action. The operator sees "No baseline-comparable targets" (friction report population drift) with nowhere to go.

- Affected: `get_friction_report` (population drift empty), `get_coverage` (all-green), `get_failure_registry` (no failures), `whats_new` (nothing degraded), several more.
- **Fix:** Every `if (list.length === 0)` branch should either link to another tool (`Tip: call get_X to ...`) or explicitly say "this is a healthy state."

#### C12. Tool descriptions drift from actual behavior

Overclaim or underclaim in descriptions is not just B12/B13 — it's a pattern.

- `summarize_my_agent`: description says "all lenses", renders 3.
- `get_my_agent`: description says "menu of all tools", renders 22 of 26.
- `get_coverage`: description says "which fields you populate" with no examples.
- `search_skills`: description lists `source` values but schema accepts any string.
- **Fix:** Add a CI check that asserts every tool's description accurately summarizes its schema + handler behavior. (Or just audit descriptions quarterly — this drifts naturally.)

#### C13. Server source-enum values hardcoded across the codebase

`source='agent' | 'server' | 'fetch-observer' | 'environmental'` is used as a string in at least 6 files with no central definition. Add one when it's ever extended.

- Sites: `log_interaction`, `self-log`, `fetch-observer`, `environmental.ts`, `receipts.ts`, `receipts-read.ts`.
- **Fix:** `const RECEIPT_SOURCES = { AGENT: 'agent', SERVER: 'server', OBSERVER: 'fetch-observer', ENVIRONMENTAL: 'environmental' } as const;` in a shared module.

#### C14. Composition-empty heuristic duplicated

The `skills === 0 && mcps === 0 && tools === 0` test is copy-pasted across four tools. Extract `utils/is-composition-empty.ts`.

- Sites: `get_my_agent`, `get_notifications:45`, `summarize_my_agent`, `get_composition_diff`.

#### C15. Hardcoded `system_id` and chain-id prefix strings

`'mcp:acr-registry'` (self-log), `'s-'` (MCP chain), `'srv-'` (server chain), `'pseudo_'` (register fallback), `'acr_'` (register success) — five prefix conventions with no shared constants.

- **Fix:** `src/constants.ts` with every prefix exported and commented.

#### C16. Mutation tools return success/failure only, no diff

`register_agent`, `update_composition`, `acknowledge_threat` all mutate state but return "success" without showing what changed. A diff (added/removed/unchanged) would let operators verify.

### How to work the small bucket

The theme clusters above define 16 logical units. Most land in 10-30 minutes each because the change is mechanical and the per-tool sections above give file + line numbers. Suggested order, by ratio of fixed-findings-per-unit-of-work:

1. C2 (auth) — ~9 sites, single helper, high security impact.
2. C1 (null-guards) — single utility module, many sites.
3. C4 (style) — one module, clean sweep.
4. C13 (source enum) — one module, 6 sites.
5. C14, C15 (prefix/helper dedup) — near-trivial.
6. C6 (truncation) — one module, everyone imports.
7. C10 (scope enum) — one module, 6 schemas updated.
8. C9 (cursor pagination) — per-tool but pattern identical.
9. C5 (confidence coverage) — requires per-tool thinking.
10. C7 (terminology) — needs rename pass + DB migration planning. Biggest scope.
11. C3, C11, C12, C16, C8 — documentation/UX sweeps, batch as one PR.
