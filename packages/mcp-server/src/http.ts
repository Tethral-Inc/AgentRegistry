#!/usr/bin/env node
/**
 * ACR MCP server — Streamable HTTP entry point.
 * For browser-based clients (claude.ai) and remote MCP connections.
 * For stdio transport, see index.ts.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createAcrServer } from './server.js';
import { SessionState } from './session-state.js';

const PORT = parseInt(process.env.ACR_MCP_HTTP_PORT ?? '3001', 10);
const AUTH_TOKEN = process.env.ACR_MCP_AUTH_TOKEN;
const STATELESS = process.env.ACR_MCP_STATELESS === 'true';

// Track active transports per session for cleanup
const sessions = new Map<string, StreamableHTTPServerTransport>();

function createTransport(): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: STATELESS ? undefined : () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, transport);
    },
  });
  return transport;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // CORS headers for browser access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
    return;
  }

  // Only handle /mcp endpoint
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol.' }));
    return;
  }

  // Optional bearer auth
  if (AUTH_TOKEN) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  // Route by session: existing session or new initialization
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Existing session — route to its transport
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  if (req.method === 'POST' && !sessionId) {
    // New session — create transport with its own session state, connect server
    const transport = createTransport();
    const session = new SessionState('streamable-http');
    const server = createAcrServer({ session });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
      server.close().catch(() => {});
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  if (req.method === 'DELETE' && sessionId) {
    // Session cleanup
    const transport = sessions.get(sessionId);
    if (transport) {
      await transport.close();
      sessions.delete(sessionId);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ closed: true }));
    return;
  }

  // Unknown session ID
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Session not found' }));
});

httpServer.listen(PORT, () => {
  console.error(`ACR MCP HTTP server listening on port ${PORT}`);
  console.error(`  Endpoint: http://localhost:${PORT}/mcp`);
  console.error(`  Mode: ${STATELESS ? 'stateless' : 'stateful (session-based)'}`);
  if (AUTH_TOKEN) console.error('  Auth: bearer token required');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.error('Shutting down...');
  for (const transport of sessions.values()) {
    transport.close().catch(() => {});
  }
  httpServer.close();
});
