# ACR MCP: Compute Boundary

**Status:** Draft — working document, not approved, not immutable.
**Scope:** `@tethral/acr-mcp` and any successor MCP packages.
**Purpose:** Describe what the ACR MCP is for, grounded in what ACR is for, and let the constraints that fall out of that purpose speak for themselves.

---

## What ACR is for

ACR captures **interaction data** and **agent composition**. It does not capture content.

When an agent engages with a service, ACR records:

- **The composition** — the model and what's attached to it (MCPs, APIs, skills). Where possible, the components of those attachments (the internals of each MCP and skill).
- **The interaction** — type, timing, status, chain context, anomaly flags. Not bodies, not prompts, not completions, not file contents.

From that, ACR tells the operator:

- When you engaged with this service, in this composition, this is what happened.
- This is where the interaction was costly.
- This is where it was efficient or healthy.
- This is how the cost was on your side.
- This is how the cost was on theirs.
- This is the downstream effect, if any.

Because composition includes both the model and its attachments, ACR sees two layers of friction:

- **Internal friction** — between the agent's own constituent parts (model ↔ MCP, skill ↔ skill, one component of an attachment ↔ another).
- **External friction** — between the composed agent and the systems it calls.

These are separate readings and can be synchronized. Over days, months, and years, readings accumulate into a **corpus** describing how agents behave under varying compositions and varying conditions.

That corpus is the point.

---

## What the MCP is for

The MCP is the piece of ACR that runs in the agent's process. Its job is:

1. **Register composition.** The model, its attachments, and — where visible — the components of those attachments. Keep it current as the agent changes.
2. **Capture interactions.** Every external tool call, API request, MCP interaction, and — where visible — internal interactions the agent has with its own attached parts. With timing, status, chain context, category, and anomaly flags. No content.
3. **Gather answers from the server.** Call one or more Layer 2 endpoints to pull together what the user needs to see.
4. **Present what matters to the operator.** Not every piece of data the server returns is worth showing. The MCP's job is to pick the handful of things the operator actually needs — the most costly interaction, the target that's suddenly failing, the healthy corridor worth preserving, the jeopardy flag they should know about — and put them in front of the operator in language they can act on. Raw dumps of server JSON are not presentation. Telling the operator *what's costing them, what's working, what changed, and what to look at next* is presentation.

The MCP picks which of the server's labeled findings to mention first, phrases them in English the operator can act on, and ties together multiple endpoints when a single summary needs several data sources. The server does the math. The MCP decides what's worth the operator's attention and says it clearly. Both jobs are real work.

---

## Constraints that fall out of ACR's purpose

These are not rules imposed from outside. They're consequences of what ACR is for. If ACR's purpose changes, the constraints change with it. Each constraint below is named plainly; the explanation says what it means and why it exists, without jargon.

### 1. The MCP never sends content — only facts and categories about the call.

The MCP must never send or store the actual text of anything the agent is processing: no prompts, no completions, no request bodies, no response bodies, no file contents, no user input.

What it *does* send is a rich set of facts and classification fields that describe the shape of the call without revealing its content. Rich classification matters because the same agent calling the same target can have very different friction profiles depending on **what kind of work is involved**. An LLM doing math responds differently than one composing creative writing or reasoning about visuals — we've already seen that happen. As agents specialize, it becomes valuable to know how much effort different *kinds of work* take.

The category dimensions receipts should carry (evolving schema — all fields optional on the client, accepted server-side, default to `unknown` if not provided):

- **Target type** — more granular than today's `mcp_server` / `api` / `skill` / `platform`. Examples: `api.llm_provider`, `api.payment`, `api.source_control`, `mcp.database`, `skill.parser`. Descriptive namespacing, not a fixed enum.
- **Interaction category** — today's `interaction_category` field: `tool_call`, `data_exchange`, `commerce`, `research`, `code`, `communication`. Kept as-is for compatibility.
- **Activity class** — the kind of work the interaction represents. Starting taxonomy: `language`, `math`, `visuals`, `creative`, `deterministic`, `sound`. Expandable as patterns emerge. This is the "what cognitive or computational domain is this" dimension.
- **Interaction purpose** — what the agent was trying to accomplish: `read`, `write`, `search`, `generate`, `transform`, `acknowledge`.
- **Workflow role** — where the call sits in the broader workflow: `initial`, `intermediate`, `recovery`, `cleanup`.
- **Workflow phase** — if the agent runs in phases: `plan`, `act`, `reflect`.
- **Data shape** — a content-free description of what kind of data moved: `tabular`, `text`, `binary`, `structured_json`, `stream`, `image`, `audio`.
- **Criticality** — how essential this call was to the workflow: `core`, `enrichment`, `debug`.

None of these are content. All of them describe the call without revealing what was in it. Taken together, they let the server slice friction readings by kind-of-work, not just by raw duration — which matters more as agents get specialized and the same target behaves differently depending on what it's being asked to do.

**Why:** ACR's privacy promise is about *bodies*, not about keeping the category vocabulary thin. The promise says "no content." It does not say "only timing and status." Expanding the descriptive category layer is a feature, and as the corpus grows, these classification dimensions are what lets the server answer "why is math slow on this target when language is fine?" and other workload-sensitive questions the current schema can't answer.

### 2. The MCP does not do math or logic across a list of receipts.

The MCP should not count receipts, average durations, sort targets by speed, pick "the worst failing call," or compare one receipt to another. Any time the answer to a question requires loading a set of past calls and computing something from them, the server does it.

**Why:** Every agent is running its own copy of the MCP. If each copy does its own math, each copy gets slightly different answers depending on what it has in memory, what's cached, what version of the code it's running. The corpus stops being consistent. The server has every receipt and is the single source of truth — ask it.

The MCP is still free to call the server, get back a pre-sorted list with pre-computed numbers, and pick which entries to mention in the user-facing text. That's presentation, not computation.

### 3. The MCP holds a ~60-second rolling correlation window — a passive buffer, not a store.

The MCP's long-term truth always lives on the Tethral server. But a strict "forget everything between tool calls" rule is too tight, because when two interactions happen seconds apart, it's useful if the MCP can tag the second one as following the first before sending it to the server, rather than leaving the server to reconstruct the linkage afterward.

So the rule is: **the MCP holds a rolling window of ~60 seconds** of the correlation keys from recent receipts. Long enough to catch typical in-flight workflow correlation (a call that immediately follows another, a retry that comes seconds later). Short enough that the MCP is never holding a meaningful slice of history that could drift from the server's record.

What the MCP holds in the 60-second window:
- The agent's identity (`agent_id`, `agent_name`, `transport_type`, server URL)
- A rolling list of recent receipts' correlation keys: `receipt_id`, `chain_id`, target, timestamp
- Nothing else. No bodies. No aggregates. No labels from the server.

What the MCP does **not** do with the window:
- No pattern matching across it — the MCP doesn't know history or patterns, in the forward sense ("what usually comes next") or the reverse sense ("what usually came before")
- No aggregation over it — not "how many calls in the last 60 seconds," not averages, not counts, not rankings
- No analysis of any kind
- No prediction

The MCP is a passive buffer. It holds just enough context to link a new receipt to recent ones in the same workflow at the point of ingest, and that's it. The server does all actual correlation, all pattern matching, all history work. Beyond 60 seconds, correlation is entirely the server's job — it has the full record and can reconstruct any relationship between any two receipts, no matter how far apart.

**Why:** Without a short correlation window, receipts arrive at the server as disconnected events and the server has to do harder work to reassemble the natural chains of a workflow. A tight 60-second window on the client keeps in-flight linkage cheap and correct at the point of capture. If the window were longer — or if the MCP started analyzing what was in it — the MCP would be holding a parallel mini-corpus that drifts from the server's truth, and every constraint in this doc would start to bend.

### 4. The MCP does not try to guess what's normal, what's weird, or what's coming next.

Three things the MCP should not attempt locally:

- **"What's normal"** — figuring out a baseline requires seeing lots of agents over lots of time. The MCP only sees one agent in one session. It's the wrong vantage point.
- **"Is this weird"** — you can't flag something as anomalous unless you know what non-anomalous looks like. Same problem.
- **"What's about to happen"** — forecasting requires history. The MCP doesn't have history; the Tethral server does.

**Why:** All three require data the MCP doesn't have. If the MCP tried anyway, it would return confident-sounding numbers that are just wrong. The Tethral server computes these with the full corpus and returns labeled findings. The MCP renders the labels.

**Tier note:** Because producing longitudinal patterns (baselines, drift detection, regime fingerprinting, forecasting) costs real compute on Tethral's server, access to these views is a natural delineation between Basic and Pro. Basic users see their own interaction profile and directional signals — things computable from their own data. Pro users get the views that required the server to run corpus-level analysis to produce. The MCP doesn't know or care which tier the user is on; it calls the same endpoint, and the server gates the response based on the API key.

### 5. Composition is captured from two sources, and the comparison is itself a signal.

The MCP captures what the agent is made of — the model, its attached MCPs, its attached skills, its attached APIs, and (where visible) the sub-components of those attachments — from **two sources**, and both matter:

1. **What the MCP can observe** — the attachments it can see directly in the environment (loaded MCP servers, declared skills, runtime tool bindings, `env-detect` output). This is ground-truth from the MCP's vantage point.
2. **What the agent reports about itself** — the composition the agent declares via `register_agent` and `update_composition`. This is self-report, which may be incomplete because the agent may not be fully aware of everything it has access to.

Both are sent to the server. The server can then compare them and treat disagreements as a signal:

- **If the MCP observes an attachment the agent didn't declare**, the agent has access to something it doesn't know about — worth flagging.
- **If the agent declares an attachment the MCP doesn't observe**, the self-report is wrong or stale — also worth flagging.
- **If they agree**, the composition is confidently known and can be used to classify interactions as internal vs. external.

**Why:** Internal-vs-external classification is one of the two main readings ACR produces. If composition is wrong, that reading is wrong. But the right response to that risk isn't just "the MCP must report composition correctly" — it's "capture from two sources, compare them, and learn from the differences." The comparison itself reveals things neither source knows alone: gaps in the agent's self-awareness, drift between declared and actual state, or cases where the MCP's observation is limited by the runtime.

`register_agent`, `update_composition`, and the MCP's own observation path all exist so the server can see both views and reason about the delta.

### 6. The MCP logs both layers of interaction — the agent using its own parts, and those parts reaching outside.

There are two distinct interaction layers, and both get logged:

- **Internal interaction** — the agent's model engages a skill, MCP, or tool it has. That engagement itself is valuable and worth recording. (Example: the model decides to use its `github-issues` skill.)
- **External interaction** — the engaged skill/MCP/tool now reaches out to an external force. That's the external-facing call. (Example: the `github-issues` skill then calls `api.github.com`.)

In practice these chain: **model → engages internal skill (internal interaction) → engaged skill calls external target (external interaction).** Both steps get logged via `log_interaction`. Both matter for different reasons:

- The **internal** log captures friction inside the agent's own orchestration — "how long did it take for the model to engage this skill, was the skill even available, did the model pick the right one?"
- The **external** log captures friction between the engaged component and the outside world — "how long did the external API take, did it fail, was the response useful?"

**Why:** Without internal logging, you can't distinguish orchestration friction from external-target friction. An agent that takes 1.2 seconds to "call GitHub" might be spending 900ms picking and engaging its own skill before a 300ms external API call. You'd wrongly blame GitHub for the 1.2 seconds. Logging both layers lets the server attribute cost to the right place.

The server uses the agent's composition (constraint #5) to classify which targets are "the agent's own parts" (internal) versus "things the agent's parts reach out to" (external). That's why composition fidelity matters — without it, the classification breaks and attribution breaks with it.

When both layers are linked via `chain_id`, the server can reconstruct the full causal chain: *agent used skill X, skill X then called target Y, total cost breaks down as A ms in orchestration plus B ms in external call plus C ms of overhead between them*.

### 7. The MCP must be fast and must not block the agent.

The MCP runs inside the thing it's measuring. If the MCP is slow, the agent is slow, and then the friction report blames the agent's *targets* for time the MCP actually caused itself. The measurement pollutes itself.

Concretely: `log_interaction` is fire-and-forget. No synchronous waits for the server to respond before returning to the agent. No heavy work in between. No "let me check one more thing" calls that block the hot path.

This is not a hard millisecond budget — it's a discipline. If a change to the MCP makes the agent's perceived latency go up, something is wrong and should be moved server-side.

**Why:** Observer effect. A fast, non-blocking sensor produces clean measurements. A slow sensor produces measurements of its own slowness.

### 8. The shape of the data the MCP sends up can't keep changing.

The fields in a receipt — `duration_ms`, `target_system_id`, `status`, `chain_id`, and the rest — have fixed names and fixed meanings. New fields can be added (that's fine). Existing fields cannot be renamed or have their meaning quietly changed. Removing a field requires explicit migration and a version bump.

**Why:** ACR is building a corpus of receipts over months and years. If a receipt from January uses `duration_ms` and a receipt from June uses `latency_ms`, those receipts aren't comparable anymore, and the longitudinal record is broken. Long-term comparability is the whole point of keeping the corpus, so the short-term convenience of renaming a field doesn't win.

---

## What the MCP is expected to do

Given the constraints above, the MCP is expected to:

- Register composition and keep it current.
- Log every interaction the agent makes, internal or external, with enough metadata for the server to attribute cost and map downstream effect.
- Call as many Layer 2 endpoints as a single user-facing summary needs.
- Choose which of the server's pre-labeled findings to surface to the operator, in what order, with what framing.
- Write plain-language summaries that answer: "in this composition, this happened, here's where the cost was, here's the downstream effect."
- Stay out of the agent's hot path.

---

## Open items that need discussion

This is a working document. Items are marked **[resolved]** when the constraint discussion has answered them, **[open]** when they still need work.

- **[resolved] Capturing composition from two sources.** Both the MCP's own observation AND the agent's self-report feed the server. The comparison between them is itself a signal. (Constraint #5.)
- **[resolved] Internal vs external interaction logging.** Both layers are logged. Internal = model engaging its own attached part. External = that part reaching outside. They chain via `chain_id`. Server classifies by comparing target against registered composition. (Constraint #6.)
- **[resolved] MCP working memory window.** The MCP holds a ~60-second rolling buffer of recent correlation keys (not 12 hours, as an earlier draft had). Passive buffer only — no pattern matching forward or reverse. (Constraint #3.)
- **[resolved] Longitudinal patterns as tier boundary.** Baselines, forecasting, drift detection, and regime fingerprinting are produced by the Tethral server's corpus compute and gate cleanly to Pro tier. (Constraint #4.)
- **[resolved] Mismatch handling between MCP observation and agent self-report.** Server keeps both and reports the delta. No forced resolution; the mismatch itself is informative. (Constraint #5.)
- **[resolved] Category schema — first-pass taxonomy.** Receipts should carry target_type, interaction_category (existing), activity_class (language / math / visuals / creative / deterministic / sound), interaction_purpose (read / write / search / generate / transform / acknowledge), workflow_role (initial / intermediate / recovery / cleanup), workflow_phase (plan / act / reflect), data_shape (tabular / text / binary / structured_json / stream / image / audio), and criticality (core / enrichment / debug). All optional on the client. (Constraint #1.)

- **[open] Concrete category schema migration.** The first-pass taxonomy is listed in constraint #1, but turning it into an actual database migration — new columns on `interaction_receipts`, backwards-compatible receipt validation, MCP changes to populate new fields from tool annotations where possible — is still work to scope.
- **[open] Capturing components-of-attachments.** When an attachment (skill, MCP) has its own internal composition — sub-scripts, sub-tools, nested MCPs — how does the MCP discover them? Parse metadata? Recursive self-report from the attachment? Hybrid? What does the composition object look like when it's recursive?
- **[open] Composition update cadence.** Every session? On detected change? Periodically with a version check? How does the MCP detect a change worth reporting?
- **[open] Attribution phrasing in presentation.** When the server labels a cost decomposition as "sender-side" or "receiver-side," how does the MCP phrase that for the operator without sounding accusatory or flat? This is a presentation-copy question, not an architecture question.
- **[open] 60-second window storage.** In-process memory only, or survives process restart via a short-lived tmpfile? Dying on MCP restart is simpler and probably fine given the window is so short, but needs confirming.

These are product and schema questions, not architectural ones. They're listed here because they affect what "capture composition" and "log interactions" actually mean in practice.

---

This document describes what the MCP needs to be in order to support what ACR is. It is a draft, not a decree. It is not approved and it is not immutable.
