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
import { SessionState, sessionContext } from './session-state.js';
import { envBool, envInt } from './utils/env.js';

const PORT = envInt('ACR_MCP_HTTP_PORT', 3001);
const AUTH_TOKEN = process.env.ACR_MCP_AUTH_TOKEN;
const STATELESS = envBool('ACR_MCP_STATELESS', false);

/**
 * Per-session record. The transport carries the MCP protocol frames; the
 * session is the per-agent state we enter into via `sessionContext.run`
 * on every handleRequest call so tools and middleware read the correct
 * SessionState without the tool factories having to thread it through.
 */
interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  session: SessionState;
}

// Track active sessions for cleanup + per-request session lookup.
const sessions = new Map<string, SessionEntry>();

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
    // Existing session — route to its transport inside the session context
    // so tools + middleware see the right SessionState via getActiveSession().
    const entry = sessions.get(sessionId)!;
    await sessionContext.run(entry.session, () => entry.transport.handleRequest(req, res));
    return;
  }

  if (req.method === 'POST' && !sessionId) {
    // New session — create transport with its own session state, connect server.
    // The session is entered into `sessionContext` for the duration of this
    // request so the initialize call and any tool call made on the same
    // request read the correct session.
    const session = new SessionState('streamable-http');
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: STATELESS ? undefined : () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, session });
      },
    });
    const server = createAcrServer({ session });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
      // Abort any in-flight background promises tied to this session
      // (environmental probe, version check) before the MCP server is
      // torn down, so they don't write to a freshly-disposed session.
      session.close();
      server.close().catch((err) => { console.error('Failed to close MCP server on session end', err); });
    };

    await server.connect(transport);
    await sessionContext.run(session, () => transport.handleRequest(req, res));
    return;
  }

  if (req.method === 'DELETE' && sessionId) {
    // Session cleanup — mirror the onclose path so DELETE and transport
    // drops follow the same abort ordering.
    const entry = sessions.get(sessionId);
    if (entry) {
      entry.session.close();
      await entry.transport.close();
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

// Graceful shutdown — abort every session's background work before
// closing its transport so in-flight probes/version checks don't try
// to write against sessions that are already being torn down.
process.on('SIGTERM', () => {
  console.error('Shutting down...');
  for (const entry of sessions.values()) {
    entry.session.close();
    entry.transport.close().catch((err) => { console.error('Failed to close transport during shutdown', err); });
  }
  httpServer.close();
});
