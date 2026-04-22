## 2.6.0 (2026-04-22)

First-value onboarding. A brand-new MCP install against a brand-new
agent used to land on "pre-signal — thin sample" for the first ~10
interactions. Every lens was empty, every verdict was withheld, and
the operator saw a black hole with no framing. Now the first call
renders the cohort's typical performance — keyed on the caller's
`provider_class` — so there's always something useful to look at.

Release E of the v2.5.0 – v2.9.0 roadmap.

- **New tool `orient_me`.** State-aware router: reads profile +
  coverage + notifications and returns the single most useful next step
  for the caller's current state (NEW / SOME_DATA / STEADY). Unread
  signals win over everything; otherwise NEW gets "log your first
  interaction + here's cohort typical performance," SOME_DATA gets
  "keep logging, N receipts to go," STEADY gets routed to the lens
  that fits their current shape. Replaces `getting_started` as the
  recommended front-door tool (the old one stays registered for now;
  it'll be absorbed in 2.7.0).
- **Server-side cohort baseline endpoint.**
  `GET /api/v1/baselines/cohort?provider_class=...` returns typical
  median / p95 / failure / anomaly per target across the caller's
  provider-class cohort over the last 7 days (configurable up to 30).
  Public — no agent ID, no API key — because the thin-sample prepend
  runs before the agent has activity of its own. Privacy: `cohort_size
  >= 3` enforced at both the cohort and per-target level; environmental
  probe receipts excluded by default so synthetic baselines don't
  dilute "what real agent calls look like."
- **Thin-sample prepend across lenses.** `get_friction_report` and
  `summarize_my_agent` now prepend a "Your cohort's typical performance
  —" section whenever the agent's own sample is below 10 interactions.
  Framing, not substitution: the thin own-data section still renders
  underneath. Baseline failures are non-fatal — a missing cohort never
  blocks a lens.
- **Environmental probe coverage doubled.** `probes/environmental.ts`
  default targets now include Google (Gemini), AWS Bedrock, and Azure
  alongside the original Anthropic / OpenAI / GitHub. Six provider
  families instead of three, so the baseline latency picture covers
  the full modern model-provider footprint. Users can still override
  via `ACR_ENV_PROBE_TARGETS`.

No schema changes. Rebuild and republish only.

## 2.5.3 (2026-04-22)

Auth harmonization across every tier-gated tool. Previously the resolver
and network-lookup endpoints (`check_entity`, `check_environment`,
`get_skill_versions`, `get_skill_tracker`, `search_skills`) called their
ACR API paths with a bare `fetch(url)` — the server's tier gates saw an
anonymous request and returned the stripped view. The agent's API key
was sitting right there in session state; it just wasn't being sent.
Fixed, and guarded by CI so it can't drift back.

Release D of the v2.5.0 – v2.9.0 roadmap.

- **`utils/fetch-authed.ts`** is the one place API auth happens. A thin
  wrapper over `fetch` that merges `getAuthHeaders()` from the active
  session with any caller-supplied headers, returns the raw `Response`,
  and lets callers keep their existing `res.ok` / `res.json()` patterns.
  Every `${apiUrl}/api/v1/...` call in `src/tools/` now routes through
  it — lens tools, registry tools, tier-gated network lookups, POST
  endpoints (`log_interaction`, `update_composition`,
  `acknowledge_threat`), and `get_composition_diff`. The resolver
  (`${resolverUrl}/v1/...`) stays unauthed (public by design) and so do
  the two intentional exceptions: `register_agent`'s pre-registration
  POST and `get_network_status`'s network-wide rollup.
- **CI grep-guard** (`tests/unit/no-bare-fetch-api.test.ts`). Scans
  every `src/tools/*.ts` for `fetch(`-shaped lines that reference
  `/api/v1/` and fails the build if any skip `fetchAuthed`. Explicit
  allowlist for the two public endpoints. A second sanity-check
  assertion confirms the scraper actually finds `fetchAuthed` calls —
  so a broken regex can't silently pass.
- **`check_entity` agent + system render parity with skill**. The
  agent branch now emits the same `── Network signals ──` block as the
  skill branch (interaction count, skill count, system count, failure
  rate, anomaly rate, optional composition hash) instead of the old
  four-line status sketch. The system branch adds first-seen /
  last-active and a top-error-codes line, parity with the skill's
  anomaly-pattern categories.

No schema changes. Rebuild and republish only.

## 2.5.2 (2026-04-22)

Verdicts show their math; descriptions match behavior. Operators no
longer have to reverse-engineer why a friction target got flagged one
way or another — the threshold rule that fired is rendered inline. Tool
menu + description accuracy + malformed-response guards round out the
release.

Release C of the v2.5.0 – v2.9.0 roadmap.

- **`config/friction-thresholds.ts`** extracts the per-target verdict
  math from `get-friction-report.ts` inline. Every threshold is named
  (`LOCAL_MIN_INTERACTIONS`, `NETWORK_HEALTHY_PCT`,
  `LOCAL_CONFIG_FLOOR_PCT`, `CONFIG_RATIO`, `BETTER_RATIO`,
  `NETWORK_WIDE_PCT`, `NETWORK_MIN_AGENTS`, `NETWORK_MIN_INTERACTIONS`)
  and the verdict render returns the exact clause that fired, so the
  report prints `(threshold: net<5% AND yours≥5% AND yours>2×net)`
  under each verdict line. Calibration notes live in
  [`docs/friction-verdict-thresholds.md`](docs/friction-verdict-thresholds.md).
- **`TOOL_MENU` covers all 26 tools** (`get-my-agent.ts`). Adds
  `getting_started`, `get_revealed_preference`,
  `get_compensation_signatures`, `get_composition_diff` to the menu —
  they were registered but invisible. A new CI guard
  (`tests/unit/tool-menu.test.ts`) scrapes every
  `server.registerTool(...)` call and asserts set-equality with the
  menu, so a future tool can't slip in without a menu entry.
- **Honest description on `summarize_my_agent`**. Previously
  advertised "all available lenses" — it actually fetches profile +
  friction + coverage. Description now says so, and points at the
  individual lens tools for deeper dives.
- **`get_interaction_log` single-receipt path**. A call with an
  explicit `receipt_id` now returns the matching receipt in detail or
  a clear "receipt X not found — either the id is wrong, or it belongs
  to a different agent." Previously the server returning a narrowed
  list would render as "detail of up to 5 receipts," which was
  confusing noise. `mode="detail"` without an id still shows the
  recent handful.
- **`log_interaction` `.join` guard**. Defensive `Array.isArray` check
  on `data.receipt_ids` — a server returning an unexpected shape (200
  with malformed body) no longer crashes the render with a confusing
  `.join is not a function` error.

No schema changes. Rebuild and republish only.

## 2.5.1 (2026-04-22)

UX footers across every lens. Each lens output now starts with a silent
unread-notification header when there's something waiting, ends with a
concrete `→ Next action` line that routes based on the lens's own data,
and finishes with a `Full view:` dashboard link at the exact range +
source scope the lens just rendered. Operators stop hitting dead ends
when a lens doesn't answer the question directly.

Release B of the v2.5.0 – v2.9.0 roadmap.

- **Notification header** (`utils/notification-header.ts`). Best-effort
  fetch of `GET /api/v1/agent/<id>/notifications?read=false` in parallel
  with the lens fetch — zero serial round trips. Renders a one-line
  `!  N new signals since your last call — call get_notifications`
  banner when `unread_count > 0`, silent empty string otherwise. Every
  failure mode (network, parse, auth) returns `null` so a lens call
  never errors because the notification probe failed. Singular / plural
  chosen honestly ("1 new signal" vs "N new signals").
- **Next-action footer** (`utils/next-action.ts`). Per-lens heuristics
  for friction / trend / coverage / failure-registry / stable-corridors
  / network-status / revealed-preference / compensation / whats-new /
  summarize-my-agent / get-my-agent. Each reads the same response the
  lens just rendered and picks a tool worth calling next, or honestly
  says "nothing to chase this period" when the data is clean. Friction
  routes network-wide failures to `get_network_status`, retry hotspots
  to `get_skill_tracker`, wait hogs to `get_failure_registry`. Trend
  routes degraded targets to `get_friction_report`, stable weeks to
  `get_stable_corridors`. `summarize_my_agent` and `get_my_agent`
  delegate to the strongest sub-lens signal.
- **Dashboard-link footer** (`utils/dashboard-link.ts`). Every
  agent-scoped lens appends `Full view:
  https://dashboard.acr.nfkey.ai/agents/<id>/<lens>?range=<scope>&source=<src>`
  so the operator can pivot from "I read the summary" to "let me drill
  in" without hunting for the URL. `ACR_DASHBOARD_URL` env var overrides
  the base URL for staging and self-hosted deployments, matching
  `get_my_agent`'s existing dashboard-link behavior. Network-status is
  network-wide and gets only the next-action footer (no agent-scoped
  URL).
- **11 lens tools wired**: `get_friction_report`, `get_trend`,
  `get_coverage`, `get_failure_registry`, `get_stable_corridors`,
  `get_network_status`, `get_profile`, `whats_new`, `summarize_my_agent`,
  `get_my_agent`. Each tool fetches unread count in parallel with its
  primary data fetch so the header adds no latency. `whats_new` and
  `summarize_my_agent` reuse the unread count they already fetched —
  literally zero extra work.

No schema changes. Rebuild and republish only.

## 2.5.0 (2026-04-22)

HTTP transport and attribution are correct — concurrent HTTP sessions
no longer leak each other's agent identity, registration failures
surface actionable errors instead of silently masquerading, and the
composition hash now reflects every component the agent reports.

Release A of the v2.5.0 – v2.9.0 roadmap. Nothing changes for stdio
users; HTTP users start getting correct attribution.

- **Per-session state via `AsyncLocalStorage`**
  (`session-state.ts` + `middleware/*`). Concurrent HTTP requests each
  run inside `sessionContext.run(session, …)` so every tool, middleware,
  and the fetch observer resolve the correct `SessionState` via
  `getActiveSession()`. The fetch observer is now installed once,
  session-agnostic, and looks up the live session on every observed
  fetch — no more cross-session bleed. Self-log's module-boolean
  re-entrancy guard becomes `AsyncLocalStorage<boolean>` so it survives
  concurrent sessions correctly. Stdio semantics are preserved via
  `defaultSession` fallback.
- **Typed `RegistrationFailedError`** (`session-state.ts`). Auto-register
  no longer writes `pseudo_<hex>` placeholder IDs on failure and
  pretends to succeed. It throws a typed error carrying the HTTP status
  and response body, with `userMessage()` rendering a one-line
  actionable hint (5xx / 429 / other). Every tool that resolves an
  agent ID (`get_my_agent`, `log_interaction`, `acknowledge_threat`,
  `get_notifications`, `update_composition`) catches the typed error
  and returns `isError: true` with the user message. `log_interaction`
  retries the registration once (500 ms) before surfacing the error so
  transient network blips don't break the receipt-collection loop.
  Stale `pseudo_*` IDs previously persisted to the state file are
  treated as unregistered on startup and trigger a clean re-registration.
- **`provider_class` on environmental probes**
  (`probes/environmental.ts`). Baseline probes were hard-coded
  `provider_class='unknown'` and formed a separate cohort from the
  agent's own activity. They now read the live session's `providerClass`
  (inferred from the MCP client name) so the baseline lands in the
  correct cohort.
- **Full-composition `composition_hash`**
  (`shared/crypto/hash.ts`). The ingestion-api previously hashed only
  `skill_hashes`, collapsing every rich-only composition
  (`skill_components` etc.) to `sha256('')`. A new helper
  `extractCompositionComponentHashes` folds every field (flat + rich +
  `sub_components`) into the hash with type-namespaced identity strings
  so a skill and an MCP that happen to share a name don't collide. Fully
  backwards compatible for legacy `skill_hashes`-only callers.
  Skill-subscription writes still key off the real `skill_hashes` only
  (not derived synthetic hashes) so cross-agent signal ingestion still
  lines up.
- **Signed `get_trend` deltas** (`utils/format-delta.ts`). Extracted the
  delta-rendering into a helper with explicit signs — latency/failure
  direction is now distinguishable at a glance. Server contract
  (`latency_change_ratio` is a fraction, `failure_rate_delta` is a raw
  subtraction) is documented inline.
- **Test harness landing before the refactor**. 21 `SessionState` unit
  tests, 11 `createAcrServer` integration tests exercising HTTP session
  isolation end-to-end (`sessionContext.run` + `getActiveSession` +
  `state.ts` getters), 14 `composition-hash` invariants, 11
  `format-delta` cases. Vitest define mirrors esbuild's
  `__PACKAGE_VERSION__` so tests see the package version at load time.

Resolves 13 Big audit findings (B1, B2, B3, B4, B5, B6, B7, B8, B9, B10,
B11, B15, B18).

## 2.4.1 (2026-04-21)

Built-in upgrade nudge — long-running MCP installs learn about new
versions without the user having to check.

- **Version probe** (`version-check.ts`). On `createAcrServer()` the MCP
  fires a single background GET to `registry.npmjs.org/@tethral/acr-mcp/latest`,
  compares the result against the baked-in package version under a
  coarse semver comparator (pre-release tags ignored), and caches the
  result on the session. The probe uses the unwrapped fetch so it is
  not observed into a receipt, carries a 2s timeout, caps response body
  at 8KB, and swallows every failure silently. Opt out with
  `ACR_DISABLE_VERSION_CHECK=1`.
- **Upgrade banner** on entry-point tools (`getting_started`,
  `whats_new`, `get_my_agent`). When a newer version is available the
  tools prepend a two-line banner with the current → latest versions,
  the `npx` update command, and the opt-out flag. Renders to an empty
  string when nothing is available, so existing output is unchanged on
  up-to-date installs.

No schema changes. Rebuild and republish only.

## 2.4.0 (2026-04-21)

Transport-boundary observation — the agent doesn't have to remember to
log every call. The MCP now captures what actually happens on the wire.

- **Fetch observer middleware** (`middleware/fetch-observer.ts`). On
  `createAcrServer()` the MCP wraps `globalThis.fetch` so every
  outbound HTTP call made from this process (tools, skills, or the
  agent's own code sharing the runtime) becomes a receipt automatically
  — with `source=fetch-observer` and the duration + status captured at
  the transport boundary. Self-emission is guarded by an ACR host match
  and an `AsyncLocalStorage` re-entrancy check so the observer never
  logs its own POSTs. Opt out with `ACR_DISABLE_FETCH_OBSERVE=1`.
- **Environmental baseline probes** (`probes/environmental.ts`). At
  startup, the MCP fires a handful of small requests against public
  targets to build a "what does latency from this host look like when
  nothing is wrong?" baseline. These receipts carry
  `source=environmental` and are intentionally excluded from chain
  inference, so they never contaminate friction chains. Opt out with
  `ACR_DISABLE_ENV_PROBE=1`.
- **Session-inferred chains** (`middleware/correlation-window.ts` +
  `session-state.ts`). Receipts without an explicit `chain_id` that
  land within the correlation window are stitched into a chain on the
  server. Chain IDs minted by the MCP use an `s-` prefix; server-minted
  ones use `srv-`; explicit agent-set values are preserved as-is.
- **New tool: `get_composition_diff`.** Declared-vs-actual composition
  — what the agent advertises through `skills`/`targets` in its
  composition versus what the interaction profile actually shows.
- **Enhanced `get_friction_report`.** Error-code breakdown (`── Failures
  by Error Code ──`) surfaces the top failure modes per scope with the
  dominant target for each code. Token-level waste renders with
  locale-formatted numbers and a waste percentage. Implicit retries are
  detected from timing (failure + same target inside the detection
  window) and reported alongside agent-reported retries. Network
  verdict logic has sample-size floors so a 1-agent "network" can't
  issue a false verdict.
- **Enhanced `log_interaction`.** Accepts `chain_id`, `preceded_by`,
  `wasted_tokens`, and the expanded category set from receipts v2.

Breaking: none. Observer + probes are on-by-default but gated by env
vars. All existing tool signatures are backwards-compatible.

## 2.3.2 (2026-04-20)

Metadata-only release — moves the MCP registry entry from the
`io.github.TethralAI` personal namespace to `io.github.Tethral-Inc`
(the organization). The npm package's `mcpName` field now matches, so
the registry validates ownership correctly and future bumps sync from
CI via GitHub OIDC instead of manual `mcp-publisher` runs.

No runtime or API surface changes.

## 2.3.1 (2026-04-20)

Auth wiring for write paths.

- `log_interaction` now sends the session API key (when one exists) on receipt POSTs. The server's `optional-agent-auth` middleware continues to accept unauthenticated writes for low-friction onboarding, but registered agents now get their writes tagged with a verified owner — which the anomaly-on-ingest layer uses for per-agent rate tracking and quarantine checks.
- `update_composition` POSTs likewise carry the API key when available.
- Self-log middleware (`withSelfLog`) sends the key on auto-generated `source=server` receipts, so server-side tool-call telemetry is attributable to the same agent as manually-logged interactions.

No schema changes. Rebuild and republish only.

## 2.3.0 (2026-04-19)

Metabolic observability — see where time goes and who you look like.

- **Shadow tax** on `get_friction_report` summary: the slice of total wait that produced no forward progress, broken into three disjoint buckets — `failed_call_ms` (duration of non-success calls), `retry_ms` (retry_count × duration on succeeded-after-retry calls), and `chain_queue_ms` (queue time for chained calls). Each receipt credits the most specific bucket so operators can re-aggregate without double-counting.
- **Provider-class cohort rank** on friction top targets: when ≥3 peers of the same `provider_class` have hit the same target, reports include `percentile_rank_in_class` alongside the existing global `percentile_rank` — so "faster than 78% of anthropic peers on this target" renders beside "faster than 41% of agents globally".
- **Revealed-preference lens** (`get_friction_report` + profile): declared-but-uncalled bindings vs called-but-undeclared targets surface drift between composition metadata and real behavior.
- **Compensation signatures** — chain-shape stability scoring identifies repeated multi-hop patterns an agent falls back on, with fleet-wide frequency when available.
- **Confidence propagation** to five more tools: `get_failure_registry`, `get_trend` (weakest-period-wins rule for deltas), `get_skill_tracker`, `get_stable_corridors`, `get_network_status` now carry the same `pre-signal` / `directional` / `significant` tags as the friction report.

## 2.2.1 (2026-04-19)

Signal quality.

- All lens tools (`get_friction_report`, `get_trend`, `get_coverage`, `get_failure_registry`, `get_stable_corridors`, `get_network_status`) now accept a `source` argument that defaults to `agent`. Reports reflect the agent's real `log_interaction` calls instead of observer-side self-log. Pass `source=all` for the combined view or `source=server` for self-log only.
- Friction report renders chain analysis, directional amplification, retry overhead, and population drift *before* per-target detail — structural signal first.
- Sample-size confidence tags (`pre-signal` / `directional` / `significant`) on chain patterns, directional pairs, retry targets, and per-target rows so thin slices can't be mistaken for authoritative truth.
- Fix: `get_trend` no longer renders current/previous period as `[object Object]`; unpacks ISO start/end.
- Fix: `log_interaction` and self-log middleware emit the real `provider_class` (from SessionState) instead of hard-coded `unknown`.
- Fix: MCP server reports its real package version instead of the hard-coded `1.0.0` string.

## 0.1.0 (2026-04-06)

Initial release.

- Agent registration and JWT credentials
- Interaction receipt submission (single and batch)
- Skill safety checking before installation
- Friction analysis reports
- Active threat monitoring
- Population baseline comparison (paid tier)

