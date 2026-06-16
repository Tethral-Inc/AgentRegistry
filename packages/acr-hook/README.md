# @tethral/acr-hook

Claude Code hook that captures what your agent does — and shows you a
readout when each session ends.

Observation at the transport boundary, no agent cooperation required. The
`pre`/`post` hooks record every tool call; the `card` hook prints a short
summary to your terminal as the session closes.

## Setup (one command)

```bash
npm install -g @tethral/acr-hook
acr-hook init
```

`init` does everything:
- **registers an identity** for you (no `@tethral/acr-mcp` required),
- **wires the hooks** into `~/.claude/settings.json` (idempotent — it won't
  duplicate, and it backs the file up first),
- **verifies the loop** by emitting a test event and reading it back.

That's it. From then on, capture runs on every tool call and a readout prints
when each session ends.

<details>
<summary>Manual config (if you'd rather not run <code>init</code>)</summary>

Add to `~/.claude/settings.json` (use the global <code>acr-hook</code> bin so
the path is stable):

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": "*", "hooks": [{ "type": "command", "command": "acr-hook pre" }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "acr-hook post" }] }],
    "SessionEnd":  [{ "matcher": "",  "hooks": [{ "type": "command", "command": "acr-hook card" }] }]
  }
}
```
</details>

## No API key to manage, no MCP required

You never generate, paste, or even see an API key. The hook self-registers on
first run — generating a signing keypair and minting an identity into
`~/.claude/.acr-state.json` — then reads that file locally to send receipts
and fetch your readout. The key never leaves your machine and there's no setup
step for it. (`@tethral/acr-mcp` shares the same identity file, so the two
interoperate, but neither requires the other.)

## The readout

At the end of a session you'll see:

```
─ ACR · today ─
  49 tool calls · 0 failures · 7% of your active time spent waiting on tools
  where the time went: bash 79% · openai.com 12% · github.com 3%
  full view → https://dashboard.acr.nfkey.ai/agents/<id>/friction?range=week#k=…
```

The `full view` link is pre-authenticated (it carries your local key in the
URL fragment, which browsers never send to a server) so it opens straight to
your dashboard with no login.

## What gets observed

Every tool call Claude Code makes, mapped to a canonical target:

| Tool                      | Target            |
|---------------------------|-------------------|
| `Bash`                    | `platform:bash`   |
| `Read` / `Write` / `Edit` | `platform:fs-*`   |
| `Grep` / `Glob`           | `platform:fs-*`   |
| `Task`                    | `agent:subagent`  |
| `WebFetch`                | `api:<hostname>`  |
| `WebSearch`               | `api:web-search`  |
| `mcp__<server>__<tool>`   | `mcp:<server>`    |

Receipts carry `source='claude-code-hook'`, the primary capture path.

## Fail-quiet by design

`pre`/`post` never block a tool call and never write to stdout/stderr —
if ACR is unreachable, the receipt is dropped rather than slowing you down.
`card` is the one command that prints (to stdout, shown by Claude Code at
session close); on any error it prints nothing rather than cluttering the
exit.
