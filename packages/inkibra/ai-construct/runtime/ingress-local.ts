import type { SystemEventNameFromProfile } from '../impulse/keys';
import type { ConstructOp } from './ops';
import { processLocalConstructOp } from './processor';
import { publishQueuedSourceFact } from './source-fact-tracker';
import type {
  ConstructIngress,
  ConstructRuntimeManager,
  ConstructSourceFactSink,
} from './types';

export function createLocalConstructIngress(
  runtimeManager: ConstructRuntimeManager,
  sourceFactSink?: ConstructSourceFactSink,
): ConstructIngress;
export function createLocalConstructIngress<
  TImpulseProfileName extends string,
  TImpulsePoolName extends string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  runtimeManager: ConstructRuntimeManager<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >,
  sourceFactSink?: ConstructSourceFactSink,
): ConstructIngress<TImpulseProfileName, TImpulsePoolName, TSystemEventName>;
export function createLocalConstructIngress<
  TImpulseProfileName extends string,
  TImpulsePoolName extends string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  runtimeManager: ConstructRuntimeManager<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >,
  sourceFactSink?: ConstructSourceFactSink,
): ConstructIngress<TImpulseProfileName, TImpulsePoolName, TSystemEventName> {
  const queueByConstruct = new Map<string, Promise<void>>();

  async function serializeForConstruct<T>(
    constructId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = queueByConstruct.get(constructId) ?? Promise.resolve();
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const currentChain = previous.catch(() => {}).then(() => current);
    queueByConstruct.set(constructId, currentChain);

    await previous.catch(() => {});
    try {
      return await work();
    } finally {
      releaseCurrent?.();
      const queued = queueByConstruct.get(constructId);
      if (queued === currentChain) {
        queueByConstruct.delete(constructId);
      }
    }
  }

  async function waitForSettled(constructId: string): Promise<void> {
    while (true) {
      const queued = queueByConstruct.get(constructId);
      if (!queued) {
        return;
      }

      await queued.catch(() => {});

      if (queueByConstruct.get(constructId) === queued) {
        return;
      }
    }
  }

  async function submit(
    constructId: string,
    op: ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
  ) {
    return serializeForConstruct(constructId, async () => {
      const construct = await runtimeManager.getOrCreate(constructId);
      await publishQueuedSourceFact({
        sink: sourceFactSink,
        constructId,
        op,
        vfs: construct.getVfs(),
      });

      const processed = await processLocalConstructOp(construct, op);
      if (processed.shutdownRequested) {
        await runtimeManager.flushAndRelease(constructId);
      }

      return { accepted: true } as const;
    });
  }

  return {
    submit,
    waitForSettled,
    loadConstruct(constructId, options) {
      return submit(constructId, {
        opId: `load:${constructId}:${crypto.randomUUID()}`,
        kind: 'drain_only',
        payload: {},
        createdAt: new Date().toISOString(),
        traceId: options?.traceId,
      });
    },
    queueNextNapPin(constructId, input) {
      return submit(constructId, {
        opId:
          input.opId ?? `next-nap-pin:${constructId}:${crypto.randomUUID()}`,
        kind: 'next_nap_pin',
        payload: { path: input.path },
        createdAt: new Date().toISOString(),
        traceId: input.traceId,
      });
    },
    queueNextNapImprint(constructId, input) {
      return submit(constructId, {
        opId:
          input.opId ??
          `next-nap-imprint:${constructId}:${crypto.randomUUID()}`,
        kind: 'next_nap_imprint',
        payload: { text: input.text },
        createdAt: new Date().toISOString(),
        traceId: input.traceId,
      });
    },
  };
}
