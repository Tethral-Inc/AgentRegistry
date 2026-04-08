import { z } from 'zod';
import {
  SkillHashSchema,
  SkillCheckResponseSchema,
  SkillCatalogSchema,
  SkillSearchRequestSchema,
  SkillSearchResultSchema,
  SkillVersionEntrySchema,
  SkillVersionHistorySchema,
} from '../schemas/skill.js';

export type SkillHash = z.infer<typeof SkillHashSchema>;
export type SkillCheckResponse = z.infer<typeof SkillCheckResponseSchema>;
export type SkillCatalog = z.infer<typeof SkillCatalogSchema>;
export type SkillSearchRequest = z.infer<typeof SkillSearchRequestSchema>;
export type SkillSearchResult = z.infer<typeof SkillSearchResultSchema>;
export type SkillVersionEntry = z.infer<typeof SkillVersionEntrySchema>;
export type SkillVersionHistory = z.infer<typeof SkillVersionHistorySchema>;
