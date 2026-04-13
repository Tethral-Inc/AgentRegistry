export default function Home() {
  const linkStyle = {
    padding: '1rem 2rem', background: '#1a1a1a', border: '1px solid #333',
    borderRadius: '8px', color: '#4a9eff', textDecoration: 'none',
  } as const;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>ACR Dashboard</h1>
      <p style={{ color: '#888' }}>
        Agent Composition Records — monitoring and operator portal.
      </p>
      <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <a href="/observatory" style={linkStyle}>Network Observatory</a>
        <a href="/agents" style={linkStyle}>Agent Profiles</a>
        <a href="/operator" style={linkStyle}>Operator Portal</a>
        <a href="/skills" style={linkStyle}>Skill Catalog</a>
        <a href="/internal" style={linkStyle}>Internal Metrics</a>
        <a href="/leaderboard" style={linkStyle}>Leaderboard</a>
      </div>
    </div>
  );
}
