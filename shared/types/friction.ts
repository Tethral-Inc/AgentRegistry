import { z } from 'zod';
import {
  FrictionSummarySchema,
  TargetFrictionSchema,
  FrictionReportSchema,
  ComponentFrictionSchema,
} from '../schemas/friction.js';

export type FrictionSummary = z.infer<typeof FrictionSummarySchema>;
export type TargetFriction = z.infer<typeof TargetFrictionSchema>;
export type FrictionReport = z.infer<typeof FrictionReportSchema>;
export type ComponentFriction = z.infer<typeof ComponentFrictionSchema>;
