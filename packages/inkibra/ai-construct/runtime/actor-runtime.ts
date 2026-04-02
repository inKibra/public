/**
 * Simplified actor runtime: a local construct runtime running inside an actor.
 *
 * The mailbox is a gateway INTO the actor — not part of the local runtime.
 * Messages are drained in batch and fed to processMailboxMessages() which
 * fires concurrent impulses via ingestDetached(). The construct's internal
 * scheduler timer runs (autoStartPolling=true) and handles response scheduling.
 *
 * Frontier model:
 * - processedCursor: construct has read/reflected the op ("seen")
 * - committedCursor: op is durable/flushed
 * - On crash: replay from last committed cursor
 *
 * waitForRef remains durability-based: it resolves once the committed
 * mailbox cursor has advanced past the ref.
 */

import {
  type ActorCheckpointStore,
  type ActorLeaseStore,
  createMailboxActorRuntime,
  type MailboxActorContext,
} from '@inkibra/actor';
import type { Logger } from '@inkibra/logger';
import type {
  MailboxClient,
  MailboxMessage,
  MailboxOperation,
} from '@inkibra/mailbox';
import { decodeCursor } from '@inkibra/streams';
import type { Construct } from '../construct/construct';
import type { ConstructConfig } from '../construct/types';
import type { SystemEventNameFromProfile } from '../impulse/keys';
import { normalizeContextPath } from '../lab/lab-action-ops';
import { buildEditModeSnapshot } from '../lab/lab-edit-mode';
import { classifyConstructOpAsSourceFact } from '../source-facts';
import type { SourceFactRecord } from '../vfs/source-fact-state';
import { loadSourceFactState } from '../vfs/source-fact-state';
import { listStudioContextFiles, readStudioState } from '../vfs/studio-context';
import { createNoopConstructActivitySink } from './activity';
import { defaultConstructMailboxKeyStrategy } from './keys';
import { createConstructRuntimeManager } from './manager';
import type { ConstructOp } from './ops';
import { processMailboxMessages } from './processor';
import { publishQueuedSourceFact } from './source-fact-tracker';
import type {
  ConstructActivityConfig,
  ConstructIngressWaitResult,
  ConstructMailboxKeyContext,
  ConstructMailboxKeyStrategy,
  ConstructResponseLifecycleConfig,
  ConstructRuntimeManager,
  ConstructSourceFactConfig,
  DurableConstructRuntime,
} from './types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESIDENT_CONSTRUCTS = 64;
const DEFAULT_CONSTRUCT_IDLE_TTL_MS = 30_000;
const DEFAULT_CONSTRUCT_LEASE_MS = 60_000;
const DEFAULT_INGRESS_COMMIT_TIMEOUT_MS = 45_000;
const DEFAULT_INGRESS_COMMIT_POLL_MS = 50;
const DEFAULT_INGRESS_COMMIT_BUSY_EXTENSION_MS = 180_000;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type CreateActorRuntimeOptions<
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
  durable: {
    mailbox: MailboxClient;
    actor: {
      leaseStore: ActorLeaseStore;
      checkpointStore: ActorCheckpointStore<any>;
      maxResidentConstructs?: number;
      idleTtlMs?: number;
      leaseMs?: number;
      pollIntervalMs?: number;
      wakeRetryMs?: number;
    };
    keyStrategy?: ConstructMailboxKeyStrategy;
    keyContext?: Omit<ConstructMailboxKeyContext, 'constructId'>;
  };
  activity?: ConstructActivityConfig;
  sourceFacts?: ConstructSourceFactConfig;
  responses?: ConstructResponseLifecycleConfig;
  onFrontierAdvanced?: (args: {
    constructId: string;
    processedCursor?: string;
    committedCursor?: string;
    phase: 'prepared' | 'committed';
  }) => Promise<void> | void;
  onConstructOpened?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
  onConstructClosed?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
  ingress?: {
    commitTimeoutMs?: number;
    pollMs?: number;
    busyExtensionMs?: number;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a durable construct runtime backed by an actor + mailbox.
 *
 * The actor holds a local construct runtime. The mailbox is only a gateway
 * for incoming ops. All scheduling and response execution happens inside
 * the local runtime (autoStartPolling=true by default).
 */
export function createActorRuntime<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  options: CreateActorRuntimeOptions<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName
  >,
): DurableConstructRuntime<
  TImpulseProfileName,
  TImpulsePoolName,
  TLaneName,
  TSystemEventName
> {
  const activitySink =
    options.activity?.sink ?? createNoopConstructActivitySink();
  const keyStrategy =
    options.durable.keyStrategy ?? defaultConstructMailboxKeyStrategy;
  const keyContext = options.durable.keyContext;
  const actorConfig = options.durable.actor;
  const ingressCommitTimeoutMs =
    options.ingress?.commitTimeoutMs ?? DEFAULT_INGRESS_COMMIT_TIMEOUT_MS;
  const ingressCommitPollMs =
    options.ingress?.pollMs ?? DEFAULT_INGRESS_COMMIT_POLL_MS;
  const ingressCommitBusyExtensionMs =
    options.ingress?.busyExtensionMs ??
    DEFAULT_INGRESS_COMMIT_BUSY_EXTENSION_MS;

  const mailboxKeysFor = (constructId: string) => ({
    mailboxKey: keyStrategy.mailboxKey({
      constructId,
      namespace: keyContext?.namespace,
      environment: keyContext?.environment,
      tenantId: keyContext?.tenantId,
    }),
    consumerKey: keyStrategy.consumerKey({
      constructId,
      namespace: keyContext?.namespace,
      environment: keyContext?.environment,
      tenantId: keyContext?.tenantId,
    }),
  });

  // -------------------------------------------------------------------------
  // Runtime manager — shared construct lifecycle
  // -------------------------------------------------------------------------

  const runtimeManager = createConstructRuntimeManager<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >(
    options.logger,
    {
      createConfig: options.createConfig as (
        constructId: string,
      ) => Promise<
        ConstructConfig<TImpulseProfileName, TImpulsePoolName, TLaneName>
      >,
      onConstructOpened: async (constructId, construct) => {
        if (options.onConstructOpened) {
          await options.onConstructOpened(constructId, construct);
        }
      },
      onConstructClosed: async (constructId, construct) => {
        if (options.onConstructClosed) {
          await options.onConstructClosed(constructId, construct);
        }
      },
    },
    {
      sink: activitySink,
      level: options.activity?.level ?? 'coarse',
    },
    options.sourceFacts,
    options.responses,
  );

  // -------------------------------------------------------------------------
  // Edit mode tracking
  // -------------------------------------------------------------------------

  const editModeSet = new Set<string>();

  // -------------------------------------------------------------------------
  // Actor runtime — local runtime inside an actor
  // -------------------------------------------------------------------------

  // Empty checkpoint — no frontier FSM
  type EmptyCheckpoint = Record<string, never>;

  const actorRuntime = createMailboxActorRuntime<EmptyCheckpoint>({
    logger: options.logger,
    definition: {
      name: 'construct-runtime-actor',

      getMailboxBinding: (actorId: string) => {
        const { mailboxKey, consumerKey } = mailboxKeysFor(actorId);
        return {
          mailbox: options.durable.mailbox,
          mailboxKey,
          consumerKey,
          batchSize: 20,
        };
      },

      createInitialCheckpoint: async () => ({}) as EmptyCheckpoint,

      onStop: async ({ actorId }: { actorId: string }) => {
        await runtimeManager.waitForSettled?.(actorId);
        await runtimeManager.flushAndRelease(actorId);
      },

      // -------------------------------------------------------------------
      // processMessages: drain batch → reflect → return immediately
      //
      // Always drains immediately regardless of runtime state.
      // Perceptions fire concurrent impulses via ingestDetached().
      // The construct's internal scheduler handles response execution.
      //
      // We use deferCommit=true so that the actor loop can immediately
      // read the next batch of messages without waiting for the full
      // turn (impulse + scheduler + response + flush) to complete.
      // This allows later messages to become "seen" while earlier ones
      // are still processing.
      //
      // The durable frontier (committedCursor) only advances when
      // processIdle returns commitProcessedCursor=true after VFS flush.
      // -------------------------------------------------------------------
      processMessages: async ({
        ctx,
        messages,
      }: {
        ctx: MailboxActorContext<EmptyCheckpoint>;
        messages: MailboxMessage[];
      }) => {
        // Edit mode guard — skip processing while construct is in edit mode
        if (editModeSet.has(ctx.actorId)) {
          options.logger.debug(
            'Skipping processMessages while construct is in edit mode',
            {
              actorId: ctx.actorId,
              messageCount: messages.length,
            },
          );
          return { didWork: false, close: false, deferCommit: false };
        }

        const processMessagesStartMs = Date.now();
        options.logger.debug('Processing message batch for construct', {
          actorId: ctx.actorId,
          messageCount: messages.length,
        });
        let construct: Awaited<ReturnType<typeof runtimeManager.getOrCreate>>;
        try {
          const getOrCreateStartMs = Date.now();
          construct = await runtimeManager.getOrCreate(ctx.actorId);
          options.logger.debug('Got construct from runtime manager', {
            actorId: ctx.actorId,
            elapsedMs: Date.now() - getOrCreateStartMs,
          });
        } catch (err) {
          options.logger.error('Failed to get construct from runtime manager', {
            actorId: ctx.actorId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          throw err;
        }

        // Batch drain — fires concurrent impulses, processes other ops inline
        let result: Awaited<ReturnType<typeof processMailboxMessages>>;
        try {
          result = await processMailboxMessages(
            construct,
            messages,
            options.logger,
          );
        } catch (err) {
          options.logger.error('Failed to process mailbox messages', {
            actorId: ctx.actorId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          throw err;
        }

        options.logger.debug('Mailbox message batch processed', {
          actorId: ctx.actorId,
          processedCount: result.processedCount,
          shutdownRequested: result.shutdownRequested,
          diagnostics: result.diagnostics,
        });

        // Wait for any synchronous source-fact / response-lifecycle tracking
        await runtimeManager.waitForSettled?.(ctx.actorId);

        const processMessagesTotalMs = Date.now() - processMessagesStartMs;
        options.logger.debug('Completed processMessages for construct', {
          actorId: ctx.actorId,
          totalMs: processMessagesTotalMs,
          didWork: messages.length > 0 || result.processedCount > 0,
        });

        return {
          didWork: messages.length > 0 || result.processedCount > 0,
          close: result.shutdownRequested,
          // Defer the commit — processedCursor advances but committedCursor
          // stays behind until the idle path flushes VFS and commits.
          deferCommit: true,
        };
      },

      // -------------------------------------------------------------------
      // processIdle: check quiescence, flush, commit durability frontier
      // -------------------------------------------------------------------
      processIdle: async (ctx: MailboxActorContext<EmptyCheckpoint>) => {
        // Edit mode guard — keep alive but skip flush/commit
        if (editModeSet.has(ctx.actorId)) {
          return { didWork: false, keepAlive: true };
        }

        const construct = runtimeManager.getOpen(ctx.actorId);
        if (!construct) {
          options.logger.debug('Skipping processIdle: construct not open', {
            actorId: ctx.actorId,
          });
          return null;
        }

        const runtimeState = await construct.getRuntimeState();
        const shouldStayAwake =
          runtimeState.activeImpulses > 0 ||
          runtimeState.activeResponses > 0 ||
          runtimeState.scheduledResponses > 0 ||
          runtimeState.schedulerBusy;

        if (shouldStayAwake) {
          // Still busy — keep actor alive, do not flush or commit.
          // No logging here to avoid spam (this runs every ~100ms).
          return { didWork: false, keepAlive: true };
        }

        // Quiescent — flush dirty VFS state and advance the durable frontier.
        // This is the single consolidated flush + commit point.
        const isDirty = construct.getVfs().isDirty();
        if (isDirty) {
          try {
            await construct.flush();
            options.logger.debug('processIdle flush+commit', {
              actorId: ctx.actorId,
            });
          } catch (err) {
            options.logger.error('processIdle flush+commit failed', {
              actorId: ctx.actorId,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
            throw err;
          }
        }

        // Commit the durability frontier — processedCursor becomes
        // committedCursor, making all previously-seen messages durable.
        return {
          didWork: isDirty,
          commitProcessedCursor: true,
        };
      },
    },
    leaseStore: actorConfig.leaseStore,
    checkpointStore: actorConfig.checkpointStore,
    maxResidentActors:
      actorConfig.maxResidentConstructs ?? DEFAULT_MAX_RESIDENT_CONSTRUCTS,
    idleTtlMs: actorConfig.idleTtlMs ?? DEFAULT_CONSTRUCT_IDLE_TTL_MS,
    leaseMs: actorConfig.leaseMs ?? DEFAULT_CONSTRUCT_LEASE_MS,
    pollIntervalMs: actorConfig.pollIntervalMs,
    wakeRetryMs: actorConfig.wakeRetryMs,
    onFrontierAdvanced: (args) => {
      // Update construct with committed cursor for source-fact frontier pruning
      if (args.committedCursor && args.phase === 'committed') {
        runtimeManager
          .getOpen(args.actorId)
          ?.setCommittedCursor(args.committedCursor);
      }
      options.onFrontierAdvanced?.({
        constructId: args.actorId,
        processedCursor: args.processedCursor,
        committedCursor: args.committedCursor,
        phase: args.phase,
      });
    },
  });

  // -------------------------------------------------------------------------
  // Residency check
  // -------------------------------------------------------------------------

  async function getConstructResidency(constructId: string): Promise<{
    awake: boolean;
    status?: 'starting' | 'active' | 'idle' | 'closing' | 'evicting' | 'dead';
    lastActiveAt?: string;
  }> {
    const hostInfo = actorRuntime.getHostInfo(constructId);
    if (hostInfo) {
      return {
        awake:
          hostInfo.status === 'starting' ||
          hostInfo.status === 'active' ||
          hostInfo.status === 'idle',
        status: hostInfo.status,
        lastActiveAt: hostInfo.lastActiveAt,
      };
    }
    return { awake: false };
  }

  // -------------------------------------------------------------------------
  // Source facts — from VFS only (no frontier)
  // -------------------------------------------------------------------------

  async function loadSourceFacts(
    _constructId: string,
    construct: Construct<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
  ): Promise<Record<string, SourceFactRecord>> {
    return loadSourceFactState(construct.getVfs());
  }

  // -------------------------------------------------------------------------
  // Mailbox preview — non-consuming read of queued user messages
  // -------------------------------------------------------------------------

  type QueuedMailboxPreviewEntry = {
    factId: string;
    previewText: string;
    queuedAt: string;
    queueRef: string;
    opKind: string;
  };

  async function loadQueuedMailboxPreview(
    constructId: string,
    previewOptions?: { limit?: number },
  ): Promise<QueuedMailboxPreviewEntry[]> {
    const { mailboxKey } = mailboxKeysFor(constructId);

    // Preview only truly unread/unseen mailbox ops.
    // If processedCursor exists, it is the "seen" frontier and preview
    // should begin after it. Otherwise fall back to committedCursor.
    const checkpoint = await actorConfig.checkpointStore.load(constructId);
    const cursor = checkpoint?.processedCursor ?? checkpoint?.committedCursor;

    // Peek without consuming
    const { messages } = await options.durable.mailbox.peekBatch({
      mailboxKey,
      cursor,
      limit: previewOptions?.limit ?? 50,
    });

    const entries: QueuedMailboxPreviewEntry[] = [];
    for (const msg of messages) {
      if (msg.kind !== 'op') {
        continue;
      }
      const op = msg.operation;
      const sourceFact = classifyConstructOpAsSourceFact(op as ConstructOp);
      // Only include user-facing user-message facts in the preview.
      if (!sourceFact || sourceFact.factType !== 'user_message') {
        continue;
      }
      const payload = op.payload as { content?: string } | undefined;
      const previewText =
        typeof payload?.content === 'string' ? payload.content : undefined;
      if (!previewText) {
        continue;
      }
      entries.push({
        factId: sourceFact.factId,
        previewText,
        queuedAt: op.createdAt,
        queueRef: msg.cursor,
        opKind: op.kind,
      });
    }

    return entries;
  }

  async function loadIngressFrontier(constructId: string): Promise<{
    processedCursor?: string;
    committedCursor?: string;
  }> {
    const checkpoint = await actorConfig.checkpointStore.load(constructId);
    return {
      processedCursor: checkpoint?.processedCursor,
      committedCursor: checkpoint?.committedCursor,
    };
  }

  // -------------------------------------------------------------------------
  // waitForRef — simple cursor-based polling (no frontier FSM)
  //
  // After processMessages returns, the actor framework commits the consumer
  // cursor. If the cursor is past the ref, the op was consumed and processed.
  // -------------------------------------------------------------------------

  async function waitForRefResult(
    constructId: string,
    ref: string | undefined,
    waitOptions?: {
      timeoutMs?: number;
      pollMs?: number;
      busyExtensionMs?: number;
    },
  ): Promise<ConstructIngressWaitResult> {
    if (!ref) {
      return {
        status: 'stalled',
        waitedMs: 0,
        timeoutMs: 0,
        reason: 'invalid_ref',
      };
    }

    const target = decodeCursor(ref);
    if (!target) {
      return {
        status: 'stalled',
        waitedMs: 0,
        timeoutMs: 0,
        reason: 'invalid_ref',
      };
    }

    const timeoutMs = waitOptions?.timeoutMs ?? ingressCommitTimeoutMs;
    const pollMs = waitOptions?.pollMs ?? ingressCommitPollMs;
    const busyExtensionMs =
      waitOptions?.busyExtensionMs ?? ingressCommitBusyExtensionMs;
    const startedAt = Date.now();
    const initialDeadline = startedAt + timeoutMs;
    const hardDeadline = initialDeadline + busyExtensionMs;

    const { mailboxKey, consumerKey } = mailboxKeysFor(constructId);

    while (Date.now() < hardDeadline) {
      // Check if the consumer cursor has advanced past this ref
      const committedCursor = await options.durable.mailbox.getConsumerCursor({
        mailboxKey,
        consumerKey,
      });

      if (committedCursor) {
        const committed = decodeCursor(committedCursor);
        if (committed && committed.seq >= target.seq) {
          return {
            status: 'committed',
            waitedMs: Date.now() - startedAt,
            timeoutMs,
          };
        }
      }

      // After initial deadline, only keep waiting if runtime is busy
      if (Date.now() >= initialDeadline) {
        const open = runtimeManager.getOpen(constructId);
        if (!open) {
          break;
        }

        const runtimeState = await open.getRuntimeState();
        const isBusy =
          runtimeState.activeImpulses > 0 ||
          runtimeState.activeResponses > 0 ||
          runtimeState.scheduledResponses > 0 ||
          runtimeState.schedulerBusy;

        if (!isBusy) {
          break;
        }
      }

      await sleep(pollMs);
    }

    return {
      status: 'stalled',
      waitedMs: Date.now() - startedAt,
      timeoutMs,
      reason: 'commit_timeout',
    };
  }

  async function waitForRef(
    constructId: string,
    ref: string | undefined,
    waitOptions?: {
      timeoutMs?: number;
      pollMs?: number;
      busyExtensionMs?: number;
    },
  ): Promise<void> {
    const result = await waitForRefResult(constructId, ref, waitOptions);
    if (result.status === 'stalled') {
      throw new Error(
        `Durability timeout: commit not confirmed after ${result.waitedMs}ms ` +
          `(reason: ${result.reason}, constructId: ${constructId}, ref: ${ref})`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // submit — append to mailbox + wake actor
  // -------------------------------------------------------------------------

  async function submit(
    constructId: string,
    op: ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
  ): Promise<{ accepted: true; ref?: string }> {
    const { mailboxKey } = mailboxKeysFor(constructId);
    const appended = await options.durable.mailbox.appendOperation({
      mailboxKey,
      operation: op as MailboxOperation<unknown>,
    });

    void publishQueuedSourceFact({
      sink: options.sourceFacts?.sink,
      constructId,
      op,
      queueRef: appended.cursor,
    });

    void actorRuntime.ensureRunning(constructId);

    return {
      accepted: true,
      ref: appended.cursor,
    };
  }

  // -------------------------------------------------------------------------
  // Return the runtime interface
  // -------------------------------------------------------------------------

  return {
    mode: 'durable',
    actorRuntime,
    runtimeManager: runtimeManager as ConstructRuntimeManager<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
    submit,
    waitForRef,
    waitForRefResult,
    loadSourceFacts,
    loadQueuedMailboxPreview,
    loadIngressFrontier,
    getConstructResidency,
    // -----------------------------------------------------------------
    // Edit mode lifecycle
    // -----------------------------------------------------------------

    async enterEditMode(constructId: string) {
      editModeSet.add(constructId);
      // Get the construct in readonly mode (no scheduler start)
      const construct = await runtimeManager.getOrCreateReadonly(constructId);
      return buildEditModeSnapshot(construct);
    },

    async exitEditMode(constructId: string) {
      if (!editModeSet.has(constructId)) {
        return;
      }
      // Flush any edits made during edit mode.
      // writeContextFile uses getOrCreateReadonly, so we must flush that same
      // instance. getOpen() only returns the active running construct, which
      // may not exist when the construct is idle — causing edits to be lost.
      const openConstruct = runtimeManager.getOpen(constructId);
      if (openConstruct) {
        await openConstruct.flush();
      } else {
        // The construct may only exist as a readonly instance (loaded by
        // getOrCreateReadonly in writeContextFile). Flush that instead.
        const readonlyConstruct =
          await runtimeManager.getOrCreateReadonly(constructId);
        await readonlyConstruct.flush();
      }
      editModeSet.delete(constructId);
      // Wake the actor so it resumes processing
      void actorRuntime.ensureRunning(constructId);
    },

    isInEditMode(constructId: string) {
      return editModeSet.has(constructId);
    },

    // -----------------------------------------------------------------
    // File CRUD (only valid during edit mode)
    // -----------------------------------------------------------------

    async readContextFile(constructId: string, path: string) {
      if (!editModeSet.has(constructId)) {
        throw new Error(
          'Cannot read context file: construct is not in edit mode',
        );
      }
      const construct = await runtimeManager.getOrCreateReadonly(constructId);
      const normalized = normalizeContextPath(path);
      return construct.getVfs().read(normalized);
    },

    async writeContextFile(constructId: string, path: string, content: string) {
      if (!editModeSet.has(constructId)) {
        throw new Error(
          'Cannot write context file: construct is not in edit mode',
        );
      }
      const construct = await runtimeManager.getOrCreateReadonly(constructId);
      const normalized = normalizeContextPath(path);
      await construct.getVfs().write(normalized, content);
    },

    async deleteContextFile(constructId: string, path: string) {
      if (!editModeSet.has(constructId)) {
        throw new Error(
          'Cannot delete context file: construct is not in edit mode',
        );
      }
      const construct = await runtimeManager.getOrCreateReadonly(constructId);
      const normalized = normalizeContextPath(path);
      try {
        await construct.getVfs().delete(normalized);
      } catch {
        // Ignore missing path.
      }
    },

    async listContextFiles(constructId: string) {
      if (!editModeSet.has(constructId)) {
        throw new Error(
          'Cannot list context files: construct is not in edit mode',
        );
      }
      const construct = await runtimeManager.getOrCreateReadonly(constructId);
      const [contextFiles, studioState] = await Promise.all([
        listStudioContextFiles(construct),
        readStudioState(construct),
      ]);
      return {
        contextFiles,
        activeContextFilePath: studioState.activeContextFilePath,
      };
    },

    // -----------------------------------------------------------------
    // Shutdown
    // -----------------------------------------------------------------

    requestShutdown: async (constructId: string) => {
      await submit(constructId, {
        kind: 'shutdown',
        opId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      } as ConstructOp<
        TImpulseProfileName,
        TImpulsePoolName,
        TSystemEventName
      >);
    },
    shutdown: async () => {
      await actorRuntime.shutdown();
    },
  };
}
