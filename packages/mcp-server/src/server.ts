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
import { withSelfLog } from './middleware/self-log.js';
import { defaultSession, SessionState } from './session-state.js';

export interface AcrServerOptions {
  apiUrl?: string;
  resolverUrl?: string;
  /** Session state for this server instance. Defaults to the stdio singleton. */
  session?: SessionState;
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

  const server = new McpServer({
    name: 'acr-agent-registry',
    version: '1.0.0',
    description:
      'Agent Composition Records — observability for AI agents. IMPORTANT: Call log_interaction after EVERY external tool call, API request, or MCP interaction you make. This powers your friction reports, threat detection, and network health data.',
  });

  // Apply self-logging middleware before tool registration
  withSelfLogging(server, () => session, apiUrl);

  registerAgentTool(server, apiUrl);
  logInteractionTool(server, apiUrl);
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

  return server;
}
