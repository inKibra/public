/**
 * Commit Engine — Re-runs selected preview code against real state.
 *
 * Re-runs the exact previewed program against the real OverlayFs and a fresh
 * commit transaction cycle. Module bindings and command adapters are resolved
 * per invocation against that cycle.
 */

import * as vm from 'node:vm';
import type { OverlayFs } from '@inkibra/ai-flow';
import {
  createNoopEffectContext,
  type TransactionRuntime,
} from '@inkibra/router';
import type { AiComputerModule } from './define-module';
import type { ResponsePlan } from './globals';
import { createPreviewGlobals } from './globals';
import {
  instantiateModuleCommandStubs,
  instantiateModuleCommands,
  type ModuleInvocationContext,
  resolveModuleBindings,
} from './module-runtime';
import type {
  PreviewExecRecord,
  PreviewInvocationHostContext,
} from './preview-engine';
import { createCommandRegistry } from './registry';
import type { AiSdkConfig } from './sys-ai';
import {
  createSystemStaticModuleMap,
  type SystemStaticPackageRuntimeConfig,
} from './system-static-packages';
import {
  splitImportsAndBody,
  transpileTs,
  wrapForSourceTextModule,
} from './transpile';
import type { CommandRegistry } from './types';
import {
  createVfsModuleLinker,
  registerAgentCommands,
} from './vfs-command-loader';

export type CommitResult = {
  execId: string;
  stdout: string;
  responsePlans: ResponsePlan[];
  effectsFlushed: boolean;
  error?: string;
};

export type CommitEngineConfig = {
  registry: CommandRegistry;
  overlayFs: OverlayFs;
  timeoutMs?: number;
  modules?: AiComputerModule[];
  preloadedModules?: Record<string, Record<string, unknown>>;
  aiSdkConfig?: AiSdkConfig;
  transactionRuntime?: TransactionRuntime;
  hostContext?: PreviewInvocationHostContext;
};

export async function commitPreview(
  record: PreviewExecRecord,
  config: CommitEngineConfig,
): Promise<CommitResult> {
  const { registry, overlayFs, timeoutMs = 10_000 } = config;
  const stdout: string[] = [];
  const responsePlans: ResponsePlan[] = [];

  const cycle = config.transactionRuntime
    ? await config.transactionRuntime.begin({ mode: 'commit' })
    : null;

  const invocation: ModuleInvocationContext = {
    fs: overlayFs,
    driver: cycle?.driver ?? {},
    effects: cycle?.effects ?? createNoopEffectContext(),
    ctx: config.hostContext?.ctx ?? {},
    input: config.hostContext?.input,
    logger: config.hostContext?.logger,
  };

  try {
    const stubNames = new Set(
      (config.modules ? instantiateModuleCommandStubs(config.modules) : []).map(
        (command) => command.name,
      ),
    );
    const invocationRegistry = createCommandRegistry(
      registry.list().filter((command) => !stubNames.has(command.name)),
    );
    const moduleMap = new Map<string, Record<string, unknown>>();

    if (config.modules && config.modules.length > 0) {
      const moduleBindings = await resolveModuleBindings(
        config.modules,
        invocation,
      );
      const moduleCommands = instantiateModuleCommands(
        config.modules,
        moduleBindings,
      );
      for (const command of moduleCommands) {
        invocationRegistry.register(command);
      }
      for (const [name, exports] of Object.entries(moduleBindings)) {
        const withDefault = exports.default
          ? exports
          : { ...exports, default: exports };
        moduleMap.set(name, withDefault);
      }
    }

    const globals = createPreviewGlobals({
      registry: invocationRegistry,
      ctx: { fs: overlayFs, registry: invocationRegistry },
      stdout,
      responsePlans,
      responsePlanPolicy: config.hostContext?.responsePlanPolicy,
    });

    const transpiled = transpileTs(record.code);
    const { imports, body } = splitImportsAndBody(transpiled);
    const wrappedCode = wrapForSourceTextModule(imports, body);

    const systemModules = createSystemStaticModuleMap({
      fs: overlayFs,
      globals,
      aiSdkConfig: config.aiSdkConfig,
    } satisfies SystemStaticPackageRuntimeConfig);
    for (const [name, exports] of systemModules) {
      moduleMap.set(name, exports);
    }

    moduleMap.set('__globals__', {
      show: globals.show,
      plan_response: globals.plan_response,
    });

    if (config.preloadedModules) {
      for (const [name, exports] of Object.entries(config.preloadedModules)) {
        const withDefault = exports.default
          ? exports
          : { ...exports, default: exports };
        moduleMap.set(name, withDefault);
      }
    }
    const context = vm.createContext({
      console: globals.console,
      command: globals.command,
      show: globals.show,
      plan_response: globals.plan_response,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      structuredClone,
      atob,
      btoa,
      crypto,
      __resolve: null as (() => void) | null,
      __reject: null as ((e: unknown) => void) | null,
    });

    const mod = new vm.SourceTextModule(wrappedCode, {
      context,
      identifier: `commit:${record.execId}`,
    });

    const linker = createVfsModuleLinker({
      moduleMap,
      context,
      fs: overlayFs,
    });
    await registerAgentCommands({
      fs: overlayFs,
      registry: invocationRegistry,
      linker,
    });
    await mod.link(linker);

    const completionPromise = new Promise<void>((resolve, reject) => {
      context.__resolve = resolve;
      context.__reject = reject;
    });

    await mod.evaluate({ timeout: timeoutMs });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Commit timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    await Promise.race([completionPromise, timeoutPromise]);

    let effectsFlushed = false;
    if (cycle) {
      await cycle.commit();
      effectsFlushed = true;
    }

    return {
      execId: record.execId,
      stdout: stdout.join('\n'),
      responsePlans,
      effectsFlushed,
    };
  } catch (error) {
    if (cycle) {
      try {
        await cycle.rollback();
      } catch {
        // Best-effort rollback
      }
    }

    return {
      execId: record.execId,
      stdout: stdout.join('\n'),
      responsePlans,
      effectsFlushed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
