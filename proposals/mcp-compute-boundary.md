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
4. **Present in plain language.** Write user-facing summaries from server-returned structured data, choosing what to surface, in what order, with what emphasis.

Presentation is deliberate work. The MCP picks which of the server's labeled findings to mention first, phrases them in English the operator can act on, and ties together multiple endpoints when a single summary needs several data sources. That is not computation, and the MCP is expected to do it.

---

## Constraints that fall out of ACR's purpose

These are not rules imposed from outside. They're consequences of what ACR is for. If ACR's purpose changes, the constraints change with it.

### 1. No content capture, ever.

ACR's privacy promise is that we record metadata only. The MCP never sends request bodies, response bodies, prompts, completions, file contents, or any identifier tied to a human. This is constitutive of the product — violating it breaks the privacy promise and the legal basis for operation.

### 2. No computation over records on the client.

Attribution (was the cost on the agent's side or the target's?), decomposition (where in the chain did it land?), and downstream mapping all depend on population data and longitudinal history the MCP doesn't have. If the MCP did this math locally, it would get a different answer than the server, and the corpus would stop being coherent across clients.

Concretely: no `sort`, `filter`, `count`, `mean`, `sum`, or comparison across receipts on the client. The server has the full picture. The MCP asks for the answer and renders it.

### 3. No persistent local state beyond session identity.

The corpus lives on the server. Caches, rolling buffers, and memoization on the client drift from that truth and corrupt longitudinal readings. The only state the MCP holds is `agent_id`, `agent_name`, `transport_type`, and `api_url` — enough to keep talking to the server without re-authenticating.

### 4. No baseline, anomaly, or prediction work on the client.

These all require "what's normal for this composition under these conditions" — a question only the corpus can answer. The server computes the baseline and labels the finding. The MCP presents the label.

### 5. Composition fidelity is load-bearing.

Because ACR distinguishes internal from external friction, the MCP must capture the agent's composition accurately. Missing attachments, incorrect skill hashes, or stale composition data corrupt the internal-vs-external split. `register_agent` and `update_composition` exist so the server can tell which interactions are an agent talking to itself versus an agent talking to the outside world.

### 6. Capture both internal and external interactions.

When an agent's model calls one of its own attached MCPs or skills, that's an **internal interaction** and should be logged. When the agent calls an external API or another agent, that's an **external interaction** and should be logged. Both go through `log_interaction`. The server separates them by comparing the target against the agent's registered composition.

### 7. Observer-effect discipline.

The MCP is a sensor inside the thing being measured. If the sensor is slow, every measurement it takes is inflated by the sensor's own latency, and the friction reading becomes self-referential. This means: no synchronous heavy work before returning to the agent, no blocking the agent's hot path, and `log_interaction` stays fire-and-forget.

This is a qualitative discipline, not a hard millisecond budget.

### 8. Stable ingest schema.

The corpus is built over months and years. Breaking receipt field names or semantics mid-stream breaks historical comparability. Schema additions are fine. Removals and renames require explicit migration and a version bump.

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
