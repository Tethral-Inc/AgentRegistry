'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'acr_api_key';

export function ApiKeyInput({ onChange }: { onChange?: (key: string | null) => void }) {
  const [key, setKey] = useState('');
  const [stored, setStored] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    try {
      // Prefer persistent store; fall back to sessionStorage for keys saved
      // by an older build so they aren't silently dropped on first load.
      const s = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
      setStored(s);
      if (s) setKey(s);
    } catch { /* ignore */ }
  }, []);

  const save = () => {
    const trimmed = key.trim();
    try {
      if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
      else localStorage.removeItem(STORAGE_KEY);
      // Drop any legacy sessionStorage copy so the two stores can't diverge.
      sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    setStored(trimmed || null);
    setEditing(false);
    onChange?.(trimmed || null);
  };

  const clear = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    setKey('');
    setStored(null);
    setEditing(false);
    onChange?.(null);
  };

  const masked = stored ? `${stored.substring(0, 12)}…${stored.substring(stored.length - 4)}` : null;

  return (
    <div style={{ background: '#141414', border: '1px solid #252525', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <span style={{ color: '#888', fontSize: '0.8rem' }}>API Key</span>
      {stored && !editing ? (
        <>
          <code style={{ color: '#4a9eff', fontSize: '0.85rem', fontFamily: 'monospace' }}>{masked}</code>
          <span style={{ color: '#4caf50', fontSize: '0.75rem' }}>✓ active</span>
          <button onClick={() => setEditing(true)} style={btn}>Change</button>
          <button onClick={clear} style={btn}>Clear</button>
        </>
      ) : (
        <>
          <input
            type="password"
            autoComplete="off"
            placeholder="acr_..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            style={{ flex: 1, minWidth: 220, background: '#0a0a0a', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', padding: '0.4rem 0.6rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
          <button onClick={save} style={{ ...btn, background: '#1e3a5f', color: '#4a9eff', borderColor: '#2a4a7a' }}>Save</button>
          {stored && <button onClick={() => { setEditing(false); setKey(stored); }} style={btn}>Cancel</button>}
          <span style={{ color: '#666', fontSize: '0.7rem', width: '100%' }}>
            Saved in this browser. Open the dashboard link from any ACR lens to fill this in automatically. Unlocks paid-tier lenses (p95, vs_baseline, volatility).
          </span>
        </>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '4px',
  color: '#ccc',
  padding: '0.35rem 0.7rem',
  fontSize: '0.75rem',
  cursor: 'pointer',
};
