'use client';

import { useState } from 'react';
import { Stat } from '../../components/Stat';
import { getAgentFriction } from '../../lib/api';
import { formatMs } from '../../lib/format';

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

const SCOPE_LABELS = { session: 'Last Session', day: 'Last 24h', week: 'Last 7d' } as const;

export default function OperatorPortal() {
  const [agentId, setAgentId] = useState('');
  const [scope, setScope] = useState<'session' | 'day' | 'week'>('day');
  const [data, setData] = useState<FrictionData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function fetchFriction() {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      const json = await getAgentFriction(agentId, scope) as unknown as FrictionData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach ACR API');
      setData(null);
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
          onKeyDown={(e) => e.key === 'Enter' && fetchFriction()}
          placeholder="Agent ID (acr_...)"
          style={{ flex: 1, minWidth: 200, padding: '0.5rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'monospace' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {(Object.entries(SCOPE_LABELS) as [keyof typeof SCOPE_LABELS, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setScope(key)}
            style={{ padding: '0.5rem 1rem', background: scope === key ? '#4a9eff' : '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
        <button onClick={fetchFriction} disabled={loading || !agentId}
          style={{ padding: '0.5rem 1.5rem', background: '#4a9eff', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', marginLeft: 'auto' }}>
          {loading ? 'Loading...' : 'Get Report'}
        </button>
      </div>

      {error && (
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
          <button onClick={fetchFriction} style={{ padding: '0.4rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {data && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <Stat label="Interactions" value={data.summary.total_interactions} />
            <Stat label="Wait Time" value={formatMs(data.summary.total_wait_time_ms)} />
            <Stat label="Friction" value={`${data.summary.friction_percentage.toFixed(2)}%`} />
            <Stat label="Failures" value={data.summary.total_failures} />
            <Stat label="Failure Rate" value={`${(data.summary.failure_rate * 100).toFixed(1)}%`} />
            <Stat label="Tier" value={data.tier} />
          </div>

          {data.top_targets.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Top Bottlenecks</h3>
              <div style={{ overflowX: 'auto' }}>
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
                    {data.top_targets.map((target) => (
                      <tr key={target.target_system_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{target.target_system_id}</td>
                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{target.interaction_count}</td>
                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{(target.proportion_of_total * 100).toFixed(1)}%</td>
                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{formatMs(target.median_duration_ms)}</td>
                        <td style={{ textAlign: 'right', padding: '0.5rem', color: target.failure_count > 0 ? '#ef4444' : '#4ade80' }}>{target.failure_count}</td>
                        {target.vs_baseline != null && (
                          <td style={{ textAlign: 'right', padding: '0.5rem', color: target.vs_baseline > 1.5 ? '#f97316' : '#4ade80' }}>{target.vs_baseline}x</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
