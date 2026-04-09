import { z } from 'zod';
import {
  FrictionSummarySchema,
  TargetFrictionSchema,
  FrictionReportSchema,
  ComponentFrictionSchema,
  ChainAnalysisSchema,
  DirectionalPairSchema,
  RetryOverheadSchema,
  PopulationDriftSchema,
} from '../schemas/friction.js';

export type FrictionSummary = z.infer<typeof FrictionSummarySchema>;
export type TargetFriction = z.infer<typeof TargetFrictionSchema>;
export type FrictionReport = z.infer<typeof FrictionReportSchema>;
export type ComponentFriction = z.infer<typeof ComponentFrictionSchema>;
export type ChainAnalysis = z.infer<typeof ChainAnalysisSchema>;
export type DirectionalPair = z.infer<typeof DirectionalPairSchema>;
export type RetryOverhead = z.infer<typeof RetryOverheadSchema>;
export type PopulationDrift = z.infer<typeof PopulationDriftSchema>;
