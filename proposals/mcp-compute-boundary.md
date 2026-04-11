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

### 1. The MCP never sends content — only facts about the call.

The MCP must never send or store the actual text of anything the agent is processing: no prompts, no completions, no request bodies, no response bodies, no file contents, no user input. Only facts *about* the call — which target, which category, how long it took, success or failure, chain position, anomaly flags.

**Why:** ACR's privacy promise to operators is that we record metadata only. That promise is the legal and ethical basis for the product. If the MCP ever captured content, the promise is broken and the product is dead.

### 2. The MCP does not do math or logic across a list of receipts.

The MCP should not count receipts, average durations, sort targets by speed, pick "the worst failing call," or compare one receipt to another. Any time the answer to a question requires loading a set of past calls and computing something from them, the server does it.

**Why:** Every agent is running its own copy of the MCP. If each copy does its own math, each copy gets slightly different answers depending on what it has in memory, what's cached, what version of the code it's running. The corpus stops being consistent. The server has every receipt and is the single source of truth — ask it.

The MCP is still free to call the server, get back a pre-sorted list with pre-computed numbers, and pick which entries to mention in the user-facing text. That's presentation, not computation.

### 3. The MCP only remembers the agent's identity for the current session.

The only things the MCP keeps in memory are: `agent_id`, `agent_name`, `transport_type`, and the server URL. Enough to know who's talking to the server and how to reach it. No cached report from five minutes ago. No buffer of recent calls. No list of targets the agent has seen. When the session ends, forget all of it except how to re-authenticate next time.

**Why:** Anything the MCP remembers locally will eventually disagree with what the server knows, and then there are two versions of the truth. The server has to win that disagreement every time, so it's simpler if the MCP just doesn't remember.

### 4. The MCP does not try to guess what's normal, what's weird, or what's coming next.

Three things the MCP should not attempt:

- **"What's normal"** — figuring out a baseline requires seeing lots of agents over lots of time. The MCP only sees one agent in one session. It's the wrong vantage point.
- **"Is this weird"** — you can't flag something as anomalous unless you know what non-anomalous looks like. Same problem.
- **"What's about to happen"** — forecasting requires history. The MCP doesn't have history; the server does.

**Why:** All three require data the MCP doesn't have. If the MCP tried anyway, it would return confident-sounding numbers that are just wrong. The server computes these with the full corpus and returns labeled findings. The MCP renders the labels.

### 5. The MCP must report composition correctly, or half the product breaks.

The MCP is responsible for telling the server what the agent is made of: the model, its attached MCPs, its attached skills, its attached APIs, and (where visible) the sub-components of those attachments. It must keep that information current as the agent changes. If the MCP reports composition wrong — missing attachments, wrong hashes, stale data — the server can't tell which interactions are the agent talking to its own parts (internal friction) versus the agent talking to outside systems (external friction).

**Why:** Internal-vs-external is one of the two main readings ACR produces. If composition is wrong, that reading is wrong, and a major part of the product silently produces garbage. `register_agent` and `update_composition` exist specifically to let the MCP fix this when it changes.

### 6. The MCP logs every interaction the agent makes — inside itself and outside.

When the agent's model uses one of its own attached tools (an MCP it has, a skill it's loaded, an internal helper) — that's an internal interaction and should be logged. When the agent calls an external API, another agent, or an outside system — that's an external interaction and should be logged. Both go through `log_interaction`. Both matter.

**Why:** Without internal logging, you can't tell whether an agent is slow because of its own orchestration or because of what it's calling. You'd see "calling GitHub took 1.2 seconds" and blame GitHub, when really the agent spent 900ms on its own internal work before ever reaching out. ACR needs both layers to do attribution correctly.

The server figures out which is which by comparing the target of each interaction against the agent's registered composition. That's another reason constraint #5 (correct composition) has to hold — the server literally uses it to classify interactions.

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

This is a working document. Several things are not settled:

- **Capturing component-of-attachment data.** Do we parse a skill's metadata or an MCP's tool list to record sub-components, or does the agent self-report via `composition` updates? What does "composition" look like when an attachment has its own composition?
- **Internal interaction logging.** How does the MCP distinguish "the model used its own attached tool" from "the agent made an external call"? Does it need to? Is this done by target naming convention, by an explicit flag, or by the server comparing against registered composition?
- **Composition update cadence.** Every session? Every detected change? Periodically? On-demand?
- **Attribution surfacing in presentation.** Once the server returns sender/receiver cost decomposition, how does the MCP phrase "this was your side" vs "this was theirs" in English without sounding accusatory or flat?

These are product and schema questions, not architectural ones. They're listed here because they affect what "capture composition" and "log interactions" actually mean in practice.

---

This document describes what the MCP needs to be in order to support what ACR is. It is a draft, not a decree. It is not approved and it is not immutable.
