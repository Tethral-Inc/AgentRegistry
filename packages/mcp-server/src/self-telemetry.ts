/**
 * MCP self-telemetry — process-level visibility into the MCP server's
 * own internal failures (background probes, version-check, state-file
 * I/O). Without this surface, those failures were caught and dropped
 * silently. The operator could not tell from any tool whether the
 * version banner was missing because there is no upgrade or because
 * the registry was unreachable.
 *
 * Two surfaces:
 *   1. `recordSelfFailure(component, message)` — call from any silent
 *      catch block. Cheap; in-memory ring buffer, bounded.
 *   2. `getRecentSelfFailures()` — read by `check_environment` so the
 *      structured `known_issues` block surfaces these to the operator
 *      where they actually look.
 *
 * Process-scoped on purpose. Background work (probes, version-check)
 * is per-process and the failures we want to surface are about the
 * MCP installation itself, not a particular HTTP session.
 *
 * Future: wire into the receipts ingestion endpoint via a
 * `target=mcp:acr-mcp-self` receipt so the agent's own friction
 * report shows MCP-internal failures alongside agent traffic. That
 * needs an agent_id, which is not always available at probe-failure
 * time, so the buffer comes first; the receipt path is a follow-on.
 */

const MAX_FAILURES = 50;

export interface SelfFailure {
  component: string;
  message: string;
  /** Wall-clock ms when this was recorded. */
  recorded_at: number;
}

const buffer: SelfFailure[] = [];

/**
 * Record an internal MCP failure. Bounded in-memory; oldest entries
 * drop off the front when the cap is hit. Never throws — if the
 * caller is itself in a catch block, this must not introduce a
 * second failure path.
 */
export function recordSelfFailure(component: string, message: string): void {
  try {
    buffer.push({ component, message, recorded_at: Date.now() });
    if (buffer.length > MAX_FAILURES) buffer.shift();
  } catch {
    // Belt-and-suspenders: this module must not be the reason a
    // catch block re-throws.
  }
}

/**
 * Snapshot of recent self-failures. Returns a copy so callers can
 * filter/sort without mutating the buffer.
 *
 * `withinMs` filters to recent entries — `check_environment` uses
 * 24h so a transient failure from yesterday doesn't dominate the
 * surface forever.
 */
export function getRecentSelfFailures(withinMs: number = 24 * 60 * 60 * 1000): SelfFailure[] {
  const cutoff = Date.now() - withinMs;
  return buffer.filter((f) => f.recorded_at >= cutoff).slice();
}

/** Test-only: clear the buffer so unit tests don't bleed state. */
export function _clearSelfFailuresForTest(): void {
  buffer.length = 0;
}
