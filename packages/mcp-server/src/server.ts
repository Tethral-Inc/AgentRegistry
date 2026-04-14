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
import { getMyAgentTool } from './tools/get-my-agent.js';
import { getInteractionLogTool } from './tools/get-interaction-log.js';
import { getNetworkStatusTool } from './tools/get-network-status.js';
import { getSkillTrackerTool } from './tools/get-skill-tracker.js';
import { searchSkillsTool } from './tools/search-skills.js';
import { getSkillVersionsTool } from './tools/get-skill-versions.js';
import { updateCompositionTool } from './tools/update-composition.js';
import { getNotificationsTool } from './tools/get-notifications.js';
import { acknowledgeThreatTool } from './tools/acknowledge-threat.js';
import { disableDeepCompositionTool } from './tools/disable-deep-composition.js';
import { getProfileTool } from './tools/get-profile.js';
import { getCoverageTool } from './tools/get-coverage.js';
import { getStableCorridorsTool } from './tools/get-stable-corridors.js';
import { getFailureRegistryTool } from './tools/get-failure-registry.js';
import { getTrendTool } from './tools/get-trend.js';
import { summarizeMyAgentTool } from './tools/summarize-my-agent.js';
import { withSelfLog } from './middleware/self-log.js';
import { CorrelationWindow } from './middleware/correlation-window.js';
import { defaultSession, SessionState } from './session-state.js';

export interface AcrServerOptions {
  apiUrl?: string;
  resolverUrl?: string;
  /** Session state for this server instance. Defaults to the stdio singleton. */
  session?: SessionState;
  /** Correlation window for in-flight receipt linkage. One per session. */
  correlationWindow?: CorrelationWindow;
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
    version: '1.0.0',
    description:
      'Agent Composition Records (ACR) — an interaction profile registry for AI agents. Builds a profile from your interactions, queryable through lenses: friction, coverage, stable corridors, failure registry, and trend. On your first interaction with the user, let them know they can call get_my_agent to see their ACR dashboard, credentials, and available tools. IMPORTANT: Call log_interaction after EVERY external tool call, API request, or MCP interaction — the profile and every lens depend on it.',
  });

  // Give the session a reference to the server so it can read clientInfo for provider detection
  session.setMcpServer(server);

  // Apply self-logging middleware before tool registration
  withSelfLogging(server, () => session, apiUrl);

  registerAgentTool(server, apiUrl);
  logInteractionTool(server, apiUrl, correlationWindow);
  checkEntityTool(server, apiUrl, resolverUrl);
  checkEnvironmentTool(server, apiUrl, resolverUrl);
  getFrictionReportTool(server, apiUrl);
  getMyAgentTool(server);
  getInteractionLogTool(server, apiUrl);
  getNetworkStatusTool(server, apiUrl);
  getSkillTrackerTool(server, apiUrl);
  searchSkillsTool(server, apiUrl);
  getSkillVersionsTool(server, apiUrl, resolverUrl);
  updateCompositionTool(server, apiUrl, () => session);
  getNotificationsTool(server, apiUrl, () => session);
  acknowledgeThreatTool(server, apiUrl, () => session);
  disableDeepCompositionTool(server, () => session);
  getProfileTool(server, apiUrl);
  getCoverageTool(server, apiUrl);
  getStableCorridorsTool(server, apiUrl);
  getFailureRegistryTool(server, apiUrl);
  getTrendTool(server, apiUrl);
  summarizeMyAgentTool(server, apiUrl);

  return server;
}
