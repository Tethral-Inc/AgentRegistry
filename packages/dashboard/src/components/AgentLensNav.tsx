'use client';

/**
 * Navigation across the agent's interaction-profile lenses.
 *
 * Every lens is a different way of looking at the same underlying
 * interaction profile. Friction is featured first because it's the most
 * broadly useful lens; revealed-preference sits next to it because it's
 * the one no other system can produce. Additional lenses will be added
 * as they ship.
 */

type LensKey = 'friction' | 'revealed-preference' | 'compensation' | 'coverage' | 'stable-corridors' | 'trend';

interface LensDef {
  key: LensKey;
  label: string;
  href: (id: string) => string;
  description: string;
  featured?: boolean;
}

const LENSES: LensDef[] = [
  {
    key: 'friction',
    label: 'Friction',
    href: (id) => `/agents/${id}/friction`,
    description: 'Where time and tokens are being lost',
    featured: true,
  },
  {
    key: 'revealed-preference',
    label: 'Revealed Preference',
    href: (id) => `/agents/${id}/revealed-preference`,
    description: 'What you declared vs what you actually call',
  },
  {
    key: 'compensation',
    label: 'Compensation',
    href: (id) => `/agents/${id}/compensation`,
    description: 'Chain-shape stability — routine vs exploratory',
  },
];

export function AgentLensNav({ agentId, active }: { agentId: string; active: LensKey | null }) {
  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      flexWrap: 'wrap',
      borderBottom: '1px solid #252525',
      paddingBottom: '0.75rem',
      marginBottom: '1.5rem',
    }}>
      {LENSES.map((lens) => {
        const isActive = active === lens.key;
        return (
          <a
            key={lens.key}
            href={lens.href(agentId)}
            style={{
              padding: '0.5rem 0.9rem',
              borderRadius: '6px',
              border: '1px solid',
              borderColor: isActive ? '#4a9eff' : '#252525',
              background: isActive ? '#1a2738' : '#141414',
              color: isActive ? '#4a9eff' : '#ccc',
              textDecoration: 'none',
              fontSize: '0.85rem',
              fontWeight: lens.featured ? 600 : 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
            title={lens.description}
          >
            {lens.featured && <span style={{ color: '#4a9eff', fontSize: '0.7rem' }}>★</span>}
            {lens.label}
          </a>
        );
      })}
    </div>
  );
}
