import type { OverlayFs } from '@inkibra/ai-flow';
import type { ConstructEvent } from '../construct/types';
import {
  getResponseLifecyclePhaseRank,
  type ResponseLifecycleReceipt,
} from '../response-lifecycle';
import {
  getSourceFactMetadataFromPerception,
  type SourceFactMetadata,
} from '../source-facts';
import {
  loadResponseLifecycleState,
  type ResponseLifecycleRecord,
  recordResponseLifecycleReceipt,
} from '../vfs/response-lifecycle-state';
import type { ConstructResponseLifecycleSink } from './types';

type TrackerDeps = {
  constructId: string;
  sink?: ConstructResponseLifecycleSink;
  vfs: OverlayFs;
};

type ResponseMetadata = {
  responseId: string;
  scheduledBy?: string;
  sourceFactId?: string;
  sourceFactType?: SourceFactMetadata['factType'];
  traceId?: string;
};

export function createNoopConstructResponseLifecycleSink(): ConstructResponseLifecycleSink {
  return {
    publish: async () => {},
  };
}

export function createConstructResponseLifecycleTracker(deps: TrackerDeps) {
  const responsePhaseById = new Map<
    string,
    ResponseLifecycleReceipt['phase']
  >();
  const factMetadataById = new Map<string, SourceFactMetadata>();
  const factByImpulseId = new Map<string, SourceFactMetadata>();
  const responseMetadataById = new Map<string, ResponseMetadata>();
  let eventQueue = Promise.resolve();
  let bootstrapPromise: Promise<void> | undefined;

  function bootstrapFromRecords(
    records: Record<string, ResponseLifecycleRecord>,
  ): void {
    for (const [responseId, record] of Object.entries(records)) {
      responsePhaseById.set(responseId, record.lastPhase);
      responseMetadataById.set(responseId, {
        responseId,
        scheduledBy: record.scheduledBy,
        sourceFactId: record.sourceFactId,
        sourceFactType: record.sourceFactType,
        traceId: record.traceId,
      });
    }
  }

  async function ensureBootstrapped(): Promise<void> {
    if (!bootstrapPromise) {
      bootstrapPromise = (async () => {
        bootstrapFromRecords(await loadResponseLifecycleState(deps.vfs));
      })();
    }

    await bootstrapPromise;
  }

  async function publish(receipt: ResponseLifecycleReceipt): Promise<void> {
    await ensureBootstrapped();
    const current = responsePhaseById.get(receipt.responseId);
    if (
      current &&
      getResponseLifecyclePhaseRank(current) >=
        getResponseLifecyclePhaseRank(receipt.phase)
    ) {
      return;
    }

    responsePhaseById.set(receipt.responseId, receipt.phase);
    await recordResponseLifecycleReceipt(deps.vfs, receipt);
    if (deps.sink) {
      await deps.sink.publish(receipt);
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
      return;
    }

    if (event.type === 'response:scheduled') {
      const sourceFact = factByImpulseId.get(event.scheduledBy);
      const metadata: ResponseMetadata = {
        responseId: event.responseId,
        scheduledBy: event.scheduledBy,
        sourceFactId: sourceFact?.factId,
        sourceFactType: sourceFact?.factType,
        traceId: sourceFact?.traceId,
      };
      responseMetadataById.set(event.responseId, metadata);
      await publish({
        constructId: deps.constructId,
        responseId: event.responseId,
        phase: 'scheduled',
        timestamp: new Date().toISOString(),
        scheduledBy: event.scheduledBy,
        sourceFactId: sourceFact?.factId,
        sourceFactType: sourceFact?.factType,
        traceId: sourceFact?.traceId,
        intent: event.intent,
        urgency: event.urgency,
        waitForIdleTargets: event.waitForIdleTargets,
      });
      return;
    }

    if (event.type === 'response:selected') {
      const response = responseMetadataById.get(event.responseId);
      await publish({
        constructId: deps.constructId,
        responseId: event.responseId,
        phase: 'selected',
        timestamp: new Date().toISOString(),
        scheduledBy: response?.scheduledBy,
        sourceFactId: response?.sourceFactId,
        sourceFactType: response?.sourceFactType,
        traceId: response?.traceId,
      });
      return;
    }

    if (event.type === 'response:executing') {
      const response = responseMetadataById.get(event.responseId);
      await publish({
        constructId: deps.constructId,
        responseId: event.responseId,
        phase: 'executing',
        timestamp: new Date().toISOString(),
        scheduledBy: response?.scheduledBy,
        sourceFactId: response?.sourceFactId,
        sourceFactType: response?.sourceFactType,
        traceId: response?.traceId,
      });
      return;
    }

    if (event.type === 'response:delivered') {
      const response = responseMetadataById.get(event.responseId);
      await publish({
        constructId: deps.constructId,
        responseId: event.responseId,
        phase: 'delivered',
        timestamp: new Date().toISOString(),
        scheduledBy: response?.scheduledBy,
        sourceFactId: response?.sourceFactId,
        sourceFactType: response?.sourceFactType,
        traceId: response?.traceId,
        draftText: event.draftText,
      });
      return;
    }

    if (event.type === 'response:dropped') {
      const response = responseMetadataById.get(event.responseId);
      await publish({
        constructId: deps.constructId,
        responseId: event.responseId,
        phase: 'dropped',
        timestamp: new Date().toISOString(),
        scheduledBy: response?.scheduledBy,
        sourceFactId: response?.sourceFactId,
        sourceFactType: response?.sourceFactType,
        traceId: response?.traceId,
        dropReason: event.reason,
      });
      return;
    }

    if (event.type === 'response:cleared') {
      const response = responseMetadataById.get(event.responseId);
      await publish({
        constructId: deps.constructId,
        responseId: event.responseId,
        phase: 'cleared',
        timestamp: new Date().toISOString(),
        scheduledBy: response?.scheduledBy,
        sourceFactId: response?.sourceFactId,
        sourceFactType: response?.sourceFactType,
        traceId: response?.traceId,
        clearedByResponseId: event.clearedByResponseId,
      });
      return;
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
