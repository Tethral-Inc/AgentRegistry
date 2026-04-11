/**
 * Auto-detect execution environment for ACR observability.
 * Captures device class, platform, architecture at startup.
 * Env var overrides: ACR_DEVICE_CLASS, ACR_PLATFORM, ACR_ARCH.
 */
import { totalmem, release } from 'node:os';

export interface EnvironmentContext {
  device_class: 'desktop' | 'server' | 'sbc' | 'mobile' | 'unknown';
  platform: string;
  arch: string;
  client_type?: string;
  transport_type: 'stdio' | 'streamable-http';
}

function inferDeviceClass(): EnvironmentContext['device_class'] {
  const override = process.env.ACR_DEVICE_CLASS;
  if (override) return override as EnvironmentContext['device_class'];

  const memGB = totalmem() / (1024 ** 3);
  if (memGB < 2) return 'sbc';
  if (memGB < 4) return 'mobile';
  return 'desktop';
}

export function detectEnvironment(
  transportType: 'stdio' | 'streamable-http',
): EnvironmentContext {
  return {
    device_class: inferDeviceClass(),
    platform: process.env.ACR_PLATFORM ?? process.platform,
    arch: process.env.ACR_ARCH ?? process.arch,
    transport_type: transportType,
  };
}

/** OS release string, useful for debugging but not stored by default. */
export function getOsRelease(): string {
  return release();
}

/**
 * Observe the agent's composition from the MCP's vantage point.
 *
 * This is the MCP-observed side of the two-source composition pattern.
 * The MCP doesn't have a portable way to enumerate an agent's skills and
 * MCPs across all MCP hosts — that requires host integration (Claude Code
 * plugin in Phase 2, similar plugins for other hosts). In Phase 1 this
 * is a stub that returns empty: the plumbing is in place so the
 * agent_composition_sources table and the profile's composition_delta
 * computation work as soon as any observation is populated.
 *
 * Keep this pure and fast. No file I/O, no network, no parsing of
 * arbitrary files. It should always return in <1ms.
 */
export function observeComposition(): Record<string, unknown> {
  // Phase 1: MCP observation returns an empty composition. Phase 2's
  // host plugins (Claude Code, Cursor, etc.) populate the mcp_observed
  // source directly by calling the server API, bypassing this function.
  // This keeps the MCP compute-thin and the observation source
  // correctly attributed to whichever host integration produced it.
  return {};
}
