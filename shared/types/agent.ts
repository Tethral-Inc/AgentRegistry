import { z } from 'zod';
import {
  AgentSchema,
  EnvironmentContextSchema,
  RegistrationRequestSchema,
  RegistrationResponseSchema,
  CompositionUpdateSchema,
  EnvironmentBriefingSchema,
  SystemStatusSchema,
  ThreatNoticeSchema,
} from '../schemas/agent.js';

export type Agent = z.infer<typeof AgentSchema>;
export type EnvironmentContext = z.infer<typeof EnvironmentContextSchema>;
export type RegistrationRequest = z.infer<typeof RegistrationRequestSchema>;
export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;
export type CompositionUpdate = z.infer<typeof CompositionUpdateSchema>;
export type EnvironmentBriefing = z.infer<typeof EnvironmentBriefingSchema>;
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
export type ThreatNotice = z.infer<typeof ThreatNoticeSchema>;
