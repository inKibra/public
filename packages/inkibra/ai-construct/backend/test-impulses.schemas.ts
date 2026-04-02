import { defineImpulsePayload } from '@inkibra/ai-construct';

export const coachNudgePayloadSchema = defineImpulsePayload<{
  source: 'crm' | 'admin';
  note: string;
}>();
