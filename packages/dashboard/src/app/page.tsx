export default function Home() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>ACR Dashboard</h1>
      <p style={{ color: '#888' }}>
        Agent Composition Records — monitoring and operator portal.
      </p>
      <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
        <a href="/operator" style={{
          padding: '1rem 2rem', background: '#1a1a1a', border: '1px solid #333',
          borderRadius: '8px', color: '#4a9eff', textDecoration: 'none',
        }}>
          Operator Portal
        </a>
        <a href="/internal" style={{
          padding: '1rem 2rem', background: '#1a1a1a', border: '1px solid #333',
          borderRadius: '8px', color: '#4a9eff', textDecoration: 'none',
        }}>
          Internal Metrics
        </a>
      </div>
    </div>
  );
}
