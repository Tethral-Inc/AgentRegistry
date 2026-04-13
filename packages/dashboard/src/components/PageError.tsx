export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ textAlign: 'center', marginTop: '4rem' }}>
      <p style={{ color: '#ef4444' }}>{message}</p>
      {onRetry && (
        <button onClick={onRetry} style={{
          marginTop: '1rem', padding: '0.5rem 1.5rem', background: '#1a1a1a',
          border: '1px solid #333', borderRadius: '6px', color: '#e0e0e0', cursor: 'pointer',
        }}>Retry</button>
      )}
    </div>
  );
}
