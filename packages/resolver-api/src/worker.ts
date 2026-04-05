import type { Env } from './types.js';
import { checkRateLimit } from './lib/rate-limiter.js';
import { setInternalSecret } from './lib/db.js';
import { handleSkillLookup } from './routes/skill.js';
import { handleAgentLookup } from './routes/agent.js';
import { handleSystemHealth } from './routes/system-health.js';
import { handleActiveThreats } from './routes/threats.js';

const VERCEL_ORIGIN = 'https://ingestion-api-john-lunsfords-projects.vercel.app';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, X-Internal-Key',
};

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Set internal query secret from env on each request
    if (env.INTERNAL_QUERY_SECRET) {
      setInternalSecret(env.INTERNAL_QUERY_SECRET);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Proxy non-/v1/ routes to Vercel (ingestion API, lookup page, etc.)
    if (!path.startsWith('/v1/') && path !== '/v1/health') {
      const proxyUrl = new URL(path, VERCEL_ORIGIN);
      proxyUrl.search = url.search;
      const proxyReq = new Request(proxyUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });
      const proxyRes = await fetch(proxyReq);
      const res = new Response(proxyRes.body, proxyRes);
      res.headers.set('Access-Control-Allow-Origin', '*');
      return res;
    }

    // Rate limiting for resolver routes only
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const rateCheck = await checkRateLimit(env.RATE_LIMITS, ip);
    if (!rateCheck.allowed) {
      return errorResponse('RATE_LIMITED', 'Too many requests', 429);
    }

    try {
      // Route matching
      // GET /v1/health
      if (path === '/v1/health') {
        return jsonResponse({ status: 'ok' });
      }

      // GET /v1/skill/:hash
      const skillMatch = path.match(/^\/v1\/skill\/([^/]+)$/);
      if (skillMatch) {
        const hash = decodeURIComponent(skillMatch[1]!);
        const result = await handleSkillLookup(hash, env);
        return jsonResponse(result);
      }

      // GET /v1/agent/:agent_id
      const agentMatch = path.match(/^\/v1\/agent\/([^/]+)$/);
      if (agentMatch) {
        const agentId = agentMatch[1]!;
        const result = await handleAgentLookup(agentId, env);
        if (!result.found) {
          return errorResponse('AGENT_NOT_FOUND', `Agent ${agentId} not found`, 404);
        }
        return jsonResponse(result);
      }

      // GET /v1/system/:system_id/health
      const systemMatch = path.match(/^\/v1\/system\/(.+)\/health$/);
      if (systemMatch) {
        const systemId = decodeURIComponent(systemMatch[1]!);
        const { data, stale } = await handleSystemHealth(systemId, env);
        if (!data.found) {
          return errorResponse('NOT_FOUND', `System ${systemId} not found`, 404);
        }
        const headers: Record<string, string> = {};
        if (stale) headers['X-ACR-Stale'] = 'true';
        return jsonResponse(data, 200, headers);
      }

      // GET /v1/threats/active
      if (path === '/v1/threats/active') {
        const threats = await handleActiveThreats(env);
        return jsonResponse(threats);
      }

      return errorResponse('NOT_FOUND', 'Route not found', 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Resolver error:', message);
      return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
    }
  },
};
