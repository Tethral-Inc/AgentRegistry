'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  getAgentRevealedPreference,
  type RevealedPreferenceResponse,
  type RevealedPreferenceClassification,
} from '../../../../lib/api';
import { Stat } from '../../../../components/Stat';
import { PageError } from '../../../../components/PageError';
import { ApiKeyInput } from '../../../../components/ApiKeyInput';
import { AgentLensNav } from '../../../../components/AgentLensNav';

const SCOPE_LABELS: Record<string, string> = {
  yesterday: 'Yesterday',
  day: 'Today',
  week: 'Last 7d',
  month: 'Last 30d',
};

const SOURCE_LABELS: Record<string, string> = {
  agent: 'Agent log',
  server: 'Server self-log',
  all: 'All sources',
};

const CLASS_META: Record<RevealedPreferenceClassification, { label: string; color: string; border: string; description: string }> = {
  bound_uncalled: {
    label: 'Bound, uncalled',
    color: '#f59e0b',
    border: '#f59e0b',
    description: 'Declared in composition but never called in this window. Dead weight.',
  },
  called_unbound: {
    label: 'Called, unbound',
    color: '#ef4444',
    border: '#ef4444',
    description: 'Called but not declared — your composition does not describe reality.',
  },
  bound_underused: {
    label: 'Bound, underused',
    color: '#eab308',
    border: '#ca8a04',
    description: 'Declared, called fewer than 3 times. Possibly low-value, possibly task-gated.',
  },
  bound_active: {
    label: 'Bound, active',
    color: '#22c55e',
    border: '#22c55e',
    description: 'Declared and used meaningfully — healthy.',
  },
};

const CLASS_ORDER: RevealedPreferenceClassification[] = [
  'bound_uncalled',
  'called_unbound',
  'bound_underused',
  'bound_active',
];

export default function RevealedPreferenceDashboard() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<RevealedPreferenceResponse | null>(null);
  const [scope, setScope] = useState<string>('yesterday');
  const [source, setSource] = useState<string>('agent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (activeScope: string, activeSource: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAgentRevealedPreference(id, activeScope, activeSource));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(scope, source); }, [scope, source, load]);

  if ((loading && !data) || error || !data) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <a href={`/agents/${id}`} style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>&larr; Back to profile</a>
        <div style={{ marginTop: '1rem' }}>
          <ApiKeyInput onChange={() => load(scope, source)} />
        </div>
        {loading && !data && <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>}
        {error && !loading && <PageError message={error} onRetry={() => load(scope, source)} />}
      </div>
    );
  }

  const s = data.summary;

  const targetsByClass: Record<RevealedPreferenceClassification, typeof data.targets> = {
    bound_uncalled: [],
    called_unbound: [],
    bound_underused: [],
    bound_active: [],
  };
  for (const t of data.targets) targetsByClass[t.classification].push(t);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <a href={`/agents/${id}`} style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>&larr; Back to profile</a>

      <div style={{ marginTop: '1rem' }}>
        <ApiKeyInput onChange={() => load(scope, source)} />
      </div>

      <div style={{ margin: '1rem 0 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Revealed Preference</h1>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>{data.name || id}</span>
      </div>

      <AgentLensNav agentId={id} active="revealed-preference" />

      <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.5 }}>
        Every target is classified by whether it was <b style={{ color: '#ccc' }}>declared</b> in your composition
        and whether it was <b style={{ color: '#ccc' }}>called</b> during the window. Only ACR sees both, so this
        lens is the one no self-report and no server log can produce alone.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {Object.entries(SCOPE_LABELS).map(([key, label]) => (
            <button key={key} onClick={() => setScope(key)} style={{
              padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
              background: scope === key ? '#4a9eff' : '#1a1a1a', color: scope === key ? '#fff' : '#888', fontWeight: 500, fontSize: '0.8rem',
            }}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
            <button key={key} onClick={() => setSource(key)} style={{
              padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
              background: source === key ? '#2a2a2a' : '#1a1a1a', color: source === key ? '#e0e0e0' : '#666', fontWeight: 500, fontSize: '0.75rem',
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ color: '#666', fontSize: '0.75rem', marginBottom: '1.5rem' }}>
        {data.period_start} &mdash; {data.period_end}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <Stat label="Bound targets" value={s.bound_targets} />
        <Stat label="Called targets" value={s.called_targets} />
        <Stat label="Bound, uncalled" value={s.bound_uncalled} />
        <Stat label="Called, unbound" value={s.called_unbound} />
      </div>

      {s.binding_source_disagreements > 0 && (
        <div style={{
          padding: '0.75rem 1rem',
          border: '1px solid #f97316',
          background: '#1a1208',
          borderRadius: '6px',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          color: '#fbbf24',
        }}>
          <b>{s.binding_source_disagreements}</b> target{s.binding_source_disagreements === 1 ? '' : 's'} declared by only one composition source.
          The MCP observed and agent-reported compositions disagree — a disagreement on a target that is actually called is a strong integrity signal.
        </div>
      )}

      {data.targets.length === 0 && (
        <p style={{ color: '#666' }}>
          No bindings and no calls recorded in this window. Register with composition fields populated,
          and emit log_interaction after each external call.
        </p>
      )}

      {CLASS_ORDER.map((cls) => {
        const items = targetsByClass[cls];
        if (items.length === 0) return null;
        const meta = CLASS_META[cls];
        return (
          <div key={cls} style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', margin: '0 0 0.35rem', color: meta.color }}>
              {meta.label} <span style={{ color: '#666', fontWeight: 400 }}>({items.length})</span>
            </h2>
            <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{meta.description}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #252525' }}>
                    {['Target', 'Calls', 'Binding Sources', 'Last Called'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#888', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(t => (
                    <tr key={t.target_system_id} style={{ borderBottom: '1px solid #1a1a1a', borderLeft: `3px solid ${meta.border}` }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{t.target_system_id}</td>
                      <td style={{ padding: '0.5rem' }}>{t.call_count}</td>
                      <td style={{ padding: '0.5rem', color: '#888', fontSize: '0.75rem' }}>
                        {t.binding_sources.length === 0 ? <span style={{ color: '#666' }}>&mdash;</span> : t.binding_sources.join(', ')}
                      </td>
                      <td style={{ padding: '0.5rem', color: '#666', fontSize: '0.75rem' }}>
                        {t.last_called ? t.last_called : <span style={{ color: '#444' }}>&mdash;</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
