/**
 * Effect module helpers — typed effect intents with preview text and
 * host-side handler registration.
 */

import type { EffectContext, EffectIntent } from '@inkibra/router';

export type EffectDefinition<TPayload> = {
  preview?: (payload: TPayload) => string;
};

export function effect<TPayload>(definition: EffectDefinition<TPayload>) {
  return definition;
}

type EffectDefinitions = Record<string, EffectDefinition<any>>;

type EffectPayload<TDefinition> = TDefinition extends EffectDefinition<
  infer TPayload
>
  ? TPayload
  : never;

export type EffectModuleApi<TModule> = TModule extends EffectModule<
  any,
  infer TEffects
>
  ? {
      [K in keyof TEffects]-?: (
        payload: EffectPayload<TEffects[K]>,
      ) => Promise<void>;
    }
  : never;

export type EffectModuleHandlers<TModule> = TModule extends EffectModule<
  any,
  infer TEffects
>
  ? {
      [K in keyof TEffects]-?: (
        payload: EffectPayload<TEffects[K]>,
      ) => Promise<void> | void;
    }
  : never;

export type EffectModule<
  TNamespace extends string,
  TEffects extends EffectDefinitions,
> = {
  readonly namespace: TNamespace;
  readonly effects: TEffects;
  bind: (effects: EffectContext) => {
    [K in keyof TEffects]: (
      payload: EffectPayload<TEffects[K]>,
    ) => Promise<void>;
  };
  implement: (
    handlers: EffectModuleHandlers<EffectModule<TNamespace, TEffects>>,
  ) => Record<string, (intent: EffectIntent) => Promise<void>>;
};

export function createEffectModule<
  TNamespace extends string,
  TEffects extends EffectDefinitions,
>(config: {
  namespace: TNamespace;
  effects: TEffects;
}): EffectModule<TNamespace, TEffects> {
  return {
    namespace: config.namespace,
    effects: config.effects,

    bind(effects) {
      const api: Record<string, (payload: unknown) => Promise<void>> = {};
      for (const [name, definition] of Object.entries(config.effects)) {
        api[name] = async (payload: unknown) => {
          await effects.call({
            kind: `${config.namespace}.${name}`,
            payload,
            preview: definition.preview?.(payload),
          });
        };
      }
      return api as EffectModuleApi<EffectModule<TNamespace, TEffects>>;
    },

    implement(handlers) {
      const registered: Record<
        string,
        (intent: EffectIntent) => Promise<void>
      > = {};
      for (const [name, handler] of Object.entries(handlers)) {
        registered[`${config.namespace}.${name}`] = async (
          intent: EffectIntent,
        ) => {
          await handler(intent.payload as never);
        };
      }
      return registered;
    },
  };
}
