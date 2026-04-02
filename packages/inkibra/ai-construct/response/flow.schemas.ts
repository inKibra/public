import { defineAiOutputSchema } from '@inkibra/ai-flow';
import type { EvalDraftVerdict } from './flow';

export const evalDraftOutputSchema = defineAiOutputSchema<EvalDraftVerdict>();
