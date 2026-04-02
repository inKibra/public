import { defineAiOutputSchema } from '@inkibra/ai-flow';
import type { ImpulseDecisionOutput } from './types';

export const impulseDecisionOutputSchema =
  defineAiOutputSchema<ImpulseDecisionOutput>();
