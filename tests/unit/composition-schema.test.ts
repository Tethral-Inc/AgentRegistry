import { describe, it, expect } from 'vitest';
import {
  CompositionSchema,
  RegistrationRequestSchema,
  CompositionUpdateSchema,
  SkillComponentSchema,
  McpComponentSchema,
} from '../../shared/schemas/agent.js';

describe('CompositionSchema', () => {
  it('accepts empty composition', () => {
    const result = CompositionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts flat legacy fields', () => {
    const result = CompositionSchema.safeParse({
      skills: ['skill-a', 'skill-b'],
      mcps: ['mcp:github'],
      tools: ['tool-1'],
      skill_hashes: ['abc123', 'def456'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts rich nested skill_components', () => {
    const result = CompositionSchema.safeParse({
      skill_components: [
        {
          id: 'skill-a-hash',
          name: 'skill-a',
          version: '1.0.0',
          sub_components: [
            { id: 'sub-1', name: 'entry.sh', type: 'sub_script' },
            { id: 'sub-2', name: 'helper.py', type: 'sub_script' },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts flat + rich together', () => {
    const result = CompositionSchema.safeParse({
      skills: ['skill-legacy'],
      skill_components: [{ id: 'skill-new-hash' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects components missing id', () => {
    const result = CompositionSchema.safeParse({
      skill_components: [{ name: 'skill-a' } as unknown as { id: string }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects too many components (max 64)', () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => ({ id: `c-${i}` }));
    const result = CompositionSchema.safeParse({
      skill_components: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it('rejects ids exceeding 128 chars', () => {
    const result = CompositionSchema.safeParse({
      skill_components: [{ id: 'a'.repeat(129) }],
    });
    expect(result.success).toBe(false);
  });
});

describe('SkillComponentSchema', () => {
  it('accepts a bare component with just id', () => {
    const result = SkillComponentSchema.safeParse({
      id: 'skill-id',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a component with sub_components', () => {
    const result = SkillComponentSchema.safeParse({
      id: 'skill-id',
      name: 'My Skill',
      version: '1.0.0',
      sub_components: [
        { id: 'sub-1', name: 'entry.sh', type: 'sub_script' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('McpComponentSchema', () => {
  it('accepts an MCP with exposed tools as sub_components', () => {
    const result = McpComponentSchema.safeParse({
      id: 'mcp-github',
      name: 'GitHub MCP',
      sub_components: [
        { id: 'create-issue', name: 'Create issue', type: 'sub_tool' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('RegistrationRequestSchema with composition_source', () => {
  const validBase = {
    public_key: 'p'.repeat(40),
    provider_class: 'anthropic' as const,
  };

  it('accepts composition_source=agent_reported', () => {
    const result = RegistrationRequestSchema.safeParse({
      ...validBase,
      composition_source: 'agent_reported',
      composition: { skills: ['skill-a'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts composition_source=mcp_observed', () => {
    const result = RegistrationRequestSchema.safeParse({
      ...validBase,
      composition_source: 'mcp_observed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid composition_source', () => {
    const result = RegistrationRequestSchema.safeParse({
      ...validBase,
      composition_source: 'invalid_source' as unknown as 'agent_reported',
    });
    expect(result.success).toBe(false);
  });

  it('accepts request without composition_source (backwards compat)', () => {
    const result = RegistrationRequestSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});

describe('CompositionUpdateSchema with composition_source', () => {
  it('accepts agent_reported update with nested components', () => {
    const result = CompositionUpdateSchema.safeParse({
      agent_id: 'pseudo_abc123def456',
      composition_source: 'agent_reported',
      composition: {
        skill_components: [
          {
            id: 'skill-a-hash',
            name: 'skill-a',
            sub_components: [
              { id: 'sub-entry', type: 'sub_script' },
            ],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});
