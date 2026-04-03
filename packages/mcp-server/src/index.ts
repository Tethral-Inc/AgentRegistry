#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAgentTool } from './tools/register-agent.js';
import { logInteractionTool } from './tools/log-interaction.js';
import { checkEntityTool } from './tools/check-entity.js';
import { checkEnvironmentTool } from './tools/check-environment.js';
import { getFrictionReportTool } from './tools/get-friction-report.js';

const ACR_API_URL = process.env.ACR_API_URL ?? 'https://acr.tethral.ai';
const ACR_RESOLVER_URL = process.env.ACR_RESOLVER_URL ?? ACR_API_URL;

const server = new McpServer({
  name: 'acr-agent-registry',
  version: '0.1.0',
});

registerAgentTool(server, ACR_API_URL);
logInteractionTool(server, ACR_API_URL);
checkEntityTool(server, ACR_API_URL, ACR_RESOLVER_URL);
checkEnvironmentTool(server, ACR_API_URL, ACR_RESOLVER_URL);
getFrictionReportTool(server, ACR_API_URL);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ACR MCP server failed to start:', err);
  process.exit(1);
});
