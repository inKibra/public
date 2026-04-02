import type { Logger } from '@inkibra/logger';
import type { MailboxClient, MailboxMessage } from '@inkibra/mailbox';
import type { StreamCursor } from '@inkibra/streams';

export type ActorId = string;

export type ActorLeaseRecord = {
  actorId: ActorId;
  ownerId: string;
  ownerEpoch: number;
  leaseExpiresAt: string;
};

export type ActorLeaseStore = {
  acquire: (args: {
    actorId: ActorId;
    ownerId: string;
    leaseMs: number;
    now: string;
  }) => Promise<ActorLeaseRecord | null>;
  renew: (args: {
    actorId: ActorId;
    ownerId: string;
    ownerEpoch: number;
    leaseMs: number;
    now: string;
  }) => Promise<ActorLeaseRecord | null>;
  release: (args: {
    actorId: ActorId;
    ownerId: string;
    ownerEpoch: number;
  }) => Promise<void>;
  current: (actorId: ActorId) => Promise<ActorLeaseRecord | undefined>;
};

export type ActorCheckpointRecord<TCheckpoint> = {
  actorId: ActorId;
  ownerEpoch: number;
  processedCursor?: StreamCursor;
  committedCursor?: StreamCursor;
  phase: 'prepared' | 'committed';
  checkpoint: TCheckpoint;
  updatedAt: string;
};

export type ActorCheckpointStore<TCheckpoint> = {
  load: (
    actorId: ActorId,
  ) => Promise<ActorCheckpointRecord<TCheckpoint> | undefined>;
  /**
   * Persist a checkpoint record. Implementations must enforce epoch fencing:
   * reject writes where `record.ownerEpoch` is less than the currently stored
   * epoch, to prevent a stale host from overwriting a newer host's state after
   * a lease handover. The Redis implementation uses a Lua script for this.
   */
  save: (record: ActorCheckpointRecord<TCheckpoint>) => Promise<void>;
};

export type ActorMailboxBinding = {
  mailbox: MailboxClient;
  mailboxKey: string;
  consumerKey: string;
  batchSize?: number;
};

export type ActorHostStatus =
  | 'starting'
  | 'active'
  | 'idle'
  | 'closing'
  | 'evicting'
  | 'dead';

export type ActorClock = {
  now: () => string;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

export type MailboxActorContext<TCheckpoint> = {
  actorId: ActorId;
  logger: Logger;
  mailbox: ActorMailboxBinding;
  ownerId: string;
  ownerEpoch: number;
  checkpoint: TCheckpoint;
  updateCheckpoint: (checkpoint: TCheckpoint) => void;
  assertLeaseActive: () => Promise<void>;
};

export type MailboxActorBatchResult<TCheckpoint> = {
  checkpoint?: TCheckpoint;
  didWork: boolean;
  keepAlive?: boolean;
  close?: boolean;
  /**
   * When true, the actor runtime advances `processedCursor` but does NOT
   * commit the mailbox consumer cursor or advance `committedCursor`.
   * This allows the actor to "see" messages (advance the read frontier)
   * without making them durable yet. The `committedCursor` only advances
   * later when `processIdle()` returns `commitProcessedCursor: true`.
   *
   * On crash, replay starts from `committedCursor` — any messages between
   * committed and processed are re-delivered.
   */
  deferCommit?: boolean;
  /**
   * When returned from `processIdle()`, the actor runtime commits the
   * current `processedCursor` as the new `committedCursor`, advancing
   * the durable frontier.
   */
  commitProcessedCursor?: boolean;
};

export type MailboxActorDefinition<TCheckpoint> = {
  name: string;
  getMailboxBinding: (actorId: ActorId) => ActorMailboxBinding;
  createInitialCheckpoint: (
    actorId: ActorId,
  ) => Promise<TCheckpoint> | TCheckpoint;
  onStart?: (ctx: MailboxActorContext<TCheckpoint>) => Promise<void> | void;
  onStop?: (ctx: MailboxActorContext<TCheckpoint>) => Promise<void> | void;
  processMessages: (args: {
    ctx: MailboxActorContext<TCheckpoint>;
    messages: MailboxMessage[];
    nextCursor?: StreamCursor;
  }) => Promise<MailboxActorBatchResult<TCheckpoint>>;
  processIdle?: (
    ctx: MailboxActorContext<TCheckpoint>,
  ) => Promise<MailboxActorBatchResult<TCheckpoint> | null | undefined>;
};

export type MailboxActorRuntimeOptions<TCheckpoint> = {
  logger: Logger;
  definition: MailboxActorDefinition<TCheckpoint>;
  leaseStore: ActorLeaseStore;
  checkpointStore: ActorCheckpointStore<TCheckpoint>;
  maxResidentActors: number;
  idleTtlMs: number;
  leaseMs?: number;
  pollIntervalMs?: number;
  wakeRetryMs?: number;
  clock?: Partial<ActorClock>;
  onFrontierAdvanced?: (args: {
    actorId: ActorId;
    processedCursor?: StreamCursor;
    committedCursor?: StreamCursor;
    phase: 'prepared' | 'committed';
  }) => Promise<void> | void;
};

export type MailboxActorRuntime = {
  ensureRunning: (actorId: ActorId) => Promise<void>;
  nudge: (actorId: ActorId) => void;
  shutdown: () => Promise<void>;
  getHostStatus: (actorId: ActorId) => ActorHostStatus | undefined;
  getHostInfo: (
    actorId: ActorId,
  ) =>
    | { actorId: ActorId; status: ActorHostStatus; lastActiveAt: string }
    | undefined;
  listHosts: () => Array<{ actorId: ActorId; status: ActorHostStatus }>;
};
