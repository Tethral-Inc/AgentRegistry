# Open Items Plan

**Status:** Draft — working document, not approved, not immutable.
**Scope:** Decisions on the five items left open by `proposals/mcp-compute-boundary.md`.
**Purpose:** Record what was decided for each open item, with the rationale tied to ACR's stated goals, so the plan can be executed against and revisited.

This plan maps to Phase 1 of the work. Phase 2 (Claude Code plugin, other host integrations) is noted at the end and scoped separately.

---

## Reference goals

The decisions in this plan were weighed against these goals, pulled from earlier conversation:

- ACR is an **interaction profile registry** — behavioral observation, not analysis or security
- **Corpus over days/months/years** — stability and long-term comparability matter
- **Two readings: internal and external friction** — both must survive
- **Two-source composition** — MCP observes, agent reports, the delta is itself a signal
- **MCP stays compute-thin** — no analysis, no aggregation, no pattern matching
- **MCP is a smart presenter** — gathers from multiple endpoints, picks what matters, writes plain English
- **Progression, not a gate** — free users feel value on day one
- **Longitudinal patterns gate to paid** — server compute costs money
- **Privacy: no content, no owner tracking, no surveillance state on the user's machine**
- **Activity classification matters** — kind of work changes friction profile
- **60s rolling window is passive** — no forward/reverse pattern matching

---

## Item 1 — Category schema migration

**Decision: Option 1D. JSONB `categories` column now, with explicit flatten-later path for hot fields.**

### What it looks like

A single new JSONB column on `interaction_receipts`:

```sql
ALTER TABLE interaction_receipts
  ADD COLUMN categories JSONB DEFAULT '{}'::jsonb;
```

The column holds the taxonomy from `mcp-compute-boundary.md` constraint #1:

```json
{
  "target_type": "api.llm_provider",
  "activity_class": "math",
  "interaction_purpose": "generate",
  "workflow_role": "intermediate",
  "workflow_phase": "act",
  "data_shape": "structured_json",
  "criticality": "core"
}
```

All fields optional. Receipt validation (Zod) enforces allowed values at ingest time — Postgres doesn't enforce them at the DB level because the taxonomy is expected to evolve.

`interaction_category` stays as a flat column (unchanged from today) for backwards compatibility.

### Why JSONB and not flat columns

- The taxonomy is explicitly expected to evolve ("expandable as patterns emerge")
- Adding a new category dimension should be a client-side change, not a DB migration
- Stable ingest schema = "additions fine, renames/removes are migrations" — JSONB makes additions trivial

### Flatten-later path

When a specific category field proves to be a hot query (queried on most dashboard requests), promote it to a flat column as a pure additive migration:

```sql
ALTER TABLE interaction_receipts
  ADD COLUMN activity_class VARCHAR(32);
-- backfill from categories JSON
UPDATE interaction_receipts
  SET activity_class = categories->>'activity_class'
  WHERE categories ? 'activity_class';
CREATE INDEX idx_receipts_activity_class ON interaction_receipts(activity_class);
```

Likely first-flatten candidates: `activity_class`, `target_type`. Everything else probably stays in JSONB long-term.

### Known tradeoffs of JSONB

- Queries are slightly more verbose (`categories->>'activity_class'` vs `activity_class`) — hidden in the SQL layer
- ~10-30% slower queries on individual JSON fields vs indexed flat columns — only matters if a field becomes hot
- No DB-level value enforcement — handled in Zod validation instead
- Slightly larger storage per row — small compared to receipt payloads

None of these block adoption. The one that could matter at scale (query speed on hot fields) has a clear mitigation via the flatten-later path.

### Work to do

- Create migration file adding `categories` JSONB column to `interaction_receipts`
- Update receipt validation schema (`shared/schemas/receipt.ts`) to accept and validate `categories` field with enum options for each dimension
- Update `log_interaction` MCP tool to accept category parameters and pass them through
- Update `friction.ts`, `profile.ts`, `coverage.ts`, and other read endpoints to surface category breakdowns where useful
- Document the taxonomy in a schema reference

---

## Item 2 — Components-of-attachments capture

**Decision: Option 2D. Ship 2A and 2B bundled. Ship 2C with operator opt-out.**

### 2A — MCP parses at handshake (always on)

The MCP reads what it can statically observe at startup:

- `SKILL.md` frontmatter for loaded skills (reusing the scanner's parser)
- `tools/list` responses from connected MCP servers (standard MCP protocol)
- Tool annotations from registered tools

This data flows into the `composition` payload on `register_agent` as structured sub-composition per attachment.

Parsing happens once at MCP startup. No ongoing work.

### 2B — Agent self-reports via update_composition (always on)

The `update_composition` payload accepts a richer nested structure that includes sub-composition per attachment. When the agent knows about sub-components the MCP couldn't see (dynamically-loaded modules, runtime tool bindings, etc.), it can report them.

The server stores both the MCP's observation (2A) and the agent's self-report (2B) and treats any disagreement as a signal, not an error to resolve.

### 2C — Recursive canonical registration (opt-out by default for operators)

Each MCP server, skill, and composable tool can be registered as its own entity in ACR with its own `composition_hash` and canonical identifier. Agents reference them by ID when declaring composition.

**Operator opt-out mechanism:**

The operator (the person running the agent) controls how deeply ACR captures their agent's composition. Default is "deep capture on." Opt-out mechanisms:

- Environment variable: `ACR_DEEP_COMPOSITION=false` — disables 2C-level recursive capture for the entire session
- MCP tool: `disable_deep_composition` — flips the setting at runtime, persists until re-enabled
- Per-composition flag in `register_agent` / `update_composition` payload: `"deep_capture": false`

When opted out, the MCP still performs 2A and 2B (observation and self-report at the top level) but does not traverse into sub-components. Composition is captured at one level deep, not recursive.

This is a privacy control for operators who don't want ACR to dig into the internals of their agent's attachments. It is not a vendor control — vendors cannot opt out of having their packages referenced in composition records.

### Work to do

- Extend the `composition` payload schema to accept nested sub-composition per attachment
- Add MCP-side parser that populates sub-composition from `SKILL.md` frontmatter and `tools/list` responses at startup
- Add operator opt-out: env var, MCP tool, payload flag
- Add server-side handling that stores both MCP observation and agent self-report and computes the delta as a derived finding
- Document the composition schema

### Deferred

Formal vendor-side canonical registration (a skill author saying "register my package in ACR's network as a composable entity with a stable identifier") is deferred. When a paying customer wants it, we revisit.

---

## Item 3 — Composition update cadence

**Decision: Option 3G + opportunistic check on self-log (skill-instruction-based, portable).**

**Claude Code plugin for compulsory behavior is deferred to Phase 2.**

### How it works in Phase 1

1. **Startup registration** — MCP registers composition on first connection, same as today.
2. **Agent-explicit updates** — the ACR skill's instructions tell the agent to call `update_composition` at the start of every session and whenever it becomes aware of a new tool it's about to use. The skill is loaded in-context, so the instructions are always available.
3. **Opportunistic check on self-log** — the existing `self-log` middleware runs on every tool call. Every few tool calls, it checks whether the agent has reported a composition update recently. If not, the response to the current tool call includes a small note asking the agent to re-declare. This is not polling — it's opportunistic, piggybacking on activity already happening, and only fires when there's been a gap.

### Why this is "near-compulsory"

In practice, if the agent reads its ACR skill instructions (which it does on every session because the skill sits in context), compliance with the "call `update_composition` at session start and on new-tool events" rule is high. The opportunistic check catches agents that miss the explicit call.

The remaining gap — an agent installs a skill and uses it before the MCP has received an explicit composition update — is typically a few tool calls wide, not minutes. The server can still classify those first few calls correctly once the update arrives, because receipts carry `composition_hash` at emit time and the server can reconcile.

### Why no polling

- Background polling violates the "no background work" part of the compute boundary
- Polling at 5-10 second intervals means 5,000-17,000 polls per day per agent — real cost
- Filesystem polling (`.claude/settings.json`) is host-specific and brittle
- Polling would require local state beyond the 60s window, which the compute boundary forbids

### Work to do

- Update the ACR skill (`packages/openclaw-skill/SKILL.md`) to include explicit instructions: "call `update_composition` at session start and when you become aware of a new tool you're about to use"
- Update `mcp-server/src/middleware/self-log.ts` to track "time since last observed composition update" and include a gentle note in tool responses when the gap is unusual
- The MCP holds one additional piece of functional state: `lastComposedHash` (the composition_hash it last sent to the server). This is in the same class as `agent_id` — not rolling data, but functional state for the MCP's relationship to the server.

### Phase 2 (deferred, scoped separately)

A Claude Code plugin that watches `.claude/settings.json` and `.claude/skills/` for file changes and fires `update_composition` directly on change. This gives truly compulsory update-on-install for Claude Code users, zero-latency.

Plus similar host-specific plugins for Cursor, Continue, and other MCP hosts as they become priorities.

These ship as separate packages from `@tethral/acr-mcp`. They talk to ACR's server directly, not to the MCP. The MCP never knows the plugin exists — both talk to the server independently.

---

## Item 4 — Attribution phrasing

**Decision: Option 4D — explanatory default, neutral on drilldown, actionable only when server-labeled. Subject is always "your interaction profile" or "your composition," never "you."**

### The rhetorical invariant

Attribution sentences never blame the operator. The subject of the sentence is always the profile or the composition, which is a *thing that behaves*, not the user who is responsible. This is load-bearing for how operators receive findings.

**Examples:**

- ❌ "Most of the time on this call was spent on your side."
- ❌ "Your orchestration caused the latency."
- ❌ "You are slow on this target."
- ✅ "Most of the latency on this call came from your interaction profile — specifically how your current composition handled the preparation step."
- ✅ "Your composition accounted for most of the wait time on this call. The target itself responded in under 300ms."
- ✅ "In your current composition, this interaction tends to spend most of its time in the orchestration layer."

The profile and composition are described as entities with behaviors, not as extensions of the operator. This is descriptive, not accusatory.

### Three layers of presentation

1. **Explanatory (default)** — the server returns attribution data with a label (`sender_dominant`, `receiver_dominant`, `transmission_gap`, etc.) and the MCP maps the label to an English template that names where the cost came from. Default for all presenter tools.

2. **Neutral numbers (drilldown)** — when the operator asks for detail or when the presenter is rendering a dense summary, show the decomposition as numbers: "profile side: 72%, target side: 28%." This is available on request, not the default.

3. **Actionable (server-labeled only)** — when the server attaches a specific next-step recommendation (e.g., from Friction Observer's `intervention_guidance.json`), the MCP surfaces it verbatim as "the network suggests: {server recommendation}." The MCP never invents recommendations. If the server didn't label one, there isn't one.

### Implementation

Presenter tools use a small deterministic template library in the MCP. The library maps server labels to English sentences that follow the rhetorical invariant. This is a lookup, not business logic — the server decides the label, the MCP renders the template.

Example template entries:

```
sender_dominant_latency:
  "Most of the latency on {this_call} came from your interaction profile."
receiver_dominant_latency:
  "Most of the wait time on {this_call} was spent waiting on {target}."
transmission_gap:
  "{target} was fast to respond, but the time between sending and the response arriving took the bulk of this call."
```

All templates use "your interaction profile" or "your composition" as subjects, never "you."

### Calibration surfacing

Every presenter tool output leads with (or trails with) the agent's current `maturity_state` from the `/profile` endpoint:

- **warmup:** "Your profile is still warming up (N receipts across M targets). These findings will firm up once you reach ~50 receipts and 3 targets."
- **calibrating:** "Your profile is calibrating (N receipts, M targets). Findings below are early signals — take them with appropriate uncertainty."
- **stable_candidate:** "Your profile is stable (N receipts across M targets, D days active). Findings below are based on enough data to be reliable."

This is the "progression, not a gate" pattern surfaced in every interaction with a presenter tool. Users see the meter fill up and understand when findings become trustworthy.

### Work to do

- Build the attribution template library in the MCP (`packages/mcp-server/src/presenter/attribution-templates.ts`)
- Wire presenter tools to fetch `/profile` for `maturity_state` and include it in every response
- Add server endpoints that return attribution labels (not just numbers) — this may require extending friction.ts response shape
- Document the invariant ("subject is always profile, never user") in the presenter style guide

---

## Item 5 — 60s window storage medium

**Decision: Option 5A / 5D — in-process `Map`, no persistence. Positioned as a privacy and lightweight-use design choice.**

### What the MCP holds

A JavaScript `Map` keyed by `chain_id`, entries being the recent receipts' correlation keys: `receipt_id`, `target_system_id`, `created_at_ms`. Entries are evicted via timestamp check whenever a new entry is added — no background sweeper, no setInterval.

Window length: ~60 seconds.

### What the MCP does NOT do with the window

- No pattern matching across it (forward or reverse)
- No aggregation, counting, or ranking
- No prediction
- No analysis

Passive buffer only. The MCP uses it to tag new receipts with explicit links to recent ones (`preceded_by`, `chain_id`) at ingest time. Server does all correlation beyond that.

### Privacy and lightweight-use framing

This is positioned to users as a deliberate design choice, not a limitation:

> ACR keeps a lightweight in-process correlation window of ~60 seconds and nothing more. Users get useful interaction data without overreach, without persistent surveillance state on their machine, and without ACR interfering with agent behavior. On process exit the window evaporates; the server always holds the authoritative long-term record.

This is the story in all user-facing docs, marketplace listings, and the privacy policy.

### Honest tradeoff

The 60-second window means the MCP cannot tag causal links between interactions spaced more than 60 seconds apart. Long-range downstream effects have to be reconstructed by the server from receipts (using `chain_id` if the agent provided one, or post-hoc pattern analysis).

This is acceptable because long-range correlation is the server's job by design. The server has every receipt and can run any analysis over any window. The MCP's role is to capture at ingest and link only what's right in front of it — anything else lives on the server.

Presenter tools that surface findings about downstream effects should be honest about this: findings about delays greater than a minute come from the server's view of receipts, not from the MCP's local observation.

### Work to do

- Implement the in-process `Map` in `packages/mcp-server/src/middleware/correlation-window.ts` (new file)
- Wire the `self-log` and `log_interaction` paths to check the window for recent receipts when assigning `preceded_by`
- Add presenter-side honesty: findings about long-range downstream effects are labeled as "network view from receipts"
- Document the privacy framing in README and the privacy policy

---

## Summary of work for Phase 1

| Item | Workstream | Effort |
|---|---|---|
| **1. Categories** | Schema migration, Zod update, MCP `log_interaction` changes, read endpoint updates | Medium |
| **2. Components capture** | Composition payload schema, MCP parser, operator opt-out mechanism, server-side delta finding | Medium-large |
| **3. Update cadence** | Skill instructions update, `self-log` opportunistic check | Small |
| **4. Attribution phrasing** | Template library, presenter wiring, maturity state surfacing, server endpoint extension | Medium |
| **5. 60s window** | New middleware file, wire into log paths, privacy framing in docs | Small |

Total: one coherent phase. No blockers between items. Work in all five items can proceed in parallel because they touch different files and different layers.

---

## Phase 2 (deferred, scoped separately)

- **Claude Code plugin** for compulsory update-on-install. Watches `.claude/settings.json` and `.claude/skills/` for file changes, fires `update_composition` directly to ACR's server API when detected. Separate package from `@tethral/acr-mcp`. Installs alongside Claude Code, not alongside the MCP. No changes to MCP required.
- **Similar host-specific plugins** for Cursor, Continue, and other MCP hosts as they become priorities.
- **Vendor-side canonical recursive registration (2C opt-in for vendors)** — lets MCP/skill authors register their packages as first-class composable entities with stable identifiers. Defer until a paying customer wants it.
- **Flatten hot category fields** — promote `activity_class` and `target_type` (and any other category field that proves to be a hot query) from JSONB to indexed flat columns as a pure additive migration.

---

## Not in scope for this plan

The following were discussed or adjacent but are intentionally out of scope:

- MCP tools for the new Layer 2 endpoints (`get_profile`, `get_coverage`, `get_healthy_corridors`, `get_failure_registry`, `get_trend`, and the composite `summarize_my_agent`) — tracked separately as the presenter-tool work
- Dashboard exploration — deferred to after this phase
- Security hardening (receipt auth, per-agent rate limiting, AST analysis for content scanner) — tracked separately
- Pro tier endpoint implementation — covered by `proposals/layer2-endpoint-audit.md`
- Enterprise tier / Friction Observer-operated runs — future work

---

This plan is a draft. Nothing here is locked until it ships. Revisit as implementation reveals things the plan got wrong.
