/**
 * Correlation window for the ACR MCP.
 *
 * A passive in-process buffer of ~60 seconds of recent receipt correlation
 * keys. The window is used at receipt emit time to tag a new receipt with a
 * `preceded_by` link when it's part of the same in-flight workflow as a
 * recent prior receipt. Beyond 60 seconds, correlation is the server's job.
 *
 * Design choices and their rationale (see proposals/mcp-compute-boundary.md
 * constraint #3):
 *
 * - In-process only. No disk, no persistence, no tmpfile. The window is lost
 *   on process restart, which is fine: the authoritative record lives on
 *   the server, and 60 seconds is short enough that restart rarely matters.
 * - Passive. No pattern matching forward or reverse. No aggregation. No
 *   prediction. The window holds correlation keys and nothing else.
 * - Eager eviction on insert. No setInterval, no background sweeper, no
 *   timers. Eviction runs once per insert, O(n) over at-most-hundreds of
 *   entries. No background work.
 * - One window per session. Instantiated in server.ts and passed by
 *   reference into the tools that need it. Not a module-level singleton, so
 *   the HTTP transport with concurrent sessions doesn't share state across
 *   agents.
 * - Framed as a privacy + lightweight design choice. Users get useful
 *   interaction data without persistent surveillance state on their machine.
 */

export interface CorrelationEntry {
  receipt_id: string;
  chain_id: string | null;
  target_system_id: string;
  /** Unix ms timestamp when the receipt was produced. */
  created_at_ms: number;
}

/** Defaults to 60 seconds. Overridable for tests only. */
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Hard cap on entries held in the window, as a safety net in case eviction
 * has a bug or the MCP is under unusual load. 500 is plenty for a 60s
 * window at realistic tool-call rates.
 */
const DEFAULT_MAX_ENTRIES = 500;

export class CorrelationWindow {
  private readonly entries: Map<string, CorrelationEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(windowMs: number = DEFAULT_WINDOW_MS, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Record a receipt's correlation keys into the window. Runs eviction of
   * expired entries on every insert — no background sweeper.
   *
   * If the window is at its hard cap after eviction (indicates either a
   * very high tool-call rate or a bug), the oldest entries are dropped.
   * This is a safety net, not a normal path.
   */
  record(entry: CorrelationEntry): void {
    this.evictExpired(entry.created_at_ms);
    this.entries.set(entry.receipt_id, entry);

    // Hard-cap safety: if we're somehow over the limit, drop oldest.
    if (this.entries.size > this.maxEntries) {
      const excess = this.entries.size - this.maxEntries;
      let dropped = 0;
      for (const key of this.entries.keys()) {
        if (dropped >= excess) break;
        this.entries.delete(key);
        dropped++;
      }
    }
  }

  /**
   * Find a recent receipt that should be linked as `preceded_by` for a new
   * receipt. Prefers the most recent entry in the same chain_id. Returns the
   * target_system_id of the match (that's what `preceded_by` stores), or
   * null if nothing links.
   *
   * If currentChainId is null, we don't attempt cross-chain linking — the
   * agent didn't declare a chain, so the server will reconstruct any
   * linkage from its full history.
   */
  findPrecededBy(currentChainId: string | null, nowMs: number): string | null {
    if (!currentChainId) return null;
    this.evictExpired(nowMs);

    // Walk entries newest-first by iterating in reverse insertion order.
    // Map preserves insertion order, so the newest entry is last. Convert
    // to an array and scan from the end.
    const allEntries = Array.from(this.entries.values());
    for (let i = allEntries.length - 1; i >= 0; i--) {
      const entry = allEntries[i]!;
      if (entry.chain_id === currentChainId) {
        return entry.target_system_id;
      }
    }
    return null;
  }

  /**
   * Evict entries older than the window. Called on every record() and
   * every findPrecededBy() call. No background timers.
   */
  private evictExpired(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    for (const [key, entry] of this.entries) {
      if (entry.created_at_ms < cutoff) {
        this.entries.delete(key);
      }
    }
  }

  /** Current number of entries in the window. Used by tests and observability. */
  size(): number {
    return this.entries.size;
  }

  /** Clear the window. Used by tests; not expected in production code paths. */
  clear(): void {
    this.entries.clear();
  }
}
