import { z } from 'zod';

export const TargetSystemType = z.enum([
  'mcp_server', 'api', 'agent', 'skill', 'platform', 'unknown',
]);

export const InteractionCategory = z.enum([
  'tool_call', 'delegation', 'data_exchange', 'skill_install',
  'commerce', 'research', 'code', 'communication',
]);

export const InteractionStatus = z.enum([
  'success', 'failure', 'timeout', 'partial',
]);

export const AnomalyCategory = z.enum([
  'unexpected_behavior', 'data_exfiltration', 'prompt_injection',
  'malformed_output', 'excessive_latency', 'unauthorized_access', 'other',
]);

export const ProviderClass = z.enum([
  'anthropic', 'openai', 'google', 'openclaw', 'langchain',
  'crewai', 'autogen', 'custom', 'unknown',
]);

const TARGET_PATTERN = /^(mcp|api|agent|skill|platform):[a-zA-Z0-9._:-]+$/;
const AGENT_ID_PATTERN = /^(acr_|pseudo_)[a-f0-9]{12,32}$/;

export const EmitterSchema = z.object({
  agent_id: z.string().regex(AGENT_ID_PATTERN, 'agent_id must match acr_xxxx or pseudo_xxxx'),
  composition_hash: z.string().optional(),
  provider_class: ProviderClass,
});

export const TargetSchema = z.object({
  system_id: z.string().regex(TARGET_PATTERN, 'system_id must match {type}:{name}'),
  system_type: TargetSystemType,
});

export const InteractionSchema = z.object({
  category: InteractionCategory,
  duration_ms: z.number().nonnegative().optional(),
  status: InteractionStatus,
  request_timestamp_ms: z.number().refine(
    (ts) => {
      const now = Date.now();
      const twentyFourHoursAgo = now - 86400000;
      return ts >= twentyFourHoursAgo && ts <= now + 60000;
    },
    'request_timestamp_ms must be within the last 24 hours'
  ),
  response_timestamp_ms: z.number().optional(),
  queue_wait_ms: z.number().nonnegative().optional(),
  retry_count: z.number().nonnegative().optional().default(0),
  error_code: z.string().max(50).optional(),
  response_size_bytes: z.number().nonnegative().optional(),
});

export const AnomalySchema = z.object({
  flagged: z.boolean(),
  category: AnomalyCategory.optional(),
  detail: z.string().max(500).optional(),
});

export const TransportType = z.enum(['stdio', 'streamable-http']);
export const ReceiptSource = z.enum(['agent', 'server']);

export const InteractionReceiptSchema = z.object({
  receipt_id: z.string().optional(),
  emitter: EmitterSchema,
  target: TargetSchema,
  interaction: InteractionSchema,
  anomaly: AnomalySchema.default({ flagged: false }),
  transport_type: TransportType.optional(),
  source: ReceiptSource.default('agent'),
  chain_id: z.string().max(64).optional(),
  chain_position: z.number().nonnegative().optional(),
  preceded_by: z.string().optional(),
});

export const ReceiptBatchSchema = z.object({
  receipts: z.array(InteractionReceiptSchema).min(1).max(50),
});

export const ReceiptSubmissionSchema = z.union([
  InteractionReceiptSchema,
  ReceiptBatchSchema,
]);
