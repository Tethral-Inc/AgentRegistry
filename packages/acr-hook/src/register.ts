/**
 * Self-bootstrap: mint an ACR identity without the MCP.
 *
 * The hook used to depend on @tethral/acr-mcp to register and write the
 * state file. This lets the hook stand alone: if there's no identity yet,
 * it generates an Ed25519 keypair, registers (proof-of-possession), and
 * persists the result to ~/.claude/.acr-state.json. The signing scheme
 * mirrors @acr/shared / ts-sdk pop.ts — inlined because this package is
 * zero-dependency. Keep the three in lockstep.
 */
import { generateKeyPairSync, createPrivateKey, sign as nodeSign } from 'node:crypto';
import { writeFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readState, writeState, type AcrState } from './state.js';

const POP_VERSION = 'v1';
const REGISTER_TIMEOUT_MS = 5000;
const LOCK_PATH = join(homedir(), '.claude', '.acr-state.lock');
const LOCK_STALE_MS = 60_000;

/** Generate a keypair, sign the registration challenge, POST /register. */
export async function registerNewIdentity(apiUrl: string): Promise<AcrState> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = (publicKey.export({ format: 'jwk' }) as { x?: string }).x;
  const priv = (privateKey.export({ format: 'jwk' }) as { d?: string }).d;
  if (!pub || !priv) throw new Error('Ed25519 keypair export missing x/d');

  const ts = Date.now();
  const signer = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: priv, x: '' },
    format: 'jwk',
  } as Parameters<typeof createPrivateKey>[0]);
  const signature = nodeSign(
    null,
    Buffer.from(`register:${POP_VERSION}:${pub}:${ts}`, 'utf8'),
    signer,
  ).toString('base64url');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiUrl}/api/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        public_key: pub,
        registration_timestamp_ms: ts,
        signature,
        provider_class: 'anthropic',
        operational_domain: 'claude-code',
        composition: {},
      }),
    });
    if (!res.ok) throw new Error(`register HTTP ${res.status}`);
    const body = (await res.json()) as { agent_id?: string; api_key?: string };
    if (!body.agent_id) throw new Error('register response missing agent_id');
    return { agent_id: body.agent_id, api_url: apiUrl, api_key: body.api_key, public_key: pub, private_key: priv };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Return the agent's identity, minting one if none exists yet.
 *
 * Concurrency guard: at session start many hooks fire at once and would all
 * see "no state" and each register — spawning a pile of throwaway agents
 * (exactly the ephemeral-identity churn we want to avoid). An exclusive lock
 * file means only one hook registers; the others skip this round and pick up
 * the persisted identity on their next call. Stale locks from a crashed
 * attempt are cleared after LOCK_STALE_MS.
 */
export async function ensureIdentity(apiUrl: string): Promise<AcrState | null> {
  const existing = readState();
  if (existing?.agent_id && existing.api_url) return existing;

  // The lock and the state file live in ~/.claude; on a brand-new machine
  // that dir may not exist yet (e.g. `acr-hook init` before Claude Code has
  // created it). Ensure it exists, or the exclusive lock write below ENOENTs
  // and we'd misread that as "another hook is registering".
  try { mkdirSync(dirname(LOCK_PATH), { recursive: true }); } catch { /* best-effort */ }

  try {
    try {
      if (Date.now() - statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) unlinkSync(LOCK_PATH);
    } catch { /* no lock present */ }
    writeFileSync(LOCK_PATH, String(Date.now()), { flag: 'wx' }); // exclusive create
  } catch {
    return readState(); // another hook holds the lock (or just finished registering)
  }

  try {
    const state = await registerNewIdentity(apiUrl);
    writeState(state);
    return state;
  } catch {
    return null;
  } finally {
    try { unlinkSync(LOCK_PATH); } catch { /* fine */ }
  }
}
