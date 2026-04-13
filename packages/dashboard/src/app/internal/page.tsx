'use client';

import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_ACR_API_URL ?? 'https://acr.tethral.ai';
const RESOLVER_URL = process.env.NEXT_PUBLIC_ACR_RESOLVER_URL ?? API_URL;

interface SkillSignal {
  skill_hash: string;
  skill_name?: string;
  anomaly_signal_count: number;
  anomaly_signal_rate: number;
  agent_count: number;
  first_seen: string;
}

interface HealthCheckResponse {
  status: string;
  database: string;
  timestamp: string;
}

export default function InternalMetrics() {
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [threats, setThreats] = useState<SkillSignal[]>([]);
  const [lastRefresh, setLastRefresh] = useState('');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [healthRes, threatsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/health`).then((r) => r.json()),
        fetch(`${RESOLVER_URL}/v1/threats/active`).then((r) => r.json()),
      ]);
      setHealth(healthRes);
      setThreats(Array.isArray(threatsRes) ? threatsRes : []);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch {
      setHealth({ status: 'error', database: 'unreachable', timestamp: '' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Internal Metrics</h1>
        <button onClick={refresh} disabled={loading}
          style={{ padding: '0.4rem 1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#888', cursor: 'pointer', marginLeft: 'auto' }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        {lastRefresh && <span style={{ color: '#555', fontSize: '0.8rem' }}>Last: {lastRefresh}</span>}
      </div>

      {/* System Health */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', color: '#888', marginBottom: '0.75rem' }}>System Health</h2>
        {health && (
          <div style={{ display: 'flex', gap: '1rem' }}>
            <StatusCard label="API" status={health.status === 'ok' ? 'healthy' : 'down'} />
            <StatusCard label="Database" status={health.database === 'connected' ? 'healthy' : 'down'} />
          </div>
        )}
      </section>

      {/* Skills with Anomaly Signals */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', color: '#888', marginBottom: '0.75rem' }}>
          Skills with Anomaly Signals ({threats.length})
        </h2>
        {threats.length === 0 ? (
          <p style={{ color: '#4ade80' }}>No elevated anomaly signals.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {threats.map((t) => (
              <div key={t.skill_hash} style={{
                background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '1rem',
                borderLeft: '3px solid #f97316',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, color: '#f97316' }}>
                    {t.anomaly_signal_count} signals ({(t.anomaly_signal_rate * 100).toFixed(1)}%)
                  </span>
                  <span style={{ color: '#666', fontSize: '0.8rem' }}>{t.agent_count} reporters</span>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {t.skill_name || t.skill_hash.substring(0, 24) + '...'}
                </div>
                <div style={{ color: '#555', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  First seen: {new Date(t.first_seen).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusCard({ label, status }: { label: string; status: 'healthy' | 'down' }) {
  return (
    <div style={{
      background: '#1a1a1a', border: '1px solid #222', borderRadius: 8, padding: '1rem', minWidth: 120,
    }}>
      <div style={{ color: '#888', fontSize: '0.8rem' }}>{label}</div>
      <div style={{
        fontSize: '1rem', fontWeight: 600, marginTop: '0.25rem',
        color: status === 'healthy' ? '#4ade80' : '#ef4444',
      }}>
        {status === 'healthy' ? 'Healthy' : 'Down'}
      </div>
    </div>
  );
}
