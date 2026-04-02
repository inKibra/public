import type { ConstructEvent, ResponseThinkingStage } from '../construct/types';
import type {
  SourceFactClearReason,
  SourceFactJournal,
  SourceFactLifecyclePhase,
  SourceFactType,
} from '../source-facts';
import {
  advanceConstructViewFrontier,
  applyConstructViewConstructEvent,
  applyConstructViewResponseDelta,
  applyConstructViewResponseThinkingDelta,
  applyConstructViewSourceFactLifecycle,
  type ConstructViewState,
  noteConstructViewIngressAccepted,
  noteConstructViewIngressCommitted,
  noteConstructViewIngressStalled,
  noteConstructViewRuntimeActivity,
  observeConstructViewCursor,
} from './view-machine';

export type ConstructViewStreamEventMap = {
  streamCursor: {
    cursor: string;
    phase: 'replay' | 'live';
    source: 'redis' | 'postgres';
    recovered?: boolean;
    reason?: 'cursor_trimmed' | 'redis_unavailable' | 'gap_detected';
  };
  constructEvent: {
    constructId: string;
    instanceKind: 'draft' | 'binding' | 'unknown';
    instanceId: string;
    event: {
      type: string;
      [key: string]: unknown;
    };
    ts: string;
  };
  thinkingDelta: {
    delta: string;
    ts: string;
  };
  responseThinkingDelta: {
    responseId: string;
    stage: ResponseThinkingStage;
    delta: string;
    ts: string;
  };
  responseDelta: {
    responseId: string;
    delta: string;
    ts: string;
  };
  sourceFactLifecycle: {
    constructId: string;
    factId: string;
    factType: SourceFactType;
    phase: SourceFactLifecyclePhase;
    ts: string;
    previewText?: string;
    traceId?: string;
    journal?: SourceFactJournal;
    queueRef?: string;
    impulseId?: string;
    responseId?: string;
    clearReason?: SourceFactClearReason;
  };
  ingressAccepted: {
    ref: string;
    opId: string;
    opKind: string;
    ts: string;
  };
  ingressCommitted: {
    ref: string;
    opId: string;
    opKind: string;
    ts: string;
  };
  ingressStalled: {
    ref: string;
    opId: string;
    opKind: string;
    reason:
      | 'commit_timeout'
      | 'invalid_ref'
      | 'failed_permanent'
      | 'failed_not_open';
    ts: string;
  };
  frontierAdvanced: {
    processedCursor?: string;
    committedCursor?: string;
    phase: 'prepared' | 'committed';
    ts: string;
  };
};

export const constructViewStreamHandlers = {
  streamCursor: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['streamCursor'],
  ) => observeConstructViewCursor(state, event.cursor),
  constructEvent: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['constructEvent'],
  ) =>
    applyConstructViewConstructEvent(
      state,
      event.event as ConstructEvent,
      event.ts,
    ),
  thinkingDelta: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['thinkingDelta'],
  ) => noteConstructViewRuntimeActivity(state, event.ts),
  responseThinkingDelta: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['responseThinkingDelta'],
  ) =>
    applyConstructViewResponseThinkingDelta(
      state,
      event.responseId,
      event.stage,
      event.delta,
      event.ts,
    ),
  responseDelta: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['responseDelta'],
  ) =>
    applyConstructViewResponseDelta(
      state,
      event.responseId,
      event.delta,
      event.ts,
    ),
  sourceFactLifecycle: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['sourceFactLifecycle'],
  ) => applyConstructViewSourceFactLifecycle(state, event),
  ingressAccepted: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['ingressAccepted'],
  ) => noteConstructViewIngressAccepted(state, event),
  ingressCommitted: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['ingressCommitted'],
  ) => noteConstructViewIngressCommitted(state, event),
  ingressStalled: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['ingressStalled'],
  ) => noteConstructViewIngressStalled(state, event),
  frontierAdvanced: (
    state: ConstructViewState,
    event: ConstructViewStreamEventMap['frontierAdvanced'],
  ) =>
    advanceConstructViewFrontier(state, {
      processedCursor: event.processedCursor,
      committedCursor: event.committedCursor,
    }),
};
