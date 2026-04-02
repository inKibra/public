/**
 * Module deps helpers — typed dependency graph and binding extraction.
 *
 * These types let AI computer modules depend on other modules with a typed
 * callable view of their bindings, while keeping binding authoring static via
 * defineCodeBinding / .tool.ts.
 */

import type { CodeFunction, FsApi } from '@inkibra/ai-flow/codemode/types';
import type { EffectContext } from '@inkibra/router';

export type ModuleBindingsRecord = Record<string, CodeFunction<any, any, any>>;

export type AnyAiComputerModule = {
  readonly name: string;
  readonly bindings?: ModuleBindingsRecord;
};

export type UnwrapCodeFunction<TBinding> = TBinding extends CodeFunction<
  infer TParams,
  infer TResult,
  any
>
  ? (params: TParams) => Promise<TResult>
  : never;

export type UnwrapBindingRecord<TBindings extends ModuleBindingsRecord> = {
  [K in keyof TBindings]: UnwrapCodeFunction<TBindings[K]>;
};

export type AiModuleBindings<TModule> = TModule extends {
  readonly bindings?: infer TBindings;
}
  ? TBindings extends ModuleBindingsRecord
    ? UnwrapBindingRecord<TBindings>
    : {}
  : {};

export type AiModuleDependencyMap = Record<string, AnyAiComputerModule>;

export type AiResolvedModules<TDepends extends AiModuleDependencyMap> = {
  [K in keyof TDepends]: AiModuleBindings<TDepends[K]>;
};

export type AiModuleDepsFactoryArgs<TDepends extends AiModuleDependencyMap> = {
  driver: unknown;
  effects: EffectContext;
  fs: FsApi;
  modules: AiResolvedModules<TDepends>;
  ctx: Record<string, unknown>;
  input: unknown;
  logger: unknown;
};

export type AiModuleDepsFactory<
  TDeps,
  TDepends extends AiModuleDependencyMap = {},
> = {
  readonly depends: TDepends;
  create: (args: AiModuleDepsFactoryArgs<TDepends>) => Promise<TDeps> | TDeps;
};

export function createAiModuleDeps<TDeps>() {
  return {
    factory(
      create: (args: AiModuleDepsFactoryArgs<{}>) => Promise<TDeps> | TDeps,
    ): AiModuleDepsFactory<TDeps, {}> {
      return {
        depends: {},
        create,
      };
    },

    depends<TDepends extends AiModuleDependencyMap>(depends: TDepends) {
      return {
        factory(
          create: (
            args: AiModuleDepsFactoryArgs<TDepends>,
          ) => Promise<TDeps> | TDeps,
        ): AiModuleDepsFactory<TDeps, TDepends> {
          return {
            depends,
            create,
          };
        },
      };
    },
  };
}
