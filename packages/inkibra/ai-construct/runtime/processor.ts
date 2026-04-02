import type { Logger } from '@inkibra/logger';
import type { MailboxMessage, MailboxOperation } from '@inkibra/mailbox';
import type { Construct } from '../construct/construct';
import {
  consumeDeferredPerceptionQueueEntries,
  type DeferredParentResolutionOutcome,
  type DeferredPerceptionEnqueueRequest,
  type DeferredPerceptionQueueEntry,
  enqueueDeferredPerceptionOps,
  loadPendingDeferredPerceptionQueueEntries,
  recordDeferredParentResolutionOutcomes,
} from '../vfs/deferred-perceptions';
import {
  type ConstructOp,
  type ConstructOpAction,
  mapConstructOpToAction,
} from './ops';
import { publishQueuedSourceFact } from './source-fact-tracker';

export type ProcessMailboxMessagesResult = {
  processedCount: number;
  shutdownRequested: boolean;
  diagnostics: ProcessMailboxMessagesDiagnostics;
  opOutcomes: ProcessMailboxOpOutcome[];
};

export type ProcessMailboxOpLifecycle =
  | 'applied'
  | 'applied_deferred'
  | 'failed_permanent'
  | 'failed_not_open';

export type ProcessMailboxOpOutcome = {
  source: 'mailbox' | 'deferred';
  opId: string;
  opKind: string;
  ref?: string;
  lifecycle: ProcessMailboxOpLifecycle;
};

export type ProcessMailboxMessagesDiagnostics = {
  mailbox: {
    messageCount: number;
    opCount: number;
    idleCount: number;
    dlqCount: number;
    invalidOpCount: number;
  };
  deferredQueue: {
    loadedCount: number;
    enqueuedCount: number;
    dedupedCount: number;
    replayedCount: number;
    consumedCount: number;
    deferredByHypnoCount: number;
  };
  processed: {
    perceptionCount: number;
    perceptionCommandCount: number;
    runtimeCount: number;
    exclusiveCommandCount: number;
    controlCount: number;
  };
  actionKindCounts: Record<string, number>;
  opIdSample: string[];
};

export type DrainScheduledResponsesResult = {
  pollCount: number;
  stopReason: 'stabilized' | 'max_polls_reached';
};

type CommandAction = ConstructOpAction & { type: 'command' };

type PerceptionLaneCommandAction = CommandAction & {
  action: 'rate_response' | 'steer_directive';
};

type ProcessQueueItem =
  | {
      source: 'mailbox';
      ref: string;
      op: ConstructOp;
    }
  | {
      source: 'deferred';
      deferredEntryId: string;
      deferredParentOpId: string;
      deferredChildOpId: string;
      op: ConstructOp;
    };

type DeferredMailboxParentPendingCommit = {
  item: Extract<ProcessQueueItem, { source: 'mailbox' }>;
  childOpId: string;
};

export async function processMailboxMessages(
  construct: Construct,
  messages: MailboxMessage[],
  logger?: Logger,
): Promise<ProcessMailboxMessagesResult> {
  const vfs = construct.getVfs();
  const constructState = await construct.getState();
  const deferredEntries = await loadPendingDeferredPerceptionQueueEntries(vfs);

  const diagnostics: ProcessMailboxMessagesDiagnostics = {
    mailbox: {
      messageCount: messages.length,
      opCount: 0,
      idleCount: 0,
      dlqCount: 0,
      invalidOpCount: 0,
    },
    deferredQueue: {
      loadedCount: deferredEntries.length,
      enqueuedCount: 0,
      dedupedCount: 0,
      replayedCount: 0,
      consumedCount: 0,
      deferredByHypnoCount: 0,
    },
    processed: {
      perceptionCount: 0,
      perceptionCommandCount: 0,
      runtimeCount: 0,
      exclusiveCommandCount: 0,
      controlCount: 0,
    },
    actionKindCounts: {},
    opIdSample: [],
  };

  let processedCount = 0;
  let shutdownRequested = false;
  const opOutcomes: ProcessMailboxOpOutcome[] = [];
  const pendingPerceptionTasks: Promise<void>[] = [];
  let requiresFinalPerceptionDrain = false;
  const consumedDeferredEntryIds: string[] = [];
  const deferredTerminalOutcomes: DeferredParentResolutionOutcome[] = [];
  const deferredEnqueueRequests: DeferredPerceptionEnqueueRequest[] = [];
  const pendingDeferredChildOpIds = new Set(
    deferredEntries.map((entry) => entry.childOpId),
  );
  const deferredMailboxParentsPendingCommit: DeferredMailboxParentPendingCommit[] =
    [];

  const queuePerceptionTask = (task: () => Promise<boolean>): void => {
    const pending = (async () => {
      if (await task()) {
        processedCount += 1;
      }
    })();
    pendingPerceptionTasks.push(pending);
  };

  const drainPendingPerceptionTasks = async (): Promise<void> => {
    if (pendingPerceptionTasks.length === 0) {
      return;
    }

    const pending = pendingPerceptionTasks.splice(
      0,
      pendingPerceptionTasks.length,
    );
    await Promise.all(pending);
  };

  const queueDeferredChildOpForMailboxParent = (
    item: Extract<ProcessQueueItem, { source: 'mailbox' }>,
    op: ConstructOp,
    sourceFactReflected: boolean,
  ): void => {
    const childOpId = createDeferredChildOpId(op.opId);

    if (pendingDeferredChildOpIds.has(childOpId)) {
      diagnostics.deferredQueue.dedupedCount += 1;
      recordOutcome(item, 'applied_deferred');
      return;
    }

    pendingDeferredChildOpIds.add(childOpId);
    deferredEnqueueRequests.push({
      parentOpId: op.opId,
      childOpId,
      lane: 'nap-lane',
      op: {
        ...op,
        opId: childOpId,
        sourceFactId: op.sourceFactId ?? op.opId,
        ...(sourceFactReflected ? { sourceFactReflected: true } : {}),
      },
    });

    deferredMailboxParentsPendingCommit.push({
      item,
      childOpId,
    });
  };

  const recordOutcome = (
    item: ProcessQueueItem,
    lifecycle: ProcessMailboxOpLifecycle,
  ): void => {
    opOutcomes.push({
      source: item.source,
      opId: item.op.opId,
      opKind: item.op.kind,
      ref: item.source === 'mailbox' ? item.ref : undefined,
      lifecycle,
    });
  };

  const recordDeferredChildTerminalOutcome = (
    item: Extract<ProcessQueueItem, { source: 'deferred' }>,
    lifecycle: DeferredParentResolutionOutcome['lifecycle'],
  ): void => {
    consumedDeferredEntryIds.push(item.deferredEntryId);
    diagnostics.deferredQueue.replayedCount += 1;
    deferredTerminalOutcomes.push({
      parentOpId: item.deferredParentOpId,
      childOpId: item.deferredChildOpId,
      lifecycle,
      resolvedAt: new Date().toISOString(),
    });
  };

  const queueItems: ProcessQueueItem[] = [];
  for (const deferred of deferredEntries) {
    queueItems.push({
      source: 'deferred',
      deferredEntryId: deferred.id,
      deferredParentOpId: deferred.parentOpId,
      deferredChildOpId: deferred.childOpId,
      op: normalizeDeferredReplayOp(deferred),
    });
  }

  for (const message of messages) {
    if (message.kind === 'dlq') {
      diagnostics.mailbox.dlqCount += 1;
      continue;
    }

    if (message.kind === 'idle') {
      diagnostics.mailbox.idleCount += 1;
      continue;
    }

    let op: ConstructOp | null = null;
    if (message.kind === 'op' && isConstructOp(message.operation)) {
      op = message.operation;
      diagnostics.mailbox.opCount += 1;
    } else if (message.kind === 'op') {
      diagnostics.mailbox.invalidOpCount += 1;
    }

    if (!op) {
      continue;
    }

    await publishQueuedSourceFact({
      constructId: constructState.id,
      op,
      queueRef: message.cursor,
      vfs,
    });

    queueItems.push({ source: 'mailbox', ref: message.cursor, op });
  }

  for (const item of queueItems) {
    let op = item.op;

    diagnostics.actionKindCounts[op.kind] =
      (diagnostics.actionKindCounts[op.kind] ?? 0) + 1;
    if (diagnostics.opIdSample.length < 10) {
      diagnostics.opIdSample.push(op.opId);
    }

    let action = mapConstructOpToAction(op);
    if (item.source === 'mailbox' && action.type === 'perception') {
      const sourceFactReflected = await reflectMailboxParentSourceFact(
        construct,
        action,
      );
      if (sourceFactReflected) {
        op = markOpSourceFactReflected(op);
        action = mapConstructOpToAction(op);
      }
    }

    if (action.type === 'perception') {
      const perceptionAction = action;

      if (shouldDeferPerceptionLaneWork(construct)) {
        diagnostics.deferredQueue.deferredByHypnoCount += 1;
        if (item.source === 'mailbox') {
          queueDeferredChildOpForMailboxParent(
            item,
            op,
            op.sourceFactReflected === true,
          );
        }
        continue;
      }

      if (
        item.source === 'mailbox' &&
        !item.ref.startsWith('local:') &&
        typeof construct.ingestDetached === 'function'
      ) {
        const ingestStartMs = Date.now();
        logger?.debug('ingestDetached perception queued', {
          perceptionSource: perceptionAction.perception.source,
          ref: item.ref,
        });
        void construct
          .ingestDetached(perceptionAction.perception)
          .then(() => {
            logger?.debug('ingestDetached completed', {
              ref: item.ref,
              elapsedMs: Date.now() - ingestStartMs,
            });
          })
          .catch((err) => {
            logger?.error('ingestDetached failed', {
              ref: item.ref,
              elapsedMs: Date.now() - ingestStartMs,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
          });
        diagnostics.processed.perceptionCount += 1;
        processedCount += 1;
        recordOutcome(item, 'applied');
        continue;
      }

      queuePerceptionTask(async () => {
        const ingest = construct.ingest;
        if (!ingest) {
          throw new Error('Construct does not support ingest');
        }
        await ingest.call(construct, perceptionAction.perception);
        diagnostics.processed.perceptionCount += 1;
        if (item.source === 'mailbox') {
          recordOutcome(item, 'applied');
        }
        if (item.source === 'deferred') {
          recordDeferredChildTerminalOutcome(item, 'applied');
        }
        return true;
      });
      requiresFinalPerceptionDrain = true;
      continue;
    }

    if (isPerceptionLaneCommandAction(action)) {
      const lane = normalizePerceptionLane(action.payload.lane);
      if (!lane) {
        if (item.source === 'mailbox') {
          recordOutcome(item, 'failed_permanent');
        }
        if (item.source === 'deferred') {
          recordDeferredChildTerminalOutcome(item, 'failed_permanent');
        }
        continue;
      }

      let perceptionLaneAction = action;

      if (perceptionLaneAction.action === 'rate_response') {
        queuePerceptionTask(async () =>
          executePerceptionLaneCommand(
            construct,
            perceptionLaneAction,
            lane,
          ).then((executed) => {
            if (item.source === 'mailbox') {
              recordOutcome(item, executed ? 'applied' : 'failed_permanent');
            }
            if (item.source === 'deferred') {
              recordDeferredChildTerminalOutcome(
                item,
                executed ? 'applied' : 'failed_permanent',
              );
            }
            if (executed) {
              diagnostics.processed.perceptionCommandCount += 1;
            }
            return executed;
          }),
        );
        requiresFinalPerceptionDrain = true;
        continue;
      }

      if (shouldDeferPerceptionLaneWork(construct)) {
        diagnostics.deferredQueue.deferredByHypnoCount += 1;
        if (item.source === 'mailbox') {
          const sourceFactReflected = await reflectMailboxParentSourceFact(
            construct,
            perceptionLaneAction,
            lane,
          );
          if (sourceFactReflected) {
            op = markOpSourceFactReflected(op);
            action = mapConstructOpToAction(op);
            if (!isPerceptionLaneCommandAction(action)) {
              throw new Error(
                `Expected perception-lane command after reflection for ${op.opId}`,
              );
            }
            perceptionLaneAction = action;
          }
          queueDeferredChildOpForMailboxParent(item, op, sourceFactReflected);
        }
        continue;
      }

      queuePerceptionTask(async () =>
        executePerceptionLaneCommand(
          construct,
          perceptionLaneAction,
          lane,
        ).then((executed) => {
          if (item.source === 'mailbox') {
            recordOutcome(item, executed ? 'applied' : 'failed_permanent');
          }
          if (item.source === 'deferred') {
            recordDeferredChildTerminalOutcome(
              item,
              executed ? 'applied' : 'failed_permanent',
            );
          }
          if (executed) {
            diagnostics.processed.perceptionCommandCount += 1;
          }
          return executed;
        }),
      );
      requiresFinalPerceptionDrain = true;
      continue;
    }

    await drainPendingPerceptionTasks();

    if (action.type === 'runtime') {
      let applied = false;

      if (action.action === 'next_nap_pin') {
        const path = action.payload.path;
        if (typeof path === 'string' && path.length > 0) {
          const queueNextNapPin = construct.queueNextNapPin;
          if (!queueNextNapPin) {
            throw new Error('Construct does not support queueNextNapPin');
          }
          await queueNextNapPin.call(construct, { path, id: op.opId });
          applied = true;
          processedCount += 1;
          diagnostics.processed.runtimeCount += 1;
          if (item.source === 'deferred') {
            recordDeferredChildTerminalOutcome(item, 'applied');
          }
        }
      }
      if (action.action === 'next_nap_imprint') {
        const text = action.payload.text;
        if (typeof text === 'string' && text.length > 0) {
          const queueNextNapImprint = construct.queueNextNapImprint;
          if (!queueNextNapImprint) {
            throw new Error('Construct does not support queueNextNapImprint');
          }
          await queueNextNapImprint.call(construct, { text, id: op.opId });
          applied = true;
          processedCount += 1;
          diagnostics.processed.runtimeCount += 1;
          if (item.source === 'deferred') {
            recordDeferredChildTerminalOutcome(item, 'applied');
          }
        }
      }

      if (action.action === 'response_delivered') {
        const responseId = action.payload.responseId;
        if (typeof responseId === 'string' && responseId.trim().length > 0) {
          applied = true;
          processedCount += 1;
          diagnostics.processed.runtimeCount += 1;
          if (item.source === 'deferred') {
            recordDeferredChildTerminalOutcome(item, 'applied');
          }
        }
      }

      if (!applied && item.source === 'deferred') {
        recordDeferredChildTerminalOutcome(item, 'failed_permanent');
      }

      if (item.source === 'mailbox') {
        recordOutcome(item, applied ? 'applied' : 'failed_permanent');
      }
      continue;
    }

    if (action.type === 'command') {
      const executed = await executeExclusiveCommandAction(construct, action);

      if (item.source === 'mailbox') {
        recordOutcome(item, executed ? 'applied' : 'failed_permanent');
      }

      if (item.source === 'deferred') {
        recordDeferredChildTerminalOutcome(
          item,
          executed ? 'applied' : 'failed_permanent',
        );
      }

      if (executed) {
        processedCount += 1;
        diagnostics.processed.exclusiveCommandCount += 1;
      }
      continue;
    }

    if (action.type === 'control') {
      diagnostics.processed.controlCount += 1;
      if (item.source === 'mailbox') {
        recordOutcome(item, 'applied');
      }
      if (item.source === 'deferred') {
        recordDeferredChildTerminalOutcome(item, 'applied');
      }
      if (action.action === 'shutdown') {
        shutdownRequested = true;
      }
    }
  }

  if (requiresFinalPerceptionDrain) {
    await drainPendingPerceptionTasks();
  }

  const deferredEnqueueResult = await enqueueDeferredPerceptionOps(
    vfs,
    deferredEnqueueRequests,
  );

  diagnostics.deferredQueue.enqueuedCount +=
    deferredEnqueueResult.enqueuedCount;
  diagnostics.deferredQueue.dedupedCount += deferredEnqueueResult.dedupedCount;

  const acceptedChildOpIds = new Set(deferredEnqueueResult.acceptedChildOpIds);
  for (const pendingParent of deferredMailboxParentsPendingCommit) {
    if (acceptedChildOpIds.has(pendingParent.childOpId)) {
      recordOutcome(pendingParent.item, 'applied_deferred');
    } else {
      recordOutcome(pendingParent.item, 'failed_permanent');
    }
  }

  await recordDeferredParentResolutionOutcomes(vfs, deferredTerminalOutcomes);

  await consumeDeferredPerceptionQueueEntries(vfs, consumedDeferredEntryIds);

  diagnostics.deferredQueue.consumedCount = consumedDeferredEntryIds.length;

  return { processedCount, shutdownRequested, diagnostics, opOutcomes };
}

export async function processLocalConstructOp(
  construct: Construct,
  op: ConstructOp,
  logger?: Logger,
): Promise<ProcessMailboxMessagesResult> {
  const result = await processMailboxMessages(
    construct,
    [
      {
        kind: 'op',
        operation: op as MailboxOperation<unknown>,
        cursor: createLocalCursor(op.opId),
        ts: new Date().toISOString(),
      },
    ],
    logger,
  );

  if (result.shutdownRequested) {
    return result;
  }

  await replayDeferredLocalOpsUntilSettled(construct, 8, logger);
  return result;
}

function createDeferredChildOpId(parentOpId: string): string {
  return `nap-child:${parentOpId}`;
}

function createLocalCursor(opId: string): string {
  return `local:${opId}`;
}

function normalizeDeferredReplayOp(
  entry: DeferredPerceptionQueueEntry,
): ConstructOp {
  if (entry.op.sourceFactId) {
    return entry.op;
  }

  return {
    ...entry.op,
    sourceFactId: entry.parentOpId,
  };
}

function shouldDeferPerceptionLaneWork(construct: Construct): boolean {
  return construct.isHypnoActive?.() ?? false;
}

function isPerceptionLaneCommandAction(
  action: ConstructOpAction,
): action is PerceptionLaneCommandAction {
  return (
    action.type === 'command' &&
    (action.action === 'rate_response' || action.action === 'steer_directive')
  );
}

function normalizePerceptionLane(lane: unknown): string | null {
  if (typeof lane !== 'string') {
    return null;
  }

  const normalizedLane = lane.trim();
  return normalizedLane.length > 0 ? normalizedLane : null;
}

async function reflectMailboxParentSourceFact(
  construct: Construct,
  action: Extract<ConstructOpAction, { type: 'perception' | 'command' }>,
  lane?: string,
): Promise<boolean> {
  if (action.type === 'perception') {
    if (!construct.reflectPerceptionSourceFact) {
      return false;
    }
    await construct.reflectPerceptionSourceFact(action.perception);
    return true;
  }

  if (action.action === 'rate_response') {
    const rating = action.payload.rating;
    if (rating !== 'good' && rating !== 'bad') {
      return false;
    }

    if (!lane) {
      return false;
    }

    const rate = construct.rate;
    if (!rate) {
      throw new Error('Construct does not support rate');
    }

    await rate.call(construct, {
      rating,
      annotation:
        typeof action.payload.annotation === 'string'
          ? action.payload.annotation
          : undefined,
      source:
        typeof action.payload.source === 'string'
          ? action.payload.source
          : undefined,
      lane,
      id:
        typeof action.payload.op_id === 'string'
          ? action.payload.op_id
          : undefined,
      traceId:
        typeof action.payload.trace_id === 'string'
          ? action.payload.trace_id
          : undefined,
    });
    return true;
  }

  if (action.action !== 'steer_directive') {
    return false;
  }

  const directive = action.payload.directive;
  if (typeof directive !== 'string') {
    return false;
  }

  if (!construct.reflectSteeringDirective) {
    return false;
  }

  if (!lane) {
    return false;
  }

  await construct.reflectSteeringDirective({
    directive,
    source:
      typeof action.payload.source === 'string'
        ? action.payload.source
        : undefined,
    lane,
    id:
      typeof action.payload.op_id === 'string'
        ? action.payload.op_id
        : undefined,
    traceId:
      typeof action.payload.trace_id === 'string'
        ? action.payload.trace_id
        : undefined,
  });
  return true;
}

function markOpSourceFactReflected(op: ConstructOp): ConstructOp {
  if (op.sourceFactReflected) {
    return op;
  }

  return {
    ...op,
    sourceFactReflected: true,
  };
}

async function replayDeferredLocalOpsUntilSettled(
  construct: Construct,
  maxPasses = 8,
  logger?: Logger,
): Promise<void> {
  const vfs = construct.getVfs();

  for (let i = 0; i < maxPasses; i += 1) {
    const pending = await loadPendingDeferredPerceptionQueueEntries(vfs);
    if (pending.length === 0) {
      return;
    }

    const hypnoClosed = await waitForLocalHypnoToClose(construct);
    if (!hypnoClosed) {
      return;
    }

    const replay = await processMailboxMessages(construct, [], logger);

    if (
      replay.diagnostics.deferredQueue.loadedCount === 0 ||
      (replay.diagnostics.deferredQueue.consumedCount === 0 &&
        replay.processedCount === 0)
    ) {
      return;
    }
  }
}

async function waitForLocalHypnoToClose(
  construct: Construct,
  timeoutMs = 2_000,
): Promise<boolean> {
  if (!construct.isHypnoActive?.()) {
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!construct.isHypnoActive?.()) {
      return true;
    }
    await sleep(10);
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executePerceptionLaneCommand(
  construct: Construct,
  action: PerceptionLaneCommandAction,
  lane: string,
): Promise<boolean> {
  if (action.action === 'rate_response') {
    const rating = action.payload.rating;
    if (rating === 'good' || rating === 'bad' || rating === 'neutral') {
      const rate = construct.rate;
      if (!rate) {
        throw new Error('Construct does not support rate');
      }

      await rate.call(construct, {
        rating,
        annotation:
          typeof action.payload.annotation === 'string'
            ? action.payload.annotation
            : undefined,
        source:
          typeof action.payload.source === 'string'
            ? action.payload.source
            : undefined,
        lane,
        id:
          typeof action.payload.op_id === 'string'
            ? action.payload.op_id
            : undefined,
        traceId:
          typeof action.payload.trace_id === 'string'
            ? action.payload.trace_id
            : undefined,
        skipReflection: action.payload.source_fact_reflected === true,
      });
      return true;
    }
    return false;
  }

  const directive = action.payload.directive;
  if (typeof directive !== 'string' || directive.length === 0) {
    return false;
  }

  const steer = construct.steer;
  if (!steer) {
    throw new Error('Construct does not support steer');
  }

  await steer.call(construct, {
    directive,
    source:
      typeof action.payload.source === 'string'
        ? action.payload.source
        : undefined,
    lane,
    id:
      typeof action.payload.op_id === 'string'
        ? action.payload.op_id
        : undefined,
    traceId:
      typeof action.payload.trace_id === 'string'
        ? action.payload.trace_id
        : undefined,
    skipReflection: action.payload.source_fact_reflected === true,
  });
  return true;
}

async function executeExclusiveCommandAction(
  construct: Construct,
  action: CommandAction,
): Promise<boolean> {
  try {
    if (action.action === 'run_nap') {
      const nap = construct.nap;
      if (!nap) throw new Error('Construct does not support nap');
      await nap.call(construct);
      return true;
    }

    if (action.action === 'start_hypno') {
      const startHypno = construct.startHypno;
      if (!startHypno) throw new Error('Construct does not support startHypno');
      await startHypno.call(construct);
      return true;
    }

    if (action.action === 'chat_hypno_review') {
      const text = action.payload.text;
      if (typeof text === 'string' && text.length > 0) {
        const chatHypnoReview = construct.chatHypnoReview;
        if (!chatHypnoReview) {
          throw new Error('Construct does not support chatHypnoReview');
        }
        await chatHypnoReview.call(construct, text);
        return true;
      }
      return false;
    }

    if (action.action === 'accept_hypno') {
      const acceptHypno = construct.acceptHypno;
      if (!acceptHypno)
        throw new Error('Construct does not support acceptHypno');
      acceptHypno.call(construct);
      return true;
    }

    if (action.action === 'update_hypno') {
      const updateHypno = construct.updateHypno;
      if (!updateHypno)
        throw new Error('Construct does not support updateHypno');
      updateHypno.call(construct);
      return true;
    }

    if (action.action === 'cancel_hypno') {
      const cancelHypno = construct.cancelHypno;
      if (!cancelHypno)
        throw new Error('Construct does not support cancelHypno');
      cancelHypno.call(construct);
      return true;
    }
  } catch (error) {
    if (isRecoverableHypnoCommandError(action, error)) {
      return false;
    }
    throw error;
  }

  return false;
}

function isRecoverableHypnoCommandError(
  action: CommandAction,
  error: unknown,
): boolean {
  if (
    action.action !== 'chat_hypno_review' &&
    action.action !== 'accept_hypno' &&
    action.action !== 'update_hypno'
  ) {
    return false;
  }

  return (
    error instanceof Error &&
    error.message.trim().toLowerCase() === 'no hypno session active'
  );
}

export async function drainScheduledResponses(
  construct: Pick<Construct, 'getScheduler' | 'getRuntimeState'>,
  maxPolls: number,
): Promise<DrainScheduledResponsesResult> {
  for (let i = 0; i < maxPolls; i += 1) {
    const before = await construct.getRuntimeState();
    await construct.getScheduler().poll();
    const after = await construct.getRuntimeState();

    if (
      after.activeResponses === 0 &&
      after.schedulerBusy === false &&
      after.scheduledResponses === before.scheduledResponses
    ) {
      return {
        pollCount: i + 1,
        stopReason: 'stabilized',
      };
    }
  }

  return {
    pollCount: maxPolls,
    stopReason: 'max_polls_reached',
  };
}

export function isQuiescentState(state: {
  activeImpulses: number;
  scheduledResponses: number;
  activeResponses: number;
  schedulerBusy: boolean;
}): boolean {
  return (
    state.activeImpulses === 0 &&
    state.scheduledResponses === 0 &&
    state.activeResponses === 0 &&
    state.schedulerBusy === false
  );
}

function isConstructOp(value: unknown): value is ConstructOp {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.opId === 'string' &&
    typeof record.kind === 'string' &&
    typeof record.createdAt === 'string'
  );
}
