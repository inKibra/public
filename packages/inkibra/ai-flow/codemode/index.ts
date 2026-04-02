/**
 * Code Execution
 *
 * The code execution paradigm where LLMs write TypeScript code that calls
 * function APIs in a sandboxed environment.
 *
 * ## Key Concepts
 *
 * - **CodeFunction**: A self-describing function that can be called from AI-generated code.
 *   Created either via the `.tool.ts` plugin or manually using `codeFunction()`.
 *
 * - **executeCode**: Executes TypeScript code in a sandbox with access to functions,
 *   filesystem, context, and console.
 *
 * - **FunctionContext**: Context passed to function implementations, containing
 *   `{ fs, ctx, deps, output }` where deps and output are NOT visible to AI.
 *
 * - **Plugin**: A Bun plugin that transforms `.tool.ts` files into CodeFunction objects,
 *   extracting types and generating validators automatically.
 *
 * ## Usage
 *
 * ### Via Plugin (Recommended)
 *
 * ```typescript
 * // 1. Write a .tool.ts file
 * // routines.tool.ts
 * import { defineCodeBinding } from '@inkibra/ai-flow/codemode';
 *
 * /**
 *  * Fetches a user by ID from the database
 *  *\/
 * export const fetchUser = defineCodeBinding(
 *   async function fetchUser(
 *     { userId }: { userId: string },
 *     { deps }: { deps: RoutineDeps }
 *   ): Promise<User> {
 *     deps.logger.debug('Fetching user', { userId });
 *     return deps.db.getUser(userId);
 *   },
 * );
 *
 * // 2. Import and configure stage with codeExecution
 * import { fetchUser, commitRoutine } from './routines.tool';
 *
 * const stage = createAiOutputStage('generateRoutine', {
 *   model: 'gpt-4',
 *
 *   codeExecution: {
 *     functions: { fetchUser, commitRoutine },
 *     mount: (ctx) => ({
 *       '/input/exercises.json': JSON.stringify(ctx.exercises),
 *     }),
 *     output: () => ({
 *       routine: null as Routine | null,
 *     }),
 *   },
 *
 *   // ... rest of stage config
 * });
 * ```
 *
 * ### Manual Creation
 *
 * ```typescript
 * import { codeFunction, executeCode } from '@inkibra/ai-flow/codemode';
 * import typia from 'typia';
 *
 * const fetchUser = codeFunction({
 *   description: 'Fetches a user by ID',
 *   validate: typia.createValidate<{ userId: string }>(),
 *   fn: async ({ userId }, { deps }) => deps.db.getUser(userId),
 * });
 *
 * const result = await executeCode(code, config, ctx, deps);
 * ```
 */

// Context shell (bash-like commands)
export {
  ContextShell,
  type ContextShellOptions,
  createContextShell,
  type ShellResult,
} from './context-shell';
// Context tool (AI interface)
export {
  type ContextToolDefinition,
  type ContextToolResult,
  type CreateContextToolOptions,
  createContextTool,
  createSimpleContextTool,
  formatShellResult,
} from './context-tool';

// Code executor
export {
  executeCode,
  formatExecutionError,
  formatExecutionResult,
  generateExecuteToolDescription,
} from './executor';
// Function factories
export {
  codeFunction,
  defineCodeBinding,
  getFunctionDeclaration,
  getFunctionDeclarations,
  isCodeFunction,
} from './function';

// Overlay filesystem
export {
  createOverlayFs,
  type FsEntry,
  type IOverlayFs,
  OverlayFs,
  type OverlayFsConfig,
  type PersistentPathConfig,
} from './overlay-fs';
// Plugin (for .tool.ts transformation)
export { codeBindingPlugin } from './plugin';
// Tool usage helpers
export {
  extractFilesFromToolUsage,
  formatToolUsageLines,
  type ToolUsageEntry,
  type ToolUsageFormatOptions,
} from './tool-format';
// Types
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
} from './types';
// VFS tool (AiTool wrapper)
export {
  type CreateVfsToolOptions,
  createVfsTool,
  type VfsToolResult,
} from './vfs-tool';
