# Architectural Principle: ACR MCP is a Thin Client

**Status:** Approved (locked in 2026-04-10)
**Scope:** All future development of `@tethral/acr-mcp` and any successor MCP packages
**Audience:** Tethral engineering, design partners, contributors

---

## Principle

> The ACR MCP is a registrar and a reporter. It captures what happened and displays what the network says about it. **It does not interpret, it does not aggregate, it does not rank, and it does not learn.** If a feature needs more than an HTTP round-trip to produce, it does not belong in the MCP.

This is a hard architectural invariant, not a guideline. Every change to the MCP must be evaluated against it.

---

## Why this principle exists

### The observer-effect problem

ACR's product is measuring agent interaction signals. The MCP is the sensor. **If the sensor costs more than what it reveals, you've added friction while trying to expose it.** Every byte of analysis logic the MCP performs corrupts the very thing it's trying to measure.

This is the same reason the Friction Observer package explicitly distinguishes "watch" mode (live, light) from "post-hoc" mode (canonical, heavy). Watch mode is operational. Post-hoc is canonical. The two layers must be physically separated to keep the watch layer trustworthy.

### Five concrete costs of MCP analysis logic

1. **Latency tax on every call.** If the MCP runs synchronous analysis before returning, every logged interaction gets slower. The agent's perceived performance degrades. The friction lens then misattributes ACR's own overhead to the targets being measured.
2. **Context window tax.** Every tool description and schema consumes the agent's context budget. 14 tools already consume meaningful context. Each new "local lens" or "local computation" means more schemas, more descriptions, less budget for the actual work.
3. **Compute tax on the operator.** If the MCP runs analysis locally, the agent operator pays for it (CPU, battery, memory). Tethral would be extracting value by burning the operator's resources, then selling the interpretation back. This is backwards.
4. **Attack surface in the agent process.** The MCP runs in the agent's process space. More logic means more code an attacker can exploit to influence what gets reported upstream. Thin sensors are harder to compromise than smart ones.
5. **Wrong trust boundary for heavy analysis.** TriST's canonical constructs (deformation profile, interaction shape, memory order, response geometry) are computed post-hoc from bounded runs by design. The MCP cannot do those computations even in principle without an episode-structured input the receipt schema doesn't capture.

### The three-layer architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — MCP (thin sensor) — runs in agent process space      │
│  • Registers agent composition                                   │
│  • Captures raw signals: duration, status, retries, queue wait, │
│    chain position, anomaly flags, target ids                    │
│  • Ships to Tethral ingestion API (fire-and-forget)             │
│  • Fetches lightweight pre-computed reports + notifications     │
│  • Displays server-returned text                                │
│  • INVARIANT: zero analysis, zero aggregation, zero local       │
│    state beyond session identity                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS (signals up, reports down)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2 — Tethral ingestion + lens API — Tethral infra         │
│  • Receipt ingest endpoint                                       │
│  • Profile, coverage, friction, healthy-corridors, failures,    │
│    trend, regime, cost-patterns endpoints                        │
│  • Notifications + jeopardy propagation                          │
│  • Network observatory summary                                   │
│  • RETURNS: lightweight interpretation suitable for the active  │
│    tier (Basic / Pro / Enterprise)                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Internal pipeline (batch / post-hoc)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3 — Friction Observer / TriST pipeline — Tethral private │
│  • deformation_profile, interaction_shape_profile,              │
│    memory_order_profile, response_geometry_profile,             │
│    response_surface, signal_qualification, ...                  │
│  • Consumes: full signal history + episode-structured input     │
│  • Produces: canonical TriST constructs                         │
│  • Access: Enterprise tier only, Tethral-operated               │
└─────────────────────────────────────────────────────────────────┘
```

The bright line is Layer 1 ↔ Layer 2. The MCP never sees Layer 3. Layer 3 outputs flow through Layer 2 endpoints when (and only when) the customer is on a tier that exposes them.

---

## What the MCP MAY do

### ✅ Allowed

1. **Register the agent** — `register_agent`, `update_composition`
2. **Capture raw signals** — `log_interaction` (single tool, one HTTP POST per call)
3. **Auto-log self events** — `self-log.ts` middleware (fire-and-forget, re-entrancy guarded, 2s timeout, never blocks)
4. **Fetch pre-computed reports** — every `get_*` tool is an HTTP GET against a Layer 2 endpoint, format the response text, return it
5. **Display server-returned text** — text formatting, string interpolation, simple template substitution
6. **Hold session identity** — `agent_id`, `agent_name`, `transport_type`, `api_url` in `SessionState`. Nothing else.
7. **Light environment detection** — `env-detect.ts` (provider class, transport type) at startup only, sent once with registration
8. **Re-entrancy and concurrency guards** — protect against accidental loops, but only the minimum needed
9. **Error handling** — convert errors to user-readable text, never silently swallow

### ❌ Forbidden

1. **No aggregation** — no `count`, no `sum`, no `mean`, no rolling windows over past calls
2. **No ranking** — no `sort`, no `top N`, no severity scoring
3. **No filtering of server data** — if the server returns a list of 10 items, the MCP shows 10 items, not "the most important 3"
4. **No baseline computation** — never compute "this is X% slower than usual" locally
5. **No anomaly detection** — never decide locally whether something looks wrong
6. **No threat scoring** — never compute a security score, never decide whether to block
7. **No persistent local state beyond session identity** — no caches, no memoization, no historical buffers
8. **No background work** — no setInterval, no scheduled jobs, no rolling computation
9. **No content scanning** — never inspect skill content, prompts, or responses
10. **No prediction** — never forecast, never estimate, never extrapolate
11. **No machine learning** — no models, no embeddings, no similarity computation
12. **No business logic** — never decide what to recommend, never decide what's important
13. **No provider-specific logic** — never branch on which LLM the agent uses
14. **No multi-call dependencies** — never make a tool that internally calls another tool
15. **No telemetry beyond `self-log`** — no fingerprinting, no analytics, no tracking pixels

---

## The 1ms rule

> If a feature needs more than ~1ms of compute on the agent's box (excluding the network round-trip), it does not belong in the MCP.

This is the operational test. When evaluating any new feature:

1. Strip away the network call. What's left?
2. If what's left is "format text from a JSON response and return it" — that's allowed.
3. If what's left is "iterate, compare, sort, compute, decide" — that's not allowed. Move it to Layer 2.

---

## Concrete creep scenarios and the right answer

### "Can we cache the friction report so we don't hit the API on every call?"

**No.** Caching is local state. If the cache is wrong, the user sees stale data and Tethral has no way to know. If the cache is right, the savings are negligible compared to the network round-trip the user would have made anyway. Add a server-side cache layer if needed; the MCP stays stateless.

### "Can we sort the failure registry by severity locally?"

**No.** The server returns the data already sorted. If the sort is wrong, fix the server. If the user wants a different sort, add a query parameter to the Layer 2 endpoint. The MCP renders.

### "Can we let the user filter by provider locally?"

**No.** Filter at the server. The MCP passes the filter as a query parameter and renders the result. This keeps the filter logic in one place where it can be tested, evolved, and made consistent across SDKs.

### "Can we compute an estimate of token cost from `response_size_bytes` so the operator doesn't have to look it up?"

**No.** That's inference. The server has the provider tables and the model. The MCP asks the server.

### "Can we add a 'severity score' to anomaly notifications?"

**No.** Severity is a value judgment based on the network's view of all observations. The server computes it. The MCP renders the number.

### "Can we add a local 'recent activity' history so the user can see what their agent did this session?"

**No.** That's local state with a rolling window. Use `get_interaction_log` instead — the server already has the data and can return it filtered to the session.

### "Can we add an offline mode that buffers receipts and replays them later?"

**Maybe.** This is a real reliability feature, not analysis. But:
- The buffer must be append-only and bounded
- No analysis of buffered data
- Replay must be FIFO, no reordering
- The buffer must be opt-in, not default
- It must never block tool calls

Discuss before implementing. Default answer is still no.

### "Can we add a tool that predicts when the agent is likely to hit a rate limit?"

**No.** Prediction is Layer 2 or Layer 3. Add a `GET /api/v1/agent/{id}/rate-limit-forecast` endpoint and have the MCP fetch it.

### "Can we add a tool that rolls up the last 50 calls into a summary?"

**No.** That's aggregation. Add a `GET /api/v1/agent/{id}/recent?limit=50` endpoint with a summary in the response.

### "What if a feature needs both server data and local context, like 'how many of my last 10 tool calls were to GitHub'?"

**The local context is already on the server.** Every tool call is logged via `log_interaction`. The server can answer "how many of your last 10 calls were to GitHub" because it has all of them. Make it a server endpoint.

The only context the MCP holds locally is the session identity. Everything else is reconstructible from the server.

---

## Approved patterns

### Pattern 1: HTTP fetch + text format

```typescript
server.registerTool('get_friction_report', {
  description: '...',
  inputSchema: { /* params */ },
  annotations: { readOnlyHint: true, destructiveHint: false },
  _meta: { priorityHint: 0.7 },
}, async (params) => {
  const id = params.agent_id || getAgentId() || await ensureRegistered();
  const res = await fetch(`${apiUrl}/api/v1/agent/${id}/friction?scope=${params.scope}`);
  const data = await res.json();
  // Pure text formatting from data — no compute
  let text = `Friction Report for ${data.name} (${data.scope})\n`;
  text += `\n── Summary ──\n`;
  text += `  Interactions: ${data.summary.total_interactions}\n`;
  // ... etc, all template substitution
  return { content: [{ type: 'text', text }] };
});
```

### Pattern 2: HTTP POST + acknowledge

```typescript
server.registerTool('log_interaction', {
  // ...
}, async (params) => {
  const id = params.agent_id || getAgentId() || await ensureRegistered();
  const res = await fetch(`${apiUrl}/api/v1/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ /* receipt shape */ }),
  });
  const data = await res.json();
  return { content: [{ type: 'text', text: `Logged ${data.accepted} receipt(s).` }] };
});
```

### Pattern 3: Self-log middleware (fire-and-forget)

```typescript
// Allowed because it never blocks, has timeout, has re-entrancy guard,
// has no local state beyond a single boolean, and no analysis.
fireAndForgetLog(apiUrl, agentId, toolName, status, durationMs, transportType)
  .finally(() => { selfLogging = false; });
```

### Anti-pattern 1: local aggregation (forbidden)

```typescript
// ❌ NEVER DO THIS
const recentCalls = sessionState.recentCalls; // local buffer
const avgDuration = recentCalls.reduce((s, c) => s + c.duration, 0) / recentCalls.length;
return { content: [{ type: 'text', text: `Average: ${avgDuration}ms` }] };
```

Replace with: a server endpoint that returns the average from the agent's full interaction profile.

### Anti-pattern 2: client-side filtering (forbidden)

```typescript
// ❌ NEVER DO THIS
const data = await res.json();
const onlyGithub = data.targets.filter(t => t.target_system_id === 'mcp:github');
return { content: [{ type: 'text', text: formatTargets(onlyGithub) }] };
```

Replace with: a `target=mcp:github` query parameter on the Layer 2 endpoint.

---

## Tier impact

This principle holds regardless of tier:

- **Basic:** thin client, free Layer 2 endpoints
- **Pro:** thin client, paid Layer 2 endpoints (more depth, historical scope, population data)
- **Enterprise:** thin client, premium Layer 2 endpoints (canonical TriST outputs from Layer 3 pipelines)

The MCP is the same code in all tiers. What changes is the response shape from Layer 2, gated by the API key tier check at the server.

This means: **a Pro user gets richer data without any new code on their MCP.** Their existing MCP tools start returning more detailed responses because the server is now returning more detail. Upgrade is invisible to the client.

---

## Enforcement

### Code review checklist for any MCP PR

- [ ] Does this change add any local state beyond `SessionState`? (Should be no.)
- [ ] Does this change perform any aggregation, filtering, sorting, or scoring? (Should be no.)
- [ ] Does this change require more than ~1ms of compute on the client? (Should be no.)
- [ ] Could this feature be implemented as a new Layer 2 endpoint with no MCP changes? (Usually yes — and that's the right move.)
- [ ] Does this change introduce any background work, intervals, or scheduled tasks? (Should be no.)
- [ ] Does this change inspect or scan any content (skill bodies, prompts, responses)? (Should be no.)
- [ ] Does this change retain data across sessions? (Should be no, beyond the agent_id.)

### Quarterly audit

Run a quarterly audit of `packages/mcp-server/src/`:

1. Total lines of code (current baseline: ~1,849 lines)
2. Number of tools (current: 14)
3. Largest non-tool file (currently `self-log.ts` at 100 lines)
4. Any file growth >25% since last audit triggers review

Growth is fine if it's HTTP plumbing or new tool wiring. Growth driven by analysis logic is a red flag.

### When in doubt

The default answer to "should this go in the MCP?" is **no**. Make Tethral prove it must be local before adding logic to the client.

---

## Dependencies and side effects

This principle has implications across the codebase:

1. **Layer 2 endpoints must be richer.** Every "I wish the MCP could..." should become a new Layer 2 endpoint. This is documented in `proposals/layer2-endpoint-audit.md`.
2. **The SDK packages (`@tethral/acr-sdk`, `tethral-acr`) follow the same principle.** They're thin clients too.
3. **The ACR dashboard is a thin client.** The dashboard renders data from the API. It doesn't compute anything.
4. **Tethral's compute lives in Layer 2 and Layer 3.** That's where the value (and the cost) accumulates.

---

## Why this is the right tradeoff

**It costs us flexibility on the client side.** Adding a new "local feature" requires a server change. That's slower than just patching the MCP.

**It buys us correctness, scale, and trust.**

- **Correctness:** one source of truth for every computation. No drift between SDKs.
- **Scale:** the MCP doesn't get slower as the product gets smarter. New lenses ship as server changes; clients pick them up automatically.
- **Trust:** users can audit the MCP source code in 2,000 lines and verify it does nothing surprising. The product's depth lives behind the API where Tethral controls it.
- **Observer integrity:** the sensor stays cheap, so the signals it captures stay clean.
- **Tier coherence:** tier upgrades are invisible to the client. No "this feature requires MCP version X" friction.

This is the same architectural pattern New Relic, Datadog, Sentry, and every credible observability product uses. The agent (their SDK, our MCP) is the boring part. The intelligence is in the back.

---

## Revision policy

This principle is **immutable** without explicit Tethral leadership review. If you find yourself wanting to add analysis logic to the MCP:

1. Re-read this document.
2. Propose a Layer 2 endpoint instead.
3. If the Layer 2 endpoint is impossible, write a memo explaining why and what the implications would be for trust, performance, and tier coherence.
4. Schedule a review with the team before any code changes.

The principle exists precisely to prevent gradual erosion. Each individual exception will look reasonable. The cumulative effect destroys the architecture.

---

## Related documents

- `proposals/layer2-endpoint-audit.md` — full Layer 2 endpoint roadmap
- `proposals/positioning-audit.md` — product framing and reframe
- `packages/mcp-server/src/server.ts` — current MCP server implementation
- `packages/mcp-server/src/middleware/self-log.ts` — the canonical example of what "thin" looks like

---

## Sign-off

Approved for ACR architecture, 2026-04-10.

This is the thin-client invariant. It is not a guideline. It is not a default. It is the architecture.
