'use client';

import { useState, useEffect, useCallback } from 'react';
import { getLeaderboard, type LeaderboardResponse } from '../../lib/api';
import { Stat } from '../../components/Stat';
import { PageError } from '../../components/PageError';
import { rateColor } from '../../lib/format';

/** Combined failure + anomaly rate → human label. Thresholds: 0 = Excellent, <5% = Good, <15% = Fair, else Poor. */
function reliabilityLabel(failureRate: number, anomalyRate: number): { label: string; color: string } {
  const combined = failureRate + anomalyRate;
  if (combined < 0.001) return { label: 'Excellent', color: '#22c55e' };
  if (combined < 0.05) return { label: 'Good', color: '#4a9eff' };
  if (combined < 0.15) return { label: 'Fair', color: '#f97316' };
  return { label: 'Poor', color: '#ef4444' };
}

export default function Leaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'systems' | 'skills' | 'reliability'>('systems');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getLeaderboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (error) return <PageError message={error} onRetry={loadData} />;
  if (!data) return null;

  const sortedByReliability = [...data.systems].sort((a, b) =>
    (a.failure_rate + a.anomaly_rate) - (b.failure_rate + b.anomaly_rate)
  );

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>ACR Network Leaderboard</h1>
      <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Anonymous aggregate data from the ACR (Agent Composition Records) network over the last 7 days.
        Shows which MCP servers, APIs, and skills are most used and how reliably they perform.
        No individual agent data is included.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        <Stat label="Active Agents" value={data.totals.total_agents} />
        <Stat label="Interactions (7d)" value={data.totals.total_interactions.toLocaleString()} />
        <Stat label="Systems Tracked" value={data.totals.total_systems} />
        <Stat label="Skills Observed" value={data.totals.total_skills} />
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem' }}>
        {([['systems', 'Most Used'], ['skills', 'Top Skills'], ['reliability', 'Reliability']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
            background: tab === key ? '#4a9eff' : '#1a1a1a', color: tab === key ? '#fff' : '#888', fontWeight: 500,
          }}>{label}</button>
        ))}
      </div>

      {tab === 'systems' && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Most Used MCP Servers & APIs</h2>
          {data.systems.length === 0 ? (
            <p style={{ color: '#666' }}>No system data yet. Data populates as agents log interactions.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem', color: '#666', fontWeight: 500, width: 30 }}>#</th>
                    {['System', 'Type', 'Agents', 'Interactions', 'Failure', 'Anomaly', 'Median'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.systems.map((sys, i) => (
                    <tr key={sys.system_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '0.5rem', color: '#666' }}>{i + 1}</td>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{sys.system_id}</td>
                      <td style={{ padding: '0.5rem', color: '#888' }}>{sys.system_type}</td>
                      <td style={{ padding: '0.5rem', fontWeight: 600 }}>{sys.agent_count}</td>
                      <td style={{ padding: '0.5rem' }}>{sys.total_interactions.toLocaleString()}</td>
                      <td style={{ padding: '0.5rem', color: rateColor(sys.failure_rate) }}>{(sys.failure_rate * 100).toFixed(1)}%</td>
                      <td style={{ padding: '0.5rem', color: rateColor(sys.anomaly_rate) }}>{(sys.anomaly_rate * 100).toFixed(1)}%</td>
                      <td style={{ padding: '0.5rem' }}>{sys.median_duration_ms != null ? `${sys.median_duration_ms}ms` : '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'skills' && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Most Adopted Skills</h2>
          {data.skills.length === 0 ? (
            <p style={{ color: '#666' }}>No skill adoption data yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem', color: '#666', fontWeight: 500, width: 30 }}>#</th>
                    {['Skill', 'Source', 'Agents', 'Interactions', 'Anomaly Signals', 'Signal Rate'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.skills.map((skill, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '0.5rem', color: '#666' }}>{i + 1}</td>
                      <td style={{ padding: '0.5rem', fontWeight: 500 }}>{skill.skill_name || 'unknown'}</td>
                      <td style={{ padding: '0.5rem', color: '#888' }}>{skill.skill_source || '\u2014'}</td>
                      <td style={{ padding: '0.5rem', fontWeight: 600 }}>{skill.agent_count}</td>
                      <td style={{ padding: '0.5rem' }}>{skill.interaction_count}</td>
                      <td style={{ padding: '0.5rem', color: skill.anomaly_signal_count > 0 ? '#f97316' : '#22c55e' }}>
                        {skill.anomaly_signal_count}
                      </td>
                      <td style={{ padding: '0.5rem', color: skill.anomaly_signal_rate > 0.1 ? '#ef4444' : '#888' }}>
                        {(skill.anomaly_signal_rate * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'reliability' && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Reliability Rankings</h2>
          <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '1rem' }}>
            Ranked by combined failure + anomaly rate (lower is better).
          </p>
          {sortedByReliability.length === 0 ? (
            <p style={{ color: '#666' }}>No system data yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {sortedByReliability.map((sys, i) => {
                const score = reliabilityLabel(sys.failure_rate, sys.anomaly_rate);
                return (
                  <div key={sys.system_id} style={{
                    display: 'flex', alignItems: 'center', gap: '1rem',
                    background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '0.75rem 1rem',
                  }}>
                    <span style={{ color: '#666', fontSize: '1.1rem', fontWeight: 600, width: 30 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{sys.system_id}</div>
                      <div style={{ color: '#888', fontSize: '0.75rem' }}>
                        {sys.agent_count} agents &middot; {sys.total_interactions.toLocaleString()} interactions &middot; {sys.median_duration_ms ?? '?'}ms median
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: score.color, fontWeight: 600, fontSize: '0.9rem' }}>{score.label}</div>
                      <div style={{ color: '#666', fontSize: '0.75rem' }}>
                        {(sys.failure_rate * 100).toFixed(1)}% fail &middot; {(sys.anomaly_rate * 100).toFixed(1)}% anomaly
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: '2rem', padding: '1rem', background: '#141414', border: '1px solid #222', borderRadius: '8px', fontSize: '0.8rem', color: '#666' }}>
        Aggregated anonymously across the ACR network. No individual agent identities included.
        Updated every 15 minutes. Data covers the last 7 days.
      </div>
    </div>
  );
}
