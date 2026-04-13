export function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', padding: '0.5rem 0', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ color: '#888', width: 180, flexShrink: 0, fontSize: '0.85rem' }}>{label}</span>
      <span style={{ color: '#e0e0e0', fontSize: '0.85rem', wordBreak: 'break-all' }}>{value || '\u2014'}</span>
    </div>
  );
}
