import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('POST /api/v1/receipts', () => {
  it('rejects invalid emitter agent_id', async () => {
    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emitter: { agent_id: 'bad_id', provider_class: 'openclaw' },
        target: { system_id: 'mcp:github', system_type: 'mcp_server' },
        interaction: {
          category: 'tool_call',
          status: 'success',
          request_timestamp_ms: Date.now() - 1000,
          duration_ms: 1200,
        },
        anomaly: { flagged: false },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid target system_id format', async () => {
    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emitter: { agent_id: 'acr_abcdef123456', provider_class: 'openclaw' },
        target: { system_id: 'no-prefix-here', system_type: 'mcp_server' },
        interaction: {
          category: 'tool_call',
          status: 'success',
          request_timestamp_ms: Date.now() - 1000,
          duration_ms: 500,
        },
        anomaly: { flagged: false },
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects receipt with timestamp older than 24 hours', async () => {
    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emitter: { agent_id: 'acr_abcdef123456', provider_class: 'openclaw' },
        target: { system_id: 'mcp:github', system_type: 'mcp_server' },
        interaction: {
          category: 'tool_call',
          status: 'success',
          request_timestamp_ms: Date.now() - 86400001, // > 24 hours ago
          duration_ms: 500,
        },
        anomaly: { flagged: false },
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects batch exceeding 50 receipts', async () => {
    const receipts = Array.from({ length: 51 }, (_, i) => ({
      emitter: { agent_id: 'acr_abcdef123456', provider_class: 'openclaw' as const },
      target: { system_id: 'mcp:github', system_type: 'mcp_server' as const },
      interaction: {
        category: 'tool_call' as const,
        status: 'success' as const,
        request_timestamp_ms: Date.now() - i * 100,
        duration_ms: 100,
      },
      anomaly: { flagged: false },
    }));

    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipts }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects negative duration_ms', async () => {
    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emitter: { agent_id: 'acr_abcdef123456', provider_class: 'openclaw' },
        target: { system_id: 'mcp:github', system_type: 'mcp_server' },
        interaction: {
          category: 'tool_call',
          status: 'success',
          request_timestamp_ms: Date.now() - 1000,
          duration_ms: -100,
        },
        anomaly: { flagged: false },
      }),
    });

    expect(res.status).toBe(400);
  });
});
