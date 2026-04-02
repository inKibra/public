/**
 * Generic construct lab types.
 *
 * These define the app-agnostic contract for construct lab snapshots,
 * actions, studio state, runtime introspection, and SSE events.
 * Product-specific apps extend these with their own entity metadata.
 */

import type {
  ConstructEvent,
  ConstructRuntimeState,
  ResponseThinkingStage,
} from '../construct/types';
import type {
  ConstructDecisionLogEvent,
  ConstructHypnoSnapshot,
  ConstructIngressFrontier,
  ConstructQueuedNextNapImprint,
  ConstructQueuedNextNapPin,
  ConstructSnapshotTranscriptMessage,
  ConstructToolLogEvent,
} from '../live/snapshot-types';
import type {
  SourceFactClearReason,
  SourceFactJournal,
  SourceFactLifecyclePhase,
  SourceFactType,
} from '../source-facts';
import type {
  LaneStageContextPressureDiagnostics,
  LaneStageContextPressureEntry,
} from '../vfs/context-pressure';

// ---------------------------------------------------------------------------
// Snapshot Node (DAL-agnostic VFS snapshot)
// ---------------------------------------------------------------------------

/**
 * Minimal VFS snapshot node shape that generic lab builders operate on.
 * DAL-specific implementations extend this with `id`, `version`, etc.
 */
export type ConstructSnapshotNode = {
  path: string;
  kind: 'file' | 'directory';
  content: string;
  /** Parsed frontmatter metadata (when loaded from DAL snapshot). */
  meta?: Record<string, unknown>;
  sizeBytes: number;
  modified: string;
};

// ---------------------------------------------------------------------------
// Lab Snapshot
// ---------------------------------------------------------------------------

export type ConstructLabTranscriptMessage = ConstructSnapshotTranscriptMessage;

export type ConstructLabHypnoState = ConstructHypnoSnapshot;

export type ConstructLabToolEvent = ConstructToolLogEvent;

export type ConstructLabDecisionEvent = ConstructDecisionLogEvent;

export type ConstructLabSnapshot = {
  transcript: ConstructLabTranscriptMessage[];
  frontier?: ConstructIngressFrontier;
  hypno: ConstructLabHypnoState;
  queuedNextNapPins: ConstructQueuedNextNapPin[];
  queuedNextNapImprints: ConstructQueuedNextNapImprint[];
  toolLog: ConstructLabToolEvent[];
  decisionLog: ConstructLabDecisionEvent[];
  runtimeState: ConstructRuntimeState;
};

// ---------------------------------------------------------------------------
// Lab Actions
// ---------------------------------------------------------------------------

export type ConstructLabActionName =
  | 'chat'
  | 'nap'
  | 'startHypno'
  | 'chatHypnoReview'
  | 'acceptHypno'
  | 'updateHypno'
  | 'cancelHypno'
  | 'queueNextNapPin'
  | 'queueNextNapImprint'
  | 'rate'
  | 'steer';

export type ConstructLabAction =
  | { action: 'chat'; message: string; lane: string }
  | { action: 'nap' }
  | { action: 'startHypno' }
  | { action: 'chatHypnoReview'; text: string }
  | { action: 'acceptHypno' }
  | { action: 'updateHypno' }
  | { action: 'cancelHypno' }
  | { action: 'queueNextNapPin'; path: string }
  | { action: 'queueNextNapImprint'; text: string }
  | {
      action: 'rate';
      rating: 'helpful' | 'unhelpful';
      annotation?: string;
      lane: string;
    }
  | { action: 'steer'; directive: string; lane: string };

export type ConstructLabActionAccepted = {
  type: 'Accepted';
  action: ConstructLabActionName;
  opId?: string;
  ref?: string;
  queuedAt: string;
};

export type ConstructLabCommandRejectionReason =
  | 'CommandBusy'
  | 'CommandInvalidState'
  | 'CommandDuplicate';

export type ConstructLabActionRejected = {
  type: 'CommandRejected';
  reason: ConstructLabCommandRejectionReason;
  message: string;
  activeCommand?: string;
};

// ---------------------------------------------------------------------------
// Studio Snapshot
// ---------------------------------------------------------------------------

export type ConstructStudioContextFile = {
  path: string;
  title: string;
  summary?: string;
  content: string;
  sizeBytes: number;
  modifiedAt: string;
  /** Parsed YAML frontmatter from the file (empty object when absent). */
  frontmatter: Record<string, unknown>;
  /** True when the file is pinned by any source. */
  pinned?: boolean;
  /** Which policy layer pinned this file. */
  pinnedSource?: 'system' | 'ai';
  /** Visibility scope for the pin: '*' (global), 'nap', or a lane name. */
  pinnedScope?: string;
};

export type ConstructStudioSnapshot = {
  activeContextFilePath?: string;
  contextFiles: ConstructStudioContextFile[];
  lastSavedAt?: string;
};

export type ConstructStudioAction =
  | {
      action: 'upsertContextFile';
      file: {
        path: string;
        title?: string;
        summary?: string;
        content: string;
        pinned?: boolean;
      };
    }
  | { action: 'deleteContextFile'; path: string }
  | { action: 'setActiveContextFile'; path: string };

// ---------------------------------------------------------------------------
// Runtime Snapshot
// ---------------------------------------------------------------------------

export type ConstructRuntimeVfsNode = {
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
  modifiedAt: string;
};

export type ConstructRuntimeImpulseView = {
  id: string;
  pool: string;
  profile: string;
  status: 'queued' | 'running' | 'completed' | 'error';
  summary: string;
  startedAt: string;
};

export type ConstructRuntimeDecisionView = {
  id: string;
  stage: string;
  intent: string;
  rationale: string;
  createdAt: string;
};

export type ConstructRuntimeScheduledResponseView = {
  id: string;
  scheduledBy: string;
  intent: string;
  urgency: import('../impulse/types').ImpulseUrgency;
  waitForIdleTargets?: Array<{ kind: 'pool' | 'profile'; name: string }>;
  scheduledAt: string;
};

export type ConstructRuntimeToolEventView = {
  id: string;
  tool: string;
  command: string;
  output: string;
  createdAt: string;
};

export type ConstructRuntimeSourceFactView = {
  factId: string;
  factType: SourceFactType;
  lastPhase: SourceFactLifecyclePhase;
  updatedAt: string;
  previewText?: string;
  traceId?: string;
  journal?: SourceFactJournal;
  queueRef?: string;
  queuedAt?: string;
  reflectedAt?: string;
  spawnedAt?: string;
  clearedAt?: string;
  deliveredAt?: string;
  clearReason?: SourceFactClearReason;
  responseIds: string[];
  impulseIds: string[];
};

export type ConstructRuntimeResidencyView = {
  awake: boolean;
  status?: 'starting' | 'active' | 'idle' | 'closing' | 'evicting' | 'dead';
  lastActiveAt?: string;
};

export type ConstructRuntimeContextLanePressure = LaneStageContextPressureEntry;

export type ConstructRuntimeContextDiagnostics =
  LaneStageContextPressureDiagnostics;

export type ConstructRuntimeSnapshot = {
  constructState: {
    id: string;
    storage: string;
    isRunning: boolean;
    activeImpulses: number;
    queuedPerceptions: number;
    scheduledResponses: number;
  };
  runtimeState: ConstructRuntimeState;
  residency: ConstructRuntimeResidencyView;
  vfs: {
    nodes: ConstructRuntimeVfsNode[];
  };
  context?: ConstructRuntimeContextDiagnostics;
  impulses: ConstructRuntimeImpulseView[];
  scheduledResponses: ConstructRuntimeScheduledResponseView[];
  sourceFacts: ConstructRuntimeSourceFactView[];
  decisions: ConstructRuntimeDecisionView[];
  toolLog: ConstructRuntimeToolEventView[];
};

export type ConstructRuntimeAction =
  | { action: 'getVfs' }
  | { action: 'getState' }
  | { action: 'getRuntimeState' };

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

export type ConstructEventStreamConstructEvent = {
  type: ConstructEvent['type'];
  [key: string]: unknown;
};

export type ConstructEventStreamSourceFactLifecycle = {
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

export type ConstructEventStreamEventTypes = {
  streamCursor: {
    cursor: string;
    phase: 'replay' | 'live';
    source: 'redis' | 'postgres';
    recovered?: boolean;
    reason?: 'cursor_trimmed' | 'redis_unavailable' | 'gap_detected';
  };
  constructEvent: {
    constructId: string;
    event: ConstructEventStreamConstructEvent;
    ts: string;
  };
  thinkingDelta: {
    constructId: string;
    delta: string;
    ts: string;
  };
  responseThinkingDelta: {
    constructId: string;
    responseId: string;
    stage: ResponseThinkingStage;
    delta: string;
    ts: string;
  };
  responseDelta: {
    constructId: string;
    responseId: string;
    delta: string;
    ts: string;
  };
  sourceFactLifecycle: ConstructEventStreamSourceFactLifecycle;
  ingressAccepted: {
    constructId: string;
    ref: string;
    opId: string;
    opKind: string;
    ts: string;
  };
  ingressCommitted: {
    constructId: string;
    ref: string;
    opId: string;
    opKind: string;
    waitedMs: number;
    ts: string;
  };
  ingressStalled: {
    constructId: string;
    ref: string;
    opId: string;
    opKind: string;
    timeoutMs: number;
    waitedMs: number;
    reason:
      | 'commit_timeout'
      | 'invalid_ref'
      | 'failed_permanent'
      | 'failed_not_open';
    ts: string;
  };
  frontierAdvanced: {
    constructId: string;
    processedCursor?: string;
    committedCursor?: string;
    phase: 'prepared' | 'committed';
    ts: string;
  };
};
