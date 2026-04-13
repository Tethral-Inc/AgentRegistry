'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getAgentProfile, type AgentProfileResponse } from '../../../lib/api';
import { Stat } from '../../../components/Stat';
import { MetaRow } from '../../../components/MetaRow';
import { PageError } from '../../../components/PageError';
import { formatTimestamp } from '../../../lib/format';

export default function AgentProfile() {
  const params = useParams();
  const id = params.id as string;
  const [profile, setProfile] = useState<AgentProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfile(await getAgentProfile(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) return <p style={{ color: '#888', textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (error) return <PageError message={error} onRetry={loadProfile} />;
  if (!profile) return null;

  const counts = profile.counts;
  const comp = profile.composition_summary;
  const delta = profile.composition_delta;
  const hashDisplay = profile.composition_hash ? profile.composition_hash.substring(0, 24) + '...' : null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <a href="/agents" style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>&larr; Back to agents</a>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{profile.name || id}</h1>
        {profile.provider_class && (
          <span style={{ background: '#333', color: '#ccc', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem' }}>
            {profile.provider_class}
          </span>
        )}
        <span style={{ background: '#1a1a1a', color: '#888', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem' }}>
          {profile.tier}
        </span>
      </div>

      <div style={{ background: '#141414', border: '1px solid #252525', borderRadius: '8px', padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        <MetaRow label="Agent ID" value={profile.agent_id} />
        <MetaRow label="Provider" value={profile.provider_class} />
        <MetaRow label="Domain" value={profile.operational_domain} />
        <MetaRow label="Composition Hash" value={hashDisplay} />
        <MetaRow label="Registered" value={formatTimestamp(profile.registered_at)} />
        <MetaRow label="Last Active" value={formatTimestamp(profile.last_active_at)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        <Stat label="Total Receipts" value={counts.total_receipts} />
        <Stat label="Last 24h" value={counts.receipts_last_24h} />
        <Stat label="Distinct Targets" value={counts.distinct_targets} />
        <Stat label="Categories" value={counts.distinct_categories} />
        <Stat label="Chains" value={counts.distinct_chains} />
        <Stat label="Days Active" value={counts.days_active} />
      </div>

      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Composition</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        <Stat label="Skills" value={comp.skill_count} />
        <Stat label="MCPs" value={comp.mcp_count} />
        <Stat label="Tools" value={comp.tool_count} />
      </div>

      {delta && (delta.mcp_only.length > 0 || delta.agent_only.length > 0) && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Composition Delta</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
            <div>
              <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.5rem' }}>MCP-observed only</div>
              {delta.mcp_only.length === 0 ? <p style={{ color: '#666', fontSize: '0.85rem' }}>None</p> : (
                delta.mcp_only.map(item => (
                  <div key={item} style={{ borderLeft: '3px solid #f97316', padding: '0.4rem 0.75rem', marginBottom: '0.25rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#e0e0e0' }}>
                    {item}
                  </div>
                ))
              )}
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Agent-reported only</div>
              {delta.agent_only.length === 0 ? <p style={{ color: '#666', fontSize: '0.85rem' }}>None</p> : (
                delta.agent_only.map(item => (
                  <div key={item} style={{ borderLeft: '3px solid #4a9eff', padding: '0.4rem 0.75rem', marginBottom: '0.25rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#e0e0e0' }}>
                    {item}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <a href={`/agents/${id}/friction`} style={{
        display: 'inline-block', padding: '0.75rem 1.5rem', background: '#1a1a1a', border: '1px solid #333',
        borderRadius: '8px', color: '#4a9eff', textDecoration: 'none', fontWeight: 500,
      }}>
        View Friction Dashboard &rarr;
      </a>
    </div>
  );
}
