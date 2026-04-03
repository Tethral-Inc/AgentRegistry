// Zod schemas (values, used for validation)
export * from './schemas/index.js';

// TypeScript types (only the complex object types; enum types come from Zod schemas via z.infer)
export type {
  Emitter, Target, Interaction, Anomaly, InteractionReceipt,
} from './types/receipt.js';
export type {
  Agent, RegistrationRequest, RegistrationResponse,
  CompositionUpdate, EnvironmentBriefing, SystemStatus, ThreatNotice,
} from './types/agent.js';
export type { SkillHash, SkillCheckResponse } from './types/skill.js';
export type {
  FrictionSummary, TargetFriction, FrictionReport, ComponentFriction,
} from './types/friction.js';
export { type APIError, type ErrorCode, makeError } from './types/errors.js';

export * from './crypto/index.js';
export { getPool, closePool, query, queryOne, execute } from './db/index.js';
export { normalizeSystemId } from './canonical-names/normalize.js';
export { createLogger, logger } from './logger/index.js';
