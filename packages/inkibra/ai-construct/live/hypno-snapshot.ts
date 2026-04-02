import type { Construct } from '../construct/construct';
import type { ConstructHypnoSnapshot } from './snapshot-types';

export function mapConstructHypnoStage(
  stage: string | null,
  active: boolean,
): ConstructHypnoSnapshot['stage'] {
  if (!active) {
    return stage === 'completed' ? 'completed' : 'idle';
  }
  if (stage === 'analyze') {
    return 'analyze';
  }
  if (stage === 'propose') {
    return 'propose';
  }
  if (stage === 'commit') {
    return 'commit';
  }
  return 'review';
}

export function buildConstructHypnoSnapshot(
  construct: Construct,
  now = new Date().toISOString(),
): ConstructHypnoSnapshot {
  const active = construct.isHypnoActive();
  const stage = construct.getHypnoStage();
  const reviewState = construct.getHypnoReviewState();

  return {
    active,
    stage: mapConstructHypnoStage(stage, active),
    pendingPlan: reviewState?.hasPendingPlan ?? false,
    acceptRequiresConfirmation: reviewState?.hasPendingPlan ?? false,
    lastReviewReply: reviewState?.chatTranscript
      .filter((entry) => entry.role === 'assistant')
      .at(-1)?.text,
    updatedAt: now,
  };
}
