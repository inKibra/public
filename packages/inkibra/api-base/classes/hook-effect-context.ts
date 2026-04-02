import type {
  CacheableObject,
  ObjectCache,
  ObservableCache,
} from '@inkibra/observable-cache';
import { useEffect, useState } from 'react';

/**
 * Represents a function that will be called when the hook is run.
 */
export type HookRunner = (data: ObjectCache<CacheableObject>) => void;
export type HookSetupFunction = (
  cache: ObservableCache,
) => Promise<void> | void;

/**
 * Represents the return type of a hook function.
 * @template TData - The type of the data returned by the hook function.
 */
export type HookFunctionReturnType<TData> = {
  /**
   * The data returned by the hook function used to set state;
   */
  data: TData;
  /**
   * The function that will be called when the hook is run.
   */
  hookRunner: HookRunner;
  /**
   * An optional constraint passed to the useEffect hook.
   */
  constraint?: unknown;
  /**
   * An optional setup function that can be used to fetch the initial data for the hook.
   */
  setup?: HookSetupFunction;
};

/**
 * Represents the context for running hooks. It provides a way to add effects to the context and then run them.
 */
export class HookEffectContext {
  private hookRunners: HookRunner[] = [];
  private hookSetupFunctions: HookSetupFunction[] = [];
  private constraints: unknown[] = [];
  private ran = false;

  /**
   * Adds an effect to the hook context.
   * @param hookFunctionReturnData - The return data from the hook function.
   * @returns The data from the hook function.
   * @throws Error if effects are added after calling `runEffects()`.
   * // TODO: migrate to match the signature of addEffectWithSetup
   */
  public addEffect<TData>(
    hookFunctionReturnData: HookFunctionReturnType<TData>,
  ) {
    const [data] = this.addEffectWithSetup(hookFunctionReturnData);
    return data;
  }

  public addEffectWithSetup<TData>(
    hookFunctionReturnData: HookFunctionReturnType<TData>,
  ) {
    if (this.ran === true) {
      throw new Error('Cannot add effects after calling this.runEffects().');
    }
    this.hookRunners.push(hookFunctionReturnData.hookRunner);
    if (hookFunctionReturnData.setup !== undefined) {
      this.hookSetupFunctions.push(hookFunctionReturnData.setup);
    }
    if (hookFunctionReturnData.constraint !== undefined) {
      if (!this.constraints.includes(hookFunctionReturnData.constraint)) {
        this.constraints.push(hookFunctionReturnData.constraint);
      }
    }
    return [hookFunctionReturnData.data, hookFunctionReturnData.setup] as const;
  }

  /**
   * Runs the effects in the hook context.
   * @param cache - The observable cache.
   * @throws Error if `runEffects()` is called more than once.
   */
  public runEffects(
    cache: ObservableCache,
    additionalConstraints: unknown[] = [],
  ) {
    if (this.ran === true) {
      throw new Error('Cannot run this.runEffects() more than once.');
    }
    this.ran = true;
    const [isFirstRender, setIsFirstRender] = useState(true);
    if (isFirstRender) {
      this.hookRunners.forEach((hookRunner) => {
        hookRunner(cache.latest);
      });
      setIsFirstRender(false);
    }
    useEffect(() => {
      this.hookSetupFunctions.forEach((setupFunction) => {
        void setupFunction(cache);
      });
      // TODO: should we label this with useDebugValue
      // TODO: does this need to be subscribed to within a useExternalStore
      const subscription = cache.objectObservable.subscribe((data) => {
        this.hookRunners.forEach((hookRunner) => {
          hookRunner(data);
        });
      });

      return () => subscription.unsubscribe();
    }, this.constraints.concat(additionalConstraints));
  }
}
