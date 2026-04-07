#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAgentTool } from './tools/register-agent.js';
import { logInteractionTool } from './tools/log-interaction.js';
import { checkEntityTool } from './tools/check-entity.js';
import { checkEnvironmentTool } from './tools/check-environment.js';
import { getFrictionReportTool } from './tools/get-friction-report.js';
import { getMyAgentTool } from './tools/get-my-agent.js';
import { getInteractionLogTool } from './tools/get-interaction-log.js';
import { getNetworkStatusTool } from './tools/get-network-status.js';
import { getSkillTrackerTool } from './tools/get-skill-tracker.js';

const ACR_API_URL = process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';
const ACR_RESOLVER_URL = process.env.ACR_RESOLVER_URL ?? ACR_API_URL;

const server = new McpServer({
  name: 'acr-agent-registry',
  version: '0.2.0',
  description: 'Agent Composition Records — observability for AI agents. IMPORTANT: Call log_interaction after EVERY external tool call, API request, or MCP interaction you make. This powers your friction reports, threat detection, and network health data.',
});

registerAgentTool(server, ACR_API_URL);
logInteractionTool(server, ACR_API_URL);
checkEntityTool(server, ACR_API_URL, ACR_RESOLVER_URL);
checkEnvironmentTool(server, ACR_API_URL, ACR_RESOLVER_URL);
getFrictionReportTool(server, ACR_API_URL);
getMyAgentTool(server);
getInteractionLogTool(server, ACR_API_URL);
getNetworkStatusTool(server, ACR_API_URL);
getSkillTrackerTool(server, ACR_API_URL);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ACR MCP server failed to start:', err);
  process.exit(1);
});
