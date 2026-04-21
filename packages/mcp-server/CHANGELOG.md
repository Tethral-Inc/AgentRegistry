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

