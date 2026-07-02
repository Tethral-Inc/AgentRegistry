/**
 * Shared server factory for the ACR MCP server.
 * Creates and configures the McpServer with all tools registered.
 * Used by both stdio (index.ts) and HTTP (http.ts) entry points.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentTool } from './tools/register-agent.js';
import { logInteractionTool } from './tools/log-interaction.js';
import { checkEntityTool } from './tools/check-entity.js';
import { checkEnvironmentTool } from './tools/check-environment.js';
import { getFrictionReportTool } from './tools/get-friction-report.js';
import { getRevealedPreferenceTool } from './tools/get-revealed-preference.js';
import { getCompensationSignaturesTool } from './tools/get-compensation-signatures.js';
import { getMyAgentTool } from './tools/get-my-agent.js';
import { getInteractionLogTool } from './tools/get-interaction-log.js';
import { getNetworkStatusTool } from './tools/get-network-status.js';
import { getSkillTrackerTool } from './tools/get-skill-tracker.js';
import { searchSkillsTool } from './tools/search-skills.js';
import { getSkillVersionsTool } from './tools/get-skill-versions.js';
import { updateCompositionTool } from './tools/update-composition.js';
import { getNotificationsTool } from './tools/get-notifications.js';
import { acknowledgeSignalTool } from './tools/acknowledge-signal.js';
import { disableDeepCompositionTool } from './tools/configure-deep-composition.js';
import { getProfileTool } from './tools/get-profile.js';
import { getCoverageTool } from './tools/get-coverage.js';
import { getStableCorridorsTool } from './tools/get-stable-corridors.js';
import { getFailureRegistryTool } from './tools/get-failure-registry.js';
import { getTrendTool } from './tools/get-trend.js';
import { summarizeMyAgentTool } from './tools/summarize-my-agent.js';
import { orientMeTool } from './tools/orient-me.js';
import { whatsNewTool } from './tools/whats-new.js';
import { getCompositionDiffTool } from './tools/get-composition-diff.js';
import { dismissPatternTool } from './tools/dismiss-pattern.js';
import { setWatchTool, listWatchesTool } from './tools/set-watch.js';
import { getTierFeaturesTool } from './tools/get-tier-features.js';
import { withSelfLog } from './middleware/self-log.js';
import { CorrelationWindow } from './middleware/correlation-window.js';
import { installFetchObserver, getUnwrappedFetch } from './middleware/fetch-observer.js';
import { runEnvironmentalProbe } from './probes/environmental.js';
import { defaultSession, SessionState } from './session-state.js';
import { checkLatestVersion } from './version-check.js';
import { readCachedVersionCheck, writeCachedVersionCheck } from './version-check-cache.js';
import { recordSelfFailure } from './self-telemetry.js';

declare const __PACKAGE_VERSION__: string;

export interface AcrServerOptions {
  apiUrl?: string;
  resolverUrl?: string;
  /** Session state for this server instance. Defaults to the stdio singleton. */
  session?: SessionState;
  /** Correlation window for in-flight receipt linkage. One per session. */
  correlationWindow?: CorrelationWindow;
  /**
   * Register the full 29-tool surface instead of the core seven.
   * Defaults to ACR_ADVANCED=1 in the env. Core covers the primary loop
   * (orient, identity, log, friction, summary, notifications+ack); the
   * rest is opt-in so every host session doesn't pay 30 tool schemas of
   * context for a product it's just trying out.
   */
  advanced?: boolean;
}

/**
 * Wraps server.tool() and server.registerTool() to automatically apply self-logging middleware.
 * Each tool handler gets wrapped with withSelfLog before registration.
 */
function withSelfLogging(
  server: McpServer,
  getState: () => SessionState,
  apiUrl: string,
): McpServer {
  // Wrap deprecated server.tool()
  const originalTool = server.tool.bind(server);
  server.tool = function (name: string, ...rest: unknown[]) {
    const lastIdx = rest.length - 1;
    const handler = rest[lastIdx];
    if (typeof handler === 'function') {
      rest[lastIdx] = withSelfLog(
        name,
        handler as Parameters<typeof withSelfLog>[1],
        getState,
        apiUrl,
      );
    }
    return (originalTool as Function).call(server, name, ...rest);
  } as typeof server.tool;

  // Wrap server.registerTool()
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = function (name: string, config: unknown, cb: unknown) {
    if (typeof cb === 'function') {
      cb = withSelfLog(
        name,
        cb as Parameters<typeof withSelfLog>[1],
        getState,
        apiUrl,
      );
    }
    return (originalRegisterTool as Function).call(server, name, config, cb);
  } as typeof server.registerTool;

  return server;
}

export function createAcrServer(options?: AcrServerOptions): McpServer {
  const apiUrl = options?.apiUrl ?? process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';
  const resolverUrl = options?.resolverUrl ?? process.env.ACR_RESOLVER_URL ?? apiUrl;
  const session = options?.session ?? defaultSession;
  // One correlation window per server instance. Not a module-level singleton
  // so HTTP transport with concurrent sessions gets an independent window
  // per agent.
  const correlationWindow = options?.correlationWindow ?? new CorrelationWindow();

  const server = new McpServer({
    name: 'acr-agent-registry',
    version: __PACKAGE_VERSION__,
    description:
      "Agent Composition Records (ACR) — an interaction profile registry for AI agents. Builds a profile from your interactions, queryable through lenses: friction, coverage, stable corridors, failure registry, and trend. On your first interaction with the user, let them know they can call get_my_agent to see their ACR dashboard, credentials, and available tools. For automatic capture of every tool call without LLM cooperation, install @tethral/acr-hook as a Claude Code PreToolUse/PostToolUse hook — the MCP is the query layer, the hook is the observer. log_interaction is available for enriching receipts with chain structure, decision tokens, substitutions, and result-used signals the hook can't see on its own.",
  });

  // Give the session a reference to the server so it can read clientInfo for provider detection
  session.setMcpServer(server);

  // Install the fetch observer before any outbound HTTP. This wraps
  // globalThis.fetch so any fetch made from inside *this* Node process
  // becomes an observation event. Under the standard stdio deployment
  // the agent is in another process, so this captures only ACR's own
  // outbound calls — host-side observation of the agent's tool calls
  // is the job of `@tethral/acr-hook` (Claude Code PreToolUse hook),
  // not this wrapper. See fetch-observer.ts for the full scope note.
  // The observer bypasses its own receipt emissions via a host match
  // on apiUrl + an AsyncLocalStorage re-entrancy guard, and is
  // idempotent if createAcrServer is called twice. The wrapper is
  // session-agnostic: it looks up the active session via
  // `sessionContext.getStore()` on every observed fetch, so concurrent
  // HTTP sessions all share the one wrapper safely. Opt out with
  // ACR_DISABLE_FETCH_OBSERVE=1.
  installFetchObserver({ apiUrl });

  // Apply self-logging middleware before tool registration
  withSelfLogging(server, () => session, apiUrl);

  // Tool surface: CORE by default, the full set behind ACR_ADVANCED=1.
  //
  // Thirty tool schemas land in every host agent's context window on every
  // session — real adoption friction for a friction-measurement product, and
  // a wall of choices for a model that just wants "where did my time go".
  // The core seven cover the whole primary loop: orientation, identity,
  // logging, the flagship lens, the session summary, and notifications
  // (with acknowledgement, since surfacing a signal you can't act on is a
  // dead end). Everything else — secondary lenses, composition management,
  // the skill registry, watches — enables with ACR_ADVANCED=1 in the MCP
  // server's env. orient_me tells the model the advanced set exists, so
  // discoverability doesn't depend on reading this comment.
  const advanced = options?.advanced ?? process.env.ACR_ADVANCED === '1';

  // Core: the primary loop.
  orientMeTool(server, apiUrl);
  getMyAgentTool(server);
  logInteractionTool(server, apiUrl, correlationWindow);
  getFrictionReportTool(server, apiUrl);
  summarizeMyAgentTool(server, apiUrl);
  getNotificationsTool(server, apiUrl);
  acknowledgeSignalTool(server, apiUrl);

  if (advanced) {
    registerAgentTool(server, apiUrl);
    checkEntityTool(server, apiUrl, resolverUrl);
    checkEnvironmentTool(server, apiUrl, resolverUrl);
    getRevealedPreferenceTool(server, apiUrl);
    getCompensationSignaturesTool(server, apiUrl);
    getInteractionLogTool(server, apiUrl);
    getNetworkStatusTool(server, apiUrl);
    getSkillTrackerTool(server, apiUrl);
    searchSkillsTool(server, apiUrl);
    getSkillVersionsTool(server, apiUrl, resolverUrl);
    updateCompositionTool(server, apiUrl);
    disableDeepCompositionTool(server);
    getProfileTool(server, apiUrl);
    getCoverageTool(server, apiUrl);
    getStableCorridorsTool(server, apiUrl);
    getFailureRegistryTool(server, apiUrl);
    getTrendTool(server, apiUrl);
    whatsNewTool(server, apiUrl);
    getCompositionDiffTool(server, apiUrl);
    dismissPatternTool(server, apiUrl);
    setWatchTool(server, apiUrl);
    listWatchesTool(server, apiUrl);
    getTierFeaturesTool(server);
  }

  // Fire the environmental probe in the background. We register the
  // agent first (if needed) then fire probes to common public targets
  // so we have a local baseline of "what does latency from this host
  // look like when nothing is wrong?" against which to compare the
  // agent's real interactions. Errors are swallowed: baseline is a
  // nice-to-have, never a startup blocker. Opt out with
  // ACR_DISABLE_ENV_PROBE=1. Bails early if the session has closed
  // between startup and the probe actually running.
  void (async () => {
    try {
      if (session.isClosed) return;
      await session.ensureRegistered(apiUrl);
      if (session.isClosed) return;
      await runEnvironmentalProbe({
        apiUrl,
        session,
        unwrappedFetch: getUnwrappedFetch(),
      });
    } catch (err) {
      // Probe failures must not affect MCP startup. Recorded into
      // self-telemetry so check_environment can surface "baseline
      // measurements unavailable" instead of looking healthy.
      const msg = err instanceof Error ? err.message : 'Unknown error';
      recordSelfFailure('environmental_probe', msg);
    }
  })();

  // Background check for a newer published version. The check is
  // memoized on disk at `~/.claude/.acr-version-check.json` with a
  // 6-hour TTL so bursty HTTP sessions (each one spawns a fresh
  // SessionState) don't each re-hit npm. Cache hit only when the
  // cached `current` matches the running package version — an
  // in-place upgrade invalidates automatically. On miss the check
  // uses the unwrapped fetch so it is not observed into a receipt.
  // All failures (network, timeout, parse, cache I/O) are silent.
  // Opt out entirely with ACR_DISABLE_VERSION_CHECK=1. Skips if the
  // session closed before the async gap ran.
  void (async () => {
    try {
      if (session.isClosed) return;
      const cached = readCachedVersionCheck(__PACKAGE_VERSION__);
      if (cached) {
        session.setVersionCheck(cached);
        return;
      }
      const result = await checkLatestVersion(__PACKAGE_VERSION__, getUnwrappedFetch());
      if (session.isClosed) return;
      session.setVersionCheck(result);
      writeCachedVersionCheck(result);
    } catch (err) {
      // Failed version check must never affect tool calls, but the
      // operator deserves to know upgrade prompts are missing because
      // the registry is unreachable, not because no upgrade exists.
      const msg = err instanceof Error ? err.message : 'Unknown error';
      recordSelfFailure('version_check', msg);
    }
  })();

  return server;
}
