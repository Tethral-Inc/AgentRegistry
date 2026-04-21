#!/usr/bin/env node
/**
 * @tethral/acr-mcp-proxy — transparent MCP observer.
 *
 * Wraps a stdio MCP server. JSON-RPC traffic is forwarded unchanged in
 * both directions, but every `tools/call` round-trip also emits an ACR
 * receipt so the agent's friction profile sees the wrapped server's
 * activity without needing the server (or the agent) to cooperate.
 *
 * Usage:
 *   npx @tethral/acr-mcp-proxy --name github -- npx @modelcontextprotocol/server-github
 *
 * Flags:
 *   --name <id>    system_id to report (e.g. "github" -> "mcp:github"). If
 *                  omitted, derived from the wrapped command's basename.
 *
 * Claude Code config example:
 *   "mcpServers": {
 *     "github": {
 *       "command": "npx",
 *       "args": ["@tethral/acr-mcp-proxy", "--name", "github",
 *                "--", "npx", "@modelcontextprotocol/server-github"]
 *     }
 *   }
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import { readState } from './state.js';
import { createStreamTap, splitLines, type ReceiptEmitter } from './observer.js';
import { postReceipt, type ProxyReceipt } from './http.js';

function parseArgs(argv: string[]): { name?: string; childArgv: string[] } | null {
  // Find `--` separator; everything after is the child command.
  const idx = argv.indexOf('--');
  const ours = idx === -1 ? argv : argv.slice(0, idx);
  const childArgv = idx === -1 ? [] : argv.slice(idx + 1);
  if (childArgv.length === 0) return null;

  let name: string | undefined;
  for (let i = 0; i < ours.length; i++) {
    if (ours[i] === '--name' && i + 1 < ours.length) {
      name = ours[i + 1];
      i++;
    }
  }
  return { name, childArgv };
}

function deriveName(childArgv: string[]): string {
  // Last positional arg that looks like a server name wins. Strip
  // common prefixes: "@scope/server-", "server-", file extensions.
  for (let i = childArgv.length - 1; i >= 0; i--) {
    const part = childArgv[i];
    if (!part || part.startsWith('-')) continue;
    const base = basename(part).replace(/\.(js|mjs|ts|cjs)$/, '');
    const stripped = base
      .replace(/^@[^/]+\//, '')
      .replace(/^server-/, '')
      .replace(/-server$/, '')
      .replace(/-mcp$/, '')
      .replace(/^mcp-/, '');
    if (stripped) return stripped;
  }
  return 'unknown';
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(
      'Usage: acr-mcp-proxy [--name <id>] -- <cmd> [args...]\n' +
      '  Transparent stdio MCP proxy that emits ACR receipts for tools/call.\n' +
      '  Everything after -- is forwarded unchanged.\n',
    );
    return 0;
  }
  const parsed = parseArgs(argv);
  if (!parsed) {
    process.stderr.write('acr-mcp-proxy: no child command provided (expected `-- cmd ...`).\n');
    return 2;
  }

  const serverName = parsed.name ?? deriveName(parsed.childArgv);
  const targetSystemId = `mcp:${serverName}`;

  const state = readState();

  const [cmd, ...cmdArgs] = parsed.childArgv;
  if (!cmd) return 2;
  const child: ChildProcess = spawn(cmd, cmdArgs, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  });
  if (!child.stdin || !child.stdout) {
    process.stderr.write('acr-mcp-proxy: failed to open child stdio.\n');
    return 1;
  }
  const childStdin = child.stdin;
  const childStdout = child.stdout;

  const pendingReceipts: Promise<unknown>[] = [];

  const emit: ReceiptEmitter = ({ method, params, error, duration_ms, request_timestamp_ms }) => {
    if (!state) return; // No agent registered — just forward traffic.

    const toolName = (params && typeof params === 'object'
      ? (params as Record<string, unknown>).name
      : undefined);

    const receipt: ProxyReceipt = {
      emitter: {
        agent_id: state.agent_id,
        provider_class: 'anthropic',
      },
      target: {
        system_id: targetSystemId,
        system_type: 'mcp_server',
      },
      interaction: {
        category: 'tool_call',
        status: error ? 'failure' : 'success',
        request_timestamp_ms,
        response_timestamp_ms: request_timestamp_ms + duration_ms,
        duration_ms,
        error_code: error?.code !== undefined ? String(error.code) : undefined,
      },
      anomaly: { flagged: false },
      source: 'mcp-proxy',
      categories: {
        jsonrpc_method: method,
        ...(typeof toolName === 'string' ? { tool_name: toolName } : {}),
      },
    };

    // Fire-and-forget — tracked only so we await them on exit.
    pendingReceipts.push(postReceipt(state.api_url, state.api_key, receipt));
  };

  const tap = createStreamTap(emit);

  // --- Parent stdin -> child stdin (requests) ---
  let outBuf = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    const { complete, rest } = splitLines(outBuf, typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    outBuf = rest;
    for (const line of complete) {
      try { tap.observeRequest(line); } catch { /* never break the proxy */ }
      try { childStdin.write(line + '\n'); } catch { /* child closed */ }
    }
  });
  process.stdin.on('end', () => {
    if (outBuf) {
      try { tap.observeRequest(outBuf); } catch { /* */ }
      try { childStdin.write(outBuf); } catch { /* */ }
    }
    childStdin.end();
  });

  // --- Child stdout -> parent stdout (responses) ---
  let inBuf = '';
  childStdout.setEncoding('utf-8');
  childStdout.on('data', (chunk: string) => {
    const { complete, rest } = splitLines(inBuf, chunk);
    inBuf = rest;
    for (const line of complete) {
      try { tap.observeResponse(line); } catch { /* */ }
      process.stdout.write(line + '\n');
    }
  });
  childStdout.on('end', () => {
    if (inBuf) {
      try { tap.observeResponse(inBuf); } catch { /* */ }
      process.stdout.write(inBuf);
    }
  });

  // Propagate child lifecycle.
  return await new Promise<number>((resolve) => {
    child.on('exit', async (code, signal) => {
      // Give in-flight receipts up to 2s to finish.
      const cleanupDeadline = Date.now() + 2000;
      while (pendingReceipts.length > 0 && Date.now() < cleanupDeadline) {
        const batch = pendingReceipts.splice(0);
        await Promise.race([
          Promise.all(batch),
          new Promise((r) => setTimeout(r, cleanupDeadline - Date.now()).unref()),
        ]);
      }
      if (signal) {
        // Mirror a signal death with standard exit code convention.
        resolve(128 + (typeof signal === 'string' ? 1 : 0));
      } else {
        resolve(code ?? 0);
      }
    });
    child.on('error', () => resolve(1));
  });
}

main().then((code) => { process.exit(code); }).catch(() => process.exit(1));
