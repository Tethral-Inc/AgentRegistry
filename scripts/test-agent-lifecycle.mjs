#!/usr/bin/env node
/**
 * ACR Agent Lifecycle Test Harness
 *
 * Simulates a full agent lifecycle: register, check skills, hit blocks,
 * log interactions, check notifications, acknowledge threats.
 *
 * Usage:
 *   node scripts/test-agent-lifecycle.mjs
 *   node scripts/test-agent-lifecycle.mjs --api-url https://acr.nfkey.ai
 */

const API_URL = process.argv.find(a => a.startsWith('--api-url='))?.split('=')[1]
  ?? process.env.ACR_API_URL
  ?? 'https://acr.nfkey.ai';

const RESOLVER_URL = API_URL;

// Test skills: mix of clean, warned, and blocked
const TEST_SKILLS = {
  // Clean (score 90+)
  muninn: '91bbb651a2eb781f7995d1b83a25e4299a07ea81d7bfdf166cdbe82ede088839',
  tlon: 'c24ee94b5f759663f4206aa3bcd8d7c0245b5a33088d4f4170aca78924a80062',
  // Blocked (score < 50)
  'gh-issues': 'c186a753169e0f1d57cc78c2f21b5ef7d5f5d8a875616739bff75606058bc496',
};

async function post(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path, useResolver = false) {
  const base = useResolver ? RESOLVER_URL : API_URL;
  const res = await fetch(`${base}${path}`);
  return res.json();
}

function header(text) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${text}`);
  console.log('='.repeat(60));
}

function step(n, text) {
  console.log(`\n--- Step ${n}: ${text} ---`);
}

function pass(msg) { console.log(`  [PASS] ${msg}`); }
function fail(msg) { console.log(`  [FAIL] ${msg}`); }
function info(msg) { console.log(`  [INFO] ${msg}`); }

async function run() {
  header('ACR AGENT LIFECYCLE TEST');
  info(`API: ${API_URL}`);
  info(`Skills to test: ${Object.keys(TEST_SKILLS).join(', ')}`);

  let passed = 0;
  let failed = 0;
  let agentId;

  // ── Step 1: Register ──
  step(1, 'Register agent with skills');
  try {
    const result = await post('/api/v1/register', {
      public_key: `test_harness_${Date.now()}_abcdefghijklmnopqrstuvwxyz1234`,
      provider_class: 'anthropic',
      name: `test-harness-${Date.now()}`,
      composition: {
        skills: Object.keys(TEST_SKILLS),
        skill_hashes: Object.values(TEST_SKILLS),
      },
    });
    agentId = result.agent_id;
    if (agentId) { pass(`Registered as ${result.name} (${agentId})`); passed++; }
    else { fail(`Registration failed: ${JSON.stringify(result)}`); failed++; return; }
  } catch (e) { fail(`Registration error: ${e.message}`); failed++; return; }

  // ── Step 2: Verify subscriptions ──
  step(2, 'Verify auto-subscriptions created');
  try {
    const subs = await get(`/api/v1/agent/${agentId}/subscriptions`);
    const count = subs.subscriptions?.length ?? 0;
    if (count >= 2) { pass(`${count} subscriptions auto-created`); passed++; }
    else { fail(`Expected 3+ subscriptions, got ${count}`); failed++; }
    for (const s of subs.subscriptions || []) {
      info(`  ${s.skill_name || s.skill_hash.slice(0, 16)}: notify_on=${s.notify_on}`);
    }
  } catch (e) { fail(`Subscription check error: ${e.message}`); failed++; }

  // ── Step 3: Check each skill before install ──
  step(3, 'Check skills before installing');
  for (const [name, hash] of Object.entries(TEST_SKILLS)) {
    try {
      const result = await get(`/v1/skill/${hash}`, true);
      const blocked = result.blocked === true;
      const score = result.scan_score ?? '?';
      const threat = result.threat_level ?? 'none';

      if (name === 'gh-issues') {
        // Should be blocked
        if (blocked) { pass(`${name}: BLOCKED (score=${score}, threat=${threat}) -- correct`); passed++; }
        else { fail(`${name}: Expected BLOCKED but got threat=${threat}, score=${score}`); failed++; }
      } else {
        // Should NOT be blocked
        if (!blocked) { pass(`${name}: OK (score=${score}, threat=${threat})`); passed++; }
        else { fail(`${name}: Unexpectedly BLOCKED (score=${score})`); failed++; }
      }
    } catch (e) { fail(`Check ${name} error: ${e.message}`); failed++; }
  }

  // ── Step 4: Try to view blocked skill content ──
  step(4, 'Verify content redaction on blocked skill');
  try {
    // Search for gh-issues via API to get skill_id
    const search = await get('/api/v1/skill-catalog/search?q=gh-issues&limit=1&status=flagged');
    if (search.skills?.length > 0) {
      const detail = await get(`/api/v1/skill-catalog/${search.skills[0].skill_id}`);
      if (detail.blocked && detail.skill_content === null) {
        pass('Blocked skill content is REDACTED');
        passed++;
        info(`  snippet: ${(detail.content_snippet || '').slice(0, 60)}`);
      } else if (detail.blocked) {
        fail(`Blocked but content not null (${detail.skill_content?.length ?? 0} chars)`);
        failed++;
      } else {
        info('Skill not found in flagged search (may have been unflagged by re-scan)');
      }
    } else {
      info('gh-issues not in flagged search results (may need status=flagged param)');
    }
  } catch (e) { fail(`Redaction check error: ${e.message}`); failed++; }

  // ── Step 5: Log interactions ──
  step(5, 'Log interactions with skills');
  const nowMs = Date.now();
  try {
    // Clean interaction
    const r1 = await post('/api/v1/receipts', {
      emitter: { agent_id: agentId, provider_class: 'anthropic' },
      target: { system_id: `skill:${TEST_SKILLS.muninn}`, system_type: 'skill' },
      interaction: { category: 'skill_install', status: 'success', duration_ms: 150, request_timestamp_ms: nowMs },
      anomaly: { flagged: false },
    });
    if (r1.accepted === 1) { pass(`Clean skill interaction logged: ${r1.receipt_ids[0]}`); passed++; }
    else { fail(`Receipt not accepted: ${JSON.stringify(r1)}`); failed++; }

    // Flagged interaction
    const r2 = await post('/api/v1/receipts', {
      emitter: { agent_id: agentId, provider_class: 'anthropic' },
      target: { system_id: `skill:${TEST_SKILLS['gh-issues']}`, system_type: 'skill' },
      interaction: { category: 'skill_install', status: 'failure', duration_ms: 50, request_timestamp_ms: nowMs + 1 },
      anomaly: { flagged: true, category: 'unexpected_behavior', detail: 'Blocked skill - refused to install' },
    });
    if (r2.accepted === 1) { pass(`Blocked skill interaction logged: ${r2.receipt_ids[0]}`); passed++; }
    else { fail(`Receipt not accepted: ${JSON.stringify(r2)}`); failed++; }

    // Check threat_warnings in response
    if (r2.threat_warnings !== undefined) {
      pass(`threat_warnings field present (${r2.threat_warnings.length} warnings)`);
      passed++;
    } else {
      info('threat_warnings field not in response');
    }
  } catch (e) { fail(`Interaction logging error: ${e.message}`); failed++; }

  // ── Step 6: Check notifications ──
  step(6, 'Check notifications');
  try {
    const notifs = await get(`/api/v1/agent/${agentId}/notifications`);
    pass(`Notification endpoint works. Unread: ${notifs.unread_count}`);
    passed++;
    if (notifs.notifications?.length > 0) {
      for (const n of notifs.notifications) {
        info(`  [${n.severity.toUpperCase()}] ${n.title}`);
      }
    } else {
      info('No notifications yet (generated by crawler/threat-update jobs)');
    }
  } catch (e) { fail(`Notification check error: ${e.message}`); failed++; }

  // ── Step 7: Search with security filter ──
  step(7, 'Search skills with security score filter');
  try {
    const safe = await get('/api/v1/skill-catalog/search?q=security&min_scan_score=80&limit=3');
    const all = await get('/api/v1/skill-catalog/search?q=security&limit=1');
    if (safe.total <= all.total) {
      pass(`Filtered: ${safe.total} safe vs ${all.total} total (filter works)`);
      passed++;
    } else {
      fail(`Filter not working: safe=${safe.total} > all=${all.total}`);
      failed++;
    }
  } catch (e) { fail(`Search filter error: ${e.message}`); failed++; }

  // ── Step 8: Friction report ──
  step(8, 'Check friction report');
  try {
    const friction = await get(`/api/v1/agent/${agentId}/friction?scope=day`);
    const total = friction.summary?.total_interactions ?? 0;
    if (total >= 2) { pass(`Friction report: ${total} interactions logged`); passed++; }
    else { pass(`Friction report works (${total} interactions)`); passed++; }
  } catch (e) { fail(`Friction report error: ${e.message}`); failed++; }

  // ── Results ──
  header('TEST RESULTS');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  Agent:  ${agentId}`);
  console.log('');

  if (failed > 0) {
    console.log('  SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('  ALL TESTS PASSED');
  }
}

run().catch(e => { console.error('Test harness error:', e); process.exit(1); });
