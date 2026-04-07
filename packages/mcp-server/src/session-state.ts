/**
 * Instance-based session state for the ACR MCP server.
 * Supports both stdio (single session) and HTTP (concurrent sessions).
 */
import { randomBytes } from 'node:crypto';
import { detectEnvironment } from './env-detect.js';

export class SessionState {
  private _agentId: string | null = null;
  private _agentName: string | null = null;
  private _registering = false;
  private _transportType: 'stdio' | 'streamable-http';
  private _clientType: string | null = null;

  constructor(transportType: 'stdio' | 'streamable-http' = 'stdio') {
    this._transportType = transportType;
  }

  get agentId(): string | null {
    return this._agentId;
  }

  get agentName(): string | null {
    return this._agentName;
  }

  get transportType(): 'stdio' | 'streamable-http' {
    return this._transportType;
  }

  get clientType(): string | null {
    return this._clientType;
  }

  setAgentId(id: string): void {
    this._agentId = id;
  }

  setAgentName(name: string): void {
    this._agentName = name;
  }

  setClientType(type: string): void {
    this._clientType = type;
  }

  /**
   * Ensure the agent is registered. Called before any tool that needs an agent_id.
   * If not registered, auto-registers with a pseudo_ ID and sends environment context.
   */
  async ensureRegistered(apiUrl: string): Promise<string> {
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
          provider_class: 'unknown',
          environment: env,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { agent_id: string; name: string };
        this._agentId = data.agent_id;
        this._agentName = data.name;
        return this._agentId;
      }

      // Registration failed — use pseudo ID locally
      this._agentId = `pseudo_${randomBytes(6).toString('hex')}`;
      return this._agentId;
    } finally {
      this._registering = false;
    }
  }
}

/** Default singleton session for stdio mode. */
export const defaultSession = new SessionState('stdio');
