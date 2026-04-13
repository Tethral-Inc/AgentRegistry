export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '1rem' }}>
      <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
