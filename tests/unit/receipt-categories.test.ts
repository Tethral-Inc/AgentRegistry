import { describe, it, expect } from 'vitest';
import { CategoriesSchema, InteractionReceiptSchema } from '../../shared/schemas/receipt.js';

describe('CategoriesSchema', () => {
  it('accepts an empty object', () => {
    const result = CategoriesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts known dimensions with valid string values', () => {
    const result = CategoriesSchema.safeParse({
      target_type: 'api.llm_provider',
      activity_class: 'math',
      interaction_purpose: 'generate',
      workflow_role: 'intermediate',
      workflow_phase: 'act',
      data_shape: 'structured_json',
      criticality: 'core',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a subset of known dimensions', () => {
    const result = CategoriesSchema.safeParse({
      activity_class: 'language',
    });
    expect(result.success).toBe(true);
  });

  it('accepts unknown dimensions with string values (evolving taxonomy)', () => {
    const result = CategoriesSchema.safeParse({
      activity_class: 'math',
      skill_level: 'intermediate',          // unknown dimension, but string
      complexity_tier: 'high',               // another unknown dimension
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string values in known dimensions', () => {
    const result = CategoriesSchema.safeParse({
      activity_class: 42 as unknown as string,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string values in unknown dimensions (catchall is string-typed)', () => {
    const result = CategoriesSchema.safeParse({
      custom_dimension: { nested: 'object' } as unknown as string,
    });
    expect(result.success).toBe(false);
  });

  it('rejects known dimension values exceeding the length cap', () => {
    const result = CategoriesSchema.safeParse({
      activity_class: 'a'.repeat(33), // exceeds max(32)
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown dimension values exceeding 64 chars (catchall cap)', () => {
    const result = CategoriesSchema.safeParse({
      custom_field: 'a'.repeat(65),
    });
    expect(result.success).toBe(false);
  });

  it('rejects target_type values over 64 chars', () => {
    const result = CategoriesSchema.safeParse({
      target_type: 'a'.repeat(65),
    });
    expect(result.success).toBe(false);
  });
});

describe('InteractionReceiptSchema with categories', () => {
  const validBaseReceipt = {
    emitter: {
      agent_id: 'pseudo_abc123def456',
      provider_class: 'anthropic' as const,
    },
    target: {
      system_id: 'mcp:github',
      system_type: 'mcp_server' as const,
    },
    interaction: {
      category: 'tool_call' as const,
      status: 'success' as const,
      duration_ms: 340,
      request_timestamp_ms: Date.now() - 5000,
    },
    anomaly: {
      flagged: false,
    },
  };

  it('accepts a receipt without categories (backwards compat)', () => {
    const result = InteractionReceiptSchema.safeParse(validBaseReceipt);
    expect(result.success).toBe(true);
  });

  it('accepts a receipt with categories populated', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validBaseReceipt,
      categories: {
        activity_class: 'math',
        interaction_purpose: 'generate',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a receipt with evolving-taxonomy unknown dimensions', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validBaseReceipt,
      categories: {
        activity_class: 'language',
        future_dimension: 'some_value',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a receipt with an invalid category value', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validBaseReceipt,
      categories: {
        activity_class: 42 as unknown as string,
      },
    });
    expect(result.success).toBe(false);
  });
});
