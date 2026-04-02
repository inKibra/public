/**
 * Module runtime helpers — resolve module deps and bind CodeFunction exports
 * per invocation.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import type { CodeFunction, FsApi } from '@inkibra/ai-flow/codemode/types';
import type { EffectContext } from '@inkibra/router';
import type { AiComputerModule } from './define-module';
import type { Command } from './types';

export type ModuleInvocationContext = {
  fs: OverlayFs;
  driver: unknown;
  effects: EffectContext;
  ctx: Record<string, unknown>;
  input: unknown;
  logger: unknown;
};

export function createFsApi(fs: OverlayFs): FsApi {
  return {
    read: (path: string) => fs.read(path),
    write: (path: string, content: string) => fs.write(path, content),
    exists: (path: string) => fs.exists(path),
    list: async (path: string) => {
      const entries = await fs.list(path);
      return entries.map((entry) => entry.name);
    },
  };
}

type BoundModuleExports = Record<string, Record<string, unknown>>;

function topoSortModules(
  modules: AiComputerModule<any, any, any, any>[],
): AiComputerModule<any, any, any, any>[] {
  const byName = new Map(modules.map((mod) => [mod.name, mod]));
  const ordered: AiComputerModule<any, any, any, any>[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(mod: AiComputerModule<any, any, any, any>) {
    if (visited.has(mod.name)) return;
    if (visiting.has(mod.name)) {
      throw new Error(
        `Circular AI module dependency detected at "${mod.name}"`,
      );
    }
    visiting.add(mod.name);
    const depends = mod.depends as Record<
      string,
      AiComputerModule<any, any, any, any>
    >;
    for (const dep of Object.values(depends)) {
      const installed = byName.get(dep.name);
      if (!installed) {
        throw new Error(
          `AI module "${mod.name}" depends on missing module "${dep.name}"`,
        );
      }
      visit(installed);
    }
    visiting.delete(mod.name);
    visited.add(mod.name);
    ordered.push(mod);
  }

  for (const mod of modules) visit(mod);
  return ordered;
}

function wrapCodeFunction(
  name: string,
  codeFn: CodeFunction<any, any, any>,
  invocation: ModuleInvocationContext,
  deps: unknown,
): (params: unknown) => Promise<unknown> {
  const fsApi = createFsApi(invocation.fs);
  return async (params: unknown) => {
    const validation = codeFn.validate(params);
    if (!validation.success) {
      const details = validation.errors
        .map((error) => `${error.path}: expected ${error.expected}`)
        .join(', ');
      throw new Error(`${name}: validation failed — ${details}`);
    }
    return codeFn.fn(validation.data, {
      fs: fsApi,
      ctx: invocation.ctx,
      deps,
      output: {},
    });
  };
}

export async function resolveModuleBindings(
  modules: AiComputerModule<any, any, any, any>[],
  invocation: ModuleInvocationContext,
): Promise<BoundModuleExports> {
  const ordered = topoSortModules(modules);
  const resolved: BoundModuleExports = {};

  for (const mod of ordered) {
    const dependencyBindings: Record<string, Record<string, unknown>> = {};
    const depends = mod.depends as Record<
      string,
      AiComputerModule<any, any, any, any>
    >;
    for (const [alias, dep] of Object.entries(depends)) {
      dependencyBindings[alias] = resolved[dep.name] ?? {};
    }

    const deps = mod.deps
      ? await mod.deps.create({
          driver: invocation.driver,
          effects: invocation.effects,
          fs: createFsApi(invocation.fs),
          modules: dependencyBindings,
          ctx: invocation.ctx,
          input: invocation.input,
          logger: invocation.logger,
        })
      : undefined;

    const wrapped: Record<string, unknown> = {};
    const bindings = mod.bindings as Record<
      string,
      CodeFunction<any, any, any>
    >;
    for (const [bindingName, binding] of Object.entries(bindings)) {
      wrapped[bindingName] = wrapCodeFunction(
        bindingName,
        binding,
        invocation,
        deps,
      );
    }
    resolved[mod.name] = wrapped;
  }

  return resolved;
}

function createThrowingApi(
  bindings: Record<string, unknown>,
): Record<string, unknown> {
  const stubs: Record<string, unknown> = {};
  for (const name of Object.keys(bindings)) {
    stubs[name] = async () => {
      throw new Error(
        `AI module binding stub "${name}" was called outside an invocation`,
      );
    };
  }
  return stubs;
}

export function instantiateModuleCommands(
  modules: AiComputerModule<any, any, any, any>[],
  bindingsByModuleName: BoundModuleExports,
): Command<any>[] {
  const ordered = topoSortModules(modules);
  const commands: Command<any>[] = [];

  for (const mod of ordered) {
    if (!mod.commands) continue;
    if (Array.isArray(mod.commands)) {
      commands.push(...mod.commands);
      continue;
    }
    const modulesArg: Record<string, Record<string, unknown>> = {};
    const depends = mod.depends as Record<
      string,
      AiComputerModule<any, any, any, any>
    >;
    for (const [alias, dep] of Object.entries(depends)) {
      modulesArg[alias] = bindingsByModuleName[dep.name] ?? {};
    }
    commands.push(
      ...mod.commands({
        self: bindingsByModuleName[mod.name] ?? {},
        modules: modulesArg,
      }),
    );
  }

  return commands;
}

export function instantiateModuleCommandStubs(
  modules: AiComputerModule<any, any, any, any>[],
): Command<any>[] {
  const stubBindings: BoundModuleExports = {};
  for (const mod of topoSortModules(modules)) {
    stubBindings[mod.name] = createThrowingApi(mod.bindings ?? {});
  }
  return instantiateModuleCommands(modules, stubBindings);
}
