/**
 * Preview Engine — Runs TypeScript code on a forked VFS.
 *
 * See spec §11. Uses vm.SourceTextModule + vm.createContext for sandboxed
 * ESM execution with proper isolation.
 *
 * Each preview:
 * 1. Transpiles TS → JS via Bun.Transpiler
 * 2. Forks the OverlayFs
 * 3. Resolves module deps and per-invocation bindings/commands
 * 4. Runs in a vm.SourceTextModule with sandboxed context
 * 5. Captures stdout, response plans, and effect previews
 * 6. Returns a PreviewExecRecord with a unique execId
 */

import * as vm from 'node:vm';
import type { OverlayFs } from '@inkibra/ai-flow';
import {
  createNoopEffectContext,
  type TransactionRuntime,
} from '@inkibra/router';
import type { AiComputerModule } from './define-module';
import type { ResponsePlan, ResponsePlanPolicy } from './globals';
import { createPreviewGlobals } from './globals';
import { populateStaticPreviewModules } from './module-resolver';
import {
  instantiateModuleCommandStubs,
  instantiateModuleCommands,
  type ModuleInvocationContext,
  resolveModuleBindings,
} from './module-runtime';
import { createCommandRegistry } from './registry';
import type { AiSdkConfig } from './sys-ai';
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

export type PreviewExecRecord = {
  execId: string;
  code: string;
  stdout: string;
  responsePlans: ResponsePlan[];
  effectPreviews: string[];
  createdAt: string;
  ephemeralOutput?: string;
  error?: string;
};

export type PreviewInvocationHostContext = {
  ctx?: Record<string, unknown>;
  input?: unknown;
  logger?: unknown;
  responsePlanPolicy?: ResponsePlanPolicy;
};

export type PreviewEngineConfig = {
  registry: CommandRegistry;
  overlayFs: OverlayFs;
  timeoutMs?: number;
  /** Product modules resolved per invocation against the tx cycle + forked VFS. */
  modules?: AiComputerModule<any, any, any, any>[];
  /** Pre-loaded VFS modules: { 'zod': zodExports } */
  preloadedModules?: Record<string, Record<string, unknown>>;
  /** sys/ai SDK configuration */
  aiSdkConfig?: AiSdkConfig;
  /** Transaction runtime for DB-backed preview/commit semantics. */
  transactionRuntime?: TransactionRuntime;
};

export type PreviewEngine = {
  preview: (
    code: string,
    hostContext?: PreviewInvocationHostContext,
  ) => Promise<PreviewExecRecord>;
};

let execCounter = 0;

function generateExecId(): string {
  execCounter++;
  const ts = Date.now().toString(36);
  const seq = execCounter.toString(36).padStart(4, '0');
  return `prev_${ts}_${seq}`;
}

export function createPreviewEngine(
  config: PreviewEngineConfig,
): PreviewEngine {
  const { registry, overlayFs, timeoutMs = 10_000 } = config;

  return {
    async preview(
      code: string,
      hostContext: PreviewInvocationHostContext = {},
    ): Promise<PreviewExecRecord> {
      const execId = generateExecId();
      const stdout: string[] = [];
      const responsePlans: ResponsePlan[] = [];
      const ephemeralCommandOutputs: string[] = [];
      const createdAt = new Date().toISOString();

      const forkedFs = overlayFs.fork();
      const cycle = config.transactionRuntime
        ? await config.transactionRuntime.begin({ mode: 'preview' })
        : null;

      const invocation: ModuleInvocationContext = {
        fs: forkedFs,
        driver: cycle?.driver ?? {},
        effects: cycle?.effects ?? createNoopEffectContext(),
        ctx: hostContext.ctx ?? {},
        input: hostContext.input,
        logger: hostContext.logger,
      };

      try {
        const stubNames = new Set(
          (config.modules
            ? instantiateModuleCommandStubs(config.modules)
            : []
          ).map((command) => command.name),
        );
        const invocationRegistry = createCommandRegistry(
          registry.list().filter((command) => !stubNames.has(command.name)),
        );
        const moduleMap = new Map<string, Record<string, unknown>>();
        let moduleBindings: Record<string, Record<string, unknown>> | undefined;

        if (config.modules && config.modules.length > 0) {
          moduleBindings = await resolveModuleBindings(
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
        }

        const globals = createPreviewGlobals({
          registry: invocationRegistry,
          ctx: { fs: forkedFs, registry: invocationRegistry },
          stdout,
          responsePlans,
          ephemeralCommandOutputs,
          responsePlanPolicy: hostContext.responsePlanPolicy,
        });

        const transpiled = transpileTs(code);
        const { imports, body } = splitImportsAndBody(transpiled);
        const wrappedCode = wrapForSourceTextModule(imports, body);

        populateStaticPreviewModules(moduleMap, {
          fs: forkedFs,
          globals,
          bindings: moduleBindings,
          aiSdkConfig: config.aiSdkConfig,
          preloadedModules: config.preloadedModules,
        });

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
          identifier: `preview:${execId}`,
        });

        const linker = createVfsModuleLinker({
          moduleMap,
          context,
          fs: forkedFs,
        });
        await registerAgentCommands({
          fs: forkedFs,
          registry: invocationRegistry,
          linker,
        });
        await mod.link(linker);

        const completionPromise = new Promise<void>((resolve, reject) => {
          context.__resolve = resolve;
          context.__reject = reject;
        });

        await mod.evaluate({ timeout: timeoutMs });

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Preview timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        });

        try {
          await Promise.race([completionPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }

        const effectPreviews = invocation.effects
          .getPreviews()
          .map((preview) => preview.text);

        if (cycle) {
          await cycle.rollback();
        }

        return {
          execId,
          code,
          stdout: stdout.join('\n'),
          responsePlans,
          effectPreviews,
          createdAt,
          ...(ephemeralCommandOutputs.length > 0
            ? { ephemeralOutput: ephemeralCommandOutputs.join('\n\n') }
            : {}),
        };
      } catch (error) {
        if (cycle) {
          try {
            await cycle.rollback();
          } catch {
            // Best-effort rollback
          }
        }

        const errorMsg = error instanceof Error ? error.message : String(error);

        return {
          execId,
          code,
          stdout: stdout.join('\n'),
          responsePlans,
          effectPreviews: invocation.effects
            .getPreviews()
            .map((preview) => preview.text),
          createdAt,
          ...(ephemeralCommandOutputs.length > 0
            ? { ephemeralOutput: ephemeralCommandOutputs.join('\n\n') }
            : {}),
          error: errorMsg,
        };
      }
    },
  };
}
