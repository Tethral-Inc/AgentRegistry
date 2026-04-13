'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getAgentFriction, type FrictionResponse } from '../../../../lib/api';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '1rem' }}>
      <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

const SCOPES = ['session', 'day', 'week'] as const;

export default function FrictionDashboard() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<FrictionResponse | null>(null);
  const [scope, setScope] = useState<string>('day');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set());

  const loadFriction = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAgentFriction(id, s);
      if ((res as unknown as { error?: { message: string } }).error) {
        throw new Error((res as unknown as { error: { message: string } }).error.message);
      }
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadFriction(scope); }, [scope, loadFriction]);

  const toggleTarget = (t: string) => {
    setExpandedTargets(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  if (loading && !data) return <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (error) return <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '4rem' }}>{error}</p>;
  if (!data) return null;

  const s = data.summary;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <a href={`/agents/${id}`} style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>&larr; Back to profile</a>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Friction Dashboard</h1>
          <span style={{ color: '#888', fontSize: '0.85rem' }}>{data.name || id}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {SCOPES.map(sc => (
            <button key={sc} onClick={() => setScope(sc)} style={{
              padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
              background: scope === sc ? '#4a9eff' : '#1a1a1a', color: scope === sc ? '#fff' : '#888', fontWeight: 500,
            }}>{sc}</button>
          ))}
        </div>
      </div>

      <div style={{ color: '#666', fontSize: '0.75rem', marginBottom: '1.5rem' }}>
        {data.period_start} &mdash; {data.period_end}
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        <Stat label="Interactions" value={s.total_interactions} />
        <Stat label="Total Wait" value={formatMs(s.total_wait_time_ms)} />
        <Stat label="Friction" value={`${s.friction_percentage.toFixed(2)}%`} />
        <Stat label="Failures" value={s.total_failures} />
        <Stat label="Failure Rate" value={`${(s.failure_rate * 100).toFixed(1)}%`} />
      </div>

      {/* Top Targets */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Top Friction Targets</h2>
      {data.top_targets.length === 0 ? (
        <p style={{ color: '#666' }}>No target data in this period.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['Target', 'Calls', '% Wait', 'Median', 'P95', 'Failures', 'vs Base', 'Volatility'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.top_targets.map(t => {
                const hasAnomalies = t.recent_anomalies && t.recent_anomalies.length > 0;
                const expanded = expandedTargets.has(t.target_system_id);
                return (
                  <tr key={t.target_system_id} style={{ borderBottom: '1px solid #1a1a1a', cursor: hasAnomalies ? 'pointer' : 'default' }} onClick={() => hasAnomalies && toggleTarget(t.target_system_id)}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {t.target_system_id}
                      {hasAnomalies && <span style={{ color: '#f97316', marginLeft: '0.5rem' }}>{expanded ? '▼' : '▶'} {t.recent_anomalies!.length}</span>}
                    </td>
                    <td style={{ padding: '0.5rem' }}>{t.interaction_count}</td>
                    <td style={{ padding: '0.5rem' }}>{(t.proportion_of_total * 100).toFixed(1)}%</td>
                    <td style={{ padding: '0.5rem' }}>{formatMs(t.median_duration_ms)}</td>
                    <td style={{ padding: '0.5rem' }}>{t.p95_duration_ms ? formatMs(t.p95_duration_ms) : '—'}</td>
                    <td style={{ padding: '0.5rem', color: t.failure_count > 0 ? '#ef4444' : '#22c55e' }}>{t.failure_count}</td>
                    <td style={{ padding: '0.5rem', color: t.vs_baseline != null && t.vs_baseline > 1.5 ? '#f97316' : '#e0e0e0' }}>
                      {t.vs_baseline != null ? `${t.vs_baseline.toFixed(1)}x` : '—'}
                    </td>
                    <td style={{ padding: '0.5rem' }}>{t.volatility != null ? t.volatility.toFixed(2) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Expanded anomaly details */}
          {data.top_targets.filter(t => expandedTargets.has(t.target_system_id) && t.recent_anomalies?.length).map(t => (
            <div key={`anomalies-${t.target_system_id}`} style={{ borderLeft: '3px solid #f97316', margin: '0.25rem 0 0.5rem 1rem', padding: '0.5rem 0.75rem', background: '#141414' }}>
              {t.recent_anomalies!.map((a, i) => (
                <div key={i} style={{ fontSize: '0.8rem', padding: '0.25rem 0', color: '#ccc' }}>
                  <span style={{ color: '#666' }}>{a.timestamp}</span> — {a.category ?? 'unknown'}: {a.detail ?? 'no detail'}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Chain Analysis */}
      {data.chain_analysis && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Chain Analysis</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
            <Stat label="Distinct Chains" value={data.chain_analysis.chain_count} />
            <Stat label="Avg Length" value={data.chain_analysis.avg_chain_length} />
            <Stat label="Total Overhead" value={formatMs(data.chain_analysis.total_chain_overhead_ms)} />
          </div>
          {data.chain_analysis.top_patterns && data.chain_analysis.top_patterns.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: '2rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem', color: '#888' }}>Pattern</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', color: '#888' }}>Frequency</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', color: '#888' }}>Avg Overhead</th>
                </tr>
              </thead>
              <tbody>
                {data.chain_analysis.top_patterns.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.chain_pattern.join(' → ')}</td>
                    <td style={{ padding: '0.5rem' }}>{p.frequency}</td>
                    <td style={{ padding: '0.5rem' }}>{formatMs(p.avg_overhead_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Directional Pairs */}
      {data.directional_pairs && data.directional_pairs.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Directional Friction Pairs</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: '2rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['Source → Dest', 'Preceded', 'Standalone', 'Amplification', 'Samples'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.directional_pairs.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.source_target} → {p.destination_target}</td>
                  <td style={{ padding: '0.5rem' }}>{formatMs(p.avg_duration_when_preceded)}</td>
                  <td style={{ padding: '0.5rem' }}>{formatMs(p.avg_duration_standalone)}</td>
                  <td style={{ padding: '0.5rem', color: p.amplification_factor > 1.5 ? '#f97316' : '#e0e0e0' }}>{p.amplification_factor.toFixed(2)}x</td>
                  <td style={{ padding: '0.5rem' }}>{p.sample_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* By Category */}
        {data.by_category.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>By Category</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                {['Category', 'Calls', 'Duration', 'Fail'].map(h => <th key={h} style={{ textAlign: 'left', padding: '0.4rem', color: '#888' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.by_category.map(r => (
                  <tr key={r.category} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.4rem' }}>{r.category}</td>
                    <td style={{ padding: '0.4rem' }}>{r.interaction_count}</td>
                    <td style={{ padding: '0.4rem' }}>{formatMs(r.total_duration_ms)}</td>
                    <td style={{ padding: '0.4rem', color: r.failure_count > 0 ? '#ef4444' : '#22c55e' }}>{r.failure_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By Transport */}
        {data.by_transport.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>By Transport</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                {['Transport', 'Calls', 'Duration'].map(h => <th key={h} style={{ textAlign: 'left', padding: '0.4rem', color: '#888' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.by_transport.map(r => (
                  <tr key={r.transport} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.4rem' }}>{r.transport}</td>
                    <td style={{ padding: '0.4rem' }}>{r.interaction_count}</td>
                    <td style={{ padding: '0.4rem' }}>{formatMs(r.total_duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By Source */}
        {data.by_source.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>By Source</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                {['Source', 'Calls'].map(h => <th key={h} style={{ textAlign: 'left', padding: '0.4rem', color: '#888' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.by_source.map(r => (
                  <tr key={r.source} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.4rem' }}>{r.source}</td>
                    <td style={{ padding: '0.4rem' }}>{r.interaction_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
