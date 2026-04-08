'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { getSkillDetail, type SkillCatalogEntry, type SkillVersionEntry } from '../../../lib/api';

function ThreatBadge({ level }: { level: string | null }) {
  if (!level || level === 'none') return <span style={{ color: '#22c55e', fontSize: 13 }}>None</span>;
  const colors: Record<string, string> = {
    low: '#facc15', medium: '#f97316', high: '#ef4444', critical: '#dc2626',
  };
  return (
    <span style={{
      background: colors[level] ?? '#666', color: '#fff',
      padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
    }}>{level}</span>
  );
}

function QualityBreakdown({ score }: { score: number | null }) {
  const s = score ?? 0;
  const color = s >= 70 ? '#22c55e' : s >= 40 ? '#facc15' : '#ef4444';
  const label = s >= 70 ? 'Good' : s >= 40 ? 'Fair' : 'Low';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ width: 120, height: 8, background: '#333', borderRadius: 4 }}>
          <div style={{ width: `${s}%`, height: '100%', background: color, borderRadius: 4 }} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color }}>{s}/100 ({label})</span>
      </div>
    </div>
  );
}

function VersionTimeline({ versions }: { versions: SkillVersionEntry[] }) {
  if (!versions.length) return <p style={{ color: '#666' }}>No version history</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {versions.map((v, i) => (
        <div key={i} style={{
          display: 'flex', gap: 16, padding: '8px 12px',
          background: '#1a1a1a', borderRadius: 6, fontSize: 13,
          borderLeft: `3px solid ${i === 0 ? '#22c55e' : '#333'}`,
        }}>
          <span style={{ color: '#888', minWidth: 90 }}>
            {v.detected_at.split('T')[0]}
          </span>
          <span style={{ color: '#fff', minWidth: 80 }}>
            {v.version ? `v${v.version}` : v.skill_hash.slice(0, 12)}
          </span>
          <span style={{ color: '#666' }}>{v.change_type}</span>
          <ThreatBadge level={v.threat_level} />
        </div>
      ))}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ color: '#666', minWidth: 120, fontSize: 13 }}>{label}</span>
      <span style={{ color: '#ccc', fontSize: 13 }}>{value}</span>
    </div>
  );
}

export default function SkillDetailPage() {
  const params = useParams();
  const skillId = params.id as string;
  const [skill, setSkill] = useState<SkillCatalogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (!skillId) return;
    setLoading(true);
    getSkillDetail(skillId)
      .then(setSkill)
      .catch((err) => setError(err.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, [skillId]);

  if (loading) return <p style={{ color: '#666', textAlign: 'center', padding: '3rem' }}>Loading...</p>;
  if (error) return <p style={{ color: '#ef4444', textAlign: 'center', padding: '3rem' }}>{error}</p>;
  if (!skill) return <p style={{ color: '#666', textAlign: 'center', padding: '3rem' }}>Skill not found</p>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <a href="/skills" style={{ color: '#666', textDecoration: 'none', fontSize: 13 }}>
        &larr; Back to catalog
      </a>

      {/* Header */}
      <div style={{ marginTop: 16, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>{skill.skill_name}</h1>
          {skill.version && <span style={{ color: '#666', fontSize: 18 }}>v{skill.version}</span>}
          <ThreatBadge level={skill.threat_level} />
        </div>
        {skill.description && (
          <p style={{ color: '#999', fontSize: 15, lineHeight: 1.6, marginTop: 8 }}>{skill.description}</p>
        )}
      </div>

      {/* Metadata */}
      <div style={{ background: '#141414', borderRadius: 8, padding: '16px 20px', marginBottom: 24, border: '1px solid #252525' }}>
        <MetaRow label="Source" value={skill.skill_source} />
        <MetaRow label="Author" value={skill.author} />
        <MetaRow label="Category" value={skill.category} />
        <MetaRow label="Tags" value={skill.tags.length > 0 ? skill.tags.join(', ') : null} />
        <MetaRow label="Requires" value={skill.requires.length > 0 ? skill.requires.join(', ') : null} />
        <MetaRow label="Agents Using" value={skill.agent_count != null ? String(skill.agent_count) : null} />
        <MetaRow label="Status" value={skill.status} />
        <MetaRow label="Current Hash" value={skill.current_hash?.slice(0, 24) + '...'} />
        <MetaRow label="Last Crawled" value={skill.last_crawled_at?.split('T')[0]} />
        <MetaRow label="Last Changed" value={skill.content_changed_at?.split('T')[0]} />
        <div style={{ marginTop: 12 }}>
          <span style={{ color: '#666', fontSize: 13, marginRight: 12 }}>Quality Score</span>
          <QualityBreakdown score={skill.quality_score} />
        </div>
      </div>

      {/* Related Skills (cross-source) */}
      {skill.related_skills && skill.related_skills.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Also Available On</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            {skill.related_skills.map((r) => (
              <a key={r.skill_id} href={`/skills/${r.skill_id}`} style={{
                background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
                padding: '10px 16px', textDecoration: 'none', color: '#ccc', fontSize: 13,
              }}>
                {r.skill_source} {r.version ? `v${r.version}` : ''}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Version History */}
      {skill.versions && skill.versions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Version History</h2>
          <VersionTimeline versions={skill.versions} />
        </div>
      )}

      {/* SKILL.md Content */}
      {skill.skill_content && (
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => setShowContent(!showContent)}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: 6,
              color: '#888', padding: '8px 16px', cursor: 'pointer', fontSize: 13,
            }}
          >
            {showContent ? 'Hide' : 'Show'} SKILL.md Content ({skill.skill_content.length} chars)
          </button>
          {showContent && (
            <pre style={{
              background: '#0d0d0d', border: '1px solid #252525', borderRadius: 8,
              padding: '16px', marginTop: 12, fontSize: 12, color: '#aaa',
              overflow: 'auto', maxHeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {skill.skill_content}
            </pre>
          )}
        </div>
      )}

      {/* Notifications & Subscriptions — Coming Soon */}
      <div style={{
        background: '#141414', borderRadius: 8, padding: '24px',
        border: '1px dashed #333', marginBottom: 24, opacity: 0.7,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Agent Notifications</h2>
          <span style={{
            background: '#333', color: '#888', padding: '2px 8px',
            borderRadius: 4, fontSize: 11, fontWeight: 600,
          }}>COMING SOON</span>
        </div>
        <p style={{ color: '#666', fontSize: 13, lineHeight: 1.6 }}>
          Agents using this skill will receive automatic notifications when:
        </p>
        <ul style={{ color: '#666', fontSize: 13, lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Security threats are detected in the skill content</li>
          <li>The skill is blocked by the content security scanner</li>
          <li>A new version of the skill is available</li>
        </ul>
        <p style={{ color: '#555', fontSize: 12, fontStyle: 'italic' }}>
          Subscription management and acknowledgement gates will be available in a future update.
        </p>
      </div>
    </div>
  );
}
