import type { OverlayFs } from '@inkibra/ai-flow';
import type { ConstructEvent } from '../construct/types';
import {
  classifyConstructOpAsSourceFact,
  classifyConstructOpKindAsSourceFact,
  getSourceFactMetadataFromPerception,
  getSourceFactPhaseRank,
  type SourceFactLifecycleReceipt,
  type SourceFactMetadata,
} from '../source-facts';
import {
  loadSourceFactState,
  recordSourceFactReceipt,
  type SourceFactRecord,
} from '../vfs/source-fact-state';
import type { ConstructOp } from './ops';
import type { ConstructSourceFactSink } from './types';

type TrackerDeps = {
  constructId: string;
  sink?: ConstructSourceFactSink;
  vfs: OverlayFs;
  getCommittedCursor?: () => string | undefined;
};

export function createNoopConstructSourceFactSink(): ConstructSourceFactSink {
  return {
    publish: async () => {},
  };
}

export async function publishQueuedSourceFact(args: {
  sink?: ConstructSourceFactSink;
  constructId: string;
  op: ConstructOp;
  queueRef?: string;
  vfs?: OverlayFs;
}): Promise<void> {
  const sourceFact = classifyConstructOpAsSourceFact(args.op);
  if (!sourceFact) {
    return;
  }

  const receipt: SourceFactLifecycleReceipt = {
    constructId: args.constructId,
    factId: sourceFact.factId,
    factType: sourceFact.factType,
    phase: 'queued',
    timestamp: new Date().toISOString(),
    traceId: sourceFact.traceId,
    previewText: getQueuedPreviewText(args.op),
    queueRef: args.queueRef,
  };

  if (args.vfs) {
    await recordSourceFactReceipt(args.vfs, receipt);
  }

  if (args.sink) {
    await args.sink.publish(receipt);
  }
}

function getQueuedPreviewText(op: ConstructOp): string | undefined {
  switch (op.kind) {
    case 'user_message':
      return typeof op.payload.content === 'string'
        ? op.payload.content
        : undefined;
    case 'self_reminder':
      return typeof op.payload.memo === 'string' ? op.payload.memo : undefined;
    case 'steer_directive':
      return typeof op.payload.directive === 'string'
        ? op.payload.directive
        : undefined;
    default:
      return undefined;
  }
}

export function createConstructSourceFactTracker(deps: TrackerDeps) {
  const factPhaseById = new Map<string, SourceFactLifecycleReceipt['phase']>();
  const factQueueRefById = new Map<string, string>();
  const factMetadataById = new Map<string, SourceFactMetadata>();
  const factByImpulseId = new Map<string, SourceFactMetadata>();
  const factByResponseId = new Map<string, SourceFactMetadata>();
  const scheduledImpulseIds = new Set<string>();
  let eventQueue = Promise.resolve();
  let bootstrapPromise: Promise<void> | undefined;

  function bootstrapFromRecords(
    records: Record<string, SourceFactRecord>,
  ): void {
    for (const [factId, record] of Object.entries(records)) {
      factPhaseById.set(factId, record.lastPhase);
      if (record.queueRef) {
        factQueueRefById.set(factId, record.queueRef);
      }

      const classification = classifyConstructOpKindAsSourceFact(
        record.factType,
      );
      factMetadataById.set(factId, {
        factId,
        factType: record.factType,
        traceId: record.traceId,
        processingStrategy: classification?.processingStrategy ?? 'impulse',
      });

      for (const impulseId of record.impulseIds ?? []) {
        factByImpulseId.set(impulseId, {
          factId,
          factType: record.factType,
          traceId: record.traceId,
          processingStrategy: classification?.processingStrategy ?? 'impulse',
        });
      }

      for (const responseId of record.responseIds ?? []) {
        factByResponseId.set(responseId, {
          factId,
          factType: record.factType,
          traceId: record.traceId,
          processingStrategy: classification?.processingStrategy ?? 'impulse',
        });
      }
    }
  }

  async function ensureBootstrapped(): Promise<void> {
    if (!bootstrapPromise) {
      bootstrapPromise = (async () => {
        bootstrapFromRecords(await loadSourceFactState(deps.vfs));
      })();
    }

    await bootstrapPromise;
  }

  async function loadKnownQueueRef(
    factId: string,
  ): Promise<string | undefined> {
    const existing = factQueueRefById.get(factId);
    if (existing) {
      return existing;
    }

    const records = await loadSourceFactState(deps.vfs);
    const queueRef = records[factId]?.queueRef;
    if (queueRef) {
      factQueueRefById.set(factId, queueRef);
    }
    return queueRef;
  }

  async function publish(receipt: SourceFactLifecycleReceipt): Promise<void> {
    await ensureBootstrapped();
    const queueRef =
      receipt.queueRef ?? (await loadKnownQueueRef(receipt.factId));
    const normalizedReceipt =
      queueRef && queueRef !== receipt.queueRef
        ? {
            ...receipt,
            queueRef,
          }
        : receipt;
    const current = factPhaseById.get(receipt.factId);
    if (current) {
      const currentRank = getSourceFactPhaseRank(current);
      const nextRank = getSourceFactPhaseRank(normalizedReceipt.phase);
      if (currentRank > nextRank) {
        return;
      }
      if (currentRank === nextRank) {
        await recordSourceFactReceipt(
          deps.vfs,
          normalizedReceipt,
          deps.getCommittedCursor?.(),
        );
        return;
      }
    }

    factPhaseById.set(normalizedReceipt.factId, normalizedReceipt.phase);
    if (normalizedReceipt.queueRef) {
      factQueueRefById.set(
        normalizedReceipt.factId,
        normalizedReceipt.queueRef,
      );
    }
    await recordSourceFactReceipt(
      deps.vfs,
      normalizedReceipt,
      deps.getCommittedCursor?.(),
    );
    if (deps.sink) {
      await deps.sink.publish(normalizedReceipt);
    }
  }

  async function handleConstructEvent(event: ConstructEvent): Promise<void> {
    await ensureBootstrapped();
    if (event.type === 'source-fact:reflected') {
      factMetadataById.set(event.factId, {
        factId: event.factId,
        factType: event.factType,
        traceId: event.traceId,
        processingStrategy: event.processingStrategy,
      });
      const reflectedReceipt: SourceFactLifecycleReceipt = {
        constructId: deps.constructId,
        factId: event.factId,
        factType: event.factType,
        phase: 'reflected',
        timestamp: event.reflectedAt,
        traceId: event.traceId,
        journal: event.journal,
      };
      await publish(reflectedReceipt);
      if (event.processingStrategy === 'none') {
        await publish({
          constructId: deps.constructId,
          factId: event.factId,
          factType: event.factType,
          phase: 'cleared',
          timestamp: event.reflectedAt,
          traceId: event.traceId,
          journal: event.journal,
          clearReason: 'no_processing_required',
        });
      }
      return;
    }

    if (event.type === 'impulse:started') {
      const derived = getSourceFactMetadataFromPerception(event.perception);
      const sourceFact =
        (derived?.factId ? factMetadataById.get(derived.factId) : undefined) ??
        derived;
      if (!sourceFact || !sourceFact.factId) {
        return;
      }

      factByImpulseId.set(event.impulseId, sourceFact);
      await publish({
        constructId: deps.constructId,
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        phase: 'spawned',
        timestamp: new Date().toISOString(),
        traceId: sourceFact.traceId,
        impulseId: event.impulseId,
      });
      return;
    }

    if (event.type === 'response:schedule_requested') {
      const sourceFact = factByImpulseId.get(event.scheduledBy);
      if (!sourceFact) {
        return;
      }

      scheduledImpulseIds.add(event.scheduledBy);

      await publish({
        constructId: deps.constructId,
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        phase: 'cleared',
        timestamp: new Date().toISOString(),
        traceId: sourceFact.traceId,
        impulseId: event.scheduledBy,
        clearReason: 'response_scheduled',
      });
      return;
    }

    if (event.type === 'response:scheduled') {
      const sourceFact = factByImpulseId.get(event.scheduledBy);
      if (!sourceFact) {
        return;
      }

      scheduledImpulseIds.add(event.scheduledBy);
      factByResponseId.set(event.responseId, sourceFact);
      await publish({
        constructId: deps.constructId,
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        phase: 'cleared',
        timestamp: new Date().toISOString(),
        traceId: sourceFact.traceId,
        impulseId: event.scheduledBy,
        responseId: event.responseId,
        clearReason: 'response_scheduled',
      });
      return;
    }

    if (event.type === 'impulse:completed') {
      const sourceFact = factByImpulseId.get(event.impulseId);
      if (!sourceFact) {
        return;
      }

      if (scheduledImpulseIds.has(event.impulseId)) {
        return;
      }

      await publish({
        constructId: deps.constructId,
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        phase: 'cleared',
        timestamp: new Date().toISOString(),
        traceId: sourceFact.traceId,
        impulseId: event.impulseId,
        clearReason: 'no_response_planned',
      });
      return;
    }

    if (event.type === 'impulse:error') {
      const sourceFact = factByImpulseId.get(event.impulseId);
      if (!sourceFact) {
        return;
      }

      await publish({
        constructId: deps.constructId,
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        phase: 'cleared',
        timestamp: new Date().toISOString(),
        traceId: sourceFact.traceId,
        impulseId: event.impulseId,
        clearReason: 'failed_permanent',
      });
      return;
    }

    if (event.type === 'response:delivered') {
      const sourceFact = factByResponseId.get(event.responseId);
      if (!sourceFact) {
        return;
      }

      await publish({
        constructId: deps.constructId,
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        phase: 'delivered',
        timestamp: new Date().toISOString(),
        traceId: sourceFact.traceId,
        responseId: event.responseId,
      });
    }
  }

  return {
    async bootstrap(): Promise<void> {
      await ensureBootstrapped();
    },
    async onConstructEvent(event: ConstructEvent): Promise<void> {
      const next = eventQueue
        .catch(() => {})
        .then(() => handleConstructEvent(event));
      eventQueue = next.catch(() => {});
      await next;
    },
    async drain(): Promise<void> {
      await eventQueue.catch(() => {});
    },
  };
}
