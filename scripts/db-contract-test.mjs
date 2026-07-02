#!/usr/bin/env node
/**
 * DB contract test — runs the real API against a real CockroachDB.
 *
 * Why this exists: unit tests mock the database, production runs CockroachDB,
 * and the SAME coverage query failed in production three consecutive times for
 * three different dialect reasons (GROUPING SETS, jsonb `!=`, float/int in
 * COALESCE) — each error hidden behind the previous one, each invisible to
 * mocked tests. This harness would have failed CI on all of them, plus the
 * multi-COUNT(DISTINCT) network-totals bug and the 000023/000024 index traps.
 *
 * What it does, against a locally-served ingestion API + single-node CRDB
 * (see the db-contract job in .github/workflows/ci.yml):
 *   1. Registers a main agent whose composition declares a test skill hash
 *      (auto-subscribes it to that skill's anomaly notifications).
 *   2. Seeds deterministic receipts through the real ingestion path.
 *   3. Registers 25 reporter agents that each flag an anomaly on the skill.
 *   4. Runs EVERY cron endpoint and asserts 2xx.
 *   5. Hits EVERY lens route and asserts 200, degraded !== true, and exact
 *      count coherence with what was seeded.
 *   6. Asserts the notification promise end-to-end: the anomaly signals must
 *      produce a skill_notifications row for the subscribed main agent.
 *
 * Env:
 *   ACR_API_URL                   (default http://localhost:3111)
 *   CRON_SECRET                   (required — must match the served API)
 *   COCKROACH_CONNECTION_STRING   (required — for seeds/asserts with no API)
 */
import { generateKeyPairSync, createPrivateKey, sign as nodeSign, createHash } from 'node:crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('../shared/node_modules/pg');

const API = (process.env.ACR_API_URL ?? 'http://localhost:3111').replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;
const DB = process.env.COCKROACH_CONNECTION_STRING;
if (!CRON_SECRET || !DB) {
  console.error('✗ set CRON_SECRET and COCKROACH_CONNECTION_STRING');
  process.exit(1);
}

const TEST_SKILL_NAME = 'contract-test-skill';
const TEST_SKILL_HASH = createHash('sha256').update('contract-test-skill-content').digest('hex');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : bad(msg));

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { _raw: text.slice(0, 300) }; }
  return { res, body };
}

function genKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'jwk' }).x,
    priv: privateKey,
  };
}

function signRegistration(kp, ts) {
  const msg = Buffer.from(`register:v1:${kp.publicKey}:${ts}`, 'utf8');
  return nodeSign(null, msg, kp.priv).toString('base64url');
}

async function register(name, composition) {
  const kp = genKeypair();
  const ts = Date.now();
  const { res, body } = await req('/api/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      public_key: kp.publicKey,
      registration_timestamp_ms: ts,
      signature: signRegistration(kp, ts),
      provider_class: 'custom',
      name,
      operational_domain: 'db-contract-test',
      composition,
    }),
  });
  if (!res.ok || !body.agent_id) throw new Error(`register ${name} failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return { agentId: body.agent_id, apiKey: body.api_key };
}

async function postReceipt(agent, receipt) {
  const now = Date.now();
  const { res, body } = await req('/api/v1/receipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': agent.apiKey },
    body: JSON.stringify({
      emitter: { agent_id: agent.agentId, provider_class: 'custom' },
      anomaly: { flagged: false },
      source: 'claude-code-hook',
      ...receipt,
      interaction: {
        category: 'tool_call',
        status: 'success',
        request_timestamp_ms: now,
        response_timestamp_ms: now + (receipt.interaction?.duration_ms ?? 100),
        duration_ms: 100,
        ...(receipt.interaction ?? {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`receipt POST failed: HTTP ${res.status} ${JSON.stringify(body)}`);
}

async function main() {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  // ── Seed: catalog row mapping the test skill's name to its hash ──
  // (the crawler owns this table in production; no public write endpoint)
  await db.query(
    `UPSERT INTO skill_catalog (skill_name, skill_source, source_url, current_hash, description)
     VALUES ($1, 'github', 'https://example.invalid/contract-test', $2, 'db-contract-test fixture')`,
    [TEST_SKILL_NAME, TEST_SKILL_HASH],
  );

  console.log('\n── Register + seed ──');
  const main = await register('db-contract-main', {
    skill_hashes: [TEST_SKILL_HASH],
    tools: ['bash', 'read'],
  });
  ok(`main agent ${main.agentId} (subscribed to ${TEST_SKILL_NAME} via composition)`);

  // 30 receipts: 24 success across 3 targets (with chains + categories),
  // 6 failures with error codes on a flaky target.
  const targets = [
    { system_id: 'platform:bash', system_type: 'platform' },
    { system_id: 'mcp:github', system_type: 'mcp_server' },
    { system_id: 'api:test-vendor.com', system_type: 'api' },
  ];
  for (let i = 0; i < 24; i++) {
    await postReceipt(main, {
      target: targets[i % 3],
      interaction: { duration_ms: 50 + i * 10, ...(i % 2 === 0 ? { chain_id: `chain-${i % 4}` } : {}) },
      categories: { activity_class: 'deterministic', interaction_purpose: 'execute' },
    });
  }
  for (let i = 0; i < 6; i++) {
    await postReceipt(main, {
      target: { system_id: 'api:flaky-vendor.com', system_type: 'api' },
      interaction: { status: 'failure', error_code: 'E429', duration_ms: 900 },
    });
  }
  ok('30 receipts seeded through /api/v1/receipts (24 ok, 6 failures)');

  // 25 distinct reporters each flag one anomaly on the NAMED skill target —
  // the notification path must resolve the name to the hash to match the
  // main agent's hash-keyed subscription.
  for (let i = 0; i < 25; i++) {
    const reporter = await register(`db-contract-reporter-${i}`, { tools: ['x'] });
    const now = Date.now();
    const { res, body } = await req('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': reporter.apiKey },
      body: JSON.stringify({
        emitter: { agent_id: reporter.agentId, provider_class: 'custom' },
        target: { system_id: `skill:${TEST_SKILL_NAME}`, system_type: 'skill' },
        interaction: {
          category: 'tool_call', status: 'success',
          request_timestamp_ms: now, response_timestamp_ms: now + 100, duration_ms: 100,
        },
        anomaly: { flagged: true, category: 'unexpected_behavior' },
        source: 'agent',
      }),
    });
    if (!res.ok) throw new Error(`reporter receipt failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  ok('25 reporter agents each flagged an anomaly on skill:' + TEST_SKILL_NAME);

  // ── Every cron endpoint must run clean ──
  console.log('\n── Cron endpoints ──');
  const crons = [
    'system-health-aggregate', 'chain-analysis', 'skill-threat-update',
    'friction-baseline-compute', 'watch-evaluation', 'pattern-detection',
    'data-archival', 'agent-expiration', 'agent-baseline-compute', 'agent-anomaly-detect',
  ];
  for (const job of crons) {
    const { res, body } = await req(`/api/cron/${job}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    assert(res.ok, `cron ${job} → ${res.status} ${res.ok ? '' : JSON.stringify(body)}`);
  }

  // ── Every lens route: 200, not degraded, coherent counts ──
  console.log('\n── Lens routes ──');
  const auth = { Authorization: `Bearer ${main.apiKey}` };
  const lens = async (path) => {
    const { res, body } = await req(`/api/v1/agent/${main.agentId}${path}`, { headers: auth });
    const label = path.split('?')[0];
    if (!res.ok) { bad(`${label} → HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`); return null; }
    if (body.degraded === true) { bad(`${label} → degraded: ${body.degraded_reason}`); return null; }
    ok(`${label} → 200, not degraded`);
    return body;
  };

  const profile = await lens('/profile');
  const friction = await lens('/friction?scope=day');
  const coverage = await lens('/coverage?source=all');
  await lens('/trend?scope=day');
  await lens('/revealed-preference?scope=day');
  const failureReg = await lens('/failure-registry?scope=day');
  await lens('/composition-diff');
  await lens('/stable-corridors?scope=day');
  await lens('/compensation?window=week');

  const { res: nsRes, body: ns } = await req('/api/v1/network/status');
  assert(nsRes.ok && ns.degraded !== true, `network/status → ${nsRes.status}, degraded=${ns.degraded}`);
  const { res: hRes, body: health } = await req('/health');
  assert(hRes.ok, `/health → ${hRes.status} (status=${health.status})`);
  assert(health.status === 'ok', `/health status is 'ok' after a fresh aggregation run (got '${health.status}' — heartbeat wiring)`);

  // Count coherence: the counts every lens reports must agree with what was
  // actually seeded. These were live-divergent (profile 1007 / coverage 0 /
  // failure-registry 15 vs friction 9) before the shared predicates.
  console.log('\n── Count coherence ──');
  if (profile) assert(profile.counts?.total_receipts === 30 || profile.total_receipts === 30,
    `profile total_receipts == 30 (got ${profile.counts?.total_receipts ?? profile.total_receipts})`);
  if (coverage) {
    assert(coverage.signals.total_receipts === 30, `coverage total_receipts == 30 (got ${coverage.signals.total_receipts})`);
    assert(coverage.signals.total_failed_receipts === 6, `coverage failed_receipts == 6 (got ${coverage.signals.total_failed_receipts})`);
    assert(coverage.signals.receipts_with_activity_class === 24, `coverage activity_class == 24 (got ${coverage.signals.receipts_with_activity_class})`);
    assert(coverage.signals.distinct_chains === 4, `coverage distinct_chains == 4 (got ${coverage.signals.distinct_chains})`);
  }
  if (friction) {
    const n = friction.summary?.total_interactions ?? friction.summary?.interactions;
    assert(n === 30, `friction day interactions == 30 (got ${n})`);
  }
  if (failureReg) {
    assert(failureReg.total_failures === 6, `failure-registry total_failures == 6 (got ${failureReg.total_failures})`);
    assert(failureReg.total_interactions === 30, `failure-registry total_interactions == 30 (got ${failureReg.total_interactions})`);
  }

  // ── The flagship promise: anomaly signals → notification for subscriber ──
  console.log('\n── Notification promise (E2E) ──');
  const notif = await db.query(
    `SELECT COUNT(*)::int AS n FROM skill_notifications
     WHERE agent_id = $1 AND skill_hash = $2 AND notification_type = 'anomaly_signal'`,
    [main.agentId, TEST_SKILL_HASH],
  );
  assert(notif.rows[0].n >= 1,
    `skill_notifications row exists for subscribed agent (got ${notif.rows[0].n}) — ` +
    `25 reporters at 100% anomaly rate on a skill the agent's composition declares MUST notify it`);

  // And it must be readable through the API the MCP uses:
  const { res: nRes, body: nBody } = await req(`/api/v1/agent/${main.agentId}/notifications`, { headers: auth });
  assert(nRes.ok && (nBody.notifications?.length ?? 0) >= 1,
    `GET /notifications returns it (HTTP ${nRes.status}, count=${nBody.notifications?.length ?? 0})`);

  await db.end();

  console.log(failures === 0 ? '\n✓ DB CONTRACT PASS' : `\n✗ DB CONTRACT FAIL — ${failures} assertion(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('✗ DB CONTRACT ERROR:', e?.stack || String(e)); process.exit(1); });
