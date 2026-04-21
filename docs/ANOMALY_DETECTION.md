# Anomaly detection — operator notes

Short ops runbook for the shadow-mode defense layers on the ingest path.
Written in April 2026 when the stack was migrated off Upstash.

## Layers, in order

1. **Schema validation** — Zod-typed request body. Malformed receipts are
   400'd before any DB hit.
2. **`optional-agent-auth`** middleware — validates the API key if one is
   sent, rejects bad/revoked keys, otherwise passes through. Writes to
   ingest endpoints stay open by design (data-collection strategy).
3. **Per-agent anomaly-on-ingest**
   - `ingest_counters`: every receipt bumps a per-`(agent_id, hour)` row.
   - `agent_quarantine`: checked on every receipt; logs a `quarantine_read`
     signal when a flagged agent emits.
   - `HARD_HOURLY_CAP` (10k/hr): absolute ceiling per agent_id. Logs a
     `volume_spike` signal when exceeded.
4. **Per-IP agent-id churn** — `ip_agent_churn` tracks distinct agent_ids
   per `(ip, hour)`. Logs a `churn_signal` when one IP declares more than
   `CHURN_THRESHOLD_PER_IP_HOUR` (default 50) unique agent_ids in an hour.
5. **Scheduled baseline + detection** — GH Actions cron hits
   `/api/cron/agent-baseline-compute` hourly and
   `/api/cron/agent-anomaly-detect` every 15 min. Baselines populate from
   the last 7 days of `ingest_counters`; detection scans the last 2 hours
   against each agent's p99 + hours_of_data >= 24 gate.

All of these are currently **shadow mode** — signals are logged, nothing
is rejected or auto-quarantined. The enforcement flip happens once we've
reviewed a week's worth of signals and tuned thresholds.

## Known blindspot: distributed-IP spray

Per-IP churn defense is defeated by an attacker rotating source IPs
(botnet, proxy chain, Tor). That is not a fix-with-code problem. The
mitigation is **Cloudflare as a proxy** sitting in front of Vercel:
- Edge-level rate limiting (free tier covers small deployments).
- Managed challenges / turnstile for high-churn IPs.
- DDoS absorption beyond Vercel's default.

Setup is ~10 min: point the ACR apex at Cloudflare, let CF proxy to
Vercel, enable Rate Limiting Rules. We have CF creds (`CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`) already set in GH secrets but no proxy active yet.

## Env vars

| Var | Where | Default | Purpose |
|---|---|---|---|
| `CRON_SECRET` | Vercel + GH Actions | unset → cron 401's | Shared secret for `/api/cron/*` |
| `INGESTION_API_URL` | GH Actions only | unset → workflow skips | Prod base URL for the cron workflow |
| `CHURN_CHECK_ENABLED` | Vercel | `true` | Kill switch for churn defense |
| `CHURN_THRESHOLD_PER_IP_HOUR` | Vercel | `50` | Unique agent_ids/hour per IP before flagging |

## Flipping shadow mode off

When ready to enforce:
1. Review logs with `grep event=` — confirm signals look real, not noisy.
2. Edit `packages/ingestion-api/src/routes/receipts.ts`:
   change `const SHADOW_MODE = true` → `false`.
3. Also edit `packages/intelligence/anomaly/agent-anomaly-detect.ts` the
   same way, and have it INSERT into `agent_quarantine` on detection.
4. Deploy. Watch `event: rate_limited` / `event: quarantine_reject` in
   logs for false-positive rate before walking away.

## Log events worth greppping

| `event:` | Fired from | Meaning |
|---|---|---|
| `quarantine_read` | receipts.ts | Live request from an agent currently in quarantine |
| `volume_spike` | receipts.ts | Agent blew past 10k/hr absolute ceiling |
| `churn_signal` | receipts.ts | One IP exceeded the agent-id churn threshold |
| `agent_anomaly_signal` | agent-anomaly-detect cron | Scheduled scan found an agent over its p99 baseline |
