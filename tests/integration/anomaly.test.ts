import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('Anomaly receipt submission', () => {
  it('accepts a valid anomaly-flagged receipt', async () => {
    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emitter: {
          agent_id: 'acr_abcdef123456',
          provider_class: 'openclaw',
        },
        target: {
          system_id: 'skill:sha256:deadbeef',
          system_type: 'skill',
        },
        interaction: {
          category: 'skill_install',
          status: 'success',
          request_timestamp_ms: Date.now() - 5000,
          duration_ms: 800,
        },
        anomaly: {
          flagged: true,
          category: 'unexpected_behavior',
          detail: 'Skill attempted to access filesystem outside sandbox',
        },
      }),
    });

    // Will be 500 (no DB) in test env, but validation passes (not 400)
    expect(res.status).not.toBe(400);
  });

  it('rejects anomaly with detail exceeding 500 chars', async () => {
    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emitter: {
          agent_id: 'acr_abcdef123456',
          provider_class: 'openclaw',
        },
        target: {
          system_id: 'skill:sha256:deadbeef',
          system_type: 'skill',
        },
        interaction: {
          category: 'skill_install',
          status: 'success',
          request_timestamp_ms: Date.now() - 5000,
          duration_ms: 800,
        },
        anomaly: {
          flagged: true,
          category: 'data_exfiltration',
          detail: 'x'.repeat(501),
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('accepts all valid anomaly categories', async () => {
    const categories = [
      'unexpected_behavior', 'data_exfiltration', 'prompt_injection',
      'malformed_output', 'excessive_latency', 'unauthorized_access', 'other',
    ];

    for (const category of categories) {
      const res = await app.request('/api/v1/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emitter: {
            agent_id: 'acr_abcdef123456',
            provider_class: 'openclaw',
          },
          target: {
            system_id: 'mcp:github',
            system_type: 'mcp_server',
          },
          interaction: {
            category: 'tool_call',
            status: 'failure',
            request_timestamp_ms: Date.now() - 1000,
            duration_ms: 200,
          },
          anomaly: {
            flagged: true,
            category,
            detail: `Test anomaly: ${category}`,
          },
        }),
      });

      // Passes validation (not 400), fails at DB (500)
      expect(res.status).not.toBe(400);
    }
  });

  it('rejects invalid anomaly category', async () => {
    const res = await app.request('/api/v1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emitter: {
          agent_id: 'acr_abcdef123456',
          provider_class: 'openclaw',
        },
        target: {
          system_id: 'mcp:github',
          system_type: 'mcp_server',
        },
        interaction: {
          category: 'tool_call',
          status: 'failure',
          request_timestamp_ms: Date.now() - 1000,
          duration_ms: 200,
        },
        anomaly: {
          flagged: true,
          category: 'not_a_real_category',
        },
      }),
    });

    expect(res.status).toBe(400);
  });
});
