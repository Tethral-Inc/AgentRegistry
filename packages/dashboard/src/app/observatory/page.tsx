'use client';

import { useState, useEffect, useCallback } from 'react';
import { getNetworkStatus, getObservatorySummary, type NetworkStatusResponse, type ObservatorySummary } from '../../lib/api';
import { Stat } from '../../components/Stat';
import { PageError } from '../../components/PageError';
import { rateColor, formatTimestamp } from '../../lib/format';

export default function Observatory() {
  const [status, setStatus] = useState<NetworkStatusResponse | null>(null);
  const [summary, setSummary] = useState<ObservatorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState('');

  const loadData = useCallback(async (isBackground = false) => {
    try {
      setError(null);
      if (!isBackground) setLoading(true);
      else setRefreshing(true);
      const [networkStatus, obs] = await Promise.all([getNetworkStatus(), getObservatorySummary()]);
      setStatus(networkStatus);
      setSummary(obs);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => loadData(true), 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  if (loading) return <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (error) return <PageError message={error} onRetry={() => loadData()} />;
  if (!status) return null;

  const totals = status.totals;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Network Observatory</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {refreshing && <span style={{ color: '#4a9eff', fontSize: '0.8rem' }}>Refreshing...</span>}
          <span style={{ color: '#666', fontSize: '0.8rem' }}>{lastRefresh}</span>
          <button onClick={() => loadData()} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#e0e0e0', padding: '0.4rem 0.8rem', cursor: 'pointer' }}>Refresh</button>
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
        <Stat label="Active Agents" value={totals.active_agents} />
        <Stat label="Systems" value={totals.active_systems} />
        <Stat label="24h Interactions" value={totals.interactions_24h.toLocaleString()} />
        <Stat label="Anomaly Rate" value={`${(totals.anomaly_rate_24h * 100).toFixed(1)}%`} />
        {summary && <Stat label="Targets Tracked" value={summary.targets_tracked} />}
        {summary && <Stat label="Skills w/ Signals" value={summary.skills_with_signals} />}
      </div>

      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Systems ({status.systems.length}, worst-first)</h2>
      {status.systems.length === 0 ? (
        <p style={{ color: '#666' }}>No system health data yet. Data populates as agents log interactions.</p>
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
              {status.systems.map(sys => (
                <tr key={sys.system_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{sys.system_id}</td>
                  <td style={{ padding: '0.5rem' }}>{sys.agent_count}</td>
                  <td style={{ padding: '0.5rem', color: rateColor(sys.failure_rate) }}>{(sys.failure_rate * 100).toFixed(1)}%</td>
                  <td style={{ padding: '0.5rem', color: rateColor(sys.anomaly_rate) }}>{(sys.anomaly_rate * 100).toFixed(1)}%</td>
                  <td style={{ padding: '0.5rem' }}>{sys.median_duration_ms ?? '\u2014'}</td>
                  <td style={{ padding: '0.5rem' }}>{sys.p95_duration_ms ?? '\u2014'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: '1.1rem', margin: '2rem 0 0.75rem' }}>Skill Anomaly Signals ({status.threats.length})</h2>
      {status.threats.length === 0 ? (
        <p style={{ color: '#666' }}>No elevated anomaly signals.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {status.threats.map(threat => (
            <div key={threat.skill_hash} style={{ background: '#1a1a1a', border: '1px solid #222', borderLeft: '3px solid #f97316', borderRadius: '6px', padding: '0.75rem 1rem' }}>
              <strong>{threat.skill_name || threat.skill_hash.substring(0, 16) + '...'}</strong>
              <span style={{ color: '#888', marginLeft: '1rem' }}>
                {threat.anomaly_signal_count} signals from {threat.agent_count} agents ({(threat.anomaly_signal_rate * 100).toFixed(0)}% rate)
              </span>
            </div>
          ))}
        </div>
      )}

      {status.recent_escalations.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.1rem', margin: '2rem 0 0.75rem' }}>Recent Escalations ({status.recent_escalations.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {status.recent_escalations.map((esc, i) => (
              <div key={i} style={{ background: '#1a1a1a', border: '1px solid #222', borderLeft: '3px solid #ef4444', borderRadius: '6px', padding: '0.75rem 1rem' }}>
                <div><strong style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{esc.target}</strong> — {esc.agents_affected} agents affected</div>
                {esc.providers_affected && esc.providers_affected.length > 0 && (
                  <div style={{ color: '#888', fontSize: '0.8rem' }}>Providers: {esc.providers_affected.join(', ')}</div>
                )}
                {esc.anomaly_categories && esc.anomaly_categories.length > 0 && (
                  <div style={{ color: '#888', fontSize: '0.8rem' }}>Categories: {esc.anomaly_categories.join(', ')}</div>
                )}
                <div style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.25rem' }}>{formatTimestamp(esc.detected_at)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
