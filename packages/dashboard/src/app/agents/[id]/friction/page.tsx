'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { getAgentFriction, type FrictionResponse } from '../../../../lib/api';
import { Stat } from '../../../../components/Stat';
import { PageError } from '../../../../components/PageError';
import { formatMs } from '../../../../lib/format';

const SCOPE_LABELS = { session: 'Last Session', day: 'Last 24h', week: 'Last 7d' } as const;

export default function FrictionDashboard() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<FrictionResponse | null>(null);
  const [scope, setScope] = useState<string>('day');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set());

  const loadFriction = useCallback(async (activeScope: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAgentFriction(id, activeScope));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadFriction(scope); }, [scope, loadFriction]);

  const toggleTarget = (targetId: string) => {
    setExpandedTargets(prev => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId); else next.add(targetId);
      return next;
    });
  };

  if (loading && !data) return <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (error) return <PageError message={error} onRetry={() => loadFriction(scope)} />;
  if (!data) return null;

  const summary = data.summary;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <a href={`/agents/${id}`} style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>&larr; Back to profile</a>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Friction Dashboard</h1>
          <span style={{ color: '#888', fontSize: '0.85rem' }}>{data.name || id}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(Object.entries(SCOPE_LABELS) as [string, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setScope(key)} style={{
              padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
              background: scope === key ? '#4a9eff' : '#1a1a1a', color: scope === key ? '#fff' : '#888', fontWeight: 500,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ color: '#666', fontSize: '0.75rem', marginBottom: '1.5rem' }}>
        {data.period_start} &mdash; {data.period_end}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        <Stat label="Interactions" value={summary.total_interactions} />
        <Stat label="Total Wait" value={formatMs(summary.total_wait_time_ms)} />
        <Stat label="Friction" value={`${summary.friction_percentage.toFixed(2)}%`} />
        <Stat label="Failures" value={summary.total_failures} />
        <Stat label="Failure Rate" value={`${(summary.failure_rate * 100).toFixed(1)}%`} />
      </div>

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
              {data.top_targets.map(target => {
                const hasAnomalies = target.recent_anomalies && target.recent_anomalies.length > 0;
                const expanded = expandedTargets.has(target.target_system_id);
                return (
                  <Fragment key={target.target_system_id}>
                    <tr
                      style={{ borderBottom: '1px solid #1a1a1a', cursor: hasAnomalies ? 'pointer' : 'default' }}
                      onClick={() => hasAnomalies && toggleTarget(target.target_system_id)}
                      onMouseEnter={(e) => hasAnomalies && (e.currentTarget.style.background = '#141414')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {target.target_system_id}
                        {hasAnomalies && <span style={{ color: '#f97316', marginLeft: '0.5rem' }}>{expanded ? '\u25BC' : '\u25B6'} {target.recent_anomalies!.length}</span>}
                      </td>
                      <td style={{ padding: '0.5rem' }}>{target.interaction_count}</td>
                      <td style={{ padding: '0.5rem' }}>{(target.proportion_of_total * 100).toFixed(1)}%</td>
                      <td style={{ padding: '0.5rem' }}>{formatMs(target.median_duration_ms)}</td>
                      <td style={{ padding: '0.5rem' }}>{target.p95_duration_ms ? formatMs(target.p95_duration_ms) : '\u2014'}</td>
                      <td style={{ padding: '0.5rem', color: target.failure_count > 0 ? '#ef4444' : '#22c55e' }}>{target.failure_count}</td>
                      <td style={{ padding: '0.5rem', color: target.vs_baseline != null && target.vs_baseline > 1.5 ? '#f97316' : '#e0e0e0' }}>
                        {target.vs_baseline != null ? `${target.vs_baseline.toFixed(1)}x` : '\u2014'}
                      </td>
                      <td style={{ padding: '0.5rem' }}>{target.volatility != null ? target.volatility.toFixed(2) : '\u2014'}</td>
                    </tr>
                    {expanded && target.recent_anomalies?.map((anomaly, i) => (
                      <tr key={`anomaly-${i}`} style={{ background: '#141414' }}>
                        <td colSpan={8} style={{ padding: '0.4rem 0.5rem 0.4rem 2rem', borderLeft: '3px solid #f97316', fontSize: '0.8rem', color: '#ccc' }}>
                          <span style={{ color: '#666' }}>{anomaly.timestamp}</span> — {anomaly.category ?? 'unknown'}: {anomaly.detail ?? 'no detail'}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.chain_analysis && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Chain Analysis</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <Stat label="Distinct Chains" value={data.chain_analysis.chain_count} />
            <Stat label="Avg Length" value={data.chain_analysis.avg_chain_length} />
            <Stat label="Total Overhead" value={formatMs(data.chain_analysis.total_chain_overhead_ms)} />
          </div>
          {data.chain_analysis.top_patterns && data.chain_analysis.top_patterns.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    {['Pattern', 'Frequency', 'Avg Overhead'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.chain_analysis.top_patterns.map((pattern, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{pattern.chain_pattern.join(' \u2192 ')}</td>
                      <td style={{ padding: '0.5rem' }}>{pattern.frequency}</td>
                      <td style={{ padding: '0.5rem' }}>{formatMs(pattern.avg_overhead_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {data.directional_pairs && data.directional_pairs.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Directional Friction Pairs</h2>
          <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  {['Source \u2192 Dest', 'Preceded', 'Standalone', 'Amplification', 'Samples'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.directional_pairs.map((pair, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{pair.source_target} \u2192 {pair.destination_target}</td>
                    <td style={{ padding: '0.5rem' }}>{formatMs(pair.avg_duration_when_preceded)}</td>
                    <td style={{ padding: '0.5rem' }}>{formatMs(pair.avg_duration_standalone)}</td>
                    <td style={{ padding: '0.5rem', color: pair.amplification_factor > 1.5 ? '#f97316' : '#e0e0e0' }}>{pair.amplification_factor.toFixed(2)}x</td>
                    <td style={{ padding: '0.5rem' }}>{pair.sample_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {data.by_category.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>By Category</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                {['Category', 'Calls', 'Duration', 'Fail'].map(h => <th key={h} style={{ textAlign: 'left', padding: '0.4rem', color: '#888' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.by_category.map(row => (
                  <tr key={row.category} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.4rem' }}>{row.category}</td>
                    <td style={{ padding: '0.4rem' }}>{row.interaction_count}</td>
                    <td style={{ padding: '0.4rem' }}>{formatMs(row.total_duration_ms)}</td>
                    <td style={{ padding: '0.4rem', color: row.failure_count > 0 ? '#ef4444' : '#22c55e' }}>{row.failure_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.by_transport.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>By Transport</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                {['Transport', 'Calls', 'Duration'].map(h => <th key={h} style={{ textAlign: 'left', padding: '0.4rem', color: '#888' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.by_transport.map(row => (
                  <tr key={row.transport} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.4rem' }}>{row.transport}</td>
                    <td style={{ padding: '0.4rem' }}>{row.interaction_count}</td>
                    <td style={{ padding: '0.4rem' }}>{formatMs(row.total_duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.by_source.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>By Source</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                {['Source', 'Calls'].map(h => <th key={h} style={{ textAlign: 'left', padding: '0.4rem', color: '#888' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.by_source.map(row => (
                  <tr key={row.source} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.4rem' }}>{row.source}</td>
                    <td style={{ padding: '0.4rem' }}>{row.interaction_count}</td>
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
