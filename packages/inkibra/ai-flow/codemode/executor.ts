/**
 * Code Executor
 *
 * Executes TypeScript code in a sandboxed environment with access to:
 * - Functions (code functions with validation)
 * - Filesystem (memfs-backed virtual filesystem)
 * - Context (flow context, readable/writable by AI)
 * - Console (logging)
 *
 * Functions receive a FunctionContext with { fs, ctx, deps, output } where
 * deps and output are NOT visible to the AI but available to function implementations.
 *
 * ## IMPORTANT: Security Notice
 *
 * The Node.js `vm` module used here is NOT a security sandbox. It provides JavaScript
 * context isolation but does NOT prevent sandbox escapes. Malicious code can potentially
 * access the host environment through prototype chain traversal.
 *
 * This sandbox is designed for:
 * - Convenience isolation of LLM-generated code
 * - Preventing accidental access to globals
 * - Providing a controlled API surface
 *
 * For true security isolation, use `isolated-vm`, WebAssembly, or separate processes.
 */

import path from 'node:path';
import vm from 'node:vm';
import { createFsFromVolume, Volume } from 'memfs';
import { getFunctionDeclarations } from './function';
import type {
  CodeExecutionConfig,
  CodeFunction,
  ExecutionResult,
  FsApi,
  FunctionCall,
  FunctionContext,
} from './types';

/** Default timeout for code execution (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30000;

/** Default maximum file size (10MB) */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Default maximum total filesystem size (100MB) */
const DEFAULT_MAX_TOTAL_SIZE = 100 * 1024 * 1024;

/**
 * Execute TypeScript code in a sandboxed environment.
 *
 * The code has access to:
 * - All configured functions (called by name)
 * - `ctx` - flow context (readable/writable)
 * - `fs` - virtual filesystem
 * - `console` - logging
 *
 * Functions receive a FunctionContext with { fs, ctx, deps, output } allowing
 * them to access external dependencies and write to the output accumulator.
 *
 * @example
 * ```typescript
 * const result = await executeCode(
 *   `
 *     const user = await fetchUser({ userId: ctx.userId });
 *     await fs.write('/output/user.json', JSON.stringify(user));
 *     console.log('Fetched user:', user.name);
 *   `,
 *   {
 *     functions: { fetchUser },
 *     mount: (ctx) => ({
 *       '/input/config.json': JSON.stringify(ctx.config),
 *     }),
 *     output: () => ({
 *       user: null as User | null,
 *     }),
 *   },
 *   { userId: 'user-123', config: {} },  // ctx
 *   { db, logger },                       // deps
 * );
 * ```
 */
export async function executeCode<
  TCtx extends Record<string, unknown>,
  TDeps,
  TOutput,
  TFunctions extends Record<string, CodeFunction<any, any, any>>,
>(
  code: string,
  config: CodeExecutionConfig<TCtx, TOutput, TFunctions>,
  ctx: TCtx,
  deps: TDeps,
): Promise<ExecutionResult<TCtx, TOutput>> {
  const startTime = Date.now();
  const logs: string[] = [];
  const calls: FunctionCall[] = [];

  const timeoutMs = config.sandbox?.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxFileSize = config.sandbox?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxTotalSize = config.sandbox?.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;

  // Create a mutable copy of the context
  let mutableCtx: TCtx;
  try {
    mutableCtx = structuredClone(ctx);
  } catch (e) {
    const cloneError = e instanceof Error ? e.message : String(e);
    const output = config.output?.() ?? ({} as TOutput);
    return {
      success: false,
      error: new Error(
        `Context cannot be cloned: ${cloneError}. Context must contain only JSON-serializable values.`,
      ),
      ctx,
      files: {},
      output,
      logs: [],
      calls: [],
      duration: Date.now() - startTime,
    };
  }

  // Create the output accumulator
  const outputAccumulator = config.output?.() ?? ({} as TOutput);

  // Create memfs volume
  const vol = new Volume();
  let totalSize = 0;

  // Mount initial files
  try {
    const initialFiles = config.mount?.(ctx) ?? {};

    for (const [filePath, content] of Object.entries(initialFiles)) {
      const safePath = sanitizePath(filePath);

      if (content.length > maxFileSize) {
        throw new Error(
          `Mounted file too large: ${safePath} (${content.length} bytes, max: ${maxFileSize})`,
        );
      }
      totalSize += content.length;
      if (totalSize > maxTotalSize) {
        throw new Error(
          `Total mounted files size exceeds limit (${totalSize} bytes, max: ${maxTotalSize})`,
        );
      }

      const dir = safePath.substring(0, safePath.lastIndexOf('/'));
      if (dir && dir !== '') {
        vol.mkdirSync(dir, { recursive: true });
      }
      vol.writeFileSync(safePath, content);
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e : new Error(String(e)),
      ctx: mutableCtx,
      files: {},
      output: outputAccumulator,
      logs: [],
      calls: [],
      duration: Date.now() - startTime,
    };
  }

  // Create fs API
  const memfs = createFsFromVolume(vol);
  const fsApi: FsApi = {
    read: async (filePath: string): Promise<string> => {
      const safePath = sanitizePath(filePath);
      return memfs.readFileSync(safePath, 'utf8') as string;
    },
    write: async (filePath: string, content: string): Promise<void> => {
      const safePath = sanitizePath(filePath);

      if (content.length > maxFileSize) {
        throw new Error(
          `File too large: ${safePath} (${content.length} bytes, max: ${maxFileSize})`,
        );
      }

      // Subtract old file size if overwriting
      let oldSize = 0;
      if (memfs.existsSync(safePath)) {
        try {
          const stat = memfs.statSync(safePath);
          if (stat.isFile()) {
            oldSize = stat.size;
          }
        } catch {
          // File might not exist or be inaccessible
        }
      }

      const newTotalSize = totalSize - oldSize + content.length;
      if (newTotalSize > maxTotalSize) {
        throw new Error(
          `Total filesystem size exceeded (max: ${maxTotalSize} bytes)`,
        );
      }
      totalSize = newTotalSize;

      const dir = safePath.substring(0, safePath.lastIndexOf('/'));
      if (dir && dir !== '') {
        try {
          memfs.mkdirSync(dir, { recursive: true });
        } catch {
          // Directory might already exist
        }
      }
      memfs.writeFileSync(safePath, content);
    },
    exists: async (filePath: string): Promise<boolean> => {
      const safePath = sanitizePath(filePath);
      return memfs.existsSync(safePath);
    },
    list: async (filePath: string): Promise<string[]> => {
      const safePath = sanitizePath(filePath);
      return memfs.readdirSync(safePath) as string[];
    },
  };

  // Create function context (passed to function implementations)
  const functionContext: FunctionContext<TCtx, TDeps, TOutput> = {
    fs: fsApi,
    ctx: mutableCtx,
    deps,
    output: outputAccumulator,
  };

  let error: Error | undefined;

  try {
    // Wrap functions with validation and tracking
    const wrappedFunctions: Record<
      string,
      (params: unknown) => Promise<unknown>
    > = {};

    for (const [fnName, fn] of Object.entries(config.functions)) {
      wrappedFunctions[fnName] = async (params: unknown) => {
        const callStart = Date.now();
        const call: FunctionCall = {
          name: fnName,
          args: params,
          timestamp: callStart,
          duration: 0,
        };

        try {
          // Validate parameters
          const validation = fn.validate(params);

          if (!validation.success) {
            const errors = validation.errors
              .map(
                (e) =>
                  `${e.path}: expected ${e.expected}, got ${typeof e.value}`,
              )
              .join(', ');
            const errorMsg = `${fnName} validation failed: ${errors}`;
            call.error = errorMsg;
            call.duration = Date.now() - callStart;
            calls.push(call);
            throw new Error(errorMsg);
          }

          // Execute the function with FunctionContext
          const fnResult = await fn.fn(validation.data, functionContext);
          call.result = fnResult;
          call.duration = Date.now() - callStart;
          calls.push(call);
          return fnResult;
        } catch (e) {
          if (!call.error) {
            call.error = e instanceof Error ? e.message : String(e);
            call.duration = Date.now() - callStart;
            calls.push(call);
          }
          throw e;
        }
      };
    }

    const exposeCtx = config.expose?.ctx ?? true;
    const exposeFs = config.expose?.fs ?? true;
    const exposeConsole = config.expose?.console ?? true;

    const vmContext: Record<string, unknown> = {
      // Functions
      ...wrappedFunctions,

      // Standard globals
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      RegExp,
      Error,
      Map,
      Set,
      Promise,
    };

    if (exposeCtx) {
      vmContext.ctx = mutableCtx;
    }

    if (exposeFs) {
      vmContext.fs = fsApi;
    }

    if (exposeConsole) {
      vmContext.console = {
        log: (...args: unknown[]) =>
          logs.push(`[LOG] ${args.map(formatArg).join(' ')}`),
        error: (...args: unknown[]) =>
          logs.push(`[ERROR] ${args.map(formatArg).join(' ')}`),
        warn: (...args: unknown[]) =>
          logs.push(`[WARN] ${args.map(formatArg).join(' ')}`),
      };
    }

    // Create the vm context
    vm.createContext(vmContext);

    // Wrap code in async IIFE for await support
    const wrappedCode = `(async () => { ${code} })()`;

    // Create the script
    const script = new vm.Script(wrappedCode, {
      filename: 'executor.ts',
    });

    // Run with proper async timeout using Promise.race
    const executionPromise = script.runInContext(vmContext, {
      timeout: timeoutMs, // This only catches sync infinite loops
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      // Clear the timeout to prevent memory leak
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  const duration = Date.now() - startTime;
  const files = getAllFiles(vol);

  if (error) {
    return {
      success: false,
      error,
      ctx: mutableCtx,
      files,
      output: outputAccumulator,
      logs,
      calls,
      duration,
    };
  }

  return {
    success: true,
    ctx: mutableCtx,
    files,
    output: outputAccumulator,
    logs,
    calls,
    duration,
  };
}

/**
 * Generate TypeScript declarations for the execute tool description.
 * Includes functions, ctx, fs, and console.
 */
export function generateExecuteToolDescription<
  TFunctions extends Record<string, CodeFunction<any, any, any>>,
>(
  functions: TFunctions,
  contextDescription?: string,
  expose?: {
    ctx?: boolean;
    fs?: boolean;
    console?: boolean;
  },
): string {
  // Get declarations for all functions
  const functionDeclarations = getFunctionDeclarations(functions);

  const exposeCtx = expose?.ctx ?? true;
  const exposeFs = expose?.fs ?? true;
  const exposeConsole = expose?.console ?? true;

  const ctxDecl = exposeCtx
    ? contextDescription
      ? `/**
 * Flow context - can be read and modified
 */
 declare const ctx: ${contextDescription};`
      : `/**
 * Flow context - can be read and modified
 */
 declare const ctx: Record<string, unknown>;`
    : '';

  const fsDecl = exposeFs
    ? `/**
 * In-memory filesystem for reading/writing files
 */
 declare const fs: {
   read: (path: string) => Promise<string>;
   write: (path: string, content: string) => Promise<void>;
   exists: (path: string) => Promise<boolean>;
   list: (path: string) => Promise<string[]>;
 };`
    : '';

  const consoleDecl = exposeConsole
    ? `/**
 * Console logging (output captured and shown in result)
 */
 declare const console: {
   log: (...args: unknown[]) => void;
   error: (...args: unknown[]) => void;
   warn: (...args: unknown[]) => void;
 };`
    : '';

  return `${functionDeclarations}

 ${ctxDecl}

 ${fsDecl}

 ${consoleDecl}`.trim();
}

/**
 * Format execution error for feedback to the LLM
 */
export function formatExecutionError(
  code: string,
  error: Error,
  logs: string[],
): string {
  const lines = code.split('\n');
  const errorMessage = error.message;

  // Try to extract line number from error
  const lineMatch =
    errorMessage.match(/line (\d+)/i) || errorMessage.match(/:(\d+):\d+/);
  const lineNumber =
    lineMatch && lineMatch[1] ? parseInt(lineMatch[1], 10) : null;

  let formattedError = `--- Error ---\n${errorMessage}`;

  if (lineNumber && lineNumber <= lines.length) {
    const contextStart = Math.max(0, lineNumber - 3);
    const contextEnd = Math.min(lines.length, lineNumber + 2);
    const context = lines
      .slice(contextStart, contextEnd)
      .map((line, i) => {
        const num = contextStart + i + 1;
        const marker = num === lineNumber ? '  <-- ERROR HERE' : '';
        return `  ${num}: ${line}${marker}`;
      })
      .join('\n');

    formattedError += `\n\nCode context:\n${context}`;
  }

  if (logs.length > 0) {
    formattedError += `\n\n--- Console ---\n${logs.join('\n')}`;
  }

  return formattedError;
}

/**
 * Format execution result for LLM feedback
 */
export function formatExecutionResult<
  TCtx extends Record<string, unknown>,
  TOutput,
>(result: ExecutionResult<TCtx, TOutput>): string {
  if (!result.success) {
    return formatExecutionError('', result.error, result.logs);
  }

  const parts: string[] = [];

  // Show what functions were called
  if (result.calls.length > 0) {
    const callSummary = result.calls
      .map((c) => {
        const status = c.error ? `ERROR: ${c.error}` : 'OK';
        return `  ${c.name}: ${status} (${c.duration}ms)`;
      })
      .join('\n');
    parts.push(`--- Function Calls ---\n${callSummary}`);
  }

  // Show output files
  const outputFiles = Object.keys(result.files).filter((f) =>
    f.startsWith('/output/'),
  );
  if (outputFiles.length > 0) {
    parts.push(`--- Output Files ---\n${outputFiles.join('\n')}`);
  }

  // Show logs
  if (result.logs.length > 0) {
    parts.push(`--- Console ---\n${result.logs.join('\n')}`);
  }

  parts.push(`--- Duration ---\n${result.duration}ms`);

  return parts.join('\n\n');
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Sanitize and validate a filesystem path
 */
function sanitizePath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath);
  if (!normalized.startsWith('/')) {
    throw new Error(`Path must be absolute: ${inputPath}`);
  }
  if (normalized.includes('\0')) {
    throw new Error('Path contains null bytes');
  }
  return normalized;
}

/**
 * Get all files from a memfs Volume as a Record
 */
function getAllFiles(vol: InstanceType<typeof Volume>): Record<string, string> {
  const files: Record<string, string> = {};

  const walk = (dir: string) => {
    try {
      const entries = vol.readdirSync(dir) as string[];
      for (const entry of entries) {
        const fullPath = dir === '/' ? `/${entry}` : `${dir}/${entry}`;
        try {
          const stat = vol.statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath);
          } else {
            files[fullPath] = vol.readFileSync(fullPath, 'utf8') as string;
          }
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  };

  walk('/');
  return files;
}

/**
 * Format an argument for console output
 */
function formatArg(arg: unknown): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}
