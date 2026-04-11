# Phase 1 Execution Plan: Five Open Items

**Status:** Draft — working document, not approved, not immutable.
**Scope:** Engineering execution of the five open items from `proposals/mcp-compute-boundary.md`.
**Purpose:** An engineering-excellence execution document: concrete files, acceptance criteria, sequencing, migration strategy, test plans, rollback, risks, and drift-prevention checks. This is the document an engineer picks up and executes against.

---

## How to read this document

Each item follows the same structure:

1. **Goal** — what success looks like in one sentence
2. **Acceptance criteria** — the testable definition of done
3. **Files affected** — exact paths that will change or be created
4. **Sequence of changes** — ordered steps, with checkpoints
5. **Data model / interface contracts** — where applicable
6. **Migration strategy** — for DB or schema changes, including backwards compatibility
7. **Test plan** — unit, integration, E2E, linting
8. **Observability** — how we verify correctness in production
9. **Rollback** — how to undo safely if something breaks
10. **Risks** — what could go wrong and how we mitigate

A dedicated **drift prevention** section at the end lists the architectural boundaries this plan must not cross and how we check at review time.

A **next steps** section covers the Claude Code plugin, which is explicitly out of scope for Phase 1 but is listed so the work is tracked and picked up cleanly later.

---

## Priorities and guardrails

This isn't a rulebook. It's a short set of reminders for what ACR is, what it isn't, and what's worth keeping in mind when you're knee-deep in an implementation and tempted to take a shortcut or add a "small thing" while you're in the area.

### What ACR is

Pulled from `proposals/mcp-compute-boundary.md`. Keep these in mind when a design decision gets fuzzy:

- An **interaction profile registry** — we observe behavior, we don't analyze or block
- A **corpus built over time** — schema stability and long-term comparability matter more than any single feature
- A **two-layer friction observer** — internal (agent engaging its own parts) and external (those parts reaching outside)
- A **compute-thin presenter** — the server computes, the MCP renders and chooses what matters to surface
- A **lightweight, privacy-respectful sensor** — no content, no owner tracking, no surveillance state on the user's machine

### What ACR isn't

Worth spelling out, because implementation is exactly when "while we're in here" scope creep happens:

- **Not a security product** — we don't evaluate skills, score threats, or block anything. We observe and notify.
- **Not a threat detector** — when we surface anomalies, we're relaying community signals, not making judgments.
- **Not a skill catalog or distributor** — we observe what the ecosystem has. We don't advertise counts; OpenClaw is at 50k and ours is static.
- **Not an analytics platform** — we measure interaction behavior, not user behavior. We don't fingerprint, don't profile humans, don't correlate people to sessions.
- **Not a compliance tool** — privacy is how the product is built, not a checkbox we satisfy later.
- **Not Datadog** — we're upstream of infrastructure monitoring. We measure the agent itself, not the systems underneath.

If a field name, response shape, error message, or marketing line drifts toward any of those, that's a signal to stop and re-read the positioning. Not because there's a rule against it — because it isn't what we do.

### Priority ordering (rough, for when schedule pressure forces choices)

All five items are in Phase 1 scope. If something has to give:

- **Item 2 (composition capture) is the load-bearing item.** Items 3 and 4 depend on it. Internal-vs-external friction classification — one of the two main things ACR reads from the interaction surface — cannot work without it. If only one item ships, this is the one.
- **Item 5 (60s correlation window)** is the smallest and the most architecturally cheap. It closes a real gap (in-flight workflow linkage) with minimal risk. Easy quick win.
- **Item 1 (categories)** is the biggest user-facing change to the ingest schema. The value appears with a lag — receipts have to accumulate with the new fields populated before the read endpoints show meaningful breakdowns.
- **Item 4 (attribution phrasing)** is the highest-visibility change because every presenter tool response gets a maturity prefix and eventually an attribution sentence. Users will notice it immediately.
- **Item 3 (update cadence)** is the smallest patch: a skill-instruction update plus a server-side `composition_stale` flag. Low code, low risk, depends on Item 2.

### Minimum viable Phase 1

If we have to cut: ship **Item 2 + Item 5 + Item 4** first. That gives us the internal-vs-external split (Item 2), in-flight correlation (Item 5), and visible presenter improvements (Item 4). Items 1 and 3 can follow without blocking the product narrative.

### Things worth remembering during implementation

Not rules. Reminders to catch "I was about to do X, oh wait":

- **No skill counts** in any response, log line, or UI string. The corpus grows — don't brag about its size.
- **No accusatory language** in attribution, error messages, warnings, or notifications. The subject is "your interaction profile" or "your composition," never "you."
- **No content capture** anywhere — not just in receipts. Don't add a "prompt snippet" field to a new schema because "it would be useful for debugging."
- **Privacy framing is positive, not defensive.** The 60s window and the opt-out are design choices. When you write copy, lead with what the user gets (fast, light, private), not what we declined to take.
- **The server computes, the MCP renders.** If you're writing `.reduce(` or `.sort(` in an MCP tool handler, pause and ask whether that math belongs on the server instead.
- **Don't invent rules.** If a constraint isn't in the compute-boundary doc and doesn't fall out of ACR's actual purpose, it probably shouldn't be in the plan either. "While I'm here let me also forbid..." is how we end up with cargo-culted rigor that confines for no reason.

If any of these feel redundant with the compute-boundary doc, they're meant to. They're here so you don't have to open three docs while you're writing the code.

---

## Reference goals

These are pulled from `proposals/mcp-compute-boundary.md` and from conversation. Every decision in this plan is weighed against them. If the plan appears to violate one, that is drift and must be flagged.

- ACR is an **interaction profile registry** — behavioral observation, not analysis or security
- **Corpus over days/months/years** — stability and long-term comparability matter
- **Two readings: internal and external friction** — both must survive
- **Two-source composition** — MCP observes, agent reports, the delta is itself a signal
- **MCP stays compute-thin** — no analysis, no aggregation, no pattern matching
- **MCP is a smart presenter** — gathers from multiple endpoints, picks what matters, writes plain English
- **Progression, not a gate** — free users feel value on day one
- **Longitudinal patterns gate to paid** — server compute costs money
- **Privacy: no content, no owner tracking, no surveillance state on the user's machine**
- **MCP local state limited to session identity + 60s correlation window** — nothing else
- **Activity classification matters** — kind of work changes friction profile

---

## Execution overview

### Dependencies and parallelization

| Item | Depends on | Blocks |
|---|---|---|
| 1. Categories | nothing | Item 4 category surfacing (optional) |
| 2. Composition capture | nothing | Items 3, 4 |
| 3. Update cadence | Item 2 (composition_source field) | nothing |
| 4. Attribution phrasing | Item 2 (two-source storage) indirectly for maturity context | nothing |
| 5. 60s window | nothing | nothing |

**Genuinely parallel:** Items 1, 2, and 5 can start on day one. Items 3 and 4 should start once Item 2's schema changes are committed.

**Recommended sequence for minimum integration risk:**

```
Day 1 parallel:   Item 5 (small) ─┬─> Item 1 (medium)
                  Item 2 (medium) ─┴─> Item 3 (small) ─> Item 4 (medium)
```

This lets Item 5 and Item 1 land quickly while Item 2 is the critical path for Items 3 and 4.

### Checkpoints

After each item, run the **drift checklist** at the bottom of this document before merging. If any check fails, the PR is held until the drift is resolved.

---

## Cross-cutting concerns

These aren't bound to any single item — they apply across multiple items and should be kept in mind on every change.

### SDK parity

When a user-facing change lands on the MCP, it should also land on the TypeScript SDK (`@tethral/acr-sdk`) and the Python SDK (`tethral-acr`). Item 1 explicitly lists the SDK changes. Items 2 and 4 touch the receipt payload and the friction response respectively, which may require SDK updates too. Before closing any item, check whether the SDKs need parity changes — and if they do, include them in the same phase.

### Maturity surfacing in every presenter tool

`profile_state.maturity_state` (`warmup` / `calibrating` / `stable_candidate`) should appear at the top of every presenter tool's output, not just in `get_friction_report`. If you're writing or updating any presenter tool in this phase, include the `renderMaturityPrefix(profile)` helper (landing as part of Item 4) as the first line of the response. This is the "progression, not a gate" pattern made visible — users see the meter fill up as their profile matures.

Applies to: `get_friction_report`, `get_interaction_log`, `get_network_status`, `get_skill_tracker`, any future presenter tool.

### Privacy framing copy

The 60s correlation window, the operator opt-out for deep composition, the no-content rule, and the no-owner-tracking rule are all part of one story: ACR is built to be lightweight, privacy-respectful, and non-interfering. When you write user-facing copy — README, MCP tool descriptions, marketplace listings, terms page, error messages — lead with what the user gets (fast, light, private), not what we declined to take (content, history, fingerprints).

The framing is positive and marketable, not defensive. "We keep a ~60-second correlation window and nothing else" is better than "We don't store your data."

### Documentation sync

When an MCP tool's behavior changes, its `description` string in `registerTool` changes too. The description is the only thing the agent's LLM reads at decision time — if it's stale, the agent uses the tool wrong. Every PR that changes tool behavior should include a description update in the same commit.

### No-content check on every schema addition

Any new receipt field, any new payload object, any new response shape — before merging, skim the change for field names that look like content (`body`, `payload`, `text`, `content`, `prompt`, `completion`, `input`, `output`, `snippet`). If one lands, it should be rejected unless it's explicitly metadata — `response_size_bytes` is fine because it's a number; `response_body` is not fine because it's content.

### Attribution rhetorical invariant (cross-cutting, not just Item 4)

The "subject is your interaction profile or your composition, never 'you'" invariant from Item 4 applies to every user-facing string, not just the friction templates. Error messages, notification text, warning banners, and log strings that an operator might see all follow the same rule. The linting test in Item 4 can be extended to grep the entire MCP source tree if we find drift.

---

## Item 1 — Category schema migration

### Goal

Receipts can carry rich classification metadata (`activity_class`, `target_type`, `interaction_purpose`, `workflow_role`, `workflow_phase`, `data_shape`, `criticality`) without breaking any existing client, with the taxonomy stored as JSONB so it can evolve without DB migrations.

### Acceptance criteria

- [ ] Existing clients posting receipts without `categories` continue to succeed with no change in behavior
- [ ] New receipts can include any subset of the taxonomy fields in a `categories` JSONB object
- [ ] `/friction` response includes category breakdowns when `categories` is populated on receipts
- [ ] `/coverage` response includes a category-coverage recommendation ("you haven't set activity_class on any receipts yet — doing so unlocks kind-of-work breakdowns")
- [ ] Zod schema on receipt ingest accepts `categories` as an optional object with known taxonomy fields. Unknown string values within a field are accepted (evolving taxonomy). Non-string values within a field are rejected.
- [ ] `log_interaction` MCP tool accepts new optional parameters for each taxonomy field
- [ ] Both TypeScript and Python SDKs accept category parameters and pass them through
- [ ] Unit tests pass for Zod schema acceptance + rejection cases
- [ ] Integration test posts a receipt with categories, queries `/friction`, verifies breakdown
- [ ] Integration test posts a receipt without categories, queries `/friction`, verifies normal behavior

### Files affected

| Path | Change type |
|---|---|
| `migrations/000011_receipt_categories.up.sql` | new |
| `migrations/000011_receipt_categories.down.sql` | new |
| `shared/schemas/receipt.ts` | edit — add `categories` field to `InteractionReceiptSchema` |
| `shared/schemas/index.ts` | edit — export new category types if needed |
| `packages/ingestion-api/src/routes/receipts.ts` | edit — destructure and store `categories` |
| `packages/ingestion-api/src/routes/friction.ts` | edit — add category breakdowns in response |
| `packages/ingestion-api/src/routes/profile.ts` | edit — include category distribution in `profile_state` |
| `packages/ingestion-api/src/routes/coverage.ts` | edit — add category coverage recommendation rule |
| `packages/mcp-server/src/tools/log-interaction.ts` | edit — accept category params |
| `packages/ts-sdk/src/client.ts` | edit — add category params to `logInteraction` |
| `packages/python-sdk/src/tethral_acr/client.py` | edit — add category params to `log_interaction` |

### Data model

**Migration file: `000011_receipt_categories.up.sql`**

```sql
-- Add categories JSONB column to interaction_receipts
-- Additive: existing clients unaffected, existing rows default to empty object

ALTER TABLE interaction_receipts
  ADD COLUMN categories JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Expression index on activity_class since it's likely the first hot field.
-- Other dimensions can get indexes as they prove hot.
CREATE INDEX CONCURRENTLY idx_receipts_activity_class
  ON interaction_receipts ((categories->>'activity_class'))
  WHERE categories ? 'activity_class';

-- Index on target_type for target-type rollups
CREATE INDEX CONCURRENTLY idx_receipts_target_type
  ON interaction_receipts ((categories->>'target_type'))
  WHERE categories ? 'target_type';
```

**Migration file: `000011_receipt_categories.down.sql`**

```sql
DROP INDEX IF EXISTS idx_receipts_target_type;
DROP INDEX IF EXISTS idx_receipts_activity_class;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS categories;
```

**Zod schema addition (`shared/schemas/receipt.ts`):**

```typescript
// Known dimensions with per-field validation.
// Unknown dimensions are accepted via catchall so the taxonomy can evolve
// without rejecting receipts from newer clients.
const CategoriesSchema = z.object({
  target_type: z.string().max(64).optional(),
  activity_class: z.string().max(32).optional(),
  interaction_purpose: z.string().max(32).optional(),
  workflow_role: z.string().max(32).optional(),
  workflow_phase: z.string().max(32).optional(),
  data_shape: z.string().max(32).optional(),
  criticality: z.string().max(32).optional(),
}).catchall(z.string().max(64)).optional();
```

**Why `.catchall()` and not `.strict()`:** the taxonomy is explicitly expected to evolve. If a newer client sends a receipt with an additional dimension (e.g., `skill_level: 'intermediate'`), the server should accept it, not reject the whole receipt. `.catchall(z.string().max(64))` gives us the right behavior: known keys get their specific validation, unknown keys are accepted as long as they're strings under 64 characters.

The length caps on both known and unknown values are privacy + sanity guards against someone accidentally (or maliciously) shoving a prompt into a "category" field. A 64-character value is plenty for a classifier token and too small to hide content in.

### Migration strategy

- Column is added with `NOT NULL DEFAULT '{}'::jsonb`, so existing rows become `{}` instantly and new rows without the field also become `{}`
- Indexes use `CREATE INDEX CONCURRENTLY` to avoid table locks
- Zero downtime
- If the migration fails partway, the state is harmless — rows either have the column or don't, and absence is handled as `{}` by read queries

### Test plan

- **Unit (shared/schemas/receipt.test.ts):**
  - Accept receipt with `categories` = `{}`
  - Accept receipt with `categories` = `{ activity_class: 'math' }`
  - Accept receipt with `categories` = `{ activity_class: 'legal' }` (unknown value, allowed)
  - Reject receipt with `categories` = `{ activity_class: 42 }` (non-string)
  - Reject receipt with `categories` = `{ unknown_key: 'foo' }` (strict rejects unknown top-level keys)
  - Accept receipt without `categories` field at all
- **Integration (packages/ingestion-api tests):**
  - POST `/receipts` with categories → 200 → category visible in row
  - POST `/receipts` without categories → 200 → row has `{}` in categories
  - GET `/friction` after posting categorized receipts → response includes category breakdown
  - GET `/friction` after posting uncategorized receipts → response omits category breakdown gracefully (no error)
- **E2E:** MCP `log_interaction` with `{ activity_class: 'math' }` → receipt stored → `get_friction_report` shows "math" activity class

### Observability

- Log the percentage of receipts per day that have non-empty `categories` (adoption metric)
- Log unique values observed per category dimension per day (taxonomy discovery — identifies new values the schema should formally recognize)
- Alert on Zod validation failures for `categories` above baseline rate (indicates client bug or schema mismatch)

### Rollback

- The column is nullable via default, so reverting the Zod and handler changes is safe at any time
- The DB column can stay in place indefinitely with no cost — it's empty JSONB on rows that weren't populated
- If a read endpoint breaks on the category surfacing, revert the read endpoint commit only; the migration stays
- Full rollback uses the `.down.sql` migration

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Zod enforcement too loose → garbage values in DB | Medium | Log unexpected values via observability; tighten enum per-dimension as taxonomy solidifies |
| Zod enforcement too strict → client rejects valid payloads | Low | Lenient string acceptance + `.strict()` only on top-level keys, values are permissive |
| Expression indexes slow writes | Low | `WHERE categories ? 'activity_class'` partial index keeps cost bounded to populated rows |
| JSONB query performance on hot dimension | Medium | Flatten-later path: promote `activity_class` and `target_type` to flat columns when justified |

---

## Item 2 — Components-of-attachments capture

### Goal

Capture agent composition from two sources — the MCP's direct observation and the agent's self-report — store both with explicit source attribution, compute the delta as a signal, and support operator opt-out of deep (recursive) capture.

### Acceptance criteria

- [ ] On first `register_agent` call of a session, the MCP runs an observation pass: parses `SKILL.md` frontmatter for visible skills and reads `tools/list` from connected MCP servers, and includes this data in the `composition` payload under a clearly-marked source tag
- [ ] Agents can call `update_composition` with a nested sub-composition structure (e.g., a skill has its own sub-tools)
- [ ] Server stores both sources for each agent with distinct `composition_source` attribution
- [ ] Server computes a `composition_delta` — fields where MCP observation and agent self-report disagree — and returns it in `/agent/{id}/profile` response
- [ ] Operator opt-out via `ACR_DEEP_COMPOSITION=false` environment variable disables recursive capture
- [ ] Operator opt-out via `disable_deep_composition` MCP tool flips the setting at runtime
- [ ] When deep capture is off, the MCP sends only top-level composition (no sub-components)
- [ ] Unit tests cover the parser, the observation payload shape, and the opt-out behavior
- [ ] Integration test registers an agent with both sources, verifies delta is stored, verifies opt-out honors the flag

### Files affected

| Path | Change type |
|---|---|
| `migrations/000012_composition_sources.up.sql` | new |
| `migrations/000012_composition_sources.down.sql` | new |
| `shared/schemas/composition.ts` | new (or extend existing in register.ts) |
| `shared/schemas/register.ts` | edit — accept nested composition |
| `packages/ingestion-api/src/routes/register.ts` | edit — store composition with source tag |
| `packages/ingestion-api/src/routes/composition.ts` | edit — same for updates |
| `packages/ingestion-api/src/routes/profile.ts` | edit — compute and return `composition_delta` |
| `packages/mcp-server/src/tools/register-agent.ts` | edit — populate observation from parser |
| `packages/mcp-server/src/tools/update-composition.ts` | edit — accept nested structure |
| `packages/mcp-server/src/tools/disable-deep-composition.ts` | new |
| `packages/mcp-server/src/env-detect.ts` | edit — extend to enumerate visible skills and MCPs |
| `packages/mcp-server/src/session-state.ts` | edit — add `deep_composition: boolean` (session-scoped only) |
| `packages/mcp-server/src/server.ts` | edit — register new tool, read env var at startup |

### Data model

**Migration `000012_composition_sources.up.sql`:**

```sql
-- Store composition as pairs of (agent_id, source, composition_jsonb)
-- so we can keep both the MCP's observation and the agent's self-report.

CREATE TABLE agent_composition_sources (
  agent_id          TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('mcp_observed', 'agent_reported')),
  composition       JSONB NOT NULL,
  composition_hash  TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, source)
);

CREATE INDEX idx_composition_sources_updated_at
  ON agent_composition_sources(updated_at);
```

**Existing `agents.composition` column** remains as the "canonical" composition the server uses for classification; it's populated by merging both sources, with agent self-report taking precedence when both sources agree on a field and the MCP observation used as fallback.

**Nested composition payload shape (shared/schemas/composition.ts):**

```typescript
interface ComponentBase {
  id: string;           // stable identifier (skill hash, MCP name, tool name)
  name?: string;
  version?: string;
}

interface SkillComponent extends ComponentBase {
  type: 'skill';
  sub_components?: ComponentBase[];  // sub-scripts, sub-tools
}

interface McpComponent extends ComponentBase {
  type: 'mcp';
  tools?: ComponentBase[];  // tools exposed by this MCP
}

interface ApiComponent extends ComponentBase {
  type: 'api';
}

interface ToolComponent extends ComponentBase {
  type: 'tool';
}

interface CompositionPayload {
  skills?: SkillComponent[];
  mcps?: McpComponent[];
  apis?: ApiComponent[];
  tools?: ToolComponent[];
  // Flat legacy fields preserved for backwards compat
  skill_hashes?: string[];
}
```

**Delta contract (returned from `/profile`):**

```typescript
interface CompositionDelta {
  mcp_only: string[];       // component ids present in MCP observation but not agent self-report
  agent_only: string[];     // component ids present in agent self-report but not MCP observation
  disagreements: Array<{    // same id, different attribute values
    id: string;
    field: string;
    mcp_value: unknown;
    agent_value: unknown;
  }>;
  last_observed_at: string;
  last_reported_at: string;
}
```

### Sequence of changes

1. Write and run migration `000012_composition_sources`
2. Update shared schemas to accept nested composition structure (backwards compatible — flat fields still work)
3. Update `register.ts` and `composition.ts` routes to accept and store into `agent_composition_sources` with explicit source tag. Preserve the merged canonical write to `agents.composition`
4. Update `profile.ts` to compute and return `composition_delta` when both sources exist
5. Extend `env-detect.ts` to enumerate visible skills and MCPs (using `parseFrontmatter` from `shared/parsers/frontmatter.ts`)
6. Update `register-agent.ts` to pass the observation payload through at registration
7. Update `update-composition.ts` to accept nested structure
8. Add `session-state.ts` field `deep_composition` (boolean, default true, read from `ACR_DEEP_COMPOSITION` env var at session start)
9. Create `disable-deep-composition.ts` tool that flips the session flag
10. Wire the session flag into both observation and payload: if deep capture is off, MCP sends only top-level components, never sub-components
11. Register the new tool in `server.ts`

### Migration strategy

- New table is additive, doesn't touch existing rows
- Existing `agents.composition` field continues to work for clients that don't upgrade
- Gradual rollout: server accepts nested composition but falls back to flat if not provided

### Test plan

- **Unit (shared/parsers/frontmatter.test.ts):** verify frontmatter parser handles valid, malformed, and missing frontmatter without crashing
- **Unit (packages/mcp-server/src/env-detect.test.ts):** enumerator returns correct component list from a test fixture of SKILL.md files
- **Unit (packages/ingestion-api/src/routes/register.test.ts):** composition with nested structure is stored correctly, both sources are tracked
- **Unit (profile delta):** given two composition sources, compute correct delta
- **Integration:** register with both sources, verify row in `agent_composition_sources` for each, verify `/profile` returns delta
- **Integration (opt-out):** set `ACR_DEEP_COMPOSITION=false`, register → verify no sub-components in stored observation
- **Integration (runtime opt-out):** call `disable_deep_composition`, then `update_composition` with sub-components → verify sub-components dropped before send
- **Linting test:** grep for sub-component emission in MCP code and verify all paths check the `deep_composition` flag

### Observability

- Log count of agents with both sources vs one source (adoption metric)
- Log count of agents with non-empty delta (inconsistency metric)
- Log opt-out usage (how many sessions have `deep_composition=false`)

### Rollback

- New table and new routes can be dropped or reverted without affecting existing agents
- Existing `agents.composition` continues to serve as the canonical composition
- The MCP changes are backwards compatible: old registered agents still work

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `parseFrontmatter` throws on malformed SKILL.md → MCP crash | Medium | Wrap in try/catch, log errors, fall back to top-level-only composition |
| MCP can't import from `shared/parsers/` due to package structure | Low | Verify import path works before starting; add as workspace dep if needed |
| Opt-out flag missed in some emission path → privacy leak | High if not tested | Linting test greps all composition emission paths, asserts `deep_composition` is checked |
| Performance hit from parsing dozens of SKILL.md at handshake | Low | Parser is cached after first read; only runs once per session |

---

## Item 3 — Update cadence

### Goal

Near-compulsory composition re-registration via skill instructions plus a server-side staleness flag, without introducing persistent MCP state beyond session identity.

### Critical correction from prior draft

An earlier draft of this plan said the MCP would hold `lastComposedHash` as additional session state and check it on every self-log. **This was drift** — it violates `mcp-compute-boundary.md` constraint #3, which limits MCP local state to session identity and the 60-second correlation window.

**Corrected approach:** the server, not the MCP, tracks staleness. When the agent hits any receipt endpoint, the server checks when it last received an `update_composition` for that agent. If older than the staleness threshold, the receipt response includes `composition_stale: true`. The MCP reads this flag and renders a prompt in the text response telling the agent to re-declare. The MCP holds zero new state.

### Acceptance criteria

- [ ] ACR skill instructions tell the agent to call `update_composition` at session start and whenever it becomes aware of a new tool it's about to use
- [ ] Server computes `composition_stale: boolean` on receipt responses by comparing `now() - last_composition_update_at` to a threshold (30 minutes default)
- [ ] Threshold is configurable via environment variable `ACR_COMPOSITION_STALE_THRESHOLD_MINUTES`
- [ ] MCP renders a prompt in tool response text when `composition_stale: true` is present in the receipt response
- [ ] No new MCP local state is added beyond session identity + 60s window
- [ ] Integration test: agent registers, waits past threshold, posts receipt → response has `composition_stale: true`
- [ ] Integration test: agent registers, immediately posts receipt → response has `composition_stale: false`

### Files affected

| Path | Change type |
|---|---|
| `packages/openclaw-skill/SKILL.md` | edit — add explicit update instructions |
| `packages/ingestion-api/src/routes/receipts.ts` | edit — add staleness computation and flag in response |
| `shared/types/receipt.ts` | edit — add `composition_stale` to receipt response type |
| `packages/mcp-server/src/tools/log-interaction.ts` | edit — render staleness prompt when flag is true |
| `packages/mcp-server/src/middleware/self-log.ts` | edit — consume staleness flag if present, optionally log |

### Data model / interfaces

**Extension to receipt response shape:**

```typescript
interface ReceiptAcceptedResponse {
  accepted: number;
  receipt_ids: string[];
  threat_warnings?: ThreatWarning[];
  composition_stale?: boolean;  // NEW
  composition_stale_since_minutes?: number;  // NEW, diagnostic
}
```

**Server-side staleness query (receipts.ts):**

```typescript
const staleness = await queryOne<{ age_min: number }>(
  `SELECT EXTRACT(EPOCH FROM (now() - updated_at)) / 60 AS age_min
   FROM agents WHERE agent_id = $1`,
  [agentId],
);
const thresholdMin = Number(process.env.ACR_COMPOSITION_STALE_THRESHOLD_MINUTES ?? 30);
const isStale = (staleness?.age_min ?? 0) > thresholdMin;
```

The `agents.updated_at` field is set whenever `register_agent` or `update_composition` is called (it already is in the current code).

**MCP rendering:**

```typescript
// In log-interaction.ts response formatter
if (data.composition_stale) {
  text += `\n\n[ACR] Your composition hasn't been updated in over ${Math.round(data.composition_stale_since_minutes ?? 0)} minutes. If you've loaded new tools or skills, call update_composition to keep your interaction profile accurate.`;
}
```

Pure text formatting. No state. No computation. Compliant with compute-boundary.

### Sequence of changes

1. Update `SKILL.md` instructions with explicit "call `update_composition` at session start and on new-tool events" guidance
2. Update `shared/types/receipt.ts` with the new optional response fields
3. Update `receipts.ts` handler to query `agents.updated_at`, compare to threshold, set flag in response
4. Update `log-interaction.ts` MCP tool to render the prompt when flag is set
5. Update `self-log.ts` to also check the flag (for observability, not presentation — self-log doesn't return text to the agent)

### Test plan

- **Unit:** staleness computation math (given `updated_at` and threshold, return correct flag)
- **Unit:** MCP rendering: given receipt response with and without flag, verify text output
- **Integration:** fresh agent, immediate receipt → flag false
- **Integration:** agent + wait past threshold (test override threshold to 1 second) → flag true
- **Integration:** agent calls `update_composition` → subsequent receipt has flag false

### Observability

- Log rate of `composition_stale: true` flags set (indicates how often agents drift)
- Log distribution of staleness ages (informs future threshold tuning)

### Rollback

- The new fields in receipt response are optional → old MCP clients ignore them gracefully
- Server changes can be reverted independently of MCP changes
- No data migration required

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Threshold too low → noisy prompts | Medium | Default 30 min, env var for tuning, observability-driven adjustment |
| Threshold too high → agents drift without prompt | Medium | Same — adjustable via env var |
| Agent ignores the prompt | Medium | This is the accepted tradeoff of "near-compulsory" vs compulsory. The Claude Code plugin in Phase 2 is the fix for truly compulsory. |

---

## Item 4 — Attribution phrasing

### Goal

Operator-facing text that explains where cost came from using a rhetorical invariant that avoids blame, with every presenter tool response prefixed by the agent's current profile maturity so operators know how much to trust the findings. All attribution labels are computed server-side; the MCP renders from a deterministic template library.

### Acceptance criteria

- [ ] Server returns structured `attribution` labels (not raw numbers) from `/friction` when sufficient data is present
- [ ] MCP has a template library at `packages/mcp-server/src/presenter/attribution-templates.ts` mapping labels to English sentences
- [ ] All template strings use "your interaction profile" or "your composition" as the subject of attribution sentences. Never "you", "your side", "your fault"
- [ ] A linting test verifies no forbidden substrings exist in the template library
- [ ] Every presenter tool response includes a maturity prefix computed from `/profile` (warmup / calibrating / stable_candidate)
- [ ] The `get_friction_report` tool uses the template library and maturity prefix in its output
- [ ] Actionable recommendations only appear when the server-supplied `attribution.recommended_action` field is non-null
- [ ] The MCP never invents an attribution label, a magnitude, or a recommendation

### Files affected

| Path | Change type |
|---|---|
| `shared/schemas/friction.ts` | edit — add `AttributionLabel` schema |
| `packages/ingestion-api/src/routes/friction.ts` | edit — compute and return attribution labels per top target |
| `packages/mcp-server/src/presenter/attribution-templates.ts` | new |
| `packages/mcp-server/src/presenter/maturity-prefix.ts` | new |
| `packages/mcp-server/src/tools/get-friction-report.ts` | edit — consume templates, add maturity prefix |
| `packages/mcp-server/test/presenter.lint.test.ts` | new (linting test) |

### Data model / interfaces

**AttributionLabel (shared contract):**

```typescript
export const AttributionCostSide = z.enum([
  'profile_dominant',    // most cost on the agent's profile side
  'target_dominant',     // most cost on the target's side
  'balanced',            // roughly 50/50
  'transmission_gap',    // cost is in the handoff between sides
  'insufficient_data',   // not enough receipts to label
]);

export const AttributionCostPhase = z.enum([
  'preparation',
  'processing',
  'queueing',
  'handoff',
  'unknown',
]).optional();

export const AttributionMagnitude = z.enum([
  'low', 'moderate', 'high', 'severe'
]);

export const AttributionLabelSchema = z.object({
  target_system_id: z.string(),
  cost_side: AttributionCostSide,
  cost_phase: AttributionCostPhase,
  magnitude_category: AttributionMagnitude,
  recommended_action: z.string().max(240).nullable(),
  // Raw numbers available for drilldown
  profile_side_proportion: z.number().min(0).max(1).nullable(),
  target_side_proportion: z.number().min(0).max(1).nullable(),
});
```

The server adds an `attribution: AttributionLabel[]` array to the `/friction` response, one entry per top target.

**Template library shape:**

```typescript
// presenter/attribution-templates.ts
interface TemplateContext {
  target: string;
  cost_side: AttributionCostSide;
  cost_phase?: AttributionCostPhase;
  magnitude_category: AttributionMagnitude;
  profile_side_proportion?: number | null;
  target_side_proportion?: number | null;
}

// Returns plain English sentence following the rhetorical invariant.
// Pure function. No side effects. No LLM. No inference.
export function renderAttribution(ctx: TemplateContext): string;
```

**Example templates (required to pass the lint test):**

```typescript
const TEMPLATES: Record<AttributionCostSide, Record<AttributionMagnitude, string>> = {
  profile_dominant: {
    low:     "Your interaction profile accounted for slightly more of the time on calls to {target}.",
    moderate:"Your interaction profile accounted for most of the time on calls to {target}.",
    high:    "Your interaction profile accounted for the majority of the time on calls to {target} — significantly more than {target} itself.",
    severe:  "Your interaction profile accounted for almost all of the time on calls to {target}. {target} itself was fast.",
  },
  target_dominant: {
    low:     "{target} accounted for slightly more of the time on these calls than your interaction profile did.",
    moderate:"{target} accounted for most of the time on these calls. Your interaction profile was quick.",
    high:    "{target} accounted for the majority of the time on these calls — your interaction profile was quick in comparison.",
    severe:  "{target} accounted for almost all of the time on these calls. Your interaction profile handled its part quickly.",
  },
  // ... balanced, transmission_gap, insufficient_data
};
```

### Maturity prefix

**presenter/maturity-prefix.ts:**

```typescript
export function renderMaturityPrefix(profile: ProfileResponse): string {
  const s = profile.profile_state;
  switch (s.maturity_state) {
    case 'warmup':
      return `Your profile is still warming up — ${s.total_receipts} receipts across ${s.distinct_targets} targets. Findings below will firm up once you reach roughly 50 receipts and 3 targets.\n\n`;
    case 'calibrating':
      return `Your profile is calibrating — ${s.total_receipts} receipts across ${s.distinct_targets} targets over ${s.days_active} day(s). These are early signals; take them with appropriate uncertainty.\n\n`;
    case 'stable_candidate':
      return `Your profile is stable — ${s.total_receipts} receipts across ${s.distinct_targets} targets over ${s.days_active} day(s). Findings below are based on enough data to be reliable.\n\n`;
  }
}
```

### Linting test

**packages/mcp-server/test/presenter.lint.test.ts:**

```typescript
import { TEMPLATES } from '../src/presenter/attribution-templates';

const FORBIDDEN_SUBSTRINGS = [
  /\byou are\b/i,
  /\byour fault\b/i,
  /\byour side\b/i,
  /\byou caused\b/i,
  /\byou made\b/i,
  /\byou were\b/i,
];

test('no template uses forbidden attribution phrasing', () => {
  for (const [side, magnitudes] of Object.entries(TEMPLATES)) {
    for (const [mag, text] of Object.entries(magnitudes)) {
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(text).not.toMatch(forbidden);
      }
    }
  }
});

test('every template mentions "interaction profile" or "composition"', () => {
  for (const magnitudes of Object.values(TEMPLATES)) {
    for (const text of Object.values(magnitudes)) {
      const mentionsProfile = /interaction profile|composition/i.test(text);
      // Exception: target_dominant templates talk about the target, not the profile
      // Adjust test accordingly or split templates by side.
      expect(mentionsProfile || text.includes('target')).toBe(true);
    }
  }
});
```

### Sequence of changes

1. Define `AttributionLabel` schema in shared
2. Extend friction handler to compute attribution labels per top target (even if initial logic is simple: compare duration to chain overhead)
3. Create presenter directory in MCP with `attribution-templates.ts` and `maturity-prefix.ts`
4. Add linting test for templates
5. Update `get-friction-report.ts` to consume templates and maturity prefix
6. Update other presenter tools (`get-failure-registry`, `get-healthy-corridors`, etc.) to use `renderMaturityPrefix` — can be done incrementally

### Migration strategy

- Attribution labels are added to friction response, never removed → backwards compatible
- MCP presenter changes only affect text formatting → safe to rollback independently

### Test plan

- **Unit:** template library passes linting test (no forbidden substrings)
- **Unit:** `renderAttribution` returns correct sentence for every (cost_side, magnitude) combination
- **Unit:** `renderMaturityPrefix` returns correct prefix for each maturity state
- **Integration:** friction endpoint returns attribution labels for known test receipts
- **E2E:** MCP `get_friction_report` produces output that starts with maturity prefix and includes attribution sentences following the invariant

### Observability

- Log when a server response omits attribution (`insufficient_data`) to track when we're not yet useful to a user
- Log when templates receive an unknown label (safety net — shouldn't happen because it's a closed enum, but catch drift)

### Rollback

- Template library is static data → revert the commit
- Server-side attribution computation is additive → revert the friction handler change
- Maturity prefix is additive on presenter tools → revert per tool

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Server attribution is wrong in edge cases | Medium | Start with simple rules, refine based on observation. `insufficient_data` is always a safe default |
| Template library has a forbidden substring | Low | Linting test catches this at build time |
| Presenter tools don't surface maturity → operator can't calibrate trust | Medium | Dedicated check in PR review: every presenter tool must use `renderMaturityPrefix` |

---

## Item 5 — 60-second correlation window

### Goal

The MCP keeps a lightweight in-process correlation buffer of ~60 seconds of recent receipt keys so it can tag linked receipts at ingest time, framed explicitly as a privacy + lightweight-use design choice. No persistence, no pattern matching.

### Acceptance criteria

- [ ] `packages/mcp-server/src/middleware/correlation-window.ts` exists and exports a function to record and query correlation keys
- [ ] On receipt insert, the window evicts entries older than 60 seconds (eager eviction on insert, no timers)
- [ ] `log_interaction` consults the window for a recent receipt on the same `chain_id` or target and sets `preceded_by` when appropriate
- [ ] Window is in-process only (lost on restart) and this is documented
- [ ] Unit tests verify eviction and lookup behavior
- [ ] Integration test: two interactions <60s apart with the same chain_id → second receipt has `preceded_by` set
- [ ] Integration test: two interactions >60s apart → second receipt does not have `preceded_by` set from the MCP
- [ ] `README.md`, `packages/mcp-server/README.md`, and `public/terms.html` include the privacy + lightweight framing

### Files affected

| Path | Change type |
|---|---|
| `packages/mcp-server/src/middleware/correlation-window.ts` | new |
| `packages/mcp-server/src/tools/log-interaction.ts` | edit — consult window, set `preceded_by` |
| `packages/mcp-server/src/middleware/self-log.ts` | edit — also record into window (fire-and-forget) |
| `packages/mcp-server/src/server.ts` | edit — instantiate single window per session |
| `packages/mcp-server/README.md` | edit — privacy framing |
| `README.md` | edit — privacy framing |
| `public/terms.html` | edit — updated policy text |
| `packages/mcp-server/test/correlation-window.test.ts` | new |

### Data model / interfaces

```typescript
// correlation-window.ts
interface CorrelationEntry {
  receipt_id: string;
  chain_id: string | null;
  target_system_id: string;
  created_at_ms: number;
}

export class CorrelationWindow {
  private entries: Map<string, CorrelationEntry> = new Map();
  private readonly windowMs: number = 60_000;

  record(entry: CorrelationEntry): void {
    this.evictExpired();
    this.entries.set(entry.receipt_id, entry);
  }

  findPrecededBy(currentChainId: string | null, currentTarget: string): string | null {
    this.evictExpired();
    // Prefer same chain_id match
    if (currentChainId) {
      for (const [id, entry] of this.entries) {
        if (entry.chain_id === currentChainId && id !== /* self */ '') {
          return entry.target_system_id;
        }
      }
    }
    return null;
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [id, entry] of this.entries) {
      if (entry.created_at_ms < cutoff) {
        this.entries.delete(id);
      }
    }
  }

  // For tests + observability
  size(): number { return this.entries.size; }
}
```

**Important:** the window is instantiated once per session in `server.ts` and passed into `log-interaction` and `self-log` via closures or a simple singleton. No global state. No disk.

### Sequence of changes

1. Create `correlation-window.ts` with unit tests
2. Wire into `log-interaction.ts` to query window on receipt send and set `preceded_by`
3. Wire into `self-log.ts` to record into window on fire-and-forget
4. Update docs with privacy framing
5. Update `public/terms.html` privacy policy text

### Test plan

- **Unit:** insert 3 entries, evict one by setting its timestamp > 60s ago → size is 2
- **Unit:** insert, lookup by chain_id → returns matching entry
- **Unit:** lookup when no match → returns null
- **Unit:** lookup across >60s gap → returns null (evicted)
- **Integration:** two `log_interaction` calls <60s apart with same chain_id → second receipt has `preceded_by: <first_target>`
- **Integration:** restart process between calls → second call has no `preceded_by` (window is empty, documented behavior)

### Observability

- Log window size periodically (indicates typical workflow burst sizes)
- Log the ratio of receipts that got `preceded_by` set from the window vs receipts where it was null (indicates how often in-flight correlation is possible)

### Rollback

- Revert the commit; the window is pure in-process logic
- No server-side impact
- No data migration

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Window grows unbounded if eviction has a bug | Low | Unit test explicitly verifies eviction; size capped via hard limit (say 500 entries) as a safety net |
| Process-wide singleton conflicts with multi-agent test harnesses | Low | Instantiate one window per `createAcrServer` call, not module-level |
| Agent uses chain_id incorrectly → false linkage | Medium | Window only matches exact chain_id; if the agent gets it wrong, the server can still reconstruct from its full history |

---

## Drift prevention checklist

Every PR that touches the MCP, the ingest API, or the compute-boundary-related code must pass these checks. If a PR fails a check, it is held until the drift is fixed.

### MCP-side checks

- [ ] **No new persistent state** beyond session identity + 60s correlation window
  - Grep: `fs.writeFileSync`, `fs.appendFileSync`, `sqlite`, `createWriteStream` — if present, verify the change is intentional and explicitly approved
  - Grep: session-state.ts changes, verify new fields are session-lifetime only
- [ ] **No background work**
  - Grep: `setInterval`, `setTimeout` (except the 2s timeout in self-log), `cron`, `schedule` — any new usage requires justification
- [ ] **No aggregation across records**
  - Grep: `.reduce(`, `.sort(`, `.filter(` in tool handlers — these are allowed ONLY in presenter code that works on a single pre-computed response, not across multiple receipts
- [ ] **No client-side baseline/anomaly/prediction computation**
  - Grep for math operations over arrays of server data; anything that looks like "compute what's normal" is drift
- [ ] **No content capture**
  - Grep for `request_body`, `response_body`, `content`, `payload` being sent in receipts — none allowed
- [ ] **Attribution templates use the rhetorical invariant**
  - Linting test at `packages/mcp-server/test/presenter.lint.test.ts` must pass
- [ ] **Schema additions are additive**
  - All new receipt fields optional; no existing field renamed or removed
- [ ] **Presenter tools include maturity surfacing**
  - Every new or updated presenter tool must call `renderMaturityPrefix` or explicitly note why it doesn't

### Server-side checks

- [ ] **Migrations are reversible**
  - Every `.up.sql` has a matching `.down.sql` that restores the prior state
- [ ] **New columns are nullable or have DEFAULT**
  - No breaking schema changes on running clients
- [ ] **Response shape changes are additive**
  - New fields optional; existing fields keep their names and types
- [ ] **Tier gating is on the server, not the client**
  - If a new endpoint is paid-tier-only, the gating is enforced by the API key check in the handler, not by client logic

### Process checks

- [ ] **Every item has acceptance criteria checked off**
- [ ] **Every item has a test plan run and passing**
- [ ] **Every item has a rollback path documented and verified**
- [ ] **Observability metrics are emitted from day one** (not added post-hoc)

---

## Phase 1 success and completion

This section is a runbook-style checklist for knowing when Phase 1 is actually done, what to watch after deploy, and what to do when the plan turns out to be wrong. None of it is a hard gate — it's the stuff you want to run through before calling it shipped.

### Definition of Ready (before starting implementation)

Before picking up any item, these should be true:

- [ ] Local dev environment builds cleanly: `pnpm install && pnpm build`
- [ ] Migration harness runs: `node scripts/run-migration.mjs up`
- [ ] Integration test harness runs against local DB: `node scripts/test-agent-lifecycle.mjs`
- [ ] You've read `proposals/mcp-compute-boundary.md`
- [ ] You've skimmed `proposals/positioning-audit.md` so the framing doesn't drift mid-implementation
- [ ] You know which tier an endpoint belongs to (Basic / Pro / Enterprise) before adding fields to its response
- [ ] You've checked this plan's **Cross-cutting concerns** section to see if your change has knock-on effects (SDK parity, maturity surfacing, privacy framing, etc.)

### Definition of Done for Phase 1

Phase 1 is complete when all of these are true:

- [ ] Each of the five items' acceptance criteria are checked off on their respective PRs
- [ ] Unit, integration, and E2E test suites pass
- [ ] The drift prevention checklist has been run on every merged PR (and filed in the PR description)
- [ ] The privacy framing copy has landed in:
  - [ ] Root `README.md`
  - [ ] `packages/mcp-server/README.md`
  - [ ] `public/terms.html`
  - [ ] Any marketplace listing text that mentions composition or state handling
- [ ] SDK parity: TypeScript and Python SDKs accept the new category parameters (if they need them for the MCP/SDK users) and are published to npm and PyPI
- [ ] A staging smoke test succeeds, covering:
  - [ ] Fresh agent registers → profile returns `maturity_state: warmup`
  - [ ] After ~50 receipts → profile returns `maturity_state: calibrating`
  - [ ] Posting a receipt with `categories.activity_class = 'math'` → `/friction` shows a math breakdown
  - [ ] Two receipts <60s apart on the same `chain_id` → second receipt has `preceded_by` set
  - [ ] Agent that hasn't updated composition for >30 min → receipt response has `composition_stale: true`
  - [ ] `get_friction_report` output starts with a maturity prefix and uses the attribution rhetorical invariant (no "your fault," no "your side," subject is "your interaction profile")
  - [ ] Setting `ACR_DEEP_COMPOSITION=false` → registered composition has no sub-component data
- [ ] Observability dashboards exist for the per-item metrics listed below
- [ ] A short "what changed in Phase 1" note is added to the root `README.md` changelog section (or equivalent)

### Success metrics (for observing, not for gating)

These are baselines to watch post-deploy so we know whether the phase did what we intended. None of them are hard targets.

**Adoption**
- % of receipts carrying non-empty `categories` in the first 30 days (how fast is the new schema being populated?)
- Unique values observed per category dimension (informs taxonomy refinement — if `activity_class: 'legal'` starts appearing, we know to formalize it)
- % of agents reporting two-source composition (both MCP observation and agent self-report)

**Quality**
- % of agents progressing through maturity states (`warmup` → `calibrating` → `stable_candidate`) within their first week
- % of profiles where the two-source composition delta is non-empty (how often does observation disagree with self-report?)
- Rate of `composition_stale: true` flags set per agent per day (how often is drift being caught?)

**Privacy and trust**
- % of sessions with `ACR_DEEP_COMPOSITION=false` (operator opt-out rate)
- Any user-reported confusion about attribution text (via GitHub issues, support channels)
- Any privacy-related inbound questions

**MCP health**
- MCP tool latency distribution (detect observer-effect regressions from this phase's changes)
- Self-log success rate (fire-and-forget instrumentation is still firing)
- 60s correlation window hit rate (how often does the MCP find a matching recent receipt to link against?)

### Phase-level risks

Item-level risks are in each item's section. These are risks to the phase as a whole, with the fallback response pre-written so we're not improvising if something goes wrong.

| Risk | Fallback response |
|---|---|
| Category taxonomy proves wrong after real usage | Observability on unique values per dimension surfaces what people actually use. Iterate the taxonomy as a follow-up; the JSONB schema is additive so iteration is cheap — no migration needed. |
| Two-source composition delta is noisy and mostly useless | Scale back the delta computation to simpler "present/absent" diffs. Don't surface noisy findings to users until we understand what "meaningful delta" means in practice. The storage is still valuable even if the delta display is hidden. |
| Near-compulsory update cadence leaves too much drift | Ship the Claude Code plugin (Phase 2) sooner than planned to close the gap for Claude Code users. Observability on `composition_stale` rates tells us when to prioritize this. |
| Operators don't find the opt-out mechanism | Add a tool-description-level mention on `register_agent` and a one-line notice the first time composition is captured deep. Low-cost addition. |
| Attribution templates don't cover real server-returned cases | The template library has a fallback path for `insufficient_data` and for unknown labels — fall back to neutral numerical presentation (Option 4A) rather than failing to render. |
| Schema migration fails on production DB size | Migrations use `CONCURRENTLY` for indexes and `DEFAULT` for columns — no table locks expected. If a rollback is needed, `.down.sql` files already exist. Test on a production-sized staging DB before prod deploy. |
| The plan itself has a flaw we won't discover until mid-implementation | See the revision process below. |

### Revision process

This plan is a draft. If you're implementing something and the plan is wrong — the acceptance criteria don't make sense, a file path has changed, a dependency is different in the real codebase, a constraint turned out wrong — amend this document. Open a PR that:

1. Updates the plan to reflect what you've learned
2. Explains the change in the commit message (what was wrong, what's correct, why)
3. Gets reviewed alongside (or just before) the implementation PR that depends on the change

Don't let the plan drift silently while the code diverges. The plan changes — it's supposed to.

If a change is urgent (you're mid-implementation and blocked), amend the plan first and tag the commit "plan-amendment" so it's easy to audit later. Better to update the doc with a clear rationale than to leave it stale and have the next engineer pick up a broken plan.

---

## Not in scope for Phase 1

Tracked separately; do not implement as part of this phase.

- MCP tools that expose the new Layer 2 endpoints (`get_profile`, `get_coverage`, `get_healthy_corridors`, `get_failure_registry`, `get_trend`, and a composite `summarize_my_agent`) — presenter-tool work, separate from this plan
- Dashboard exploration
- Security hardening (receipt auth, per-agent rate limiting, AST analysis)
- Pro tier endpoint depth (population comparison fields, changepoint detection, degradation matrix, regime fingerprinting)
- Enterprise tier / Friction Observer-operated runs
- Longitudinal corpus analysis pipelines beyond what friction.ts already has

---

## Next steps: Claude Code plugin (Phase 2)

This is the work that ships next once Phase 1 is landed. It is **out of scope for Phase 1**. It is listed here so the handoff is clean and nothing about the architecture is a surprise when it's picked up.

### Goal

A standalone package that hooks into Claude Code to give truly compulsory composition update detection, bypassing the "near-compulsory" compromise in Item 3.

### Architecture summary

The plugin is **a separate package from `@tethral/acr-mcp`**. It does not live in the MCP server. It does not communicate with the MCP. It talks directly to ACR's ingestion API over HTTP.

```
User edits .claude/settings.json or .claude/skills/*
              │
              ▼
Claude Code plugin (file watcher)
              │
              ▼
HTTP POST /api/v1/composition/update  (ACR ingestion API)
              │
              ▼
Server updates canonical composition
              │
              ▼
Next receipt from MCP is classified against fresh composition
```

The MCP never knows the plugin exists. Both processes talk to the server independently.

### Package structure

```
packages/claude-code-plugin/
├── package.json              # name: @tethral/acr-claude-code-plugin
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # plugin entry, watchers + HTTP client
│   ├── file-watcher.ts       # chokidar-based file watcher
│   ├── composition-differ.ts # detect what changed in settings.json
│   ├── acr-client.ts         # HTTP POST to /composition/update
│   ├── config.ts             # reads ACR_API_URL, looks up agent_id
│   └── hook-manifest.ts      # Claude Code hook registration
└── test/
    ├── file-watcher.test.ts
    ├── composition-differ.test.ts
    └── integration.test.ts
```

### Work breakdown

1. **Package scaffolding** (1 day)
   - New workspace package under `packages/claude-code-plugin/`
   - package.json with `@tethral/acr-claude-code-plugin`
   - TypeScript config, build pipeline, CI integration
   - README with install instructions

2. **Claude Code hook integration** (1-2 days)
   - Research current Claude Code hook API (SessionStart, UserPromptSubmit, or custom file-watch)
   - Hook manifest in the plugin's settings.json contribution
   - Entry point that starts the file watcher when Claude Code loads the plugin

3. **File watcher** (1 day)
   - Use `chokidar` for cross-platform file watching
   - Watch paths:
     - `~/.claude/settings.json`
     - `~/.claude/skills/**/*.md`
     - `<cwd>/.claude/settings.json`
     - `<cwd>/.claude/skills/**/*.md`
   - Debounce events (settings.json can get multiple writes during a save)

4. **Composition differ** (1 day)
   - Read the before/after state of the watched files
   - Compute what changed: new skills, removed skills, new MCPs, removed MCPs, sub-tool changes
   - Produce a canonical diff structure

5. **ACR HTTP client** (1 day)
   - Look up the agent's `agent_id` (via shared state file written by the MCP, or via user configuration)
   - POST to `/api/v1/composition/update` with the diffed composition
   - Auth via same mechanism as MCP (or API key from env)
   - Retry with backoff on network errors

6. **Tests** (1 day)
   - Unit test file-watcher debounce and event detection
   - Unit test differ against fixture configs
   - Integration test: change a fixture file, verify HTTP request fires with correct payload

7. **Documentation and distribution** (1 day)
   - README with install and config
   - Publishing to npm under `@tethral/acr-claude-code-plugin`
   - Landing page entry explaining what it does
   - Troubleshooting guide

**Total rough estimate: 7-10 days of focused work.**

### Open questions for Phase 2

- **Agent ID lookup.** How does the plugin know which agent_id to update? Options:
  - Plugin reads a shared state file the MCP writes on startup
  - Plugin is configured with an agent_id manually
  - Plugin queries ACR's `/whoami` endpoint using a host identifier
- **Multiple agents per host.** If a user has multiple agents (different projects, different Claude Code profiles), how does the plugin decide which one a given file change belongs to?
- **Bootstrap.** What happens if the plugin is installed before the MCP? Does it queue updates, fail gracefully, or require the MCP to be installed first?
- **Other hosts (Cursor, Continue, Zed).** Each one needs a separate plugin with host-specific hook integration. The architecture is the same but the integration point differs.

### Why it's deferred

- **Phase 1 items deliver more user-visible value.** The category schema, attribution phrasing, and two-source composition directly change what presenter tools show users. The plugin changes update-latency for a specific host.
- **The near-compulsory path covers most cases.** If the agent follows skill instructions (which the compute-boundary doc explicitly treats as a first-class mechanism), composition drift is bounded.
- **Phase 2 deserves its own design discussion.** File watching cross-platform, auth flow, multi-agent support, bootstrap ordering — these are real design questions that deserve their own review, not an afterthought bolted onto Phase 1.
- **It's purely additive.** The plugin doesn't change any Phase 1 decisions. Shipping Phase 1 and Phase 2 in sequence has zero integration risk.

### Triggers for picking it back up

- A paying customer asks for compulsory composition tracking
- Observability on Phase 1 shows high `composition_stale` rates across the user base
- Claude Code ships a new hook API that makes it trivially easy to integrate

---

## Summary

Phase 1 delivers five coherent improvements to ACR, all grounded in the compute-boundary document and its reference goals. The work is sequenced to land the small/independent items first (Item 1 categories, Item 5 correlation window) while the critical-path Item 2 (composition capture) enables Items 3 and 4. Drift prevention is enforced at review time through a concrete checklist, not after the fact. Every item has acceptance criteria, a test plan, a rollback path, and observability.

The Claude Code plugin is explicitly out of scope for Phase 1 but is documented here so nothing is a surprise when it's picked up.

This document is a draft. Revisit and amend as implementation reveals things the plan got wrong.
