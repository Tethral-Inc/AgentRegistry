'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AgentsLanding() {
  const [agentId, setAgentId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const router = useRouter();

  const go = () => {
    const id = agentId.trim();
    const key = apiKey.trim();
    if (!id) return;
    if (key && typeof window !== 'undefined') {
      sessionStorage.setItem('acr_api_key', key);
    }
    router.push(`/agents/${id}`);
  };

  const canSubmit = agentId.trim().length > 0;

  return (
    <div style={{ maxWidth: 600, margin: '4rem auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Agent Profile Viewer</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        If you arrived from a <code style={{ color: '#e0e0e0' }}>get_my_agent</code> dashboard
        link, your API key is already loaded. Otherwise, enter your agent ID below — the
        API key is optional and only needed to unlock paid-tier lenses.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <input
          type="text"
          placeholder="Agent ID (acr_abc123...)"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          style={{
            padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333',
            borderRadius: '6px', color: '#e0e0e0', fontFamily: 'monospace', fontSize: '0.9rem', outline: 'none',
          }}
        />
        <input
          type="password"
          placeholder="API Key (optional — acr_...)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          style={{
            padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333',
            borderRadius: '6px', color: '#e0e0e0', fontFamily: 'monospace', fontSize: '0.9rem', outline: 'none',
          }}
        />
        <button
          onClick={go}
          disabled={!canSubmit}
          style={{
            padding: '0.75rem 1.5rem', background: canSubmit ? '#4a9eff' : '#333',
            border: 'none', borderRadius: '6px', color: '#fff', cursor: canSubmit ? 'pointer' : 'default', fontWeight: 600,
          }}
        >
          View Profile
        </button>
      </div>
    </div>
  );
}
