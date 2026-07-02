/**
 * `acr-hook init` — one-command setup.
 *
 *   1. Ensure an identity exists (self-register if needed; no MCP required).
 *   2. Wire the Pre/Post/SessionEnd hooks into ~/.claude/settings.json
 *      (idempotent — won't duplicate; backs the file up first).
 *   3. Smoke-check the loop: emit a marker and read it back through the
 *      default friction lens.
 *
 * Writes a human-readable summary to stdout (a deliberate CLI command — the
 * capture hooks stay silent; only init and card print).
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ensureIdentity } from './register.js';
import { postReceipt, type HookReceipt } from './http.js';
import { writeState, type AcrState } from './state.js';

const API_URL = process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';
const DASHBOARD = 'https://dashboard.acr.nfkey.ai';
const out = (s = '') => process.stdout.write(s + '\n');

/** Absolute path to this installed cli.js, so the hook config is fast (no
 *  npx resolution per tool call) and pinned to the installed version. */
function cliPath(): string {
  return fileURLToPath(new URL('./cli.js', import.meta.url));
}

interface SettingsResult { added: string[]; already: string[]; npxWarning: boolean }

function configureSettings(path: string): SettingsResult {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });

  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
  }
  settings.hooks ??= {};

  const events: Array<[event: string, matcher: string, sub: string]> = [
    ['PreToolUse', '*', 'pre'],
    ['PostToolUse', '*', 'post'],
    ['SessionEnd', '', 'card'],
  ];
  const added: string[] = [];
  const already: string[] = [];
  for (const [event, matcher, sub] of events) {
    settings.hooks[event] ??= [];
    const arr: any[] = settings.hooks[event];
    const present = arr.some((g) => (g?.hooks ?? []).some(
      (h: any) => typeof h?.command === 'string' && h.command.includes('acr-hook'),
    ));
    if (present) { already.push(event); continue; }
    arr.push({ matcher, hooks: [{ type: 'command', command: `node ${path} ${sub}` }] });
    added.push(event);
  }

  // Only touch settings.json when there's an actual change — and back it up
  // first so a bad edit is always restorable.
  if (added.length > 0) {
    if (existsSync(settingsPath)) copyFileSync(settingsPath, settingsPath + '.bak');
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  // If we're running from an npx cache the absolute path is ephemeral and
  // the hooks will break when the cache is pruned. Flag it.
  const npxWarning = /[\\/]_npx[\\/]/.test(path);
  return { added, already, npxWarning };
}

async function verifyLoop(state: AcrState): Promise<boolean> {
  const marker = `api:init-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now = Date.now();
  const receipt: HookReceipt = {
    emitter: { agent_id: state.agent_id, provider_class: 'anthropic' },
    target: { system_id: marker, system_type: 'api' },
    interaction: { category: 'tool_call', status: 'success', request_timestamp_ms: now, response_timestamp_ms: now + 1, duration_ms: 1 },
    anomaly: { flagged: false },
    source: 'claude-code-hook',
    categories: { interaction_purpose: 'init-check' },
  };
  if (!(await postReceipt(state.api_url, state.api_key, receipt))) return false;

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const headers: Record<string, string> = {};
      if (state.api_key) headers['Authorization'] = `Bearer ${state.api_key}`;
      const res = await fetch(
        `${state.api_url}/api/v1/agent/${encodeURIComponent(state.agent_id)}/friction?scope=session`,
        { headers },
      );
      if (res.ok) {
        const data = await res.json();
        if ((data?.top_targets ?? []).some((t: any) => t.target_system_id === marker)) return true;
      }
    } catch { /* transient — retry */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

/**
 * `acr-hook remove` — clean uninstall of the capture hooks.
 *
 * Strips every acr-hook entry from ~/.claude/settings.json (backing the file
 * up first) and leaves everything else untouched. The identity file
 * (~/.claude/.acr-state.json) is kept so re-running init restores the same
 * agent; delete it manually to abandon the identity. Trust plumbing for an
 * always-on telemetry hook: leaving must be as easy as joining.
 */
export function cmdRemove(): void {
  out('acr-hook remove');
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    out('  • no ~/.claude/settings.json — nothing to remove.');
    return;
  }
  let settings: Record<string, any>;
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {
    out('  ✗ settings.json is not valid JSON — not touching it.');
    process.exitCode = 1;
    return;
  }

  let removed = 0;
  const hooks: Record<string, any[]> = settings.hooks ?? {};
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((g) => !(g?.hooks ?? []).some(
      (h: any) => typeof h?.command === 'string' && h.command.includes('acr-hook'),
    ));
    removed += arr.length - kept.length;
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  if (removed === 0) {
    out('  • no acr-hook entries found — nothing to remove.');
    return;
  }
  copyFileSync(settingsPath, settingsPath + '.bak');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  out(`  ✓ removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'} (backup at settings.json.bak)`);
  out('  • identity kept at ~/.claude/.acr-state.json — delete it to abandon the agent identity.');
}

export async function cmdInit(): Promise<void> {
  out('acr-hook init');

  // 1. identity (no MCP needed)
  const state = await ensureIdentity(API_URL);
  if (!state) {
    out('  ✗ could not establish an ACR identity (offline?). Re-run when online.');
    process.exitCode = 1;
    return;
  }
  out(`  ✓ identity ready: ${state.agent_id}`);

  // 2. settings.json
  const { added, already, npxWarning } = configureSettings(cliPath());
  if (added.length) out(`  ✓ wired hooks: ${added.join(', ')}`);
  if (already.length) out(`  • already configured: ${already.join(', ')}`);
  if (npxWarning) {
    out('  ! running via npx — the hook path points at a temporary cache that may be pruned.');
    out('    Install globally so it persists:  npm install -g @tethral/acr-hook && acr-hook init');
  }

  // 3. verify the loop
  out('  … verifying capture loop');
  const ok = await verifyLoop(state);
  out(ok
    ? '  ✓ loop verified — a test event was captured and read back'
    : '  ✗ could not confirm the loop within 30s (capture may still work; check again later)');

  // 4. TTFR funnel: stamp the init moment (first init only — re-running init
  // must not reset the clock) and emit a funnel receipt so the init→first-card
  // conversion is measurable with ACR's own data. Best-effort, never blocks.
  if (!state.init_at) {
    state.init_at = Date.now();
    try { writeState(state); } catch { /* read-only home — funnel just won't persist */ }
  }
  const fnow = Date.now();
  await postReceipt(state.api_url, state.api_key, {
    emitter: { agent_id: state.agent_id, provider_class: 'anthropic' },
    target: { system_id: 'platform:acr-funnel', system_type: 'platform' },
    interaction: { category: 'tool_call', status: 'success', request_timestamp_ms: fnow, response_timestamp_ms: fnow + 1, duration_ms: 1 },
    anomaly: { flagged: false },
    source: 'claude-code-hook',
    categories: { funnel_stage: 'init', loop_verified: String(ok) },
  }).catch(() => { /* funnel is telemetry, not a gate */ });

  out('');
  out('Done. A readout prints at the end of each session.');
  out(`Dashboard → ${DASHBOARD}/agents/${encodeURIComponent(state.agent_id)}/friction?range=week` +
      (state.api_key ? `#k=${encodeURIComponent(state.api_key)}` : ''));
  if (!ok) process.exitCode = 1;
}
