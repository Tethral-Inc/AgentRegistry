# ACR MCP Server — Marketplace Submission Queue

Package: `@tethral/acr-mcp@1.0.0` (already published to npm)
Repo: https://github.com/theAnthropol/AgentRegistry

## 1. Official MCP Registry

**Status:** `server.json` generated at `packages/mcp-server/server.json`

**Your steps (manual, one-time):**

```bash
# Install publisher CLI (choose one)
brew install mcp-publisher
# or: curl -L https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher-$(uname -s)-$(uname -m).tar.gz | tar xz

# From packages/mcp-server directory
cd packages/mcp-server

# Authenticate as the GitHub user/org that matches the namespace
# mcpName is "io.github.tethral-inc/acr" — auth must match tethral-inc
mcp-publisher login github

# Publish
mcp-publisher publish

# Verify
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.tethral-inc/acr"
```

**Namespace note:** The `mcpName` in `package.json` is `io.github.tethral-inc/acr`. You need to authenticate as someone with access to the `tethral-inc` GitHub org. If `tethral-inc` doesn't exist as a GitHub org/user, change `mcpName` to match your actual GitHub namespace (e.g. `io.github.theAnthropol/acr`) and regenerate `server.json`.

---

## 2. Smithery

**Your steps (manual):**

Option A — URL method (if you have an HTTP deployment):
```bash
smithery mcp publish "https://acr.nfkey.ai/mcp" -n tethral/acr
```

Option B — GitHub-based:
1. Go to https://smithery.ai/new
2. Sign in with GitHub
3. Point it at `theAnthropol/AgentRegistry`, subfolder `packages/mcp-server`
4. Smithery will read `package.json` and auto-configure

Smithery auto-discovers schemas from MCP servers, so no extra config file is strictly required.

---

## 3. Glama

**Status:** `glama.json` generated at `packages/mcp-server/glama.json`

**Your steps (manual):**

1. Commit and push `glama.json` to the repo root of `theAnthropol/AgentRegistry`
   - NOTE: Glama expects it at the REPO ROOT, not in the subfolder. You may need to move it or add a second copy at the root.
2. Go to https://glama.ai/mcp/servers
3. Click "Add Server"
4. Sign in with GitHub
5. Select `theAnthropol/AgentRegistry`
6. Glama will run security scans and create a listing

Glama also auto-discovers many MCP servers from npm/GitHub, so your server may already appear.

---

## 4. mcp.so

**Your steps (manual):**

1. Go to https://github.com/chatmcp/mcpso/issues (or search for "mcp.so GitHub")
2. Create a new issue using their "Submit MCP Server" template
3. Paste the issue body below

**Issue body (copy-paste):**

```markdown
## Submission: ACR — Agent Composition Records

**Name:** ACR (Agent Composition Records)
**Package:** `@tethral/acr-mcp`
**Repository:** https://github.com/theAnthropol/AgentRegistry
**Homepage:** https://acr.nfkey.ai
**License:** MIT

### Description
Observability and threat detection for AI agents. The ACR MCP server lets agents log every external interaction, retrieve friction reports (what's costing them the most time), check skills for known threats, track agent identity across sessions, and explore the agent interaction graph across providers.

### Features
- **Interaction logging** — `log_interaction` records every external call with timing, status, chain tracking, and anomaly flags
- **Friction reports** — `get_friction_report` shows bottlenecks by target, category, retry overhead, and chain analysis
- **Threat detection** — `check_entity` and `check_environment` verify skills against the ACR network before installation
- **Agent identity** — `get_my_agent` provides zero-config agent identity that persists across sessions
- **Network dashboard** — `get_network_status` surfaces cross-agent health and active threats

### Installation
```json
{
  "mcpServers": {
    "acr": {
      "command": "npx",
      "args": ["-y", "@tethral/acr-mcp@1.0.0"]
    }
  }
}
```

### Categories
- Observability
- Security
- Agent Infrastructure

Zero config required. Agents auto-register on first tool call.
```

---

## Order of operations

1. **First:** Resolve the `mcpName` namespace question (is `tethral-inc` a real GitHub org you control?)
2. **Second:** Publish to Official Registry (highest credibility)
3. **Third:** Publish to Smithery (largest audience)
4. **Fourth:** Submit Glama + mcp.so in parallel (auto-discovery may have already listed you)
