import type { Logger } from '@inkibra/logger';
import type { Construct } from '../construct/construct';
import type { SystemEventNameFromProfile } from '../impulse/keys';
import {
  createNoopConstructActivitySink,
  emitIdleActivity,
  emitMappedConstructActivity,
} from './activity';
import { createConstructResponseLifecycleTracker } from './response-lifecycle-tracker';
import { createConstructSourceFactTracker } from './source-fact-tracker';
import type {
  ConstructActivityConfig,
  ConstructResponseLifecycleConfig,
  ConstructRuntimeManager,
  ConstructRuntimeManagerConfig,
  ConstructSourceFactConfig,
} from './types';

export function createConstructRuntimeManager(
  logger: Logger,
  config: ConstructRuntimeManagerConfig,
  activityConfig?: ConstructActivityConfig,
  sourceFactConfig?: ConstructSourceFactConfig,
  responseLifecycleConfig?: ConstructResponseLifecycleConfig,
): ConstructRuntimeManager;
export function createConstructRuntimeManager<
  TImpulseProfileName extends string,
  TImpulsePoolName extends string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  logger: Logger,
  config: ConstructRuntimeManagerConfig<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName
  >,
  activityConfig?: ConstructActivityConfig,
  sourceFactConfig?: ConstructSourceFactConfig,
  responseLifecycleConfig?: ConstructResponseLifecycleConfig,
): ConstructRuntimeManager<
  TImpulseProfileName,
  TImpulsePoolName,
  TLaneName,
  TSystemEventName
>;
export function createConstructRuntimeManager<
  TImpulseProfileName extends string,
  TImpulsePoolName extends string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  logger: Logger,
  config: ConstructRuntimeManagerConfig<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName
  >,
  activityConfig?: ConstructActivityConfig,
  sourceFactConfig?: ConstructSourceFactConfig,
  responseLifecycleConfig?: ConstructResponseLifecycleConfig,
): ConstructRuntimeManager<
  TImpulseProfileName,
  TImpulsePoolName,
  TLaneName,
  TSystemEventName
> {
  const constructs = new Map<
    string,
    Construct<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >
  >();
  const sourceFactTrackers = new Map<
    string,
    ReturnType<typeof createConstructSourceFactTracker>
  >();
  const responseLifecycleTrackers = new Map<
    string,
    ReturnType<typeof createConstructResponseLifecycleTracker>
  >();
  const managerLogger = logger.child({
    component: 'construct-runtime-manager',
  });
  const activitySink =
    activityConfig?.sink ?? createNoopConstructActivitySink();

  // In-flight dedup map to prevent concurrent getOrCreate from creating duplicates
  const creating = new Map<
    string,
    Promise<
      Construct<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName,
        TSystemEventName
      >
    >
  >();

  // Cache for readonly instances so repeated calls return the same object
  const readonlyConstructs = new Map<
    string,
    Construct<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >
  >();

  return {
    async getOrCreate(
      constructId: string,
    ): Promise<
      Construct<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName,
        TSystemEventName
      >
    > {
      const getOrCreateStartMs = Date.now();
      const existing = constructs.get(constructId);
      if (existing) {
        console.warn(
          `[DIAG:manager] getOrCreate HIT id=${constructId} elapsed=${Date.now() - getOrCreateStartMs}ms`,
        );
        return existing;
      }

      // Dedup concurrent calls for the same constructId
      const inFlight = creating.get(constructId);
      if (inFlight) {
        return inFlight;
      }

      const createPromise = (async () => {
        const configStartMs = Date.now();
        const constructConfig = await config.createConfig(constructId);
        const configElapsed = Date.now() - configStartMs;

        const createStartMs = Date.now();
        const { createConstruct } = await import('../construct/construct');
        const construct = await createConstruct<
          TImpulseProfileName,
          TImpulsePoolName,
          TLaneName,
          TSystemEventName
        >(constructConfig);
        const createElapsed = Date.now() - createStartMs;

        const trackersStartMs = Date.now();
        const sourceFactTracker = createConstructSourceFactTracker({
          constructId,
          sink: sourceFactConfig?.sink,
          vfs: construct.getVfs(),
          getCommittedCursor: () => construct.getCommittedCursor(),
        });
        const responseLifecycleTracker =
          createConstructResponseLifecycleTracker({
            constructId,
            sink: responseLifecycleConfig?.sink,
            vfs: construct.getVfs(),
          });
        sourceFactTrackers.set(constructId, sourceFactTracker);
        responseLifecycleTrackers.set(constructId, responseLifecycleTracker);
        await sourceFactTracker.bootstrap();
        await responseLifecycleTracker.bootstrap();
        const trackersElapsed = Date.now() - trackersStartMs;

        construct.onEvent((event) => {
          void emitMappedConstructActivity({
            sink: activitySink,
            constructId,
            event,
          }).catch((error) => {
            managerLogger.warn('Failed to publish construct activity event', {
              constructId,
              error: error instanceof Error ? error.message : String(error),
            });
          });

          void sourceFactTracker.onConstructEvent(event).catch((error) => {
            managerLogger.warn(
              'Failed to persist construct source fact receipt',
              {
                constructId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          });

          void responseLifecycleTracker
            .onConstructEvent(event)
            .catch((error) => {
              managerLogger.warn(
                'Failed to persist construct response lifecycle receipt',
                {
                  constructId,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            });
        });

        // IMPORTANT: attach event publisher BEFORE starting scheduler.
        // If we start() first, the scheduler could pick up stale scheduled
        // responses from VFS and execute them before the publisher is listening,
        // causing SSE events to be lost.
        const publisherStartMs = Date.now();
        if (config.onConstructOpened) {
          await config.onConstructOpened(constructId, construct);
        }
        const publisherElapsed = Date.now() - publisherStartMs;

        construct.start();
        constructs.set(constructId, construct);
        // Invalidate readonly cache — live instance supersedes
        readonlyConstructs.delete(constructId);

        const totalElapsed = Date.now() - getOrCreateStartMs;
        console.warn(
          `[DIAG:manager] getOrCreate OPENED id=${constructId} total=${totalElapsed}ms (config=${configElapsed}ms create=${createElapsed}ms trackers=${trackersElapsed}ms publisher=${publisherElapsed}ms)`,
        );
        managerLogger.info('Construct runtime opened', { constructId });
        return construct;
      })();

      creating.set(constructId, createPromise);
      try {
        return await createPromise;
      } finally {
        creating.delete(constructId);
      }
    },

    async getOrCreateReadonly(
      constructId: string,
    ): Promise<
      Construct<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName,
        TSystemEventName
      >
    > {
      // If construct is already live (actor opened it), return it directly
      const existing = constructs.get(constructId);
      if (existing) {
        return existing;
      }

      // Return cached readonly instance if available
      const cachedReadonly = readonlyConstructs.get(constructId);
      if (cachedReadonly) {
        return cachedReadonly;
      }

      // Create a fresh construct for read-only VFS access.
      // Do NOT start scheduler, do NOT call onConstructOpened,
      // do NOT register in the live constructs map.
      const readonlyStartMs = Date.now();
      const constructConfig = await config.createConfig(constructId);
      const { createConstruct } = await import('../construct/construct');
      const construct = await createConstruct<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName,
        TSystemEventName
      >(constructConfig);
      readonlyConstructs.set(constructId, construct);
      console.warn(
        `[DIAG:manager] getOrCreateReadonly id=${constructId} created in ${Date.now() - readonlyStartMs}ms (not started, cached readonly)`,
      );
      return construct;
    },

    getOpen(
      constructId: string,
    ):
      | Construct<
          TImpulseProfileName,
          TImpulsePoolName,
          TLaneName,
          TSystemEventName
        >
      | undefined {
      return constructs.get(constructId);
    },

    async waitForSettled(constructId: string): Promise<void> {
      await sourceFactTrackers.get(constructId)?.drain();
      await responseLifecycleTrackers.get(constructId)?.drain();
    },

    async flushAndRelease(constructId: string): Promise<void> {
      const existing = constructs.get(constructId);
      if (!existing) {
        return;
      }

      if (config.onConstructClosed) {
        await config.onConstructClosed(constructId, existing);
      }
      await sourceFactTrackers.get(constructId)?.drain();
      await responseLifecycleTrackers.get(constructId)?.drain();
      await existing.flush();
      existing.stop();
      constructs.delete(constructId);
      sourceFactTrackers.delete(constructId);
      responseLifecycleTrackers.delete(constructId);
      await emitIdleActivity(activitySink, constructId);
      managerLogger.info('Construct runtime released', { constructId });
    },
  };
}
