import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ACR Dashboard',
  description: 'Agent Composition Records — Operator Portal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: '#0a0a0a',
        color: '#e0e0e0',
        minHeight: '100vh',
      }}>
        <nav style={{
          padding: '1rem 2rem',
          borderBottom: '1px solid #222',
          display: 'flex',
          gap: '2rem',
          alignItems: 'center',
        }}>
          <strong style={{ color: '#fff' }}>ACR</strong>
          <a href="/skills" style={{ color: '#888', textDecoration: 'none' }}>Skills</a>
          <a href="/operator" style={{ color: '#888', textDecoration: 'none' }}>Operator</a>
          <a href="/internal" style={{ color: '#888', textDecoration: 'none' }}>Internal</a>
          <a href="/observatory" style={{ color: '#888', textDecoration: 'none' }}>Observatory</a>
          <a href="/agents" style={{ color: '#888', textDecoration: 'none' }}>Agents</a>
        </nav>
        <main style={{ padding: '2rem' }}>{children}</main>
      </body>
    </html>
  );
}
