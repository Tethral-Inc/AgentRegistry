'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AgentsLanding() {
  const [agentId, setAgentId] = useState('');
  const router = useRouter();

  const go = () => {
    const id = agentId.trim();
    if (id) router.push(`/agents/${id}`);
  };

  return (
    <div style={{ maxWidth: 600, margin: '4rem auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Agent Profile Viewer</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>Enter an agent ID to view its interaction profile.</p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          placeholder="Agent ID (e.g. acr_abc123)"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          style={{
            flex: 1, padding: '0.75rem 1rem', background: '#1a1a1a', border: '1px solid #333',
            borderRadius: '6px', color: '#e0e0e0', fontFamily: 'monospace', fontSize: '0.9rem', outline: 'none',
          }}
        />
        <button
          onClick={go}
          disabled={!agentId.trim()}
          style={{
            padding: '0.75rem 1.5rem', background: agentId.trim() ? '#4a9eff' : '#333',
            border: 'none', borderRadius: '6px', color: '#fff', cursor: agentId.trim() ? 'pointer' : 'default', fontWeight: 600,
          }}
        >
          View Profile
        </button>
      </div>
    </div>
  );
}
