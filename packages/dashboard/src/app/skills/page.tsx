'use client';

import { useState, useEffect, useCallback } from 'react';
import { searchSkills, browseSkills, type SkillCatalogEntry } from '../../lib/api';

const SOURCES = ['all', 'npm', 'github', 'clawhub'];
const SORTS = [
  { value: 'updated_at', label: 'Recently Updated' },
  { value: 'scan_score', label: 'Scan Score' },
  { value: 'agent_count', label: 'Most Used' },
  { value: 'skill_name', label: 'Name' },
];

function SignalIndicator({ count, rate }: { count: number | null; rate: number | null }) {
  if (!count || count === 0) return null;
  return (
    <span style={{
      background: '#333',
      color: '#f97316',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
    }}>
      {count} signals ({((rate ?? 0) * 100).toFixed(1)}%)
    </span>
  );
}

function ScanScore({ score }: { score: number | null }) {
  if (score == null) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#888' }}>scan: {score}</span>
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillCatalogEntry }) {
  return (
    <a
      href={`/skills/${skill.skill_id}`}
      style={{
        display: 'block',
        background: '#141414',
        border: '1px solid #252525',
        borderRadius: 8,
        padding: '1.25rem',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 0.15s',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = '#444')}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = '#252525')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>
            {skill.skill_name}
            {skill.version && <span style={{ color: '#666', fontWeight: 400, marginLeft: 8 }}>v{skill.version}</span>}
          </h3>
          <span style={{ fontSize: 12, color: '#666' }}>{skill.skill_source}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SignalIndicator count={skill.anomaly_signal_count} rate={skill.anomaly_signal_rate} />
          <ScanScore score={skill.scan_score} />
        </div>
      </div>
      {skill.description && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#999', lineHeight: 1.5 }}>
          {skill.description.length > 200 ? skill.description.slice(0, 200) + '...' : skill.description}
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 12, color: '#666' }}>
        {skill.author && <span>by {skill.author}</span>}
        {skill.agent_count != null && skill.agent_count > 0 && <span>{skill.agent_count} agents</span>}
        {skill.tags.length > 0 && <span>{skill.tags.slice(0, 3).join(', ')}</span>}
      </div>
    </a>
  );
}

export default function SkillsPage() {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState('updated_at');
  const [skills, setSkills] = useState<SkillCatalogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      if (query.trim()) {
        const result = await searchSkills(query, {
          source: source !== 'all' ? source : undefined,
          limit: 30,
        });
        setSkills(result.skills);
        setTotal(result.total);
      } else {
        const result = await browseSkills({
          source: source !== 'all' ? source : undefined,
          sort,
          limit: 30,
        });
        setSkills(result.skills);
        setTotal(result.skills.length);
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setLoading(false);
    }
  }, [query, source, sort]);

  useEffect(() => {
    const timer = setTimeout(loadSkills, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadSkills, query]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Skill Catalog</h1>
      <p style={{ color: '#888', marginBottom: 24, fontSize: 14 }}>
        {total} skills indexed from {SOURCES.length - 1} sources
      </p>

      {/* Coming Soon Banner */}
      <div style={{
        background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: 8,
        padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 18 }}>&#x1F514;</span>
        <div>
          <strong style={{ color: '#8888cc', fontSize: 13 }}>Agent Notifications — Coming Soon</strong>
          <p style={{ color: '#666', fontSize: 12, margin: '4px 0 0' }}>
            Agents will be automatically notified when their installed skills are flagged or updated.
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <input
          type="text"
          placeholder="Search skills by name, description, or capability..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '10px 14px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          style={{
            padding: '10px 14px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
          }}
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All Sources' : s}</option>
          ))}
        </select>
        {!query && (
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              padding: '10px 14px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
            }}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <p style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>Loading...</p>
      ) : skills.length === 0 ? (
        <p style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
          {query ? `No skills found for "${query}"` : 'No skills in catalog yet'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {skills.map((skill) => (
            <SkillCard key={skill.skill_id} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}
