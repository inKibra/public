import type { ImpulseUrgency, WaitForIdleTarget } from './impulse/types';
import type { SourceFactType } from './source-facts';

export type ResponseLifecyclePhase =
  | 'scheduled'
  | 'selected'
  | 'executing'
  | 'cleared'
  | 'dropped'
  | 'delivered';

export type ResponseLifecycleDropReason =
  | 'decision_drop'
  | 'empty_output'
  | 'execution_error'
  | 'scheduler_drop'
  | 'eval_drop';

export type ResponseLifecycleReceipt = {
  constructId: string;
  responseId: string;
  phase: ResponseLifecyclePhase;
  timestamp: string;
  scheduledBy?: string;
  sourceFactId?: string;
  sourceFactType?: SourceFactType;
  traceId?: string;
  intent?: string;
  urgency?: ImpulseUrgency;
  waitForIdleTargets?: WaitForIdleTarget[];
  clearedByResponseId?: string;
  dropReason?: ResponseLifecycleDropReason;
  draftText?: string;
  /** For batch responses: peer response IDs in the same batch */
  batchPeerIds?: string[];
};

export function getResponseLifecyclePhaseRank(
  phase: ResponseLifecyclePhase,
): number {
  switch (phase) {
    case 'scheduled':
      return 1;
    case 'selected':
      return 2;
    case 'executing':
      return 3;
    case 'cleared':
      return 4;
    case 'dropped':
      return 5;
    case 'delivered':
      return 6;
  }
}

export function isResponseLifecyclePhaseAtLeast(
  phase: ResponseLifecyclePhase,
  target: ResponseLifecyclePhase,
): boolean {
  return (
    getResponseLifecyclePhaseRank(phase) >=
    getResponseLifecyclePhaseRank(target)
  );
}
