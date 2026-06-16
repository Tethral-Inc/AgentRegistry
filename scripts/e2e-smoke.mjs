#!/usr/bin/env node
/**
 * ACR end-to-end smoke test.
 *
 * Closes the full loop the way a user experiences it:
 *   DO (emit a uniquely-marked receipt) -> READ it back through the
 *   DEFAULT friction lens -> ASSERT the exact marker is there.
 *
 * Why the default lens and not a raw receipt read: every silent ACR
 * outage we've hit was a *default-read* regression — the lens defaulting
 * to source='agent' and hiding hook data, the network-totals query
 * zeroing. A raw-receipt existence check would have stayed green through
 * all of them. So we emit under source='claude-code-hook' (the primary
 * capture path) and assert it surfaces with NO source param. If the
 * default ever reverts to 'agent', this marker disappears and the test
 * fails — which is the whole point.
 *
 * Modes:
 *   node scripts/e2e-smoke.mjs --provision
 *       Register one stable smoke agent and print its id + api key. Run
 *       once; store the two values as CI secrets. Reusing a single agent
 *       (instead of registering per run) keeps this test from adding to
 *       the very ephemeral-agent churn it exists to watch.
 *
 *   node scripts/e2e-smoke.mjs
 *       Requires ACR_SMOKE_AGENT_ID + ACR_SMOKE_API_KEY. Emits a marker,
 *       polls the default friction lens until it appears (or fails at the
 *       deadline). Exit 0 = loop alive, exit 1 = broken.
 *
 * Env: ACR_API_URL (default https://acr.nfkey.ai)
 */
import { generateKeyPairSync, createPrivateKey, sign as nodeSign, randomBytes } from 'node:crypto';

const API = (process.env.ACR_API_URL ?? 'https://acr.nfkey.ai').replace(/\/$/, '');
const POP_VERSION = 'v1';
const SOURCE = 'claude-code-hook'; // primary capture path — the default lens MUST include it
const READ_DEADLINE_MS = 90_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
function fail(msg) { console.error(`✗ SMOKE FAIL: ${msg}`); process.exit(1); }

/** fetch + JSON parse with retry, so cold starts / transient edge errors don't flake the test. */
async function req(url, opts = {}, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      let body;
      try { body = text ? JSON.parse(text) : {}; } catch { body = { _raw: text.slice(0, 300) }; }
      return { res, body };
    } catch (e) { lastErr = e; await sleep(1500); }
  }
  throw lastErr;
}

function genKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x;
  const priv = privateKey.export({ format: 'jwk' }).d;
  return { publicKey: pub, privateKey: priv };
}

function signRegistration(kp, ts) {
  const priv = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: kp.privateKey, x: '' }, format: 'jwk' });
  const msg = Buffer.from(`register:${POP_VERSION}:${kp.publicKey}:${ts}`, 'utf8');
  return nodeSign(null, msg, priv).toString('base64url');
}

async function provision() {
  const kp = genKeypair();
  const ts = Date.now();
  const { res, body } = await req(`${API}/api/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      public_key: kp.publicKey,
      registration_timestamp_ms: ts,
      signature: signRegistration(kp, ts),
      provider_class: 'custom',
      name: 'acr-e2e-smoke',
      operational_domain: 'acr-smoke-test',
      composition: { tools: ['e2e-smoke'] },
    }),
  });
  if (!res.ok) fail(`register HTTP ${res.status}: ${JSON.stringify(body)}`);
  if (!body.agent_id || !body.api_key) fail(`register response missing agent_id/api_key: ${JSON.stringify(body)}`);
  log('✓ Provisioned stable smoke agent. Store these as CI secrets:\n');
  log(`  ACR_SMOKE_AGENT_ID=${body.agent_id}`);
  log(`  ACR_SMOKE_API_KEY=${body.api_key}`);
  log('\n(The api_key is only returned on fresh registration — it will not be shown again.)');
}

async function check() {
  const agentId = process.env.ACR_SMOKE_AGENT_ID;
  const apiKey = process.env.ACR_SMOKE_API_KEY;
  if (!agentId || !apiKey) fail('set ACR_SMOKE_AGENT_ID and ACR_SMOKE_API_KEY (run with --provision once to mint them)');

  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const marker = `api:smoke-${runId}`;
  const t0 = Date.now();

  // ── DO: emit the marked receipt through the real ingestion path ──
  const now = Date.now();
  const { res: pr, body: pb } = await req(`${API}/api/v1/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      emitter: { agent_id: agentId, provider_class: 'custom' },
      target: { system_id: marker, system_type: 'api' },
      interaction: {
        category: 'tool_call', status: 'success',
        request_timestamp_ms: now, response_timestamp_ms: now + 1234, duration_ms: 1234,
      },
      anomaly: { flagged: false },
      source: SOURCE,
      categories: { interaction_purpose: 'smoke', target_type: 'api.smoke' },
    }),
  });
  if (!pr.ok) fail(`receipt POST HTTP ${pr.status}: ${JSON.stringify(pb)}`);
  log(`→ emitted ${marker} (source=${SOURCE}) under ${agentId}`);

  // ── READ: poll the DEFAULT friction lens (no source param) for the marker ──
  let attempt = 0, lastSummary = null;
  while (Date.now() - t0 < READ_DEADLINE_MS) {
    attempt++;
    const { res, body } = await req(
      `${API}/api/v1/agent/${agentId}/friction?scope=session`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (res.ok && body?.summary) {
      lastSummary = body.summary;
      const targets = (body.top_targets ?? []).map((t) => t.target_system_id);
      const sources = (body.by_source ?? []).map((s) => s.source);
      if (targets.includes(marker)) {
        log(`✓ SMOKE PASS: marker read back through the DEFAULT friction lens in ` +
            `${((Date.now() - t0) / 1000).toFixed(1)}s (attempt ${attempt})`);
        log(`  default source resolved to: [${sources.join(', ')}] — includes '${SOURCE}' ✓`);
        process.exit(0);
      }
    }
    await sleep(3000);
  }
  fail(`marker ${marker} never appeared in the DEFAULT friction lens within ${READ_DEADLINE_MS / 1000}s.\n` +
       `  last summary: ${JSON.stringify(lastSummary)}\n` +
       `  Likely a default-read regression (source filter / totals query) or an ingestion outage — not "quiet".`);
}

(process.argv[2] === '--provision' ? provision() : check()).catch((e) => fail(e?.stack || String(e)));
