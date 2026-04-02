/**
 * @inkibra/ai-flow - Streaming-first AI workflow orchestration framework
 *
 * This package provides a type-safe framework for building AI workflows with:
 * - Streaming-first design for real-time reasoning feedback
 * - Structured outputs with JSON schema validation
 * - Tool execution with parameter validation
 * - Multi-stage flow composition
 * - Full state snapshots for resumability
 *
 * @example
 * ```typescript
 * import { createAiFlow, createAiOutputStage, createAiTool } from '@inkibra/ai-flow';
 *
 * const flow = createAiFlow('my-flow', { stages: { ... } })
 *   .onStep('stage1', async ({ step }) => { ... })
 *   .start({ flow: context, firstStage: 'stage1', deps });
 * ```
 */

// Codemode browser-safe exports (context shell, overlay fs, tools).
// NOTE: codeBindingPlugin is intentionally excluded — it has module-level
// process.cwd() (build-time/server-only). Import from '@inkibra/ai-flow/codemode'
// if you need it on the server.
export {
  ContextShell,
  type ContextShellOptions,
  createContextShell,
  type ShellResult,
} from './codemode/context-shell';
export {
  type ContextToolDefinition,
  type ContextToolResult,
  type CreateContextToolOptions,
  createContextTool,
  createSimpleContextTool,
  formatShellResult,
} from './codemode/context-tool';
export {
  createOverlayFs,
  type FsEntry,
  OverlayFs,
  type OverlayFsConfig,
  type PersistentPathConfig,
} from './codemode/overlay-fs';
export {
  extractFilesFromToolUsage,
  formatToolUsageLines,
  type ToolUsageEntry,
  type ToolUsageFormatOptions,
} from './codemode/tool-format';
export type {
  CodeExecutionConfig,
  CodeFunction,
  CodeFunctionOptions,
  CodeFunctionValidation,
  ConsoleApi,
  ExecutionResult,
  ExtractAllFunctionDeps,
  ExtractFunctionDeps,
  FsApi,
  FunctionCall,
  FunctionContext,
  SandboxConfig,
} from './codemode/types';
export {
  type CreateVfsToolOptions,
  createVfsTool,
  type VfsToolResult,
} from './codemode/vfs-tool';
export {
  createZonedFs,
  DEFAULT_VFS_ZONES,
  filterVisibleEntries,
  isVisible,
  isWritable,
  resolveZone,
  type VfsZone,
  type VfsZoneCaller,
  type VfsZoneOwner,
  type VfsZonePermissions,
  type VfsZoneVisibility,
  type ZonedOverlayFs,
} from './codemode/vfs-zones';
// Context module exports
export * from './context/index';
// Core flow exports
export {
  type AIDeps,
  type AiContext,
  type AiCustomTool,
  type AiEvaluationStage,
  type AiFunctionCallOutput,
  type AiInput,
  type AiInputItem,
  // Types
  type AiMessage,
  type AiOutput,
  type AiOutputSchemaDefinition,
  type AiPrompt,
  type AiTool,
  type AiToolParamsDefinition,
  type AiToolRenderOutput,
  type AnyAiTool,
  createAiContext,
  createAiCustomTool,
  createAiFlow,
  createAiInput,
  createAiOutput,
  createAiOutputStage,
  createAiPrompt,
  createAiTextStage,
  createAiTool,
  createEvaluationStage,
  createExecuteTool,
  customToolToFunctionDescriptor,
  type DebugDumpConfig,
  // Factory functions
  defineAiOutputSchema,
  defineAiToolParams,
  type FlowBuilder,
  type FlowRun,
  type FlowSnapshot,
  isStatelessProvider,
  type Json,
  type OnStepHandler,
  type OnStepReturn,
  type OutputStageDef,
  // Type utilities
  type StageNameOfDefs,
  type StageOutputOf,
  type StageReasoning,
  type StageSnapshot,
  type StageStorageOf,
  type TextStageDef,
  type ToolFailure,
  type ToolsOfStage,
  type Validation,
} from './flow';
// Processor exports (legacy API)
export {
  aiFlowProcessor,
  aiFlowToolError,
  aiFlowToolSuccess,
  createAiFlowTool,
} from './processor';
// Testing helpers
export * from './testing';
// Tokenizer utilities
export * from './tokenizer';
// Web search tool
export * from './tools/web-search';
