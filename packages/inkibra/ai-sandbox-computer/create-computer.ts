/**
 * createComputer — Assembly function that ties the computer together.
 *
 * Creates a command registry with all built-in commands, registers developer
 * commands, sets up the preview engine, and returns the preview_exec tool.
 * See spec §3 (ai-sandbox-computer) and §11.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import { contextManagementCommands } from './commands/context-management';
import { cronCommand } from './commands/cron';
import { fileOperationCommands } from './commands/file-ops';
import { pmCommand } from './commands/pm';
import type { AiComputerModule } from './define-module';
import { instantiateModuleCommandStubs } from './module-runtime';
import { createPreviewEngine } from './preview-engine';
import { createPreviewExecTool } from './preview-exec-tool';
import { createCommandRegistry } from './registry';
import type { Command, CommandRegistry } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComputerBuiltInConfig = {
  fileOperations?: boolean;
  contextManagement?: boolean;
  cron?: boolean;
  packageManager?: boolean;
};

export type ComputerConfig = {
  /** Toggle built-in command groups. Defaults to all enabled. */
  builtIns?: ComputerBuiltInConfig;
  /** Extra developer-defined commands to register. */
  commands?: Command<any>[];
  /** Product modules — bind commands and named exports into the sandbox. */
  modules?: AiComputerModule<any, any, any, any>[];
  /** Pre-loaded VFS modules: { 'zod': zodExports, 'date-fns': dateFnsExports } */
  preloadedModules?: Record<string, Record<string, unknown>>;
  /** sys/ai SDK configuration */
  ai?: import('./sys-ai').AiSdkConfig;
  /** Preview execution timeout in ms (default 10_000). */
  timeoutMs?: number;
  /** Transaction runtime — opens tx cycles for preview (rollback) and commit. */
  transactionRuntime?: import('@inkibra/router').TransactionRuntime;
};

export type Computer = {
  registry: CommandRegistry;
  tool: ReturnType<typeof createPreviewExecTool>;
  preview: (
    code: string,
    hostContext?: import('./preview-engine').PreviewInvocationHostContext,
  ) => ReturnType<ReturnType<typeof createPreviewEngine>['preview']>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createComputer(
  overlayFs: OverlayFs,
  config: ComputerConfig = {},
): Computer {
  const registry = createCommandRegistry();
  const builtIns: Required<ComputerBuiltInConfig> = {
    fileOperations: config.builtIns?.fileOperations ?? true,
    contextManagement: config.builtIns?.contextManagement ?? true,
    cron: config.builtIns?.cron ?? true,
    packageManager: config.builtIns?.packageManager ?? true,
  };

  if (builtIns.fileOperations) {
    for (const cmd of fileOperationCommands) {
      registry.register(cmd);
    }
  }

  if (builtIns.contextManagement) {
    for (const cmd of contextManagementCommands) {
      registry.register(cmd);
    }
  }

  if (builtIns.cron) {
    registry.register(cronCommand);
  }

  if (builtIns.packageManager) {
    registry.register(pmCommand);
  }
  // Register developer commands
  if (config.commands) {
    for (const cmd of config.commands) {
      registry.register(cmd);
    }
  }

  // Register module command stubs for tool description/help generation.
  // Real module commands are instantiated per invocation with bound self/modules.
  if (config.modules) {
    for (const cmd of instantiateModuleCommandStubs(config.modules)) {
      registry.register(cmd);
    }
  }

  // Create preview engine
  const engine = createPreviewEngine({
    registry,
    overlayFs,
    timeoutMs: config.timeoutMs,
    modules: config.modules,
    preloadedModules: config.preloadedModules,
    aiSdkConfig: config.ai,
    transactionRuntime: config.transactionRuntime,
  });

  // Create the preview_exec tool for ai-flow
  const tool = createPreviewExecTool({ engine, registry });

  return {
    registry,
    tool,
    preview: (code: string, hostContext) => engine.preview(code, hostContext),
  };
}
