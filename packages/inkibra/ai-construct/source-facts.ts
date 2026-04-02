import type { Perception } from './construct/types';
import type { ConstructOp } from './runtime/ops';

export type SourceFactType =
  | 'user_message'
  | 'impulse'
  | 'system_event'
  | 'self_reminder'
  | 'time_passed'
  | 'mailbox_idle'
  | 'rate_response'
  | 'steer_directive';

export type SourceFactJournal = 'lane-log' | 'source-events';

export type SourceFactLifecyclePhase =
  | 'queued'
  | 'reflected'
  | 'spawned'
  | 'cleared'
  | 'delivered';

export type SourceFactProcessingStrategy = 'impulse' | 'none';

export type SourceFactClearReason =
  | 'response_scheduled'
  | 'no_response_planned'
  | 'no_processing_required'
  | 'failed_permanent';

export type SourceFactMetadata = {
  factId: string;
  factType: SourceFactType;
  traceId?: string;
  processingStrategy: SourceFactProcessingStrategy;
};

export type SourceFactReflectedEvent = SourceFactMetadata & {
  reflectedAt: string;
  journal: SourceFactJournal;
};

export type SourceFactLifecycleReceipt = {
  constructId: string;
  factId: string;
  factType: SourceFactType;
  phase: SourceFactLifecyclePhase;
  timestamp: string;
  traceId?: string;
  previewText?: string;
  journal?: SourceFactJournal;
  queueRef?: string;
  impulseId?: string;
  responseId?: string;
  clearReason?: SourceFactClearReason;
};

export type SourceFactKindClassification = Pick<
  SourceFactMetadata,
  'factType' | 'processingStrategy'
>;

export function isSourceFactPhaseAtLeast(
  phase: SourceFactLifecyclePhase,
  target: SourceFactLifecyclePhase,
): boolean {
  return getSourceFactPhaseRank(phase) >= getSourceFactPhaseRank(target);
}

export function getSourceFactPhaseRank(
  phase: SourceFactLifecyclePhase,
): number {
  switch (phase) {
    case 'queued':
      return 1;
    case 'reflected':
      return 2;
    case 'spawned':
      return 3;
    case 'cleared':
      return 4;
    case 'delivered':
      return 5;
  }
}

export function classifyConstructOpAsSourceFact(
  op: ConstructOp,
): SourceFactMetadata | null {
  const classification = classifyConstructOpKindAsSourceFact(op.kind);
  if (!classification) {
    return null;
  }

  return {
    factId: op.sourceFactId ?? op.opId,
    factType: classification.factType,
    traceId: op.traceId,
    processingStrategy: classification.processingStrategy,
  };
}

export function classifyConstructOpKindAsSourceFact(
  opKind: ConstructOp['kind'] | string,
): SourceFactKindClassification | null {
  switch (opKind) {
    case 'user_message':
    case 'impulse':
    case 'system_event':
    case 'self_reminder':
    case 'time_passed':
    case 'mailbox_idle':
      return {
        factType: opKind,
        processingStrategy: 'impulse',
      };

    case 'rate_response':
      return {
        factType: 'rate_response',
        processingStrategy: 'none',
      };

    case 'steer_directive':
      return {
        factType: 'steer_directive',
        processingStrategy: 'impulse',
      };

    default:
      return null;
  }
}

export function getSourceFactMetadataFromPerception(
  perception: Perception,
): SourceFactMetadata | null {
  switch (perception.source) {
    case 'user_message':
      return {
        factId: readString(perception.metadata, 'op_id'),
        factType: 'user_message',
        traceId: readString(perception.metadata, 'trace_id'),
        processingStrategy: 'impulse',
      };
    case 'system_event':
      return {
        factId: readString(perception.metadata, 'op_id'),
        factType: readSystemEventFactType(perception.event ?? ''),
        traceId: readString(perception.metadata, 'trace_id'),
        processingStrategy: 'impulse',
      };
    case 'self_reminder':
      return {
        factId: readString(perception.metadata, 'op_id'),
        factType: 'self_reminder',
        traceId: readString(perception.metadata, 'trace_id'),
        processingStrategy: 'impulse',
      };
    case 'time_passed':
      return {
        factId: readString(perception.metadata, 'op_id'),
        factType: 'time_passed',
        traceId: readString(perception.metadata, 'trace_id'),
        processingStrategy: 'impulse',
      };
  }
}

export function isPerceptionSourceFactAlreadyReflected(
  perception: Perception,
): boolean {
  return readBoolean(perception.metadata, 'source_fact_reflected');
}

function readSystemEventFactType(event: string): SourceFactType {
  if (event === 'mailbox_idle') {
    return 'mailbox_idle';
  }

  return 'system_event';
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

function readBoolean(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return record?.[key] === true;
}
