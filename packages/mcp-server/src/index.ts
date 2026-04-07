#!/usr/bin/env node
/**
 * ACR MCP server — stdio entry point.
 * For HTTP transport, see http.ts.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAcrServer } from './server.js';

async function main() {
  const server = createAcrServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ACR MCP server failed to start:', err);
  process.exit(1);
});
