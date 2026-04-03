import { z } from 'zod';
import {
  EmitterSchema,
  TargetSchema,
  InteractionSchema,
  AnomalySchema,
  InteractionReceiptSchema,
} from '../schemas/receipt.js';

export type Emitter = z.infer<typeof EmitterSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Anomaly = z.infer<typeof AnomalySchema>;
export type InteractionReceipt = z.infer<typeof InteractionReceiptSchema>;
