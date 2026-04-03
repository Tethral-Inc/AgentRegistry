import { z } from 'zod';
import {
  SkillHashSchema,
  SkillCheckResponseSchema,
} from '../schemas/skill.js';

export type SkillHash = z.infer<typeof SkillHashSchema>;
export type SkillCheckResponse = z.infer<typeof SkillCheckResponseSchema>;
