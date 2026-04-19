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

