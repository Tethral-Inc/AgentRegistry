#!/usr/bin/env node
/**
 * @tethral/acr-hook — Claude Code transport-boundary observer.
 *
 * Configured as a Claude Code PreToolUse + PostToolUse hook pair.
 * On each tool call:
 *   - pre:  records start timestamp keyed by session_id
 *   - post: reads the start timestamp, maps tool_name to a target
 *           system_id, and emits a receipt with source='claude-code-hook'
 *
 * Claude Code pipes the hook payload as JSON on stdin. We never write
 * to stdout/stderr (would interleave with the tool's output) and always
 * exit 0 so an ACR hiccup never blocks a tool call.
 *
 * Example config in ~/.claude/settings.json:
 *   {
 *     "hooks": {
 *       "PreToolUse":  [{ "matcher": ".*", "hooks": [["npx", "@tethral/acr-hook", "pre"]] }],
 *       "PostToolUse": [{ "matcher": ".*", "hooks": [["npx", "@tethral/acr-hook", "post"]] }]
 *     }
 *   }
 */
import { readState, recordStart, consumeStart } from './state.js';
import { mapTool, summarizeToolInput } from './map-tool.js';
import { postReceipt, type HookReceipt } from './http.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // Hooks must be quick — if stdin hangs for >2s, resolve anyway.
    setTimeout(() => resolve(data), 2000).unref();
  });
}

interface HookPayload {
  session_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

async function parsePayload(): Promise<HookPayload | null> {
  const raw = await readStdin();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return null;
  }
}

function isFailureResponse(resp: unknown): boolean {
  if (!resp || typeof resp !== 'object') return false;
  const obj = resp as Record<string, unknown>;
  // Claude Code surfaces errors under a few keys depending on tool.
  if (obj.is_error === true) return true;
  if (typeof obj.error === 'string' && obj.error.length > 0) return true;
  return false;
}

async function cmdPre(): Promise<void> {
  const payload = await parsePayload();
  if (!payload?.session_id || !payload.tool_name) return;
  recordStart(payload.session_id, {
    tool_name: payload.tool_name,
    start_ms: Date.now(),
    tool_input_summary: summarizeToolInput(payload.tool_input),
  });
}

async function cmdPost(): Promise<void> {
  const state = readState();
  if (!state) return;

  const payload = await parsePayload();
  if (!payload?.session_id || !payload.tool_name) return;

  const inflight = consumeStart(payload.session_id, payload.tool_name);
  const nowMs = Date.now();
  const startMs = inflight?.start_ms ?? null;
  const durationMs = startMs !== null ? nowMs - startMs : null;

  const mapped = mapTool(payload.tool_name, payload.tool_input);
  const failed = isFailureResponse(payload.tool_response);

  const receipt: HookReceipt = {
    emitter: {
      agent_id: state.agent_id,
      provider_class: 'anthropic',
    },
    target: {
      system_id: mapped.target_system_id,
      system_type: mapped.target_system_type,
    },
    interaction: {
      category: mapped.category,
      status: failed ? 'failure' : 'success',
      request_timestamp_ms: startMs ?? nowMs,
      response_timestamp_ms: nowMs,
      duration_ms: durationMs,
    },
    anomaly: { flagged: false },
    source: 'claude-code-hook',
    categories: {
      ...(mapped.activity_class ? { activity_class: mapped.activity_class } : {}),
      ...(mapped.interaction_purpose ? { interaction_purpose: mapped.interaction_purpose } : {}),
      ...(mapped.data_shape ? { data_shape: mapped.data_shape } : {}),
      tool_name: payload.tool_name,
    },
  };

  await postReceipt(state.api_url, state.api_key, receipt);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  try {
    if (command === 'pre') await cmdPre();
    else if (command === 'post') await cmdPost();
    else if (command === '--help' || command === '-h') {
      process.stderr.write(
        'Usage: acr-hook {pre|post}\n' +
        '  Emits ACR receipts for Claude Code tool calls.\n' +
        '  Configure as PreToolUse + PostToolUse hooks in ~/.claude/settings.json.\n',
      );
    }
  } catch {
    // Fire-and-forget: never let hook errors surface to the host.
  }
}

main().catch(() => { /* swallow */ });
