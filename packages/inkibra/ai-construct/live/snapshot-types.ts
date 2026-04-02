import type { Construct } from '../construct/construct';
import type { ConstructRuntimeState } from '../construct/types';
import type { SourceFactRecord } from '../vfs/source-fact-state';

export type ConstructDeliveryState = 'sending' | 'sent' | 'seen' | 'durable';

export type ConstructIngressFrontier = {
  processedCursor?: string;
  committedCursor?: string;
};

export type ConstructQueuedMailboxPreviewEntry = {
  factId: string;
  previewText: string;
  queuedAt: string;
  queueRef: string;
  opKind: string;
};

export type ConstructSnapshotTranscriptMessage = {
  id: string;
  factId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  queuedAt?: string;
  reflectedAt?: string;
  queueRef?: string;
  deliveryState?: ConstructDeliveryState;
  kind: 'chat' | 'hypno-review' | 'tool' | 'decision';
  /** Lane that produced this message */
  lane?: string;
};

export type ConstructHypnoSnapshot = {
  active: boolean;
  stage: 'idle' | 'analyze' | 'propose' | 'review' | 'commit' | 'completed';
  pendingPlan: boolean;
  acceptRequiresConfirmation: boolean;
  lastReviewReply?: string;
  updatedAt: string;
};

export type ConstructToolLogEvent = {
  id: string;
  tool: string;
  command: string;
  output: string;
  createdAt: string;
};

export type ConstructDecisionLogEvent = {
  id: string;
  stage: string;
  summary: string;
  createdAt: string;
};

export type ConstructQueuedNextNapPin = {
  id: string;
  path: string;
  createdAt: string;
};

export type ConstructQueuedNextNapImprint = {
  id: string;
  text: string;
  createdAt: string;
};

export type ConstructSnapshot = {
  transcript: ConstructSnapshotTranscriptMessage[];
  frontier?: ConstructIngressFrontier;
  hypno: ConstructHypnoSnapshot;
  queuedNextNapPins: ConstructQueuedNextNapPin[];
  queuedNextNapImprints: ConstructQueuedNextNapImprint[];
  toolLog: ConstructToolLogEvent[];
  decisionLog: ConstructDecisionLogEvent[];
  runtimeState: ConstructRuntimeState;
};

export type BuildConstructSnapshotOptions<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TSystemEventName extends string = string,
> = {
  construct: Construct<TImpulseProfileName, TImpulsePoolName, TSystemEventName>;
  sourceFacts: Record<string, SourceFactRecord>;
  mailboxPreview?: ConstructQueuedMailboxPreviewEntry[];
  frontier?: ConstructIngressFrontier;
  toolLog: ConstructToolLogEvent[];
  decisionLog: ConstructDecisionLogEvent[];
  transcriptLimit?: number;
};
