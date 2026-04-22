/**
 * Instance-based session state for the ACR MCP server.
 * Supports both stdio (single session) and HTTP (concurrent sessions).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { detectEnvironment } from './env-detect.js';
import { writeAcrStateFile, readAcrStateFile } from './acr-state-file.js';
import type { VersionCheckResult } from './version-check.js';
import { envBool } from './utils/env.js';
import { generateAgentKeypair, signRegistration } from './utils/pop-client.js';

const CLIENT_TO_PROVIDER: Record<string, string> = {
  'claude-code': 'anthropic',
  'claude-desktop': 'anthropic',
  'claude': 'anthropic',
  'cursor': 'custom',
  'continue': 'custom',
  'zed': 'custom',
  'windsurf': 'custom',
  'cline': 'custom',
  'copilot': 'openai',
};

/**
 * Idle timeout (ms) for rotating the session chain_id. When more than this
 * many milliseconds elapse between successive log_interaction calls, the
 * session is considered to have moved on to a new logical workflow and a
 * fresh chain_id is minted. 5 minutes is a pragmatic default: long enough
 * to encompass multi-step workflows with thinking pauses, short enough
 * that unrelated later activity doesn't get stitched into the same chain.
 */
const CHAIN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export class SessionState {
  private _agentId: string | null = null;
  private _agentName: string | null = null;
  private _apiKey: string | null = null;
  // Persistent Ed25519 keypair (base64url strings). Generated on first
  // registration so /register can verify proof-of-possession. Reused
  // forever after — rotating the key means a new agent identity.
  private _publicKey: string | null = null;
  private _privateKey: string | null = null;
  private _mcpServer: McpServer | null = null;
  private _registering = false;
  private _transportType: 'stdio' | 'streamable-http';
  private _clientType: string | null = null;
  private _deepComposition: boolean = envBool('ACR_DEEP_COMPOSITION', true);

  // Session-scoped chain state. The MCP observes session structure
  // directly — the agent never needs to pass chain_id or chain_position.
  // Rotated on idle > CHAIN_IDLE_TIMEOUT_MS so a new logical workflow
  // doesn't get fused into an earlier one.
  private _sessionChainId: string | null = null;
  private _sessionCallCount: number = 0;
  private _lastCallMs: number = 0;

  // Latest published version probe. Populated once at MCP startup (or not
  // at all if ACR_DISABLE_VERSION_CHECK=1 or the check fails). Entry-point
  // tools can read this to surface an upgrade banner.
  private _versionCheck: VersionCheckResult | null = null;

  // Abort signal for background work tied to this session (environmental
  // probes, version check, any future long-running IIFE in server.ts).
  // Fired when the session closes so a dropped HTTP connection doesn't
  // leave receipts or writes in flight against a session that's about to
  // be garbage-collected. Consumers read `session.abortSignal` and pass
  // it to fetch/setTimeout/etc.; they must not abort it themselves.
  private _abortController: AbortController = new AbortController();
  private _closed: boolean = false;

  constructor(transportType: 'stdio' | 'streamable-http' = 'stdio') {
    this._transportType = transportType;
  }

  /**
   * Return the chain context that a new log_interaction should use when
   * the agent didn't supply its own. Mints a new chain_id if this is the
   * first call, or if the last call was more than CHAIN_IDLE_TIMEOUT_MS
   * ago. Otherwise extends the existing chain.
   *
   * This is the session-boundary probe: chains are inferred from the
   * timing of MCP activity, not reported by the agent.
   */
  nextChainContext(nowMs: number = Date.now()): { chain_id: string; chain_position: number } {
    const idle = this._lastCallMs === 0 ? Infinity : nowMs - this._lastCallMs;
    if (!this._sessionChainId || idle > CHAIN_IDLE_TIMEOUT_MS) {
      // Mint a fresh chain_id. 16 hex chars = 64 bits of entropy, plenty
      // for uniqueness within a single agent. Prefix makes it recognisable
      // in the database as session-inferred rather than agent-supplied.
      this._sessionChainId = `s-${randomBytes(8).toString('hex')}`;
      this._sessionCallCount = 0;
    }
    const position = this._sessionCallCount;
    this._sessionCallCount += 1;
    this._lastCallMs = nowMs;
    return { chain_id: this._sessionChainId, chain_position: position };
  }

  /** Testing hook: reset the session chain state. */
  resetChain(): void {
    this._sessionChainId = null;
    this._sessionCallCount = 0;
    this._lastCallMs = 0;
  }

  get deepComposition(): boolean { return this._deepComposition; }
  setDeepComposition(enabled: boolean): void { this._deepComposition = enabled; }

  get agentId(): string | null { return this._agentId; }
  get agentName(): string | null { return this._agentName; }
  get apiKey(): string | null { return this._apiKey; }
  get publicKey(): string | null { return this._publicKey; }
  get privateKey(): string | null { return this._privateKey; }
  get transportType(): 'stdio' | 'streamable-http' { return this._transportType; }
  get clientType(): string | null { return this._clientType; }

  setAgentId(id: string): void { this._agentId = id; }
  setAgentName(name: string): void { this._agentName = name; }
  setApiKey(key: string): void { this._apiKey = key; }
  setClientType(type: string): void { this._clientType = type; }
  setMcpServer(server: McpServer): void { this._mcpServer = server; }

  /**
   * Return the agent's Ed25519 keypair, generating + persisting one on
   * first access. Callers signing a /register request must use this so
   * the same public_key is offered consistently across sessions.
   */
  ensureKeypair(apiUrl: string): { publicKey: string; privateKey: string } {
    if (this._publicKey && this._privateKey) {
      return { publicKey: this._publicKey, privateKey: this._privateKey };
    }
    const { publicKey, privateKey } = generateAgentKeypair();
    this._publicKey = publicKey;
    this._privateKey = privateKey;
    // Persist immediately so a crash between keypair generation and
    // successful /register doesn't leak the identity.
    writeAcrStateFile({
      agent_id: this._agentId ?? '',
      api_url: apiUrl,
      api_key: this._apiKey ?? undefined,
      public_key: publicKey,
      private_key: privateKey,
    });
    return { publicKey, privateKey };
  }

  get versionCheck(): VersionCheckResult | null { return this._versionCheck; }
  setVersionCheck(result: VersionCheckResult): void {
    // Don't stash results if the session has already closed — the
    // state would be written but never read, and in tests it can
    // trigger unexpected-write assertions.
    if (this._closed) return;
    this._versionCheck = result;
  }

  /**
   * Abort signal for in-flight background work tied to this session.
   * Pass to fetch calls, setTimeout, etc. so session close cancels them.
   */
  get abortSignal(): AbortSignal { return this._abortController.signal; }

  /** True after `close()` has been called. Check this before scheduling new work. */
  get isClosed(): boolean { return this._closed; }

  /**
   * Cancel all background work tied to this session. Idempotent —
   * calling twice is a no-op. HTTP transport wiring fires this on
   * transport close; stdio calls it during SIGTERM graceful shutdown.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._abortController.abort();
  }

  /** Infer provider_class from the MCP client name (e.g. "claude-code" → "anthropic"). */
  get providerClass(): string { return this.inferProviderClass(); }

  private inferProviderClass(): string {
    const clientName = this._mcpServer?.server?.getClientVersion?.()?.name?.toLowerCase();
    if (!clientName) return 'unknown';
    return CLIENT_TO_PROVIDER[clientName] ?? 'custom';
  }

  async ensureRegistered(apiUrl: string): Promise<string> {
    // Hydrate from persisted state file to avoid re-registering every session.
    // Stale `pseudo_*` IDs written by old MCP builds (pre-2.5.0) are treated
    // as un-registered so this session can try again cleanly.
    if (!this._agentId) {
      const saved = readAcrStateFile();
      if (saved?.agent_id && !saved.agent_id.startsWith('pseudo_')) {
        this._agentId = saved.agent_id;
        if (saved.api_key) this._apiKey = saved.api_key;
        // Hydrate keypair too — otherwise the next /register would mint
        // a fresh key and attach this agent_id to a stranger identity.
        if (saved.public_key) this._publicKey = saved.public_key;
        if (saved.private_key) this._privateKey = saved.private_key;
        return this._agentId;
      }
      // Even without a persisted agent_id, hoist any existing keypair
      // so a partial state file (keypair written but registration never
      // completed) isn't silently discarded.
      if (saved?.public_key && saved?.private_key) {
        this._publicKey = saved.public_key;
        this._privateKey = saved.private_key;
      }
    }

    if (this._agentId) return this._agentId;
    if (this._registering) {
      await new Promise((r) => setTimeout(r, 1000));
      if (this._agentId) return this._agentId;
      // Concurrent registration is still in flight and didn't land in 1s.
      // Surface the failure rather than hang — the caller can retry.
      throw new RegistrationFailedError(
        apiUrl,
        'Concurrent registration did not complete in time.',
      );
    }

    this._registering = true;
    let httpStatus: number | null = null;
    let errorBody: string | null = null;
    try {
      const env = detectEnvironment(this._transportType);
      if (this._clientType) env.client_type = this._clientType;

      // PoP: sign a fresh timestamp with the session's Ed25519 key.
      // ensureKeypair generates + persists one if this is our first
      // run — subsequent sessions reuse the persisted identity.
      const { publicKey, privateKey } = this.ensureKeypair(apiUrl);
      const timestampMs = Date.now();
      const signature = signRegistration(privateKey, publicKey, timestampMs);

      const res = await fetch(`${apiUrl}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_key: publicKey,
          registration_timestamp_ms: timestampMs,
          signature,
          provider_class: this.inferProviderClass(),
          environment: env,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { agent_id: string; name: string; api_key?: string };
        this._agentId = data.agent_id;
        this._agentName = data.name;
        if (data.api_key) this._apiKey = data.api_key;
        writeAcrStateFile({
          agent_id: this._agentId,
          api_url: apiUrl,
          api_key: this._apiKey ?? undefined,
          public_key: publicKey,
          private_key: privateKey,
        });
        return this._agentId;
      }

      httpStatus = res.status;
      errorBody = await res.text().catch(() => null);
      throw new RegistrationFailedError(apiUrl, `HTTP ${httpStatus}`, httpStatus, errorBody);
    } catch (err) {
      if (err instanceof RegistrationFailedError) throw err;
      // Network / fetch-level error (DNS, timeout, refused, etc.). Wrap as
      // a typed error so call sites can distinguish it from caller bugs.
      const msg = err instanceof Error ? err.message : String(err);
      throw new RegistrationFailedError(apiUrl, msg);
    } finally {
      this._registering = false;
    }
  }
}

/**
 * Typed error thrown when auto-registration with the ACR API fails.
 * Call sites should catch this, surface an actionable message to the
 * agent, and either retry or fall back to a read-only flow. The MCP
 * no longer silently substitutes a `pseudo_*` agent id on failure —
 * that masqueraded as a real ID and poisoned every subsequent call.
 */
export class RegistrationFailedError extends Error {
  constructor(
    public readonly apiUrl: string,
    public readonly detail: string,
    public readonly httpStatus: number | null = null,
    public readonly responseBody: string | null = null,
  ) {
    super(`Registration with ${apiUrl} failed: ${detail}`);
    this.name = 'RegistrationFailedError';
  }

  /**
   * Human-readable message to render back to the agent. Describes the
   * failure in one line and points to the most likely cause. Kept
   * short so tools can concatenate it into an isError output block.
   */
  userMessage(): string {
    if (this.httpStatus && this.httpStatus >= 500) {
      return `ACR registry is unavailable right now (HTTP ${this.httpStatus} from ${this.apiUrl}). Try again in a minute. If it persists, set ACR_API_URL to a reachable endpoint or skip logging for this session.`;
    }
    if (this.httpStatus === 429) {
      return `ACR registry throttled this registration (HTTP 429 from ${this.apiUrl}). Try again in a minute.`;
    }
    if (this.httpStatus) {
      return `ACR registration rejected (HTTP ${this.httpStatus} from ${this.apiUrl}): ${this.responseBody ?? this.detail}`;
    }
    return `ACR registration could not reach ${this.apiUrl}: ${this.detail}. Check network connectivity or ACR_API_URL.`;
  }
}

/** Default singleton session for stdio mode. */
export const defaultSession = new SessionState('stdio');

/**
 * Per-request session context. HTTP transport runs each incoming request
 * inside `sessionContext.run(session, ...)` so tools, middleware, and the
 * fetch observer can look up the correct SessionState without the tool
 * factories having to thread it through every call site.
 *
 * Stdio mode never enters the context, so `getActiveSession()` returns
 * `defaultSession` there — which matches the single-session semantics of
 * stdio (one process, one agent).
 */
export const sessionContext = new AsyncLocalStorage<SessionState>();

/**
 * Return the SessionState for the current async context, falling back to
 * the stdio `defaultSession` when no HTTP request context is active.
 */
export function getActiveSession(): SessionState {
  return sessionContext.getStore() ?? defaultSession;
}
