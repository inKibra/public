/**
 * Command Computer
 *
 * The computer abstraction for ai-construct.
 * See command-computer-spec §3, §8–11.
 */

export { generateArgHelp, parseArgs } from './arg-parser';
export type {
  CapabilityDocKind,
  CapabilityDocTier,
  ResolvedCapabilityDoc,
} from './capability-doc-core';
export {
  CAPABILITY_DOC_EXECUTION_FILES,
  CAPABILITY_DOC_PLANNING_FILES,
  materializeCapabilityDocs,
  resolveCapabilityDocsFromCommands,
  resolveCapabilityDocsFromModules,
  resolveSystemCapabilityDocs,
} from './capability-doc-core';
export type { RenderedCommandOutput } from './command-render';
export { renderCommandOutput } from './command-render';
export { contextManagementCommands } from './commands/context-management';
export { cronCommand } from './commands/cron';
// Built-in commands
export { fileOperationCommands } from './commands/file-ops';
export { pmCommand } from './commands/pm';
export type { CommitResult } from './commit-engine';
export { commitPreview } from './commit-engine';
export type { Computer, ComputerConfig } from './create-computer';
export { createComputer } from './create-computer';
// Core
export { defineCommand } from './define-command';
export type { AiComputerModule, AiComputerModuleConfig } from './define-module';
export { defineAiComputerModule } from './define-module';
export type {
  EffectModule,
  EffectModuleApi,
  EffectModuleHandlers,
} from './effects';
export { createEffectModule, effect } from './effects';
export type {
  CapturedConsole,
  PreviewGlobals,
  ResponsePlan,
  ResponsePlanPolicy,
} from './globals';
// Globals
export { createPreviewGlobals } from './globals';
export type {
  AiModuleBindings,
  AiModuleDependencyMap,
  AiModuleDepsFactory,
  AiModuleDepsFactoryArgs,
  AiResolvedModules,
  ModuleBindingsRecord,
  UnwrapBindingRecord,
} from './module-deps';
export { createAiModuleDeps } from './module-deps';
// Module resolver
export { rewriteImports } from './module-resolver';
// Node built-in proxies (§13)
export {
  nodeAssertProxy,
  nodeBufferProxy,
  nodeCryptoProxy,
  nodeEventsProxy,
  nodeOsProxy,
  nodePathProxy,
  nodeQuerystringProxy,
  nodeUrlProxy,
  nodeUtilProxy,
} from './node-proxies';
export type {
  PreviewEngine,
  PreviewEngineConfig,
  PreviewExecRecord,
  PreviewInvocationHostContext,
} from './preview-engine';
// Engine
export { createPreviewEngine } from './preview-engine';
export type {
  ImpulseFlowContext,
  PreviewExecToolOptions,
} from './preview-exec-tool';
export { createPreviewExecTool } from './preview-exec-tool';
export type { PreviewSafeMetadata, PreviewSafety } from './preview-safe';
// Preview safety
export {
  filterPreviewSafe,
  isPreviewSafe,
  previewSafe,
  previewUnsafe,
} from './preview-safe';
export { createCommandRegistry } from './registry';
export type {
  AiModelPreset,
  AiProvider,
  AiSdk,
  AiSdkConfig,
  SearchResult,
} from './sys-ai';

// sys/ai SDK
export { createAiSdk } from './sys-ai';
// Types
export type {
  ArgDef,
  ArgParseResult,
  ArgType,
  Command,
  CommandContext,
  CommandRegistry,
  DispatchBudgetConfig,
  ParsedArgs,
} from './types';

// VFS Layout
export { bootstrapComputerVfs, VFS_COMPUTER_PATHS } from './vfs-layout';
