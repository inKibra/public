import type { ActorHostStatus, MailboxActorRuntime } from '@inkibra/actor';
import type { Logger } from '@inkibra/logger';
import type { Construct } from '../construct/construct';
import type { ConstructConfig, ConstructEvent } from '../construct/types';
import type { SystemEventNameFromProfile } from '../impulse/keys';
import type { ConstructIngressFrontier } from '../live/snapshot-types';
import type { ResponseLifecycleReceipt } from '../response-lifecycle';
import type { SourceFactLifecycleReceipt } from '../source-facts';
import type { SourceFactRecord } from '../vfs/source-fact-state';
import type { ConstructOp } from './ops';

export type ConstructMailboxKeyContext = {
  constructId: string;
  namespace?: string;
  environment?: string;
  tenantId?: string;
};

export type ConstructMailboxKeyStrategy = {
  mailboxKey: (input: ConstructMailboxKeyContext) => string;
  consumerKey: (input: ConstructMailboxKeyContext) => string;
};

export type ConstructIngressLifecycleEvent = {
  type: 'accepted';
  constructId: string;
  opId: string;
  opKind: string;
  ref: string;
  ts: string;
};

export type ConstructActivityType =
  | 'idle'
  | 'impulse_active'
  | 'response_deciding'
  | 'response_generating'
  | 'response_evaluating'
  | 'response_typing'
  | 'response_delivered'
  | 'nap_running'
  | 'nap_error';

export type ConstructActivityEvent = {
  constructId: string;
  activityType: ConstructActivityType;
  timestamp: string;
  impulseId?: string;
  responseId?: string;
  traceId?: string;
  details?: Record<string, unknown>;
};

export type ConstructActivitySink = {
  publish: (event: ConstructActivityEvent) => Promise<void>;
};

export type ConstructActivityConfig = {
  sink?: ConstructActivitySink;
  level?: 'coarse' | 'debug';
};

export type ConstructSourceFactSink = {
  publish: (receipt: SourceFactLifecycleReceipt) => Promise<void>;
};

export type ConstructSourceFactConfig = {
  sink?: ConstructSourceFactSink;
};

export type ConstructResponseLifecycleSink = {
  publish: (receipt: ResponseLifecycleReceipt) => Promise<void>;
};

export type ConstructResponseLifecycleConfig = {
  sink?: ConstructResponseLifecycleSink;
};

export type ConstructRuntimeManagerConfig<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
> = {
  createConfig: (
    constructId: string,
  ) => Promise<
    ConstructConfig<TImpulseProfileName, TImpulsePoolName, TLaneName>
  >;
  onConstructOpened?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
  onConstructClosed?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
};

export type ConstructRuntimeManager<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
> = {
  getOrCreate: (
    constructId: string,
  ) => Promise<
    Construct<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >
  >;
  /**
   * Get or create a construct for read-only access (snapshot, status checks).
   * If the construct is already open (actor running), returns the live instance.
   * Otherwise creates a new instance WITHOUT starting the scheduler or calling
   * onConstructOpened — purely for reading VFS state.
   */
  getOrCreateReadonly: (
    constructId: string,
  ) => Promise<
    Construct<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >
  >;
  getOpen: (
    constructId: string,
  ) =>
    | Construct<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName,
        TSystemEventName
      >
    | undefined;
  waitForSettled?: (constructId: string) => Promise<void>;
  flushAndRelease: (constructId: string) => Promise<void>;
};

export type ConstructIngress<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
> = {
  submit: (
    constructId: string,
    op: ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
  ) => Promise<{ accepted: true; ref?: string }>;
  loadConstruct: (
    constructId: string,
    options?: { traceId?: string },
  ) => Promise<{ accepted: true; ref?: string }>;
  queueNextNapPin: (
    constructId: string,
    input: { path: string; opId?: string; traceId?: string; lane?: string },
  ) => Promise<{ accepted: true; ref?: string }>;
  queueNextNapImprint: (
    constructId: string,
    input: { text: string; opId?: string; traceId?: string },
  ) => Promise<{ accepted: true; ref?: string }>;
  waitForSettled?: (constructId: string) => Promise<void>;
};

export type ConstructDurableIngress<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
> = ConstructIngress<
  TImpulseProfileName,
  TImpulsePoolName,
  TSystemEventName
> & {
  requestShutdown: (constructId: string) => Promise<void>;
  notifyConstructClosed?: (constructId: string) => void;
};

type ConstructRuntimeBaseOptions<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
> = {
  logger: Logger;
  createConfig: (
    constructId: string,
  ) => Promise<
    ConstructConfig<TImpulseProfileName, TImpulsePoolName, TLaneName>
  >;
  activity?: ConstructActivityConfig;
  sourceFacts?: ConstructSourceFactConfig;
  responses?: ConstructResponseLifecycleConfig;
  onConstructOpened?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
  onConstructClosed?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
};

export type LocalConstructRuntimeOptions<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
> = ConstructRuntimeBaseOptions<
  TImpulseProfileName,
  TImpulsePoolName,
  TLaneName
> & {
  mode: 'local';
};

export type ConstructRuntimeOptions<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
> = LocalConstructRuntimeOptions<
  TImpulseProfileName,
  TImpulsePoolName,
  TLaneName
>;

export type LocalConstructRuntime<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
> = {
  mode: 'local';
  runtimeManager: ConstructRuntimeManager<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >;
  submit: (
    constructId: string,
    op: ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
  ) => Promise<{ accepted: true; ref?: string }>;
  waitForSettled?: (constructId: string) => Promise<void>;
  requestShutdown: (constructId: string) => Promise<void>;
};

export type DurableConstructRuntime<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
> = {
  mode: 'durable';
  actorRuntime: MailboxActorRuntime;
  runtimeManager: ConstructRuntimeManager<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >;
  submit: (
    constructId: string,
    op: ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
  ) => Promise<{ accepted: true; ref?: string }>;
  waitForRef: (
    constructId: string,
    ref: string | undefined,
    options?: {
      timeoutMs?: number;
      pollMs?: number;
      busyExtensionMs?: number;
    },
  ) => Promise<void>;
  waitForRefResult: (
    constructId: string,
    ref: string | undefined,
    options?: {
      timeoutMs?: number;
      pollMs?: number;
      busyExtensionMs?: number;
    },
  ) => Promise<ConstructIngressWaitResult>;
  loadSourceFacts: (
    constructId: string,
    construct: Construct<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
  ) => Promise<Record<string, SourceFactRecord>>;
  /**
   * Non-consuming preview of queued mailbox messages that have not yet
   * been reflected by the construct. Used for cross-tab reconstruction
   * of queued user messages in lab snapshots.
   */
  loadQueuedMailboxPreview: (
    constructId: string,
    options?: { limit?: number },
  ) => Promise<
    Array<{
      factId: string;
      previewText: string;
      queuedAt: string;
      queueRef: string;
      opKind: string;
    }>
  >;
  loadIngressFrontier: (
    constructId: string,
  ) => Promise<ConstructIngressFrontier>;
  getConstructResidency: (constructId: string) => Promise<{
    awake: boolean;
    status?: ActorHostStatus;
    lastActiveAt?: string;
  }>;
  notifyScheduleUpdated?: (
    constructId: string,
    reason?: string,
  ) => Promise<void>;
  // Edit mode — pauses the construct for direct VFS CRUD
  enterEditMode: (constructId: string) => Promise<{
    contextFiles: import('../lab/types').ConstructStudioContextFile[];
    activeContextFilePath?: string;
    lastSavedAt?: string;
  }>;
  exitEditMode: (constructId: string) => Promise<void>;
  isInEditMode: (constructId: string) => boolean;
  // File CRUD — only available during edit mode
  readContextFile: (constructId: string, path: string) => Promise<string>;
  writeContextFile: (
    constructId: string,
    path: string,
    content: string,
  ) => Promise<void>;
  deleteContextFile: (constructId: string, path: string) => Promise<void>;
  listContextFiles: (constructId: string) => Promise<{
    contextFiles: import('../lab/types').ConstructStudioContextFile[];
    activeContextFilePath?: string;
  }>;
  requestShutdown: (constructId: string) => Promise<void>;
  shutdown: () => Promise<void>;
};

export type ConstructIngressWaitReason =
  | 'commit_timeout'
  | 'invalid_ref'
  | 'failed_permanent'
  | 'failed_not_open';

export type ConstructIngressWaitResult =
  | {
      status: 'committed';
      waitedMs: number;
      timeoutMs: number;
    }
  | {
      status: 'stalled';
      waitedMs: number;
      timeoutMs: number;
      reason: ConstructIngressWaitReason;
    };

export type ConstructRuntime<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
> =
  | LocalConstructRuntime<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >
  | DurableConstructRuntime<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >;

export type ConstructEventToActivityMapper = (args: {
  constructId: string;
  event: ConstructEvent;
  now: string;
}) => ConstructActivityEvent | null;
