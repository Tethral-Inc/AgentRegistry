#!/usr/bin/env node
/**
 * ACR Claude Code Plugin — composition sync CLI.
 *
 * Usage:
 *   npx @tethral/acr-claude-code-plugin sync
 *
 * Designed to run as a Claude Code PostToolUse hook. Fire-and-forget:
 * always exits 0, never blocks the host, never prints to stdout/stderr.
 *
 * Hook configuration in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": ".*",
 *       "hooks": [["npx", "@tethral/acr-claude-code-plugin", "sync"]]
 *     }]
 *   }
 * }
 */
import { readState, writeStateMerged } from './state.js';
import { scanComposition } from './scanner.js';
import { computeCompositionHash } from './hash.js';
import { postComposition } from './http.js';

const DEBOUNCE_MS = 60_000;

async function sync(): Promise<void> {
  const state = readState();
  if (!state) return;

  // Timestamp-only debounce first — avoids scanning on the hot path.
  // The common case (tool call within 60s, no composition change) exits
  // after a single file read.
  const now = Date.now();
  if (state.last_sync_ts && now - state.last_sync_ts < DEBOUNCE_MS) {
    return;
  }

  // Debounce expired — scan and hash the full composition
  const composition = scanComposition(process.cwd());
  const hash = computeCompositionHash([
    ...composition.skill_hashes,
    ...composition.mcps,
  ]);

  if (hash === state.last_composition_hash) {
    // Composition unchanged — bump timestamp so we don't rescan for 60s
    writeStateMerged(state, { last_sync_ts: now });
    return;
  }

  const ok = await postComposition(state.api_url, state.agent_id, composition);
  if (ok) {
    writeStateMerged(state, { last_composition_hash: hash, last_sync_ts: now });
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'sync') {
    await sync();
  } else if (command === '--help' || command === '-h') {
    process.stderr.write(
      'Usage: acr-claude-code-plugin sync\n' +
      '  Scans Claude Code config and posts composition to ACR.\n' +
      '  Designed for PostToolUse hooks. Fire-and-forget.\n',
    );
  }
}

main().catch(() => {});
