#!/usr/bin/env node
/**
 * ACR MCP server — stdio entry point.
 * For HTTP transport, see http.ts.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAcrServer } from './server.js';
import { defaultSession } from './session-state.js';

async function main() {
  const server = createAcrServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown — on SIGTERM/SIGINT, abort the default session's
  // background work (probes, version check) before the process exits so
  // in-flight fetches don't linger or write stale state.
  const shutdown = () => {
    defaultSession.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('ACR MCP server failed to start:', err);
  process.exit(1);
});
