'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  getAgentCompensation,
  type CompensationResponse,
} from '../../../../lib/api';
import { Stat } from '../../../../components/Stat';
import { PageError } from '../../../../components/PageError';
import { ApiKeyInput } from '../../../../components/ApiKeyInput';
import { AgentLensNav } from '../../../../components/AgentLensNav';

const WINDOW_LABELS: Record<string, string> = {
  day: 'Day',
  week: 'Week',
};

function stabilityReading(score: number): { label: string; color: string } {
  if (score >= 0.9) return { label: 'Near-deterministic', color: '#22c55e' };
  if (score >= 0.7) return { label: 'Highly routine', color: '#86efac' };
  if (score >= 0.4) return { label: 'Mixed', color: '#eab308' };
  if (score >= 0.2) return { label: 'Exploratory', color: '#f97316' };
  return { label: 'Unstable', color: '#ef4444' };
}

function stabilityBar(score: number): string {
  const filled = Math.round(score * 20);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(20 - filled);
}

export default function CompensationDashboard() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<CompensationResponse | null>(null);
  const [window, setWindow] = useState<string>('week');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAgentCompensation(id, w));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(window); }, [window, load]);

  if ((loading && !data) || error || !data) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <a href={`/agents/${id}`} style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>&larr; Back to profile</a>
        <div style={{ marginTop: '1rem' }}>
          <ApiKeyInput onChange={() => load(window)} />
        </div>
        {loading && !data && <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>}
        {error && !loading && <PageError message={error} onRetry={() => load(window)} />}
      </div>
    );
  }

  const s = data.summary;
  const stability = stabilityReading(s.agent_stability);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <a href={`/agents/${id}`} style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>&larr; Back to profile</a>

      <div style={{ marginTop: '1rem' }}>
        <ApiKeyInput onChange={() => load(window)} />
      </div>

      <div style={{ margin: '1rem 0 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Compensation Signatures</h1>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>{data.name || id}</span>
      </div>

      <AgentLensNav agentId={id} active="compensation" />

      <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.5 }}>
        Every multi-step chain is fingerprinted by its target sequence. <b style={{ color: '#ccc' }}>Agent stability</b> is
        how concentrated those sequences are (one pattern → 1.0, everything unique → 0.0). A persistent
        low-stability tail with real frequency is the kind of signal that *can* be ongoing compensation — read it
        together with the friction report for the involved targets.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {Object.entries(WINDOW_LABELS).map(([key, label]) => (
            <button key={key} onClick={() => setWindow(key)} style={{
              padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
              background: window === key ? '#4a9eff' : '#1a1a1a', color: window === key ? '#fff' : '#888', fontWeight: 500, fontSize: '0.8rem',
            }}>{label}</button>
          ))}
        </div>
        <div style={{ color: '#666', fontSize: '0.75rem' }}>
          Computed: {data.computed_at ?? <span style={{ color: '#444' }}>never (no chains logged yet)</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <Stat label="Total chains" value={s.total_chains} />
        <Stat label="Distinct patterns" value={s.distinct_patterns} />
        <Stat label="Agent stability" value={s.agent_stability.toFixed(3)} />
      </div>

      {s.total_chains > 0 && (
        <div style={{
          padding: '0.75rem 1rem',
          border: `1px solid ${stability.color}`,
          background: '#141414',
          borderRadius: '6px',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ fontFamily: 'monospace', color: stability.color, fontSize: '0.8rem' }}>
            {stabilityBar(s.agent_stability)}
          </div>
          <div style={{ color: stability.color, fontWeight: 600 }}>{stability.label}</div>
          <div style={{ color: '#888', fontSize: '0.75rem' }}>
            Continuum reading — not a verdict. Low values can reflect exploration, task variety, or ongoing compensation.
          </div>
        </div>
      )}

      {s.total_chains === 0 && (
        <p style={{ color: '#666' }}>
          No multi-step chains in this window. Pass <code style={{ color: '#ccc', background: '#222', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>chain_id</code> and
          <code style={{ color: '#ccc', background: '#222', padding: '0.1rem 0.3rem', borderRadius: '3px', marginLeft: '0.25rem' }}>chain_position</code> to
          log_interaction on sequential calls, and wait for the nightly analysis to run.
        </p>
      )}

      {data.patterns.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.1rem', margin: '1.5rem 0 0.5rem' }}>Patterns</h2>
          <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Ranked by frequency. Low pattern_stability with persistent frequency = long-tail behavior worth watching.
          </div>
          <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #252525' }}>
                  {['Pattern', 'Freq', 'Stability', 'Share', 'Overhead', 'Fleet'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.patterns.map((p) => {
                  const readings = stabilityReading(p.pattern_stability);
                  return (
                    <tr key={p.pattern_hash} style={{ borderBottom: '1px solid #1a1a1a', borderLeft: `3px solid ${readings.color}` }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {p.chain_pattern.join(' \u2192 ')}
                      </td>
                      <td style={{ padding: '0.5rem' }}>{p.frequency}</td>
                      <td style={{ padding: '0.5rem', color: readings.color }}>{p.pattern_stability.toFixed(3)}</td>
                      <td style={{ padding: '0.5rem', color: '#888' }}>{(p.share_of_chains * 100).toFixed(1)}%</td>
                      <td style={{ padding: '0.5rem', color: '#888' }}>{p.avg_overhead_ms > 0 ? `${p.avg_overhead_ms}ms` : <span style={{ color: '#444' }}>&mdash;</span>}</td>
                      <td style={{ padding: '0.5rem', color: '#888', fontSize: '0.75rem' }}>
                        {p.fleet_agent_count == null ? (
                          <span style={{ color: '#444' }}>&mdash;</span>
                        ) : p.fleet_agent_count === 1 ? (
                          <span style={{ color: '#f97316' }}>idiosyncratic</span>
                        ) : (
                          `${p.fleet_agent_count} agents`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
