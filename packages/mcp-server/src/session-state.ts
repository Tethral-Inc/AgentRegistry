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
  private _mcpServer: McpServer | null = null;
  private _registering = false;
  private _transportType: 'stdio' | 'streamable-http';
  private _clientType: string | null = null;
  private _deepComposition: boolean = (process.env.ACR_DEEP_COMPOSITION ?? 'true') !== 'false';

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
  get transportType(): 'stdio' | 'streamable-http' { return this._transportType; }
  get clientType(): string | null { return this._clientType; }

  setAgentId(id: string): void { this._agentId = id; }
  setAgentName(name: string): void { this._agentName = name; }
  setApiKey(key: string): void { this._apiKey = key; }
  setClientType(type: string): void { this._clientType = type; }
  setMcpServer(server: McpServer): void { this._mcpServer = server; }

  get versionCheck(): VersionCheckResult | null { return this._versionCheck; }
  setVersionCheck(result: VersionCheckResult): void { this._versionCheck = result; }

  /** Infer provider_class from the MCP client name (e.g. "claude-code" → "anthropic"). */
  get providerClass(): string { return this.inferProviderClass(); }

  private inferProviderClass(): string {
    const clientName = this._mcpServer?.server?.getClientVersion?.()?.name?.toLowerCase();
    if (!clientName) return 'unknown';
    return CLIENT_TO_PROVIDER[clientName] ?? 'custom';
  }

  async ensureRegistered(apiUrl: string): Promise<string> {
    // Hydrate from persisted state file to avoid re-registering every session
    if (!this._agentId) {
      const saved = readAcrStateFile();
      if (saved?.agent_id) {
        this._agentId = saved.agent_id;
        if (saved.api_key) this._apiKey = saved.api_key;
        return this._agentId;
      }
    }

    if (this._agentId) return this._agentId;
    if (this._registering) {
      await new Promise((r) => setTimeout(r, 1000));
      if (this._agentId) return this._agentId;
    }

    this._registering = true;
    try {
      const pseudoKey = `pseudo_${randomBytes(16).toString('hex')}`;
      const env = detectEnvironment(this._transportType);
      if (this._clientType) env.client_type = this._clientType;

      const res = await fetch(`${apiUrl}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_key: pseudoKey,
          provider_class: this.inferProviderClass(),
          environment: env,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { agent_id: string; name: string; api_key?: string };
        this._agentId = data.agent_id;
        this._agentName = data.name;
        if (data.api_key) this._apiKey = data.api_key;
        writeAcrStateFile(this._agentId, apiUrl, this._apiKey ?? undefined);
        return this._agentId;
      }

      this._agentId = `pseudo_${randomBytes(6).toString('hex')}`;
      return this._agentId;
    } finally {
      this._registering = false;
    }
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
