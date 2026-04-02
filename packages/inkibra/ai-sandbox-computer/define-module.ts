/**
 * defineAiComputerModule — Groups related code bindings, typed deps, and
 * command adapters into a cohesive unit.
 *
 * Modules expose static CodeFunction bindings (typically authored in `.tool.ts`
 * files via `defineCodeBinding`), a typed deps factory for per-invocation
 * runtime wiring, and optional commands that delegate to the same bindings the
 * AI imports.
 */

import type { CodeFunction } from '@inkibra/ai-flow/codemode/types';
import type {
  AiModuleBindings,
  AiModuleDependencyMap,
  AiModuleDepsFactory,
  ModuleBindingsRecord,
} from './module-deps';
import type { Command } from './types';

export type AiComputerModuleCommandFactory<
  TBindings extends ModuleBindingsRecord,
  TDepends extends AiModuleDependencyMap,
> = (args: {
  self: AiModuleBindings<{ bindings: TBindings }>;
  modules: {
    [K in keyof TDepends]: AiModuleBindings<TDepends[K]>;
  };
}) => Command<any>[];

export type AiComputerModuleConfig<
  TName extends string = string,
  TBindings extends ModuleBindingsRecord = Record<
    string,
    CodeFunction<any, any, any>
  >,
  TDepends extends AiModuleDependencyMap = Record<string, never>,
  TDeps = unknown,
> = {
  /** Module name — used as the import specifier in preview code. */
  name: TName;
  /** Authored semantic guidance for the public package surface. */
  readme?: string;
  /** Static CodeFunction bindings exposed to AI imports. */
  bindings?: TBindings;
  /** Explicit module dependencies for readability at the module definition site. */
  depends?: TDepends;
  /** Typed per-invocation deps factory and dependency declaration. */
  deps?: AiModuleDepsFactory<TDeps, TDepends>;
  /** Optional command adapters that delegate to `self` / dependent modules. */
  commands?:
    | Command<any>[]
    | AiComputerModuleCommandFactory<TBindings, TDepends>;
};

export type AiComputerModule<
  TName extends string = string,
  TBindings extends ModuleBindingsRecord = Record<
    string,
    CodeFunction<any, any, any>
  >,
  TDepends extends AiModuleDependencyMap = Record<string, never>,
  TDeps = unknown,
> = {
  readonly name: TName;
  readonly readme?: string;
  readonly bindings: TBindings;
  readonly deps?: AiModuleDepsFactory<TDeps, TDepends>;
  readonly depends: TDepends;
  readonly commands?:
    | Command<any>[]
    | AiComputerModuleCommandFactory<TBindings, TDepends>;
};

/**
 * Define an AI computer module that groups related bindings and commands.
 */
export function defineAiComputerModule<
  TName extends string,
  TBindings extends ModuleBindingsRecord,
  TDepends extends AiModuleDependencyMap,
  TDeps,
>(
  config: AiComputerModuleConfig<TName, TBindings, TDepends, TDeps>,
): AiComputerModule<TName, TBindings, TDepends, TDeps> {
  return {
    name: config.name,
    readme: config.readme,
    bindings: (config.bindings ?? {}) as TBindings,
    deps: config.deps,
    depends: (config.depends ??
      config.deps?.depends ??
      ({} as TDepends)) as TDepends,
    commands: config.commands,
  };
}
