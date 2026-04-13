'use client';

import { useState, useEffect } from 'react';
import { getLeaderboard, type LeaderboardResponse } from '../../lib/api';

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

function reliabilityScore(failureRate: number, anomalyRate: number): { label: string; color: string } {
  const combined = failureRate + anomalyRate;
  if (combined === 0) return { label: 'Excellent', color: '#22c55e' };
  if (combined < 0.05) return { label: 'Good', color: '#4a9eff' };
  if (combined < 0.15) return { label: 'Fair', color: '#f97316' };
  return { label: 'Poor', color: '#ef4444' };
}

export default function Leaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'systems' | 'skills' | 'reliability'>('systems');

  useEffect(() => {
    getLeaderboard()
      .then(d => { if (!(d as unknown as { error?: unknown }).error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (!data) return <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '4rem' }}>Failed to load leaderboard</p>;

  const sortedByReliability = [...data.systems].sort((a, b) =>
    (a.failure_rate + a.anomaly_rate) - (b.failure_rate + b.anomaly_rate)
  );

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>ACR Network Leaderboard</h1>
      <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Anonymous aggregate data from the ACR network (last 7 days). No individual agent data is shown.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        <Stat label="Active Agents" value={data.totals.total_agents} />
        <Stat label="Interactions (7d)" value={data.totals.total_interactions.toLocaleString()} />
        <Stat label="Systems Tracked" value={data.totals.total_systems} />
        <Stat label="Skills Observed" value={data.totals.total_skills} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem' }}>
        {(['systems', 'skills', 'reliability'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
            background: tab === t ? '#4a9eff' : '#1a1a1a', color: tab === t ? '#fff' : '#888', fontWeight: 500,
            textTransform: 'capitalize',
          }}>{t === 'systems' ? 'Most Used' : t === 'skills' ? 'Top Skills' : 'Reliability'}</button>
        ))}
      </div>

      {/* Most Used Systems */}
      {tab === 'systems' && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Most Used MCP Servers & APIs</h2>
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
                {data.systems.map((s, i) => (
                  <tr key={s.system_id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.5rem', color: '#666' }}>{i + 1}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.system_id}</td>
                    <td style={{ padding: '0.5rem', color: '#888' }}>{s.system_type}</td>
                    <td style={{ padding: '0.5rem', fontWeight: 600 }}>{s.agent_count}</td>
                    <td style={{ padding: '0.5rem' }}>{s.total_interactions.toLocaleString()}</td>
                    <td style={{ padding: '0.5rem', color: rateColor(s.failure_rate) }}>{(s.failure_rate * 100).toFixed(1)}%</td>
                    <td style={{ padding: '0.5rem', color: rateColor(s.anomaly_rate) }}>{(s.anomaly_rate * 100).toFixed(1)}%</td>
                    <td style={{ padding: '0.5rem' }}>{s.median_duration_ms != null ? `${s.median_duration_ms}ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Top Skills */}
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
                  {data.skills.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '0.5rem', color: '#666' }}>{i + 1}</td>
                      <td style={{ padding: '0.5rem', fontWeight: 500 }}>{s.skill_name || 'unknown'}</td>
                      <td style={{ padding: '0.5rem', color: '#888' }}>{s.skill_source || '—'}</td>
                      <td style={{ padding: '0.5rem', fontWeight: 600 }}>{s.agent_count}</td>
                      <td style={{ padding: '0.5rem' }}>{s.interaction_count}</td>
                      <td style={{ padding: '0.5rem', color: s.anomaly_signal_count > 0 ? '#f97316' : '#22c55e' }}>
                        {s.anomaly_signal_count}
                      </td>
                      <td style={{ padding: '0.5rem', color: s.anomaly_signal_rate > 0.1 ? '#ef4444' : '#888' }}>
                        {(s.anomaly_signal_rate * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Reliability Rankings */}
      {tab === 'reliability' && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Reliability Rankings</h2>
          <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '1rem' }}>
            Sorted by combined failure + anomaly rate (lower is better).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sortedByReliability.map((s, i) => {
              const score = reliabilityScore(s.failure_rate, s.anomaly_rate);
              return (
                <div key={s.system_id} style={{
                  display: 'flex', alignItems: 'center', gap: '1rem',
                  background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '0.75rem 1rem',
                }}>
                  <span style={{ color: '#666', fontSize: '1.1rem', fontWeight: 600, width: 30 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.system_id}</div>
                    <div style={{ color: '#888', fontSize: '0.75rem' }}>
                      {s.agent_count} agents &middot; {s.total_interactions.toLocaleString()} interactions &middot; {s.median_duration_ms ?? '?'}ms median
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: score.color, fontWeight: 600, fontSize: '0.9rem' }}>{score.label}</div>
                    <div style={{ color: '#666', fontSize: '0.75rem' }}>
                      {(s.failure_rate * 100).toFixed(1)}% fail &middot; {(s.anomaly_rate * 100).toFixed(1)}% anomaly
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ marginTop: '2rem', padding: '1rem', background: '#141414', border: '1px solid #222', borderRadius: '8px', fontSize: '0.8rem', color: '#666' }}>
        This data is aggregated anonymously across the ACR network. No individual agent identities are included.
        Updated every 15 minutes. Data covers the last 7 days.
      </div>
    </div>
  );
}
