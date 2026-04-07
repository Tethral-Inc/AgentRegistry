# ACR Deployment Runbook

## What Changed (Agent Identity & Metrics Expansion)

### Database
- **Migration 000003**: Adds `name` column (STRING, unique where not null) to `agents` table

### API (ingestion-api)
- `POST /api/v1/register` — Now accepts optional `name` field. Auto-generates `{provider}-{adjective}-{animal}` names if omitted. Returns `name` in response.
- `GET /api/v1/agent/:identifier` — **NEW**. Lookup by name OR agent_id. Returns agent profile.
- `GET /api/v1/agents` — **NEW**. List agents (paginated, filterable by `provider_class`).
- `GET /api/v1/agent/:id/friction` — Now resolves names (not just agent_ids). Response includes:
  - `name` field in root
  - `by_category` — interaction breakdown by type (tool_call, delegation, etc.)
  - `status_breakdown` per target (success/failure/timeout counts)
  - `p95_duration_ms` per target (all tiers)
  - `recent_anomalies` per target (up to 3, with category + detail)
  - `baseline_median_ms` / `baseline_p95_ms` per target (paid tier)

### MCP Server (@tethral/acr-mcp)
- `register_agent` tool — New `name` parameter
- `get_friction_report` tool — New `agent_name` parameter, expanded output with all metrics
- `get_my_agent` tool — **NEW**. Zero-config identity check.

---

## Deploy Steps

### 1. Run Migration
```bash
# Against CockroachDB
cockroach sql --url "$COCKROACH_CONNECTION_STRING" < migrations/000003_agent_name.up.sql
```
This is additive (new column, new index) — no data migration needed, no downtime.

### 2. Deploy Ingestion API
```bash
cd packages/ingestion-api
vercel --prod
```
Or push to the branch that triggers Vercel auto-deploy.

**Verify:**
```bash
# Health check
curl https://acr.nfkey.ai/api/v1/health

# Register with a name
curl -X POST https://acr.nfkey.ai/api/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"test_00000000000000000000000000000001","provider_class":"custom","name":"test-deploy-check"}'
# Should return: { "agent_id": "acr_...", "name": "test-deploy-check", ... }

# Lookup by name
curl https://acr.nfkey.ai/api/v1/agent/test-deploy-check
# Should return agent profile

# List agents
curl https://acr.nfkey.ai/api/v1/agents
# Should return { "agents": [...], "limit": 20, "offset": 0 }

# Friction by name
curl https://acr.nfkey.ai/api/v1/agent/test-deploy-check/friction?scope=week
# Should return friction report with name field and by_category
```

### 3. Publish MCP Server
```bash
cd packages/mcp-server
npm version patch
npm publish
```

**Verify locally:**
```json
{
  "mcpServers": {
    "acr": {
      "command": "npx",
      "args": ["@tethral/acr-mcp"]
    }
  }
}
```
Then in Claude: call `get_my_agent` — should return your name and ID.

---

## Rollback

### Migration
```bash
cockroach sql --url "$COCKROACH_CONNECTION_STRING" < migrations/000003_agent_name.down.sql
```
Drops the `name` column. Existing agents are unaffected (name was nullable).

### API
Redeploy previous commit. The API is backward-compatible — old clients that don't send `name` still work (auto-generated).

### MCP Server
```bash
npm unpublish @tethral/acr-mcp@<new-version>
# or pin previous version
```

---

## What Users See Now

### Before (opaque)
```
Agent ID: acr_662862c51f11
```

### After (human-readable)
```
Name: unknown-amber-fox
Agent ID: acr_662862c51f11
Provider: unknown
Status: active
```

### Friction Report — Before
```
Total interactions: 2
Total wait time: 1.9s
Top: mcp:github — 100% of wait, 2 calls, median 925ms
```

### Friction Report — After
```
── Summary ──
  Interactions: 2
  Total wait: 1.9s
  Friction: 0.00% of active time
  Failures: 0 (0.0% rate)

── By Category ──
  tool_call: 2 calls, 1.9s total, avg 925ms

── Top Targets ──
  mcp:github (mcp_server)
    2 calls | 100.0% of wait time
    median 925ms | p95 1200ms
    statuses: success: 2
```

---

## Existing Agent Backfill

Agents registered before this deploy have `name = NULL`. They still work — friction reports, receipts, everything keyed on `agent_id` is unchanged. To backfill names:

```sql
-- Preview what names would be generated (dry run)
SELECT agent_id, provider_class FROM agents WHERE name IS NULL;

-- Names must be set via re-registration or a manual UPDATE
-- Example: manually name an existing agent
UPDATE agents SET name = 'my-prod-agent' WHERE agent_id = 'acr_662862c51f11';
```
