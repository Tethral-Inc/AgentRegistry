'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_ACR_API_URL ?? 'https://acr.tethral.ai';

interface FrictionData {
  summary: {
    total_interactions: number;
    total_wait_time_ms: number;
    friction_percentage: number;
    total_failures: number;
    failure_rate: number;
  };
  top_targets: Array<{
    target_system_id: string;
    interaction_count: number;
    total_duration_ms: number;
    proportion_of_total: number;
    median_duration_ms: number;
    failure_count: number;
    vs_baseline?: number;
  }>;
  tier: string;
}

export default function OperatorPortal() {
  const [agentId, setAgentId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [scope, setScope] = useState<'session' | 'day' | 'week'>('day');
  const [data, setData] = useState<FrictionData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function fetchFriction() {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['x-api-key'] = apiKey;

      const res = await fetch(
        `${API_URL}/api/v1/agent/${agentId}/friction?scope=${scope}`,
        { headers },
      );
      const json = await res.json();
      if (json.error) {
        setError(json.error.message);
        setData(null);
      } else {
        setData(json);
      }
    } catch (e) {
      setError('Failed to reach ACR API');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Operator Portal</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          value={agentId} onChange={(e) => setAgentId(e.target.value)}
          placeholder="Agent ID (acr_...)"
          style={{ flex: 1, minWidth: 200, padding: '0.5rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'monospace' }}
        />
        <input
          value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key (optional, for paid tier)"
          style={{ flex: 1, minWidth: 200, padding: '0.5rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff' }}
          type="password"
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {(['session', 'day', 'week'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            style={{ padding: '0.5rem 1rem', background: scope === s ? '#4a9eff' : '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
            {s}
          </button>
        ))}
        <button onClick={fetchFriction} disabled={loading || !agentId}
          style={{ padding: '0.5rem 1.5rem', background: '#4a9eff', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', marginLeft: 'auto' }}>
          {loading ? 'Loading...' : 'Get Report'}
        </button>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      {data && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <Stat label="Interactions" value={data.summary.total_interactions} />
            <Stat label="Wait Time" value={`${(data.summary.total_wait_time_ms / 1000).toFixed(1)}s`} />
            <Stat label="Friction" value={`${data.summary.friction_percentage.toFixed(2)}%`} />
            <Stat label="Failures" value={data.summary.total_failures} />
            <Stat label="Failure Rate" value={`${(data.summary.failure_rate * 100).toFixed(1)}%`} />
            <Stat label="Tier" value={data.tier} />
          </div>

          {data.top_targets.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Top Bottlenecks</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333', color: '#888', fontSize: '0.85rem' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem' }}>Target</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Calls</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>% Wait</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Median</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Fails</th>
                    {data.top_targets[0]?.vs_baseline != null && (
                      <th style={{ textAlign: 'right', padding: '0.5rem' }}>vs Pop.</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.top_targets.map((t) => (
                    <tr key={t.target_system_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{t.target_system_id}</td>
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>{t.interaction_count}</td>
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>{(t.proportion_of_total * 100).toFixed(1)}%</td>
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>{t.median_duration_ms}ms</td>
                      <td style={{ textAlign: 'right', padding: '0.5rem', color: t.failure_count > 0 ? '#ef4444' : '#4ade80' }}>{t.failure_count}</td>
                      {t.vs_baseline != null && (
                        <td style={{ textAlign: 'right', padding: '0.5rem', color: t.vs_baseline > 1.5 ? '#f97316' : '#4ade80' }}>{t.vs_baseline}x</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 8, padding: '1rem' }}>
      <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
