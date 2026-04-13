'use client';

import { useState, useEffect, useCallback } from 'react';
import { getNetworkStatus, getObservatorySummary, type NetworkStatusResponse, type ObservatorySummary } from '../../lib/api';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '1rem' }}>
      <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function rateColor(rate: number): string {
  if (rate >= 0.1) return '#ef4444';
  if (rate >= 0.05) return '#f97316';
  return '#22c55e';
}

export default function Observatory() {
  const [status, setStatus] = useState<NetworkStatusResponse | null>(null);
  const [summary, setSummary] = useState<ObservatorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState('');

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [s, o] = await Promise.all([getNetworkStatus(), getObservatorySummary()]);
      if ((s as unknown as { error?: unknown }).error) throw new Error('Failed to load network status');
      setStatus(s);
      setSummary(o);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  if (loading) return <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (error) return <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '4rem' }}>{error}</p>;
  if (!status) return null;

  const t = status.totals;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Network Observatory</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: '0.8rem' }}>{lastRefresh}</span>
          <button onClick={loadData} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#e0e0e0', padding: '0.4rem 0.8rem', cursor: 'pointer' }}>Refresh</button>
          <button onClick={() => setAutoRefresh(!autoRefresh)} style={{ background: autoRefresh ? '#4a9eff' : '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: autoRefresh ? '#fff' : '#888', padding: '0.4rem 0.8rem', cursor: 'pointer' }}>
            Auto {autoRefresh ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {status.stale && (
        <div style={{ background: '#332200', border: '1px solid #665500', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1.5rem', color: '#f97316' }}>
          Data may be stale — background jobs may not have run recently.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        <Stat label="Active Agents" value={t.active_agents} />
        <Stat label="Systems" value={t.active_systems} />
        <Stat label="24h Interactions" value={t.interactions_24h.toLocaleString()} />
        <Stat label="Anomaly Rate" value={`${(t.anomaly_rate_24h * 100).toFixed(1)}%`} />
        {summary && <Stat label="Targets Tracked" value={summary.targets_tracked} />}
        {summary && <Stat label="Skills w/ Signals" value={summary.skills_with_signals} />}
      </div>

      {/* Systems table */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Systems ({status.systems.length}, worst-first)</h2>
      {status.systems.length === 0 ? (
        <p style={{ color: '#666' }}>No system health data yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                {['System', 'Agents', 'Failure', 'Anomaly', 'Median ms', 'P95 ms'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {status.systems.map(s => (
                <tr key={s.system_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.system_id}</td>
                  <td style={{ padding: '0.5rem' }}>{s.agent_count}</td>
                  <td style={{ padding: '0.5rem', color: rateColor(s.failure_rate) }}>{(s.failure_rate * 100).toFixed(1)}%</td>
                  <td style={{ padding: '0.5rem', color: rateColor(s.anomaly_rate) }}>{(s.anomaly_rate * 100).toFixed(1)}%</td>
                  <td style={{ padding: '0.5rem' }}>{s.median_duration_ms ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{s.p95_duration_ms ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Skill anomaly signals */}
      <h2 style={{ fontSize: '1.1rem', margin: '2rem 0 0.75rem' }}>Skill Anomaly Signals ({status.threats.length})</h2>
      {status.threats.length === 0 ? (
        <p style={{ color: '#666' }}>No elevated anomaly signals.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {status.threats.map(th => (
            <div key={th.skill_hash} style={{ background: '#1a1a1a', border: '1px solid #222', borderLeft: '3px solid #f97316', borderRadius: '6px', padding: '0.75rem 1rem' }}>
              <strong>{th.skill_name || th.skill_hash.substring(0, 16) + '...'}</strong>
              <span style={{ color: '#888', marginLeft: '1rem' }}>
                {th.anomaly_signal_count} signals from {th.agent_count} agents ({(th.anomaly_signal_rate * 100).toFixed(0)}% rate)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recent escalations */}
      {status.recent_escalations.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.1rem', margin: '2rem 0 0.75rem' }}>Recent Escalations ({status.recent_escalations.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {status.recent_escalations.map((e, i) => (
              <div key={i} style={{ background: '#1a1a1a', border: '1px solid #222', borderLeft: '3px solid #ef4444', borderRadius: '6px', padding: '0.75rem 1rem' }}>
                <div><strong style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{e.target}</strong> — {e.agents_affected} agents affected</div>
                {e.providers_affected && e.providers_affected.length > 0 && (
                  <div style={{ color: '#888', fontSize: '0.8rem' }}>Providers: {e.providers_affected.join(', ')}</div>
                )}
                {e.anomaly_categories && e.anomaly_categories.length > 0 && (
                  <div style={{ color: '#888', fontSize: '0.8rem' }}>Categories: {e.anomaly_categories.join(', ')}</div>
                )}
                <div style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.25rem' }}>{e.detected_at}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
