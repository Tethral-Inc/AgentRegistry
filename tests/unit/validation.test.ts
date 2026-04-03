import { describe, it, expect } from 'vitest';
import {
  InteractionReceiptSchema,
  RegistrationRequestSchema,
} from '@acr/shared';

describe('InteractionReceiptSchema', () => {
  const validReceipt = {
    emitter: {
      agent_id: 'acr_abcdef123456',
      provider_class: 'openclaw',
    },
    target: {
      system_id: 'mcp:github',
      system_type: 'mcp_server',
    },
    interaction: {
      category: 'tool_call',
      status: 'success',
      request_timestamp_ms: Date.now() - 1000,
      duration_ms: 1200,
    },
    anomaly: {
      flagged: false,
    },
  };

  it('accepts a valid receipt', () => {
    const result = InteractionReceiptSchema.safeParse(validReceipt);
    expect(result.success).toBe(true);
  });

  it('rejects invalid agent_id format', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      emitter: { ...validReceipt.emitter, agent_id: 'bad_id' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid target system_id format', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      target: { ...validReceipt.target, system_id: 'no-prefix' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid provider_class', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      emitter: { ...validReceipt.emitter, provider_class: 'invalid' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid interaction category', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      interaction: { ...validReceipt.interaction, category: 'invalid' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects timestamp older than 24 hours', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      interaction: {
        ...validReceipt.interaction,
        request_timestamp_ms: Date.now() - 86400001,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative duration_ms', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      interaction: { ...validReceipt.interaction, duration_ms: -100 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects anomaly detail longer than 500 chars', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      anomaly: { flagged: true, category: 'other', detail: 'x'.repeat(501) },
    });
    expect(result.success).toBe(false);
  });

  it('accepts pseudo_ agent IDs', () => {
    const result = InteractionReceiptSchema.safeParse({
      ...validReceipt,
      emitter: { ...validReceipt.emitter, agent_id: 'pseudo_abcdef123456' },
    });
    expect(result.success).toBe(true);
  });
});

describe('RegistrationRequestSchema', () => {
  it('accepts valid registration', () => {
    const result = RegistrationRequestSchema.safeParse({
      public_key: 'a'.repeat(32),
      provider_class: 'openclaw',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short public_key', () => {
    const result = RegistrationRequestSchema.safeParse({
      public_key: 'short',
      provider_class: 'openclaw',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid provider_class', () => {
    const result = RegistrationRequestSchema.safeParse({
      public_key: 'a'.repeat(32),
      provider_class: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects operational_domain over 200 chars', () => {
    const result = RegistrationRequestSchema.safeParse({
      public_key: 'a'.repeat(32),
      provider_class: 'openclaw',
      operational_domain: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional composition', () => {
    const result = RegistrationRequestSchema.safeParse({
      public_key: 'a'.repeat(32),
      provider_class: 'openclaw',
      composition: {
        skills: ['skill1'],
        skill_hashes: ['hash1'],
      },
    });
    expect(result.success).toBe(true);
  });
});
