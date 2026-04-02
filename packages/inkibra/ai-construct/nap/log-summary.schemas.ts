import { defineAiOutputSchema } from '@inkibra/ai-flow';
import type { NapLaneLogSummary } from './log-summary';

export const napLaneLogSummaryOutputSchema =
  defineAiOutputSchema<NapLaneLogSummary>();
