# Add `priorityHint` to Tool Annotations for Client-Side Loading and Discovery

## Problem

As MCP adoption grows, users connect multiple servers simultaneously. Hosts face a context budget problem: loading full JSON schemas for every tool from every server consumes significant context window space. The common solution is lazy/deferred loading -- listing tools by name but withholding full schemas until needed.

This creates a discovery and selection problem:

- **The model doesn't know what it doesn't know.** Deferred tools may be listed by name only, without schemas or descriptions. Models routinely fail to discover deferred tools and incorrectly tell users "that tool isn't available" -- even when the tools are loaded and functional.
- **All tools are treated equally.** A server's core tool (e.g., `log_interaction` for an observability server) is deferred the same as a rarely-used admin tool. Hosts have no signal to prioritize loading or selection.
- **Tool selection across servers is blind.** When multiple servers expose tools that could match a query, hosts have no way to rank them by importance to each server's purpose.
- **Users bear the cost.** When models fail to discover tools, users restart sessions, reinstall servers, and file bugs -- all for a discovery problem, not a real failure.

This is not theoretical. In testing with one host, three consecutive new sessions failed to discover tools from a 14-tool MCP server because all tools were deferred identically. The tools were available the entire time. The user restarted three times before the issue was identified as a discovery problem, not a server problem.

## Existing Precedent

The MCP spec already defines a `priority` field on **content annotations** (resources, prompts, tool result content):

```json
{
  "annotations": {
    "audience": ["user", "assistant"],
    "priority": 0.9
  }
}
```

Where `priority` is a float from 0 to 1 (1 = most important, 0 = least important). This proposal extends the same concept to tool definitions.

## Proposal

Add an optional `priorityHint` field to `ToolAnnotations`:

```typescript
type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  priorityHint?: number;  // NEW: 0.0 to 1.0, default undefined
};
```

### Semantics

| Value | Meaning | Host Behavior (suggested) |
|-------|---------|--------------------------|
| `0.8 - 1.0` | Core tool, essential to the server's purpose | SHOULD eagerly load full schema; SHOULD NOT defer |
| `0.4 - 0.7` | Standard tool, regularly used | MAY defer; SHOULD include in search index with description |
| `0.0 - 0.3` | Auxiliary/admin tool, rarely needed | MAY defer aggressively |
| `undefined` | No preference | Host applies its own default strategy |

### Example

An observability MCP server might annotate tools like:

```json
{
  "tools": [
    {
      "name": "log_interaction",
      "description": "Log every external call for friction reports and threat detection",
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "priorityHint": 0.9
      }
    },
    {
      "name": "get_friction_report",
      "description": "Get analysis of what costs the agent the most time",
      "annotations": {
        "readOnlyHint": true,
        "priorityHint": 0.7
      }
    },
    {
      "name": "acknowledge_threat",
      "description": "Acknowledge a reviewed threat notification",
      "annotations": {
        "readOnlyHint": false,
        "priorityHint": 0.3
      }
    }
  ]
}
```

## Host Behavior (Non-Normative)

Hosts SHOULD use `priorityHint` as one input to their loading and selection strategies. Suggested behaviors:

1. **Eager loading:** Tools with `priorityHint >= 0.8` SHOULD have their full schema included in the initial context, even when other tools are deferred.
2. **Search indexing:** Tools with `priorityHint >= 0.4` SHOULD include their description (not just name) in any deferred tool index.
3. **Budget allocation:** When a host has a limited context budget for tool schemas, `priorityHint` provides a sorting signal across servers.
4. **Tool selection:** When multiple tools across servers could match a model's query, `priorityHint` helps the host surface tools that are central to a server's purpose over auxiliary ones.
5. **Per-server caps:** To prevent abuse, hosts MAY cap the number of eagerly-loaded tools per server (e.g., a maximum of 3-5 tools with `priorityHint >= 0.8` per server, regardless of how many the server declares).
6. **No guarantees:** Like all annotations, `priorityHint` is advisory. Hosts MAY ignore it, especially from untrusted servers.

## Interim Adoption via `_meta`

Servers that want to signal priority today -- before spec adoption -- can use the `_meta` extensibility field:

```json
{
  "name": "log_interaction",
  "annotations": { "readOnlyHint": false, "destructiveHint": false },
  "_meta": { "priorityHint": 0.9 }
}
```

This is a pragmatic stopgap. Hosts won't read it without custom logic, but it lets server authors declare intent now and migrate to the standardized field later.

## Why Not Just Use `_meta`?

- `_meta` keys are not standardized -- each host would need custom logic to read them
- This is a cross-cutting concern affecting all MCP servers and all hosts
- The precedent exists in content annotations -- this is a natural extension
- Standardization ensures interoperability without per-vendor coordination

## Security Considerations

- `priorityHint` is advisory and MUST NOT be used for security decisions
- Untrusted servers could set all tools to `priorityHint: 1.0` -- hosts SHOULD apply per-server caps (e.g., max 3-5 eagerly-loaded tools per server) to bound context consumption
- A malicious server inflating `priorityHint` to monopolize context budget is analogous to a server declaring excessive tools -- hosts already need strategies for this
- Hosts SHOULD treat `priorityHint` the same as other annotation hints: useful input, not a guarantee

## Backwards Compatibility

- Fully backwards compatible -- `priorityHint` is optional
- Servers that don't set it behave exactly as today
- Hosts that don't read it behave exactly as today
- No changes to protocol messages, only to the ToolAnnotations schema

## Alternatives Considered

| Alternative | Why Not |
|------------|---------|
| Server-level priority | Too coarse -- different tools on the same server have different importance |
| Boolean `eagerHint` | Less expressive; doesn't help hosts compare across servers |
| Client-side config only | Puts burden on users; server author knows which tools are core |
| `_meta.priority` | Not standardized; requires per-host adoption |
