import type { SystemEventNameFromProfile } from '../impulse/keys';
import { createNoopConstructActivitySink } from './activity';
import { createLocalConstructIngress } from './ingress-local';
import { createConstructRuntimeManager } from './manager';
import type {
  LocalConstructRuntime,
  LocalConstructRuntimeOptions,
} from './types';

/**
 * Create a local construct runtime.
 *
 * For durable (actor-backed) mode, use createActorRuntime() directly.
 */
export function createConstructRuntime<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  options:
    | Omit<
        LocalConstructRuntimeOptions<
          TImpulseProfileName,
          TImpulsePoolName,
          TLaneName
        >,
        'mode'
      >
    | LocalConstructRuntimeOptions<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName
      >,
): LocalConstructRuntime<
  TImpulseProfileName,
  TImpulsePoolName,
  TLaneName,
  TSystemEventName
> {
  return createLocalConstructRuntime<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >(options);
}

export function createLocalConstructRuntime<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  options:
    | Omit<
        LocalConstructRuntimeOptions<
          TImpulseProfileName,
          TImpulsePoolName,
          TLaneName
        >,
        'mode'
      >
    | LocalConstructRuntimeOptions<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName
      >,
): LocalConstructRuntime<
  TImpulseProfileName,
  TImpulsePoolName,
  TLaneName,
  TSystemEventName
> {
  const normalized: LocalConstructRuntimeOptions<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName
  > = {
    ...options,
    mode: 'local',
  };

  const runtimeManager = createConstructRuntimeManager<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >(
    normalized.logger,
    {
      createConfig: normalized.createConfig,
      onConstructOpened: async (constructId, construct) => {
        if (normalized.onConstructOpened) {
          await normalized.onConstructOpened(constructId, construct);
        }
      },
      onConstructClosed: async (constructId, construct) => {
        if (normalized.onConstructClosed) {
          await normalized.onConstructClosed(constructId, construct);
        }
      },
    },
    {
      sink: normalized.activity?.sink ?? createNoopConstructActivitySink(),
      level: normalized.activity?.level ?? 'coarse',
    },
    normalized.sourceFacts,
    normalized.responses,
  );
  const ingress = createLocalConstructIngress<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >(runtimeManager, normalized.sourceFacts?.sink);

  return {
    mode: 'local',
    runtimeManager,
    submit: ingress.submit,
    waitForSettled: async (constructId: string) => {
      await ingress.waitForSettled?.(constructId);
      await runtimeManager.waitForSettled?.(constructId);
    },
    requestShutdown: async (constructId: string) => {
      await ingress.waitForSettled?.(constructId);
      await runtimeManager.waitForSettled?.(constructId);
      await runtimeManager.flushAndRelease(constructId);
    },
  };
}
