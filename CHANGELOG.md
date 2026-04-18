# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [2.2.0] — @tethral/acr-mcp — 2026-04-17

### Added
- `whats_new` tool: morning briefing combining yesterday's performance, degraded targets this week, today's activity, and unread notifications in one call
- `getting_started` tool: step-by-step setup wizard covering registration, logging, composition, and signal coverage — with the next action to take
- Health card in `get_my_agent`: friction flags, composition empty warning, coverage gaps, and unread notification count shown inline
- `yesterday` scope across friction, trend, and stable corridors tools
- `tokens_used` field in `log_interaction` to enable wasted-token callouts in the friction report
- Population percentile rank per target in friction report (free tier)
- p95 duration surfaced in `by_category` and `by_transport` friction breakdowns
- p95 duration and total interaction count per system in `get_network_status`
- `whats_new` added to the tools menu in `get_my_agent`
- CHANGELOG.md (this file)

### Changed
- `get_trend`: inclusion rules now always rendered at the end of output, regardless of whether results were found
- `get_stable_corridors`: `match_count` zero value no longer replaced by array length (false-zero fix)
- `disable-deep-composition.ts` renamed to `configure-deep-composition.ts`; server.ts import updated
- `preceded_by` parameter description in `log_interaction` updated to explain directional amplification use case
- Python SDK `pyproject.toml` description expanded to name all available lenses
- MCP README: added Troubleshooting section, Example output section, Registering your composition guide, paid tier markers, outcome language column in lenses table
- Root README: added Before and after section, anomaly signal definition callout

### Fixed
- `get_stable_corridors`: `data.match_count !== undefined` check prevents a real zero being replaced by `matches.length`

## [2.1.4] — @tethral/acr-mcp

### Added
- Dashboard API-key input
- Full MCP agent key shown in `get_my_agent`

### Fixed
- All workflow branch targets corrected
- Unconfigured-secret failures silenced in CI
- Publish workflow skips already-published versions

## [2.1.3] — @tethral/acr-mcp

### Added
- Health card and getting_started tool
- Scope defaults and friction report improvements
- Shared resolve-agent-id utility

### Changed
- `get_my_agent` uses profile endpoint for composition check in health card

## [2.0.x] — @tethral/acr-mcp

### Added
- `configure_deep_composition` tool (operator privacy control for sub-component capture)
- Coverage lens (`get_coverage`)
- Stable corridors lens (`get_stable_corridors`)
- Failure registry lens (`get_failure_registry`)
- Trend lens (`get_trend`)
- `summarize_my_agent` one-call overview
- esbuild bundling for sub-second cold start
- Persistent agent identity via `.acr-state.json`
- Auto-detect provider from MCP client info
- API key authentication on per-agent endpoints
- Public leaderboard at `dashboard.acr.nfkey.ai/leaderboard`

### Changed
- All synthetic labels (jeopardy/threat_level) removed from docs and SDKs
- Terminology aligned to "anomaly signal" throughout
