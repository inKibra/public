import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@inkibra/logger';
import type OpenAI from 'openai';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.mjs';
import {
  executeCode,
  formatExecutionResult,
  generateExecuteToolDescription,
} from './codemode/executor';
import type {
  CodeExecutionConfig,
  CodeFunction,
  ExecutionResult,
  ExtractAllFunctionDeps,
} from './codemode/types';

// Minimal message model used by helpers (kept independent from SDK types)
export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  type: 'message';
  content: string;
};

export type AiFunctionCallOutput = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

export type AiFunctionCall = {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
};

export type AiInputItem = AiMessage | AiFunctionCallOutput | AiFunctionCall;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type StageReasoning = {
  summaries: string[];
  delta: string;
};

export type ToolFailure = {
  toolName: string;
  callId: string;
  reason: string;
};

export type AiToolRenderOutput =
  | string
  | {
      renderedOutput: string;
      ephemeralOutput?: string;
    };

export type EphemeralToolOutput = {
  callId: string;
  output: string;
};

export type StageSnapshot<
  TFlowCtx extends Record<string, unknown>,
  TStorage extends Record<string, unknown>,
  TOutput,
> = {
  stageName: string;
  turn: number;
  completed: boolean;
  replayHistory: AiInputItem[]; // exact request/response items replayed across turns
  ephemeralToolOutputs: EphemeralToolOutput[]; // next-turn-only tool output overlays
  context: TFlowCtx; // Now TFlowCtx, propagated from flow
  storage: TStorage;
  lastOutput?: TOutput;
  outputs: TOutput[];
  reasoning: StageReasoning;
  processedFunctionCallIds: string[];
  updatedAt: string; // ISO string
};

// Helper type utilities to derive types from stage definitions
export type StageNameOfDefs<TDefs> = Extract<keyof TDefs, string>;
export type StageOutputOf<TStage> = TStage extends OutputStageDef<
  any,
  any,
  any,
  infer O,
  any,
  any
>
  ? O
  : TStage extends AnyTextStageDef<any>
    ? string
    : unknown;
export type StageStorageOf<TStage> = TStage extends OutputStageDef<
  any,
  any,
  infer S,
  any,
  any,
  any
>
  ? S
  : Record<string, unknown>;
export type ToolsOfStage<
  TFlowCtx extends Record<string, unknown>,
  TStage,
> = TStage extends OutputStageDef<any, TFlowCtx, any, any, any, infer TTools>
  ? TTools
  : TStage extends TextStageDef<any, any, infer TTextTools>
    ? TTextTools
    : Record<string, AnyAiTool<TFlowCtx>>;

export type FlowSnapshot<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
> = {
  version: number;
  flowId: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  currentStage: StageNameOfDefs<TDefs>;
  flowContext: TFlowCtx;
  stages: Partial<{
    [K in keyof TDefs]: StageSnapshot<
      TFlowCtx,
      StageStorageOf<TDefs[K]>,
      StageOutputOf<TDefs[K]>
    >;
  }>;
  history: Array<{
    stageName: StageNameOfDefs<TDefs>;
    turn: number;
    status: 'continued' | 'completed';
    at: string;
  }>;
  metadata?: Record<string, Json>;
};

const MAX_RECOVERABLE_STREAM_ATTEMPTS = 2;

// Helper Validation type (compatible shape)
export type Validation<T> =
  | { success: true; data: T; errors?: [] }
  | {
      success: false;
      errors: {
        path?: string;
        expected?: string;
        value?: unknown;
        message?: string;
      }[];
    };

// Inputs / Context / Prompt
export type AiInput<TFlowCtx extends Record<string, unknown>> = {
  key: string;
  render: (ctx: TFlowCtx) => AiMessage[] | Promise<AiMessage[]>;
};

export function createAiInput<TFlowCtx extends Record<string, unknown>>(
  key: string,
  opts: { render: (ctx: TFlowCtx) => AiMessage[] | Promise<AiMessage[]> },
): AiInput<TFlowCtx> {
  return { key, render: opts.render };
}

export type AiContext<TFlowCtx extends Record<string, unknown>> = {
  key: string;
  render: (ctx: TFlowCtx) => string | Promise<string>;
};

// consider allowing deps here
export function createAiContext<TFlowCtx extends Record<string, unknown>>(
  key: string,
  opts: { render: (ctx: TFlowCtx) => string | Promise<string> },
): AiContext<TFlowCtx> {
  return { key, render: opts.render };
}

export type AiPrompt<TFlowCtx extends Record<string, unknown>> = {
  key: string;
  render: (ctx: TFlowCtx) => string;
};

// TODO: deprecate in favor of context
export function createAiPrompt<TFlowCtx extends Record<string, unknown>>(
  key: string,
  opts: { render: (ctx: TFlowCtx) => string },
): AiPrompt<TFlowCtx> {
  return { key, render: opts.render };
}

// Tools
export type AiTool<
  TFlowCtx extends Record<string, unknown>,
  TParams extends Record<string, unknown>,
  TData,
  TDeps,
> = {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  parseParameters: (args: string) => Validation<TParams>;
  execute: (
    params: TParams,
    ctx: TFlowCtx,
    deps: TDeps,
  ) => Promise<
    { success: true; data: TData } | { success: false; message: string }
  >;
  render: (data: TData) => AiToolRenderOutput;
};

export function createAiTool<
  TFlowCtx extends Record<string, unknown>,
  TParams extends Record<string, unknown>,
  TData,
  TDeps,
>(
  name: string,
  opts: {
    description: string;
    parameterSchema: Record<string, unknown>;
    parseParameters: (args: string) => Validation<TParams>;
    execute: (
      params: TParams,
      ctx: TFlowCtx,
      deps: TDeps,
    ) => Promise<
      { success: true; data: TData } | { success: false; message: string }
    >;
    render: (data: TData) => AiToolRenderOutput;
  },
): AiTool<TFlowCtx, TParams, TData, TDeps> {
  return {
    name,
    description: opts.description,
    parameterSchema: opts.parameterSchema,
    parseParameters: opts.parseParameters,
    execute: opts.execute,
    render: opts.render,
  };
}

/**
 * Custom / text-input tool type.
 * Unlike AiTool which uses parameterSchema + JSON parsing, a custom tool
 * accepts raw text input (e.g., TypeScript code for preview_exec).
 * See command-computer-spec §5.5.
 */
export type AiCustomTool<
  TFlowCtx extends Record<string, unknown>,
  TInput,
  TData,
  TDeps,
> = {
  name: string;
  kind: 'custom';
  description: string;
  parseInput: (
    raw: string,
  ) => { success: true; data: TInput } | { success: false; error: string };
  execute: (
    input: TInput,
    ctx: TFlowCtx,
    deps: TDeps,
  ) => Promise<
    { success: true; data: TData } | { success: false; message: string }
  >;
  render: (data: TData) => AiToolRenderOutput;
};

export function createAiCustomTool<
  TFlowCtx extends Record<string, unknown>,
  TInput,
  TData,
  TDeps,
>(
  name: string,
  opts: {
    description: string;
    parseInput: (
      raw: string,
    ) => { success: true; data: TInput } | { success: false; error: string };
    execute: (
      input: TInput,
      ctx: TFlowCtx,
      deps: TDeps,
    ) => Promise<
      { success: true; data: TData } | { success: false; message: string }
    >;
    render: (data: TData) => AiToolRenderOutput;
  },
): AiCustomTool<TFlowCtx, TInput, TData, TDeps> {
  return {
    name,
    kind: 'custom',
    description: opts.description,
    parseInput: opts.parseInput,
    execute: opts.execute,
    render: opts.render,
  };
}

/**
 * Union of standard and custom tools — accepted by stage tool maps.
 */
export type AnyAiTool<TFlowCtx extends Record<string, unknown>, TDeps = any> =
  | AiTool<TFlowCtx, any, any, TDeps>
  | AiCustomTool<TFlowCtx, any, any, TDeps>;

/**
 * Convert an AiCustomTool to a function tool descriptor for the OpenAI API.
 * Custom tools are sent as function tools with a single `input` string parameter.
 * This is the provider fallback per spec §5.5.
 */
export function customToolToFunctionDescriptor(
  tool: AiCustomTool<any, any, any, any>,
): {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
} {
  return {
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description:
            'Raw text input (e.g., TypeScript code for preview_exec)',
        },
      },
      required: ['input'],
      additionalProperties: false,
    },
    strict: true,
  };
}

/**
 * Contract returned by defineAiToolParams<T>().
 */
export type AiToolParamsDefinition<TParams extends Record<string, unknown>> = {
  parameterSchema: Record<string, unknown>;
  parseParameters: (args: string) => Validation<TParams>;
};

/**
 * Marker helper expanded by build-pack type macros.
 */
export function defineAiToolParams<
  TParams extends Record<string, unknown>,
>(): AiToolParamsDefinition<TParams> {
  throw new Error(
    'defineAiToolParams<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
  );
}

/**
 * Create an execute tool from a CodeExecutionConfig.
 * This tool allows the LLM to write and execute TypeScript code
 * with access to configured functions, filesystem, and context.
 */
export function createExecuteTool<
  TFlowCtx extends Record<string, unknown>,
  TOutput,
  TFunctions extends Record<string, CodeFunction<any, any, any>>,
  TDeps,
>(
  config: CodeExecutionConfig<TFlowCtx, TOutput, TFunctions>,
  contextDescription?: string,
): AiTool<
  TFlowCtx,
  { code: string },
  ExecutionResult<TFlowCtx, TOutput>,
  TDeps
> {
  // Generate the description with function declarations
  const toolDescription = generateExecuteToolDescription(
    config.functions,
    contextDescription,
    config.expose,
  );

  return {
    name: 'execute',
    description: `Execute TypeScript code in a sandboxed environment.

${toolDescription}

Write code that uses the available functions, filesystem, and context to accomplish your task.
Results can be written to files in /output/ or returned through function calls.`,
    parameterSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The TypeScript code to execute',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
    parseParameters: (args: string): Validation<{ code: string }> => {
      try {
        const parsed = JSON.parse(args);
        if (typeof parsed.code === 'string') {
          return { success: true, data: { code: parsed.code } };
        }
        return {
          success: false,
          errors: [{ path: 'code', expected: 'string', value: parsed.code }],
        };
      } catch (e) {
        return {
          success: false,
          errors: [
            {
              message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        };
      }
    },
    execute: async (
      { code },
      ctx: TFlowCtx,
      deps: TDeps,
    ): Promise<
      | { success: true; data: ExecutionResult<TFlowCtx, TOutput> }
      | { success: false; message: string }
    > => {
      try {
        // Use config-level deps if provided, otherwise fall back to flow-level deps.
        // This allows CodeExecutionConfig to carry its own dependencies (e.g., exercise
        // search adapters) independently of the flow's deps type.
        const effectiveDeps = config.deps ? config.deps() : deps;
        const result = await executeCode(code, config, ctx, effectiveDeps);
        // Always return success from the tool's perspective -
        // the execution result itself contains success/failure info
        return { success: true, data: result };
      } catch (e) {
        return {
          success: false,
          message: `Execution error: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
    render: (result: ExecutionResult<TFlowCtx, TOutput>): string => {
      return formatExecutionResult(result);
    },
  };
}

// Outputs
export type AiOutput<
  TName extends string,
  TFlowCtx extends Record<string, unknown>,
  TOutput,
> = {
  key: TName;
  schema: Record<string, unknown>;
  validate: (raw: string) => Validation<TOutput>;
  asContext: () => AiContext<Record<TName, TOutput | null>>;
  asInput: () => AiInput<Record<TName, TOutput | null>>;
  render: (ctx: TFlowCtx, output?: TOutput | null) => string;
  write: (ctx: TFlowCtx, output: TOutput) => void;
};

/**
 * Contract returned by defineAiOutputSchema<T>().
 */
export type AiOutputSchemaDefinition<TOutput> = {
  schema: Record<string, unknown>;
  validate: (raw: string) => Validation<TOutput>;
};

/**
 * Marker helper expanded by build-pack type macros.
 */
export function defineAiOutputSchema<
  TOutput extends Record<string, unknown>,
>(): AiOutputSchemaDefinition<TOutput> {
  throw new Error(
    'defineAiOutputSchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
  );
}

export function createAiOutput<
  TName extends string,
  TFlowCtx extends Record<string, unknown>,
  TOutput,
>(
  key: TName,
  opts: {
    schema: Record<string, unknown>;
    validate: (raw: string) => Validation<TOutput>;
    render: (input: TFlowCtx, output?: TOutput | null) => string;
  },
): AiOutput<TName, TFlowCtx, TOutput> {
  return {
    key,
    schema: opts.schema,
    validate: opts.validate,
    render: opts.render,
    write: (ctx, output) => {
      (ctx as Record<TName, TOutput | null>)[key] = output;
    },
    asContext: () => ({
      key,
      render: (ctx) => opts.render(ctx as TFlowCtx, ctx[key]),
    }),
    asInput: () => ({
      key,
      render: (ctx) => {
        const output = ctx[key];
        if (output === null) {
          return [];
        }
        return [
          {
            role: 'user',
            type: 'message',
            content: opts.render(ctx as TFlowCtx, ctx[key]),
          },
        ];
      },
    }),
  };
}

// Evaluation Stage
export type AiEvaluationStage<
  TFlowCtx extends Record<string, unknown>,
  TEval,
> = {
  name: string;
  model: string;
  verbosity?: OpenAI.Responses.ResponseTextConfig['verbosity'];
  reasoningEffort?: OpenAI.ReasoningEffort;
  reasoningSummary?: OpenAI.Reasoning['summary'];
  serviceTier?: OpenAI.Responses.ResponseCreateParams['service_tier'];
  maxOutputTokens?: OpenAI.Responses.ResponseCreateParams['max_output_tokens'];
  instructions: string | ((ctx: TFlowCtx) => string);
  inputs: (
    ctx: TFlowCtx,
    candidate: unknown,
  ) => AiMessage[] | Promise<AiMessage[]>;
  schema: Record<string, unknown>;
  validate: (raw: string) => Validation<TEval>;
};

export function createEvaluationStage<
  TFlowCtx extends Record<string, unknown>,
  TEval,
>(
  name: string,
  opts: {
    model: string;
    verbosity?: OpenAI.Responses.ResponseTextConfig['verbosity'];
    reasoningEffort?: OpenAI.ReasoningEffort;
    reasoningSummary?: OpenAI.Reasoning['summary'];
    serviceTier?: OpenAI.Responses.ResponseCreateParams['service_tier'];
    maxOutputTokens?: OpenAI.Responses.ResponseCreateParams['max_output_tokens'];
    instructions: string | ((ctx: TFlowCtx) => string);
    inputs: (
      ctx: TFlowCtx,
      candidate: unknown,
    ) => AiMessage[] | Promise<AiMessage[]>;
    schema: Record<string, unknown>;
    validate: (raw: string) => Validation<TEval>;
  },
): AiEvaluationStage<TFlowCtx, TEval> {
  return {
    name,
    model: opts.model,
    verbosity: opts.verbosity,
    reasoningEffort: opts.reasoningEffort,
    reasoningSummary: opts.reasoningSummary,
    serviceTier: opts.serviceTier,
    maxOutputTokens: opts.maxOutputTokens,
    instructions: opts.instructions,
    inputs: opts.inputs,
    schema: opts.schema,
    validate: opts.validate,
  };
}

// Stage definitions
export type OutputStageDef<
  TName extends string,
  TFlowCtx extends Record<string, unknown>,
  TStorage extends Record<string, unknown>,
  TOutput,
  TOutputName extends string,
  TTools extends Record<string, AnyAiTool<TFlowCtx>>,
  TCodeFunctions extends Record<string, CodeFunction<any, any, any>> = Record<
    string,
    never
  >,
  TCodeOutput = unknown,
> = {
  kind: 'output';
  name: TName;
  model: string;
  verbosity?: OpenAI.Responses.ResponseTextConfig['verbosity'];
  reasoningEffort?: OpenAI.ReasoningEffort;
  serviceTier?: OpenAI.Responses.ResponseCreateParams['service_tier'];
  reasoningSummary?: OpenAI.Reasoning['summary'];
  maxOutputTokens?: OpenAI.Responses.ResponseCreateParams['max_output_tokens'];
  maxSteps: number;
  tools: TTools; // Tools are now strongly typed per stage
  context: Record<string, AiContext<TFlowCtx>>;
  instructions: AiPrompt<TFlowCtx>;
  inputs: Record<string, AiInput<TFlowCtx>>;
  output: AiOutput<TOutputName, TFlowCtx, TOutput>;
  storage: () => TStorage;
  toolChoice?:
    | 'auto'
    | 'required'
    | 'none'
    | ((context: {
        turn: number;
        storage: TStorage;
        flowContext: TFlowCtx;
        toolCallsMade: number;
      }) => 'auto' | 'required' | 'none');
  /** Optional code execution configuration - enables execute tool for LLM */
  codeExecution?: CodeExecutionConfig<TFlowCtx, TCodeOutput, TCodeFunctions>;
};

export function createAiOutputStage<
  TName extends string,
  TFlowCtx extends Record<TOutputName, TOutput | null>,
  TStorage extends Record<string, unknown>,
  TOutput,
  TOutputName extends string,
  TTools extends Record<string, AnyAiTool<TFlowCtx>>,
  TCodeFunctions extends Record<string, CodeFunction<any, any, any>> = Record<
    string,
    never
  >,
  TCodeOutput = unknown,
>(
  name: TName,
  def: Omit<
    OutputStageDef<
      TName,
      TFlowCtx,
      TStorage,
      TOutput,
      TOutputName,
      TTools,
      TCodeFunctions,
      TCodeOutput
    >,
    'name' | 'kind'
  >,
): OutputStageDef<
  TName,
  TFlowCtx,
  TStorage,
  TOutput,
  TOutputName,
  TTools,
  TCodeFunctions,
  TCodeOutput
> {
  return { kind: 'output', name, ...def };
}

export type TextStageDef<
  TName extends string,
  TFlowCtx extends Record<string, unknown>,
  TTools extends Record<string, AnyAiTool<TFlowCtx>> = Record<
    string,
    AnyAiTool<TFlowCtx>
  >,
  TCodeFunctions extends Record<string, CodeFunction<any, any, any>> = Record<
    string,
    never
  >,
  TCodeOutput = unknown,
> = {
  kind: 'text-stream';
  name: TName;
  model: string;
  verbosity?: OpenAI.Responses.ResponseTextConfig['verbosity'];
  serviceTier?: OpenAI.Responses.ResponseCreateParams['service_tier'];
  reasoningEffort?: OpenAI.ReasoningEffort;
  reasoningSummary?: OpenAI.Reasoning['summary'];
  maxOutputTokens?: OpenAI.Responses.ResponseCreateParams['max_output_tokens'];
  context: Record<string, AiContext<TFlowCtx>>;
  instructions: AiPrompt<TFlowCtx>;
  inputs: Record<string, AiInput<TFlowCtx>>;
  tools?: TTools;
  toolChoice?:
    | 'auto'
    | 'required'
    | 'none'
    | ((context: {
        turn: number;
        storage: Record<string, unknown>;
        flowContext: TFlowCtx;
        toolCallsMade: number;
      }) => 'auto' | 'required' | 'none');
  /** Optional code execution configuration - enables execute tool for LLM */
  codeExecution?: CodeExecutionConfig<TFlowCtx, TCodeOutput, TCodeFunctions>;
};

export function createAiTextStage<
  TName extends string,
  TFlowCtx extends Record<string, unknown>,
  TTools extends Record<string, AnyAiTool<TFlowCtx>> = Record<
    string,
    AnyAiTool<TFlowCtx>
  >,
  TCodeFunctions extends Record<string, CodeFunction<any, any, any>> = Record<
    string,
    never
  >,
  TCodeOutput = unknown,
>(
  name: TName,
  def: Omit<
    TextStageDef<TName, TFlowCtx, TTools, TCodeFunctions, TCodeOutput>,
    'name' | 'kind'
  >,
): TextStageDef<TName, TFlowCtx, TTools, TCodeFunctions, TCodeOutput> {
  return { kind: 'text-stream', name, ...def };
}

// Helper to extract dependencies from a single tool (standard or custom)
type ExtractToolDeps<T> = T extends AiTool<any, any, any, infer D>
  ? D
  : T extends AiCustomTool<any, any, any, infer D>
    ? D
    : never;

// Helper to merge all tool dependencies in a tools record
type MergeToolDeps<TTools extends Record<string, AnyAiTool<any>>> = {
  [K in keyof TTools]: ExtractToolDeps<TTools[K]>;
}[keyof TTools];

type StageToolDeps<TStage> = TStage extends OutputStageDef<
  any,
  any,
  any,
  any,
  any,
  infer TTools
>
  ? MergeToolDeps<TTools>
  : TStage extends TextStageDef<any, any, infer TTextTools>
    ? MergeToolDeps<TTextTools>
    : never;

type StageCodeExecutionDeps<TStage> = TStage extends OutputStageDef<
  any,
  any,
  any,
  any,
  any,
  any,
  infer TCodeFunctions,
  any
>
  ? ExtractAllFunctionDeps<TCodeFunctions>
  : TStage extends TextStageDef<any, any, any, infer TCodeFunctions, any>
    ? ExtractAllFunctionDeps<TCodeFunctions>
    : never;

// Helper type to extract dependencies from stage tools and code execution
type StageDeps<TStage> = StageToolDeps<TStage> | StageCodeExecutionDeps<TStage>;

// Helper type to extract all dependencies from all stages
type FlowDeps<TDefs extends Record<string, AnyStageDef<any>>> = {
  [K in keyof TDefs]: StageDeps<TDefs[K]>;
}[keyof TDefs] extends never
  ? Record<string, unknown>
  : {
      [K in keyof TDefs]: StageDeps<TDefs[K]>;
    }[keyof TDefs];

// Base dependencies that all flows need
export type DebugDumpConfig = {
  dumpDir?: string;
  dumpFormat?: 'md';
  dumpStages?: 'all' | string[];
};

export type AIDeps<
  TExtraDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  openAI: OpenAI;
  logger: Logger;
  debug?: DebugDumpConfig;
} & TExtraDeps;

/** ai-flow now always replays its own history instead of relying on provider state. */
export function isStatelessProvider(_deps: AIDeps): boolean {
  return true;
}

function cloneAiInputItem(item: AiInputItem): AiInputItem {
  return { ...item };
}

function buildReplayInput<
  TFlowCtx extends Record<string, unknown>,
  TStorage extends Record<string, unknown>,
  TOutput,
>(
  stageSnapShot: StageSnapshot<TFlowCtx, TStorage, TOutput>,
  instructions: string | undefined,
  stageInputItems: AiInputItem[],
): AiInputItem[] {
  if (stageSnapShot.replayHistory.length === 0) {
    stageSnapShot.replayHistory = [
      ...(instructions
        ? ([
            {
              role: 'system' as const,
              type: 'message' as const,
              content: instructions,
            },
          ] satisfies AiInputItem[])
        : []),
      ...stageInputItems.map(cloneAiInputItem),
    ];
  }

  const requestItems = stageSnapShot.replayHistory.map(cloneAiInputItem);
  const ephemeralToolOutputs = stageSnapShot.ephemeralToolOutputs ?? [];
  if (ephemeralToolOutputs.length === 0) {
    return requestItems;
  }

  const overlaysByCallId = new Map<string, string>();
  const overlayOrder: string[] = [];
  for (const overlay of ephemeralToolOutputs) {
    if (!overlaysByCallId.has(overlay.callId)) {
      overlayOrder.push(overlay.callId);
    }
    const existing = overlaysByCallId.get(overlay.callId);
    overlaysByCallId.set(
      overlay.callId,
      existing ? `${existing}\n${overlay.output}` : overlay.output,
    );
  }

  const remaining = new Set(overlayOrder);
  const mergedItems = requestItems.map((item) => {
    if (item.type !== 'function_call_output') {
      return item;
    }
    const overlay = overlaysByCallId.get(item.call_id);
    if (!overlay) {
      return item;
    }
    remaining.delete(item.call_id);
    return {
      ...item,
      output: item.output ? `${item.output}\n${overlay}` : overlay,
    };
  });

  if (remaining.size > 0) {
    for (const callId of overlayOrder) {
      if (!remaining.has(callId)) continue;
      const overlay = overlaysByCallId.get(callId);
      if (!overlay) continue;
      mergedItems.push({
        type: 'function_call_output',
        call_id: callId,
        output: overlay,
      });
    }
  }

  return mergedItems;
}

function appendReplayHistoryItem<
  TFlowCtx extends Record<string, unknown>,
  TStorage extends Record<string, unknown>,
  TOutput,
>(
  stageSnapShot: StageSnapshot<TFlowCtx, TStorage, TOutput>,
  item: AiInputItem,
): void {
  stageSnapShot.replayHistory = [
    ...stageSnapShot.replayHistory,
    cloneAiInputItem(item),
  ];
}

function appendReplayHistoryItems<
  TFlowCtx extends Record<string, unknown>,
  TStorage extends Record<string, unknown>,
  TOutput,
>(
  stageSnapShot: StageSnapshot<TFlowCtx, TStorage, TOutput>,
  items: AiInputItem[],
): void {
  if (items.length === 0) return;
  stageSnapShot.replayHistory = [
    ...stageSnapShot.replayHistory,
    ...items.map(cloneAiInputItem),
  ];
}

function normalizeToolRenderOutput(output: AiToolRenderOutput): {
  renderedOutput: string;
  ephemeralOutput?: string;
} {
  if (typeof output === 'string') {
    return { renderedOutput: output };
  }

  return {
    renderedOutput: output.renderedOutput,
    ephemeralOutput: output.ephemeralOutput,
  };
}

// Tool type helpers
type ToolDataOf<T> = T extends AiTool<any, any, infer D, any>
  ? D
  : T extends AiCustomTool<any, any, infer D, any>
    ? D
    : never;

type ToolDataMap<TTools extends Record<string, AnyAiTool<any>>> = {
  [K in keyof TTools]?: Array<ToolDataOf<TTools[K]>>;
};

type ToolFailuresMap<TTools extends Record<string, AnyAiTool<any>>> = {
  [K in keyof TTools]?: ToolFailure[];
};

// Internal helpers for stage definitions
type AnyOutputStageDef<TFlowCtx extends Record<string, unknown>> =
  OutputStageDef<
    string,
    TFlowCtx,
    any,
    any,
    any,
    Record<string, AnyAiTool<TFlowCtx>>
  >;
type AnyTextStageDef<TFlowCtx extends Record<string, unknown>> = TextStageDef<
  string,
  TFlowCtx,
  Record<string, AnyAiTool<TFlowCtx>>
>;
type AnyStageDef<TFlowCtx extends Record<string, unknown>> =
  | AnyOutputStageDef<TFlowCtx>
  | AnyTextStageDef<TFlowCtx>;

function assertNoExecuteToolConflict(
  stageName: string,
  toolNames: string[],
  hasCodeExecution: boolean,
): void {
  if (!hasCodeExecution) return;
  if (!toolNames.includes('execute')) return;
  throw new Error(
    `Stage "${stageName}" defines a tool named "execute" while codeExecution is enabled. Remove the custom execute tool or disable codeExecution for this stage.`,
  );
}

function formatDiagTimings(
  entries: Array<{
    key: string;
    durationMs: number;
    charCount?: number;
    messageCount?: number;
  }>,
): string {
  if (entries.length === 0) {
    return 'none';
  }
  return entries
    .map((entry) => {
      const extras: string[] = [];
      if (typeof entry.charCount === 'number') {
        extras.push(`${entry.charCount}ch`);
      }
      if (typeof entry.messageCount === 'number') {
        extras.push(`${entry.messageCount}msg`);
      }
      const suffix = extras.length > 0 ? `/${extras.join('/')}` : '';
      return `${entry.key}:${entry.durationMs}ms${suffix}`;
    })
    .join(',');
}

// Unified streaming handler (reasoning + output text + function calls)
async function handleStageStreaming<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
  K extends StageNameOfDefs<TDefs>,
>(
  def:
    | Extract<TDefs[K], OutputStageDef<any, TFlowCtx, any, any, any, any>>
    | AnyTextStageDef<TFlowCtx>,
  stageSnapShot: StageSnapshot<
    TFlowCtx,
    StageStorageOf<TDefs[K]>,
    StageOutputOf<TDefs[K]>
  >,
  common: {
    stage: { name: K };
    flow: {
      name: string;
      flowId: string;
      runId: string;
      context: TFlowCtx;
      storage: StageStorageOf<TDefs[K]>;
      setContext: (fn: (c: TFlowCtx) => TFlowCtx) => void;
      setStorage: (
        fn: (s: StageStorageOf<TDefs[K]>) => StageStorageOf<TDefs[K]>,
      ) => void;
    };
    ctrl: {
      save: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
      stop: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
    };
  },
  deps: AIDeps,
  inputToSend: AiInputItem[],
  toolsDesc: {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: boolean;
  }[],
  instructions: string | undefined,
  toolChoice: 'auto' | 'required' | 'none',
  debugInfo: { basePrompt?: string; contextBlocks?: string[] },
  streamFormat:
    | { type: 'json'; schema: Record<string, unknown>; component: string }
    | { type: 'text'; component: string },
  handler: OnStepHandler<TFlowCtx, TDefs, K>,
  applyReturn: (ret: OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>) => void,
): Promise<FlowSnapshot<TFlowCtx, TDefs>> {
  stageSnapShot.lastOutput = undefined;

  const inputWithInstructions = buildReplayInput(
    stageSnapShot,
    instructions,
    inputToSend,
  );
  if ((stageSnapShot.ephemeralToolOutputs ?? []).length > 0) {
    stageSnapShot.ephemeralToolOutputs = [];
  }

  await dumpStageIfEnabled(deps.debug, {
    flowName: common.flow.name,
    stageName: String(common.stage.name),
    model: def.model,
    runId: common.flow.runId,
    flowId: common.flow.flowId,
    turn: stageSnapShot.turn,
    toolChoice,
    instructions,
    basePrompt: debugInfo.basePrompt,
    contextBlocks: debugInfo.contextBlocks,
    input: inputWithInstructions,
    tools: toolsDesc.map((tool) => tool.name),
  });

  const openaiRequestStartMs = Date.now();
  let openaiFirstTokenMs: number | undefined;

  // Buffer for non-reasoning events
  const bufferedEvents: ResponseStreamEvent[] = [];

  // Track function calls during streaming
  const functionCallItems = new Map<
    string,
    {
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      complete: boolean;
    }
  >();

  let aborted = false;
  let streamEndedWithRecoverableError = false;
  let sawResponseCompleted = false;
  let responseCompletedAtMs: number | undefined;

  for (
    let streamAttempt = 1;
    streamAttempt <= MAX_RECOVERABLE_STREAM_ATTEMPTS;
    streamAttempt += 1
  ) {
    if (stageSnapShot.turn > 0) {
      const inputPreview = inputWithInstructions.map((item) => ({
        type: (item as Record<string, unknown>).type,
        call_id: (item as Record<string, unknown>).call_id,
        outputPreview:
          typeof (item as Record<string, unknown>).output === 'string'
            ? ((item as Record<string, unknown>).output as string).slice(0, 100)
            : undefined,
        role: (item as Record<string, unknown>).role,
        contentPreview:
          typeof (item as Record<string, unknown>).content === 'string'
            ? ((item as Record<string, unknown>).content as string).slice(
                0,
                500,
              )
            : undefined,
      }));
      deps.logger.debug('flow request replay input', {
        flowId: common.flow.flowId,
        runId: common.flow.runId,
        stage: String(common.stage.name),
        turn: stageSnapShot.turn,
        model: def.model,
        inputItems: inputWithInstructions.length,
        inputPreview,
      });
    }
    const stream = deps.openAI.responses.stream({
      model: def.model,
      service_tier: def.serviceTier,
      input: inputWithInstructions,
      tools: toolsDesc,
      tool_choice: toolsDesc.length > 0 ? toolChoice : undefined,
      parallel_tool_calls: true,
      stream: true,
      text:
        streamFormat.type === 'json'
          ? {
              verbosity: def.verbosity,
              format: {
                type: 'json_schema',
                schema: streamFormat.schema,
                name: 'stage_output',
                strict: true,
              },
            }
          : {
              verbosity: def.verbosity,
              format: { type: 'text' },
            },
      reasoning: {
        summary: def.reasoningSummary,
        effort: def.reasoningEffort,
      },
      max_output_tokens: def.maxOutputTokens,
    });

    try {
      for await (const event of stream) {
        if (!openaiFirstTokenMs) {
          openaiFirstTokenMs = Date.now();
        }
        if (aborted) {
          stream.controller.abort();
          break;
        }

        if (event.type === 'response.completed') {
          sawResponseCompleted = true;
          responseCompletedAtMs = Date.now();
        }

        if (event.type === 'response.reasoning_summary_part.done') {
          stageSnapShot.reasoning.summaries.push(event.part.text);
        }

        if (
          event.type === 'response.reasoning_summary_text.delta' ||
          event.type === 'response.reasoning_summary_part.added'
        ) {
          stageSnapShot.reasoning.delta = '';
          if (event.type === 'response.reasoning_summary_part.added') {
            stageSnapShot.reasoning.delta =
              stageSnapShot.reasoning.summaries.length === 0
                ? event.part.text
                : `\n${event.part.text}`;
          } else {
            stageSnapShot.reasoning.delta = event.delta;
          }

          const reasoningStep = {
            kind: 'reasoning' as const,
            context: stageSnapShot.context,
            reasoning: stageSnapShot.reasoning,
            reasoningType:
              event.type === 'response.reasoning_summary_part.added'
                ? 'summary'
                : 'delta',
            next: () => ({ type: 'next' as const }),
            to: (stageName: StageNameOfDefs<TDefs>) => {
              aborted = true;
              return { type: 'to' as const, to: stageName };
            },
          } as StepArgsForStage<TFlowCtx, TDefs[K], StageNameOfDefs<TDefs>>;

          const reasoningArgs = { ...common, step: reasoningStep };
          const ret = await handler(reasoningArgs);
          applyReturn(ret);

          if (ret.type === 'to') {
            aborted = true;
          }
        } else if (
          event.type === 'response.output_item.added' &&
          event.item.type === 'function_call'
        ) {
          if (event.item.id && event.item.call_id && event.item.name) {
            functionCallItems.set(event.item.id, {
              id: event.item.id,
              call_id: event.item.call_id,
              name: event.item.name,
              arguments: '',
              complete: false,
            });
          }
        } else if (event.type === 'response.function_call_arguments.delta') {
          const functionCall = functionCallItems.get(event.item_id);
          if (functionCall && event.delta) {
            functionCall.arguments += event.delta;
          }
        } else if (event.type === 'response.function_call_arguments.done') {
          const functionCall = functionCallItems.get(event.item_id);
          if (functionCall) {
            functionCall.arguments = event.arguments;
          }
        } else if (
          event.type === 'response.output_item.done' &&
          event.item.type === 'function_call'
        ) {
          if (event.item.id) {
            const functionCall = functionCallItems.get(event.item.id);
            if (functionCall) {
              functionCall.complete = true;
              if (event.item.arguments) {
                functionCall.arguments = event.item.arguments;
              }
            }
          }
        } else if (
          streamFormat.type === 'text' &&
          event.type === 'response.output_text.delta'
        ) {
          const delta = event.delta ?? '';

          stageSnapShot.lastOutput =
            `${stageSnapShot.lastOutput || ''}${delta}` as StageOutputOf<
              TDefs[K]
            >;
          const currentText = stageSnapShot.lastOutput as string;

          const streamDeltaArgs = {
            ...common,
            step: {
              kind: 'chunk' as const,
              context: stageSnapShot.context,
              response: { text: currentText, delta },
              next: () => ({ type: 'next' as const }),
              to: (stageName: StageNameOfDefs<TDefs>) => {
                aborted = true;
                return { type: 'to' as const, to: stageName };
              },
              output: {
                accept: (
                  callback: (
                    output: string,
                    ctx: TFlowCtx,
                  ) => {
                    to?: StageNameOfDefs<TDefs>;
                    ctx: TFlowCtx;
                  },
                ) => {
                  aborted = true;
                  const result = callback(currentText, stageSnapShot.context);
                  return {
                    type: 'accept' as const,
                    to: result.to,
                    newContext: result.ctx,
                  };
                },
                reject: (feedback: { text: string }) => {
                  aborted = true;
                  stageSnapShot.lastOutput = undefined;
                  return {
                    type: 'reject' as const,
                    feedback,
                  };
                },
              },
            } as StepArgsForStage<TFlowCtx, TDefs[K], StageNameOfDefs<TDefs>>,
          };
          const ret = await handler(streamDeltaArgs);
          applyReturn(ret);
          if (ret.type === 'to') {
            aborted = true;
          }
        } else {
          bufferedEvents.push(event);
        }
      }
      break;
    } catch (error) {
      const recoverable = isRecoverableResponsesStreamCompatError(error);
      const hasUsefulStreamState =
        openaiFirstTokenMs !== undefined ||
        bufferedEvents.length > 0 ||
        functionCallItems.size > 0 ||
        stageSnapShot.reasoning.summaries.length > 0 ||
        Boolean(stageSnapShot.lastOutput);

      // Log full error details including provider error body
      const errBody = (error as Record<string, unknown>)?.error;
      const errStatus = (error as Record<string, unknown>)?.status;
      const errCode = (error as Record<string, unknown>)?.code;
      const errHeaders = (error as Record<string, unknown>)?.headers;
      const filteredHeaders =
        errHeaders !== null &&
        errHeaders !== undefined &&
        typeof errHeaders === 'object'
          ? Object.fromEntries(
              Object.entries(errHeaders as Record<string, unknown>).filter(
                ([k]) => k.startsWith('x-') || k === 'content-type',
              ),
            )
          : undefined;
      deps.logger.warn('openai stream error', {
        stage: String(common.stage.name),
        model: def.model,
        flowId: common.flow.flowId,
        runId: common.flow.runId,
        attempt: streamAttempt,
        maxAttempts: MAX_RECOVERABLE_STREAM_ATTEMPTS,
        recoverable,
        sawCompleted: sawResponseCompleted,
        completedAfterMs: responseCompletedAtMs
          ? responseCompletedAtMs - openaiRequestStartMs
          : undefined,
        bufferedEvents: bufferedEvents.length,
        functionCalls: functionCallItems.size,
        hasOutput: Boolean(stageSnapShot.lastOutput),
        error: error instanceof Error ? error.message : String(error),
        status: errStatus,
        code: errCode,
        body: errBody,
        headers: filteredHeaders,
      });
      await dumpOpenAIErrorIfEnabled(deps.debug, {
        flowName: common.flow.name,
        stageName: String(common.stage.name),
        model: def.model,
        runId: common.flow.runId,
        flowId: common.flow.flowId,
        turn: stageSnapShot.turn,
        instructions,
        basePrompt: debugInfo.basePrompt,
        contextBlocks: debugInfo.contextBlocks,
        input: inputWithInstructions,
        tools: toolsDesc,
        toolChoice,
        streamFormat,
        reasoning: {
          summary: def.reasoningSummary,
          effort: def.reasoningEffort,
        },
        maxOutputTokens: def.maxOutputTokens ?? undefined,
        recoverable,
        sawCompleted: sawResponseCompleted,
        completedAfterMs: responseCompletedAtMs
          ? responseCompletedAtMs - openaiRequestStartMs
          : undefined,
        bufferedEvents: bufferedEvents.length,
        functionCalls: functionCallItems.size,
        hasOutput: Boolean(stageSnapShot.lastOutput),
        error: error instanceof Error ? error.message : String(error),
      });

      if (recoverable && hasUsefulStreamState) {
        streamEndedWithRecoverableError = true;
        deps.logger.warn('openai stream recoverable error recovery', {
          stage: String(common.stage.name),
          model: def.model,
          flowId: common.flow.flowId,
          runId: common.flow.runId,
          attempt: streamAttempt,
          maxAttempts: MAX_RECOVERABLE_STREAM_ATTEMPTS,
          sawCompleted: sawResponseCompleted,
          completedAfterMs: responseCompletedAtMs
            ? responseCompletedAtMs - openaiRequestStartMs
            : undefined,
          bufferedEvents: bufferedEvents.length,
          functionCalls: functionCallItems.size,
          hasOutput: Boolean(stageSnapShot.lastOutput),
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }

      if (recoverable && streamAttempt < MAX_RECOVERABLE_STREAM_ATTEMPTS) {
        const retryDelayMs = 200 * streamAttempt;
        deps.logger.warn('openai stream retrying recoverable error', {
          stage: String(common.stage.name),
          model: def.model,
          flowId: common.flow.flowId,
          runId: common.flow.runId,
          attempt: streamAttempt,
          nextAttempt: streamAttempt + 1,
          maxAttempts: MAX_RECOVERABLE_STREAM_ATTEMPTS,
          delayMs: retryDelayMs,
          recoverable,
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      throw error;
    }
  }

  const openaiStreamEndMs = Date.now();
  const openaiTotalMs = openaiStreamEndMs - openaiRequestStartMs;
  const openaiTTFT = openaiFirstTokenMs
    ? openaiFirstTokenMs - openaiRequestStartMs
    : openaiTotalMs;
  deps.logger.warn('openai stream completed', {
    stage: String(common.stage.name),
    model: def.model,
    flowId: common.flow.flowId,
    runId: common.flow.runId,
    totalMs: openaiTotalMs,
    ttftMs: openaiTTFT,
    aborted,
    recovered: streamEndedWithRecoverableError,
    sawCompleted: sawResponseCompleted,
    completedAfterMs: responseCompletedAtMs
      ? responseCompletedAtMs - openaiRequestStartMs
      : undefined,
    bufferedEvents: bufferedEvents.length,
    functionCalls: functionCallItems.size,
  });
  if (bufferedEvents.length > 0) {
    const eventTypes = bufferedEvents.map((e) => e.type);
    const textContent = bufferedEvents
      .filter((e) => e.type === 'response.output_text.delta')
      .map((e) => (e as { delta?: string }).delta ?? '')
      .join('');
    deps.logger.debug('openai buffered events', {
      stage: String(common.stage.name),
      model: def.model,
      flowId: common.flow.flowId,
      runId: common.flow.runId,
      eventTypes,
      textContent: textContent.slice(0, 500),
      bufferedEvents: bufferedEvents.length,
    });
  }

  if (aborted) {
    return common.ctrl.save();
  }

  // Extract discovered function calls.
  // We cannot rely only on `complete` because some streams can finish a turn
  // without emitting `response.output_item.done` for every function call item.
  // Missing a call_id here would drop a durable tool exchange from replay history.
  const completedFunctionCalls = Array.from(functionCallItems.values()).filter(
    (fc) =>
      Boolean(fc.call_id && fc.name) &&
      !stageSnapShot.processedFunctionCallIds.includes(fc.call_id),
  );

  // Finalize reasoning state (clear delta; summaries already accumulated)
  stageSnapShot.reasoning = {
    summaries: [...stageSnapShot.reasoning.summaries],
    delta: '',
  };

  if (def.kind === 'output') {
    // Build proposal text from buffered output events
    let proposalRaw = '';
    for (const event of bufferedEvents) {
      if (event.type === 'response.output_text.delta') {
        proposalRaw += event.delta || '';
      }
    }

    if (proposalRaw) {
      return await processOutputProposal(
        def as Extract<
          TDefs[K],
          OutputStageDef<any, TFlowCtx, any, any, any, any>
        >,
        stageSnapShot,
        common,
        deps,
        proposalRaw,
        handler,
        applyReturn,
      );
    }

    if (completedFunctionCalls.length > 0) {
      return await processToolCalls(
        def,
        stageSnapShot,
        common,
        deps,
        completedFunctionCalls,
        handler,
        applyReturn,
      );
    }

    const availableTools = Object.keys(def.tools ?? {});
    appendReplayHistoryItem(stageSnapShot, {
      role: 'user',
      type: 'message',
      content:
        availableTools.length > 0
          ? `Your previous turn produced neither structured JSON nor a tool call. Call one of the available tools first if you still need to act: ${availableTools.join(', ')}. Otherwise return ONLY valid JSON matching the required schema.`
          : 'Your previous turn produced no structured JSON. Return ONLY valid JSON matching the required schema.',
    });
    stageSnapShot.turn += 1;
    return common.ctrl.save();
  }

  // Text stage (free text)
  if (completedFunctionCalls.length > 0) {
    return await processToolCalls(
      def,
      stageSnapShot,
      common,
      deps,
      completedFunctionCalls,
      handler,
      applyReturn,
    );
  }

  return await processTextStageCompletion(
    stageSnapShot as StageSnapshot<TFlowCtx, any, string>,
    common,
    deps,
    handler,
    applyReturn,
  );
}

async function dumpStageIfEnabled(
  debug: DebugDumpConfig | undefined,
  payload: {
    flowName: string;
    stageName: string;
    model: string;
    runId: string;
    flowId: string;
    turn: number;
    toolChoice: string;
    instructions?: string;
    basePrompt?: string;
    contextBlocks?: string[];
    input: AiInputItem[];
    tools: string[];
  },
): Promise<void> {
  if (!debug?.dumpDir) return;
  const stages = debug.dumpStages;
  if (stages && stages !== 'all' && !stages.includes(payload.stageName)) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}-${payload.flowName}-${payload.stageName}.md`;
  const lines: string[] = [];
  lines.push('# ai-flow stage dump');
  lines.push('');
  lines.push(`- flow: ${payload.flowName}`);
  lines.push(`- stage: ${payload.stageName}`);
  lines.push(`- model: ${payload.model}`);
  lines.push(`- runId: ${payload.runId}`);
  lines.push(`- flowId: ${payload.flowId}`);
  lines.push(`- turn: ${payload.turn}`);
  lines.push(`- toolChoice: ${payload.toolChoice}`);
  lines.push(`- tools: ${payload.tools.join(', ') || '(none)'}`);
  lines.push('');
  lines.push('## Instructions');
  lines.push('```text');
  lines.push(payload.instructions ?? '(none)');
  lines.push('```');
  if (payload.basePrompt) {
    lines.push('');
    lines.push('## Base Prompt');
    lines.push('```text');
    lines.push(payload.basePrompt);
    lines.push('```');
  }
  if (payload.contextBlocks?.length) {
    lines.push('');
    lines.push('## Context (rendered)');
    for (const block of payload.contextBlocks) {
      lines.push('```text');
      lines.push(block);
      lines.push('```');
    }
  }
  lines.push('');
  lines.push('## Input');
  if (payload.input.length === 0) {
    lines.push('(none)');
  } else {
    for (const item of payload.input) {
      if (item.type === 'message') {
        lines.push(`### ${item.role}`);
        lines.push('```text');
        lines.push(item.content);
        lines.push('```');
      } else if ('output' in item) {
        lines.push(`### function_call_output (${item.call_id})`);
        lines.push('```text');
        lines.push(item.output);
        lines.push('```');
      }
    }
  }

  try {
    await mkdir(debug.dumpDir, { recursive: true });
    await writeFile(join(debug.dumpDir, fileName), lines.join('\n'), 'utf8');
  } catch {
    // ignore dump failures
  }
}

async function dumpOpenAIErrorIfEnabled(
  debug: DebugDumpConfig | undefined,
  payload: {
    flowName: string;
    stageName: string;
    model: string;
    runId: string;
    flowId: string;
    turn: number;
    instructions?: string;
    basePrompt?: string;
    contextBlocks?: string[];
    input: AiInputItem[];
    tools: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      strict: boolean;
    }[];
    toolChoice: string;
    streamFormat:
      | { type: 'json'; schema: Record<string, unknown>; component: string }
      | { type: 'text'; component: string };
    reasoning: { summary?: string | null; effort?: string | null };
    maxOutputTokens?: number;
    recoverable: boolean;
    sawCompleted: boolean;
    completedAfterMs?: number;
    bufferedEvents: number;
    functionCalls: number;
    hasOutput: boolean;
    error: string;
  },
): Promise<void> {
  if (!debug?.dumpDir) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}-${payload.flowName}-${payload.stageName}-openai-error.json`;
  const body = {
    ...payload,
    inputCount: payload.input.length,
  };

  try {
    await mkdir(debug.dumpDir, { recursive: true });
    await writeFile(
      join(debug.dumpDir, fileName),
      JSON.stringify(body, null, 2),
      'utf8',
    );
  } catch {
    // ignore dump failures
  }
}

function isRecoverableResponsesStreamCompatError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('error reading stream') ||
    message.includes('i/o timeout') ||
    message.includes('failed to drain streaming response body') ||
    message.includes('connection reset') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  );
}

function getStructuredOutputCandidates(raw: string): string[] {
  const candidates = new Set<string>();
  const trimmed = raw.trim();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced) {
    candidates.add(fenced);
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.add(trimmed.slice(objectStart, objectEnd + 1).trim());
  }

  return [...candidates];
}

function tryValidateStructuredOutput<TOutput>(args: {
  validate: (raw: string) => Validation<TOutput>;
  raw: string;
}): Validation<TOutput> {
  let fallbackError: unknown;

  for (const candidate of getStructuredOutputCandidates(args.raw)) {
    try {
      return args.validate(candidate);
    } catch (error) {
      fallbackError = error;
    }
  }

  if (fallbackError instanceof Error) {
    return {
      success: false,
      errors: [{ message: fallbackError.message }],
    };
  }

  return {
    success: false,
    errors: [{ message: 'Invalid JSON format' }],
  };
}

// Helper: process structured proposal for output stages
async function processOutputProposal<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
  K extends StageNameOfDefs<TDefs>,
>(
  def: Extract<TDefs[K], OutputStageDef<any, TFlowCtx, any, any, any, any>>,
  stageSnapShot: StageSnapshot<
    TFlowCtx,
    StageStorageOf<TDefs[K]>,
    StageOutputOf<TDefs[K]>
  >,
  common: {
    stage: { name: K };
    flow: {
      name: string;
      flowId: string;
      runId: string;
      context: TFlowCtx;
      storage: StageStorageOf<TDefs[K]>;
      setContext: (fn: (c: TFlowCtx) => TFlowCtx) => void;
      setStorage: (
        fn: (s: StageStorageOf<TDefs[K]>) => StageStorageOf<TDefs[K]>,
      ) => void;
    };
    ctrl: {
      save: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
      stop: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
    };
  },
  deps: AIDeps,
  proposalRaw: string,
  handler: OnStepHandler<TFlowCtx, TDefs, K>,
  applyReturn: (ret: OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>) => void,
): Promise<FlowSnapshot<TFlowCtx, TDefs>> {
  if (proposalRaw) {
    // Process structured output (same logic as original handleStage)
    const validated = tryValidateStructuredOutput({
      validate: def.output.validate,
      raw: proposalRaw,
    });

    if (!validated.success) {
      const errorMessage =
        validated.errors
          ?.map(
            (e) =>
              `${e.path ? `${e.path}: ` : ''}${e.message || `found ${e.value} but expected (${e.expected})`}`,
          )
          .join('\n') || 'Invalid JSON format';

      const validationFeedback: AiInputItem = {
        role: 'user',
        type: 'message',
        content: `Your previous JSON did not satisfy the required schema.
        Please correct and return ONLY valid JSON.
        Validation errors:\n${errorMessage}`,
      };

      appendReplayHistoryItem(stageSnapShot, validationFeedback);
      stageSnapShot.turn += 1;

      const emptyToolData = {} as ToolDataMap<ToolsOfStage<TFlowCtx, TDefs[K]>>;
      const emptyToolFailures = {} as ToolFailuresMap<
        ToolsOfStage<TFlowCtx, TDefs[K]>
      >;

      // We shouldn't need a tool call to recover from an error here
      const toolStep = {
        kind: 'tool',
        context: stageSnapShot.context,
        toolData: emptyToolData,
        toolFailures: emptyToolFailures,
        next: () => ({
          type: 'next' as const,
        }),
        nextContext: (callback: (ctx: TFlowCtx) => TFlowCtx) => ({
          type: 'next' as const,
          newContext: callback(stageSnapShot.context),
        }),
        to: (stageName: StageNameOfDefs<TDefs>) => ({
          type: 'to' as const,
          to: stageName,
        }),
      } as StepArgsForStage<TFlowCtx, TDefs[K], StageNameOfDefs<TDefs>>;

      const toolArgs = { ...common, step: toolStep };
      const ret = await handler(toolArgs);
      applyReturn(ret);
      return common.ctrl.save();
    }

    // Valid output - proceed with acceptance
    def.output.write(stageSnapShot.context, validated.data);
    const typedOutput = validated.data as StageOutputOf<TDefs[K]>;
    stageSnapShot.lastOutput = typedOutput;
    stageSnapShot.outputs = [...(stageSnapShot.outputs ?? []), typedOutput];
    appendReplayHistoryItem(stageSnapShot, {
      role: 'assistant',
      type: 'message',
      content: proposalRaw,
    });

    const outputStep = {
      kind: 'output',
      context: stageSnapShot.context,
      response: typedOutput,
      output: {
        evaluate: async <TEval>(
          evalStage: AiEvaluationStage<TFlowCtx, TEval>,
        ) => {
          // Same evaluation logic as original handleStage
          const instructions =
            typeof evalStage.instructions === 'function'
              ? evalStage.instructions(stageSnapShot.context)
              : evalStage.instructions;
          const candidateMsg: AiMessage = {
            role: 'user',
            type: 'message',
            content: `Candidate JSON to evaluate:\n${proposalRaw}`,
          };
          const evalInputs = await evalStage.inputs(
            stageSnapShot.context,
            validated.data,
          );
          // Move instructions to input if present (for Grok compatibility)
          const evalInputWithInstructions = instructions
            ? [
                {
                  role: 'system' as const,
                  type: 'message' as const,
                  content: instructions,
                },
                ...evalInputs,
                candidateMsg,
              ]
            : [...evalInputs, candidateMsg];

          await dumpStageIfEnabled(deps.debug, {
            flowName: common.flow.name,
            stageName: `eval:${evalStage.name}`,
            model: evalStage.model,
            runId: common.flow.runId,
            flowId: common.flow.flowId,
            turn: stageSnapShot.turn,
            toolChoice: 'none',
            instructions,
            basePrompt: instructions,
            contextBlocks: undefined,
            input: evalInputWithInstructions,
            tools: [],
          });

          const resp = await deps.openAI.responses.create({
            model: evalStage.model,
            service_tier: evalStage.serviceTier,
            input: evalInputWithInstructions,
            tools: [],
            text: {
              verbosity: evalStage.verbosity,
              format: {
                type: 'json_schema',
                schema: evalStage.schema,
                name: 'eval',
                strict: true,
              },
            },
            // metadata: {
            //   component: 'ai-flow-evaluation',
            //   flowId: common.flow.flowId,
            //   runId: common.flow.runId,
            //   stage: `evaluate-${evalStage.name}`,
            //   flow: common.flow.name,
            //   evaluation: 'true',
            // },
            reasoning: {
              summary: evalStage.reasoningSummary ?? 'auto',
              effort: evalStage.reasoningEffort,
            },
            max_output_tokens: evalStage.maxOutputTokens,
          });
          const raw = resp?.output_text ?? '';
          const v = evalStage.validate(raw);
          return v.success ? v.data : null;
        },
        accept: (
          callback: (
            output: StageOutputOf<TDefs[K]>,
            ctx: TFlowCtx,
          ) => { to?: StageNameOfDefs<TDefs>; ctx: TFlowCtx },
        ) => {
          const result = callback(typedOutput, stageSnapShot.context);
          return {
            type: 'accept' as const,
            to: result.to,
            newContext: result.ctx,
          };
        },
        reject: (feedback: { text: string }) => ({
          type: 'reject' as const,
          feedback,
        }),
      },
      to: (stageName: StageNameOfDefs<TDefs>) => ({
        type: 'to' as const,
        to: stageName,
      }),
    } as StepArgsForStage<TFlowCtx, TDefs[K], StageNameOfDefs<TDefs>>;

    const outputArgs = { ...common, step: outputStep };
    const ret = await handler(outputArgs);
    applyReturn(ret);
    return common.ctrl.save();
  }

  // If no output, continue to next turn
  stageSnapShot.turn += 1;
  return common.ctrl.save();
}

// Helper: process finalization of a text stage (no extra buffering logic)
async function processTextStageCompletion<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
  K extends StageNameOfDefs<TDefs>,
>(
  stageSnapShot: StageSnapshot<TFlowCtx, StageStorageOf<TDefs[K]>, string>,
  common: {
    stage: { name: K };
    flow: {
      name: string;
      flowId: string;
      runId: string;
      context: TFlowCtx;
      storage: StageStorageOf<TDefs[K]>;
      setContext: (fn: (c: TFlowCtx) => TFlowCtx) => void;
      setStorage: (
        fn: (s: StageStorageOf<TDefs[K]>) => StageStorageOf<TDefs[K]>,
      ) => void;
    };
    ctrl: {
      save: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
      stop: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
    };
  },
  _deps: AIDeps,
  handler: OnStepHandler<TFlowCtx, TDefs, K>,
  applyReturn: (ret: OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>) => void,
): Promise<FlowSnapshot<TFlowCtx, TDefs>> {
  // No tool calls: use the active transcript and emit final step
  stageSnapShot.outputs.push(stageSnapShot.lastOutput || '');
  appendReplayHistoryItem(stageSnapShot, {
    role: 'assistant',
    type: 'message',
    content: stageSnapShot.lastOutput || '',
  });
  const streamFinalArgs = {
    ...common,
    step: {
      kind: 'text' as const,
      context: stageSnapShot.context,
      response: { text: stageSnapShot.lastOutput },
      next: () => ({
        type: 'next' as const,
      }),
      to: (stageName: StageNameOfDefs<TDefs>) => ({
        type: 'to' as const,
        to: stageName,
      }),
      output: {
        accept: (
          callback: (
            output: string,
            ctx: TFlowCtx,
          ) => {
            to?: StageNameOfDefs<TDefs>;
            ctx: TFlowCtx;
          },
        ) => {
          const result = callback(
            stageSnapShot.lastOutput || '',
            stageSnapShot.context,
          );
          return {
            type: 'accept' as const,
            to: result.to,
            newContext: result.ctx,
          };
        },
        reject: (feedback: { text: string }) => {
          stageSnapShot.lastOutput = undefined;
          return {
            type: 'reject' as const,
            feedback,
          };
        },
      },
    } as StepArgsForStage<TFlowCtx, TDefs[K], StageNameOfDefs<TDefs>>,
  };
  const ret = await handler(streamFinalArgs);
  applyReturn(ret);
  return common.ctrl.save();
}

// Helper: shared tool-call processing for both output and text stages
async function processToolCalls<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
  K extends StageNameOfDefs<TDefs>,
>(
  def:
    | Extract<TDefs[K], OutputStageDef<any, TFlowCtx, any, any, any, any>>
    | AnyTextStageDef<TFlowCtx>,
  stageSnapShot: StageSnapshot<
    TFlowCtx,
    StageStorageOf<TDefs[K]>,
    StageOutputOf<TDefs[K]>
  >,
  common: {
    stage: { name: K };
    flow: {
      name: string;
      flowId: string;
      runId: string;
      context: TFlowCtx;
      storage: StageStorageOf<TDefs[K]>;
      setContext: (fn: (c: TFlowCtx) => TFlowCtx) => void;
      setStorage: (
        fn: (s: StageStorageOf<TDefs[K]>) => StageStorageOf<TDefs[K]>,
      ) => void;
    };
    ctrl: {
      save: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
      stop: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
    };
  },
  deps: AIDeps,
  functionCalls: Array<{
    id: string;
    call_id: string;
    name: string;
    arguments: string;
    complete: boolean;
  }>,
  handler: OnStepHandler<TFlowCtx, TDefs, K>,
  applyReturn: (ret: OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>) => void,
): Promise<FlowSnapshot<TFlowCtx, TDefs>> {
  const toolDataRaw: Record<string, unknown[]> = {};
  const toolFailuresRaw: Record<string, ToolFailure[]> = {};

  stageSnapShot.processedFunctionCallIds.push(
    ...functionCalls.map((functionCall) => functionCall.call_id),
  );

  type ToolCallResult = {
    toolKeyStr: string;
    toolOutput: AiInputItem;
    toolData?: unknown;
    toolFailure?: ToolFailure;
    ephemeralOutput?: string;
  };

  const toolResults = await Promise.all(
    functionCalls.map(async (functionCall): Promise<ToolCallResult> => {
      const toolName = functionCall.name;
      const callId = functionCall.call_id;
      const rawArgs = functionCall.arguments;

      type StageTools = ToolsOfStage<TFlowCtx, TDefs[K]>;
      const entries = Object.entries((def.tools ?? {}) as StageTools) as [
        keyof StageTools,
        StageTools[keyof StageTools],
      ][];
      const found = entries.find(([, t]) => t.name === toolName);

      const isExecuteTool =
        !found && toolName === 'execute' && def.codeExecution;
      const executeTool = isExecuteTool
        ? createExecuteTool(def.codeExecution!)
        : undefined;

      const toolKey = isExecuteTool
        ? ('execute' as keyof StageTools)
        : ((found?.[0] as keyof StageTools | undefined) ??
          (toolName as keyof StageTools));
      const toolKeyStr = String(toolKey);
      const tool: AnyAiTool<TFlowCtx> | undefined = isExecuteTool
        ? executeTool
        : (found?.[1] as AnyAiTool<TFlowCtx> | undefined);

      if (!tool) {
        return {
          toolKeyStr,
          toolFailure: {
            toolName,
            callId,
            reason: 'Unknown tool',
          },
          toolOutput: {
            type: 'function_call_output',
            call_id: callId,
            output: 'Failed: Unknown tool',
          },
        };
      }

      const isCustomTool = 'kind' in tool && tool.kind === 'custom';
      let customToolInput = rawArgs;
      if (isCustomTool) {
        try {
          const wrapper = JSON.parse(rawArgs);
          if (
            typeof wrapper === 'object' &&
            wrapper !== null &&
            'input' in wrapper
          ) {
            customToolInput = String(wrapper.input);
          }
        } catch {
          // If JSON parse fails, pass rawArgs as-is
        }
      }

      const parsed = isCustomTool
        ? (tool as AiCustomTool<TFlowCtx, any, any, any>).parseInput(
            customToolInput,
          )
        : (tool as AiTool<TFlowCtx, any, any, any>).parseParameters(rawArgs);
      if (!parsed.success) {
        const errorMessage = isCustomTool
          ? (parsed as { error?: string }).error || 'Invalid input'
          : (
              parsed as {
                errors?: Array<{
                  path?: string;
                  message?: string;
                  value?: unknown;
                  expected?: string;
                }>;
              }
            ).errors
              ?.map(
                (e) =>
                  `${e.path ? `${e.path}: ` : ''}${e.message || `found ${e.value} but expected (${e.expected})`}`,
              )
              .join('\n') || 'Invalid parameter format';

        return {
          toolKeyStr,
          toolFailure: {
            toolName,
            callId,
            reason: `Parse failure: ${errorMessage}`,
          },
          toolOutput: {
            type: 'function_call_output',
            call_id: callId,
            output: `Failed: ${isCustomTool ? errorMessage : `Invalid parameters.\nParameter validation errors:\n${errorMessage}`}`,
          },
        };
      }

      try {
        const exec = await tool.execute(
          parsed.data,
          stageSnapShot.context,
          deps,
        );
        if (exec.success) {
          const rendered = normalizeToolRenderOutput(tool.render(exec.data));
          deps.logger.debug('tool execution succeeded', {
            flowId: common.flow.flowId,
            runId: common.flow.runId,
            stage: String(common.stage.name),
            tool: toolName,
            callId,
            renderedLength: rendered.renderedOutput.length,
            renderedPreview: rendered.renderedOutput.slice(0, 200),
          });
          return {
            toolKeyStr,
            toolData: exec.data,
            ephemeralOutput: rendered.ephemeralOutput,
            toolOutput: {
              type: 'function_call_output',
              call_id: callId,
              output: rendered.renderedOutput,
            },
          };
        }

        return {
          toolKeyStr,
          toolFailure: {
            toolName,
            callId,
            reason: `Execution failed: ${exec.success ? 'Unknown error' : exec.message}`,
          },
          toolOutput: {
            type: 'function_call_output',
            call_id: callId,
            output: `Failed: ${exec.success ? 'Unknown error' : exec.message}`,
          },
        };
      } catch (e: unknown) {
        deps.logger.warn('tool execution threw', {
          flowId: common.flow.flowId,
          runId: common.flow.runId,
          stage: String(common.stage.name),
          tool: toolName,
          callId,
          error: e instanceof Error ? e.message : String(e),
        });
        return {
          toolKeyStr,
          toolFailure: {
            toolName,
            callId,
            reason: `Execution error: ${e instanceof Error ? e.message : String(e)}`,
          },
          toolOutput: {
            type: 'function_call_output',
            call_id: callId,
            output: `Failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
    }),
  );

  const toolHistoryItems: AiInputItem[] = [];
  const ephemeralToolOutputs: EphemeralToolOutput[] = [];
  for (let index = 0; index < functionCalls.length; index += 1) {
    const functionCall = functionCalls[index];
    const result = toolResults[index];
    if (!functionCall || !result) {
      continue;
    }
    if (result.toolData !== undefined) {
      if (toolDataRaw[result.toolKeyStr] === undefined) {
        toolDataRaw[result.toolKeyStr] = [];
      }
      const toolDataItems = toolDataRaw[result.toolKeyStr];
      toolDataItems?.push(result.toolData);
    }
    if (result.toolFailure) {
      if (!toolFailuresRaw[result.toolKeyStr]) {
        toolFailuresRaw[result.toolKeyStr] = [];
      }
      const toolFailureItems = toolFailuresRaw[result.toolKeyStr];
      toolFailureItems?.push(result.toolFailure);
    }
    if (functionCall.call_id && functionCall.name) {
      toolHistoryItems.push({
        type: 'function_call' as const,
        id: functionCall.id,
        call_id: functionCall.call_id,
        name: functionCall.name,
        arguments: functionCall.arguments,
      });
      toolHistoryItems.push(result.toolOutput);
      if (result.ephemeralOutput) {
        ephemeralToolOutputs.push({
          callId: functionCall.call_id,
          output: result.ephemeralOutput,
        });
      }
    }
  }

  appendReplayHistoryItems(stageSnapShot, toolHistoryItems);
  stageSnapShot.ephemeralToolOutputs = ephemeralToolOutputs;
  stageSnapShot.turn += 1;

  const toolData = toolDataRaw as ToolDataMap<ToolsOfStage<TFlowCtx, TDefs[K]>>;
  const toolFailures = toolFailuresRaw as ToolFailuresMap<
    ToolsOfStage<TFlowCtx, TDefs[K]>
  >;

  const toolStep = {
    kind: 'tool',
    context: stageSnapShot.context,
    toolData,
    toolFailures,
    next: () => ({
      type: 'next' as const,
    }),
    nextContext: (callback: (ctx: TFlowCtx) => TFlowCtx) => ({
      type: 'next' as const,
      newContext: callback(stageSnapShot.context),
    }),
    to: (stageName: StageNameOfDefs<TDefs>) => ({
      type: 'to' as const,
      to: stageName,
    }),
  } as StepArgsForStage<TFlowCtx, TDefs[K], StageNameOfDefs<TDefs>>;

  const toolArgs = { ...common, step: toolStep };
  const ret = await handler(toolArgs);
  applyReturn(ret);
  return common.ctrl.save();
}

// Top-level stage handlers
async function handleOutputStage<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
  K extends StageNameOfDefs<TDefs>,
>(
  def: Extract<TDefs[K], OutputStageDef<any, TFlowCtx, any, any, any, any>>,
  stageSnapShot: StageSnapshot<
    TFlowCtx,
    StageStorageOf<TDefs[K]>,
    StageOutputOf<TDefs[K]>
  >,
  common: {
    stage: { name: K };
    flow: {
      name: string;
      flowId: string;
      runId: string;
      context: TFlowCtx;
      storage: StageStorageOf<TDefs[K]>;
      setContext: (fn: (c: TFlowCtx) => TFlowCtx) => void;
      setStorage: (
        fn: (s: StageStorageOf<TDefs[K]>) => StageStorageOf<TDefs[K]>,
      ) => void;
    };
    ctrl: {
      save: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
      stop: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
    };
  },
  deps: AIDeps,
  inputMsgs: AiMessage[],
  toolsDesc: {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: boolean;
  }[],
  instructions: string | undefined,
  debugInfo: { basePrompt?: string; contextBlocks?: string[] },
  handler: OnStepHandler<TFlowCtx, TDefs, K>,
  applyReturn: (ret: OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>) => void,
): Promise<FlowSnapshot<TFlowCtx, TDefs>> {
  const inputToSend = inputMsgs;

  // Evaluate tool_choice based on stage configuration and current state
  let toolChoice: 'auto' | 'required' | 'none' = 'auto';
  if (def.toolChoice) {
    if (typeof def.toolChoice === 'function') {
      // Count how many tool calls have been made across all turns
      const toolCallsMade = stageSnapShot.processedFunctionCallIds.length;
      toolChoice = def.toolChoice({
        turn: stageSnapShot.turn,
        storage: stageSnapShot.storage,
        flowContext: stageSnapShot.context,
        toolCallsMade,
      });
    } else {
      toolChoice = def.toolChoice;
    }
  }

  return await handleStageStreaming(
    def,
    stageSnapShot,
    common,
    deps,
    inputToSend,
    toolsDesc,
    instructions,
    toolChoice,
    debugInfo,
    {
      type: 'json',
      schema: def.output.schema,
      component: 'ai-flow-output-stream',
    },
    handler,
    applyReturn,
  );
}

async function handleTextStreamStage<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
  K extends StageNameOfDefs<TDefs>,
>(
  def: AnyTextStageDef<TFlowCtx>,
  stageSnapShot: StageSnapshot<TFlowCtx, StageStorageOf<TDefs[K]>, string>,
  common: {
    stage: { name: K };
    flow: {
      name: string;
      flowId: string;
      runId: string;
      context: TFlowCtx;
      storage: StageStorageOf<TDefs[K]>;
      setContext: (fn: (c: TFlowCtx) => TFlowCtx) => void;
      setStorage: (
        fn: (s: StageStorageOf<TDefs[K]>) => StageStorageOf<TDefs[K]>,
      ) => void;
    };
    ctrl: {
      save: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
      stop: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
    };
  },
  deps: AIDeps,
  inputMsgs: AiMessage[],
  toolsDesc: {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: boolean;
  }[],
  toolChoice: 'auto' | 'required' | 'none',
  instructions: string | undefined,
  debugInfo: { basePrompt?: string; contextBlocks?: string[] },
  handler: OnStepHandler<TFlowCtx, TDefs, K>,
  applyReturn: (ret: OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>) => void,
): Promise<FlowSnapshot<TFlowCtx, TDefs>> {
  // Streaming: forward deltas to onStep; require accept() on final
  const inputToSend = inputMsgs;

  return await handleStageStreaming(
    def,
    stageSnapShot as StageSnapshot<
      TFlowCtx,
      StageStorageOf<TDefs[K]>,
      StageOutputOf<TDefs[K]>
    >,
    common,
    deps,
    inputToSend,
    toolsDesc,
    instructions,
    toolChoice,
    debugInfo,
    { type: 'text', component: 'ai-flow-text-stream' },
    handler,
    applyReturn,
  );
}

// Orchestration
export type OnStepReturn<
  TStages extends string,
  TFlowCtx extends Record<string, unknown>,
> =
  | { type: 'next'; newContext?: TFlowCtx }
  | { type: 'to'; to: TStages }
  | { type: 'accept'; to?: TStages; newContext: TFlowCtx }
  | {
      type: 'reject';
      feedback: { text: string };
    };

type ReasoningStepArgs<
  TFlowCtx extends Record<string, unknown>,
  TStages extends string,
> = {
  kind: 'reasoning';
  reasoningType: 'delta' | 'summary';
  context: TFlowCtx;
  reasoning: StageReasoning;
  next: () => OnStepReturn<TStages, TFlowCtx>;
  to: (stageName: TStages) => OnStepReturn<TStages, TFlowCtx>;
};

type StepArgsForStage<
  TFlowCtx extends Record<string, unknown>,
  TStage,
  TStages extends string,
> = TStage extends OutputStageDef<any, TFlowCtx, any, any, any, infer _Tools>
  ?
      | ReasoningStepArgs<TFlowCtx, TStages>
      | {
          kind: 'tool';
          context: TFlowCtx;
          toolData: ToolDataMap<ToolsOfStage<TFlowCtx, TStage>>;
          toolFailures: ToolFailuresMap<ToolsOfStage<TFlowCtx, TStage>>;
          next: () => OnStepReturn<TStages, TFlowCtx>;
          nextContext: (
            callback: (ctx: TFlowCtx) => TFlowCtx,
          ) => OnStepReturn<TStages, TFlowCtx>;
          to: (stageName: TStages) => OnStepReturn<TStages, TFlowCtx>;
        }
      | {
          kind: 'output';
          context: TFlowCtx;
          response: StageOutputOf<TStage>;
          output: {
            evaluate: <TEval>(
              evalStage: AiEvaluationStage<TFlowCtx, TEval>,
            ) => Promise<TEval | null>;
            accept: (
              callback: (
                output: StageOutputOf<TStage>,
                ctx: TFlowCtx,
              ) => {
                to?: TStages;
                ctx: TFlowCtx;
              },
            ) => OnStepReturn<TStages, TFlowCtx>;
            reject: (feedback: {
              text: string;
            }) => OnStepReturn<TStages, TFlowCtx>;
          };
          to: (stageName: TStages) => OnStepReturn<TStages, TFlowCtx>;
        }
  :
      | {
          kind: 'chunk';
          context: TFlowCtx;
          response: { text: string; delta: string };
          next: () => OnStepReturn<TStages, TFlowCtx>;
          to: (stageName: TStages) => OnStepReturn<TStages, TFlowCtx>;
          output: {
            accept: (
              callback: (
                output: string,
                ctx: TFlowCtx,
              ) => {
                to?: TStages;
                ctx: TFlowCtx;
              },
            ) => OnStepReturn<TStages, TFlowCtx>;
            reject: (feedback: {
              text: string;
            }) => OnStepReturn<TStages, TFlowCtx>;
          };
        }
      | {
          kind: 'tool';
          context: TFlowCtx;
          toolData: ToolDataMap<ToolsOfStage<TFlowCtx, TStage>>;
          toolFailures: ToolFailuresMap<ToolsOfStage<TFlowCtx, TStage>>;
          next: () => OnStepReturn<TStages, TFlowCtx>;
          nextContext: (
            callback: (ctx: TFlowCtx) => TFlowCtx,
          ) => OnStepReturn<TStages, TFlowCtx>;
          to: (stageName: TStages) => OnStepReturn<TStages, TFlowCtx>;
        }
      | {
          kind: 'text';
          context: TFlowCtx;
          response: { text: string };
          next: () => OnStepReturn<TStages, TFlowCtx>;
          to: (stageName: TStages) => OnStepReturn<TStages, TFlowCtx>;
          output: {
            accept: (
              callback: (
                output: string,
                ctx: TFlowCtx,
              ) => {
                to?: TStages;
                ctx: TFlowCtx;
              },
            ) => OnStepReturn<TStages, TFlowCtx>;
            reject: (feedback: {
              text: string;
            }) => OnStepReturn<TStages, TFlowCtx>;
          };
        }
      | ReasoningStepArgs<TFlowCtx, TStages>;

export type OnStepHandler<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
  K extends StageNameOfDefs<TDefs> = StageNameOfDefs<TDefs>,
> = (args: {
  stage: { name: K };
  flow: {
    context: TFlowCtx;
    storage: StageStorageOf<TDefs[K]>;
    setContext: (fn: (c: TFlowCtx) => TFlowCtx) => void;
    setStorage: (
      fn: (s: StageStorageOf<TDefs[K]>) => StageStorageOf<TDefs[K]>,
    ) => void;
  };
  ctrl: {
    save: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
    stop: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
  };
  step: StepArgsForStage<TFlowCtx, TDefs[K], StageNameOfDefs<TDefs>>;
}) =>
  | OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>
  | Promise<OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>>;

export type FlowRun<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
> = {
  onStep: <K extends StageNameOfDefs<TDefs>>(
    stage: K,
    handler: OnStepHandler<TFlowCtx, TDefs, K>,
  ) => FlowRun<TFlowCtx, TDefs>;
  step: () => Promise<FlowSnapshot<TFlowCtx, TDefs>>;
  complete: () => Promise<
    | { status: 'completed'; snapshot: FlowSnapshot<TFlowCtx, TDefs> }
    | { status: 'stopped'; snapshot: FlowSnapshot<TFlowCtx, TDefs> }
    | {
        status: 'error';
        snapshot: FlowSnapshot<TFlowCtx, TDefs>;
        error: unknown;
      }
  >;
  snapshot: () => FlowSnapshot<TFlowCtx, TDefs>;
};

export type FlowBuilder<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
> = {
  onStep: <K extends StageNameOfDefs<TDefs>>(
    stage: K,
    handler: OnStepHandler<TFlowCtx, TDefs, K>,
  ) => FlowBuilder<TFlowCtx, TDefs>;
  start: (init: {
    flow: TFlowCtx;
    firstStage: StageNameOfDefs<TDefs>;
    deps: AIDeps<FlowDeps<TDefs>>;
  }) => FlowRun<TFlowCtx, TDefs>;
  resume: (
    snap: FlowSnapshot<TFlowCtx, TDefs>,
    deps: AIDeps<FlowDeps<TDefs>>,
  ) => FlowRun<TFlowCtx, TDefs>;
};

// TODO: // we are not required to check all stages
export function createAiFlow<
  TFlowCtx extends Record<string, unknown>,
  TDefs extends Record<string, AnyStageDef<TFlowCtx>>,
>(name: string, _opts: { stages: TDefs }): FlowBuilder<TFlowCtx, TDefs> {
  const handlers = new Map<
    StageNameOfDefs<TDefs>,
    OnStepHandler<TFlowCtx, TDefs>
  >();
  const defs = new Map<StageNameOfDefs<TDefs>, AnyStageDef<TFlowCtx>>(
    Object.entries(_opts.stages) as [
      StageNameOfDefs<TDefs>,
      AnyStageDef<TFlowCtx>,
    ][],
  );

  function buildRun(
    initial: FlowSnapshot<TFlowCtx, TDefs>,
    deps: AIDeps<FlowDeps<TDefs>>,
  ): FlowRun<TFlowCtx, TDefs> {
    const snap = initial;
    let stopped = false;
    let completed = false;

    function ensureStageSnapshot<K extends StageNameOfDefs<TDefs>>(name: K) {
      const existing = snap.stages[name] as
        | StageSnapshot<
            TFlowCtx,
            StageStorageOf<TDefs[K]>,
            StageOutputOf<TDefs[K]>
          >
        | undefined;
      if (existing) return existing;

      // Get the stage definition and initialize storage
      const stageDef = defs.get(name);
      const initialStorage =
        stageDef?.kind === 'output'
          ? stageDef.storage()
          : ({} as StageStorageOf<TDefs[K]>);

      const fresh: StageSnapshot<
        TFlowCtx,
        StageStorageOf<TDefs[K]>,
        StageOutputOf<TDefs[K]>
      > = {
        stageName: name,
        turn: 0,
        completed: false,
        replayHistory: [],
        ephemeralToolOutputs: [],
        context: { ...snap.flowContext },
        storage: initialStorage,
        lastOutput: undefined,
        outputs: [],
        reasoning: { summaries: [], delta: '' },
        processedFunctionCallIds: [],
        updatedAt: new Date().toISOString(),
      };
      // cast is safe due to the mapped type on FlowSnapshot.stages
      snap.stages[name] = fresh;
      return fresh;
    }

    function applyReturn(ret: OnStepReturn<StageNameOfDefs<TDefs>, TFlowCtx>) {
      const curStage = snap.currentStage as StageNameOfDefs<TDefs>;
      const stageStateSnapshot = ensureStageSnapshot(curStage);

      if (ret.type === 'next') {
        if (ret.newContext) {
          snap.flowContext = ret.newContext;
          stageStateSnapshot.context = ret.newContext;
        }
        snap.history.push({
          stageName: curStage,
          turn: stageStateSnapshot.turn,
          status: 'continued',
          at: new Date().toISOString(),
        });
        snap.updatedAt = new Date().toISOString();
        return;
      }
      if (ret.type === 'to') {
        snap.currentStage = ret.to;
        snap.history.push({
          stageName: curStage,
          turn: stageStateSnapshot.turn,
          status: 'continued',
          at: new Date().toISOString(),
        });
        snap.updatedAt = new Date().toISOString();
        return;
      }
      if (ret.type === 'accept') {
        stageStateSnapshot.completed = true;

        // Update context
        snap.flowContext = ret.newContext;

        snap.history.push({
          stageName: curStage,
          turn: stageStateSnapshot.turn,
          status: 'completed',
          at: new Date().toISOString(),
        });
        if (ret.to) {
          snap.currentStage = ret.to;
        } else {
          completed = true;
        }
        snap.updatedAt = new Date().toISOString();
        return;
      }
      if (ret.type === 'reject') {
        appendReplayHistoryItem(stageStateSnapshot, {
          role: 'user',
          type: 'message',
          content: `Feedback: ${ret.feedback.text}`,
        });
        stageStateSnapshot.turn += 1;
        snap.history.push({
          stageName: curStage,
          turn: stageStateSnapshot.turn,
          status: 'continued',
          at: new Date().toISOString(),
        });
        snap.updatedAt = new Date().toISOString();
        return;
      }
    }

    const run: FlowRun<TFlowCtx, TDefs> = {
      onStep: (stage, handler) => {
        handlers.set(stage, handler as OnStepHandler<TFlowCtx, TDefs>);
        return run;
      },
      step: async () => {
        if (stopped || completed) return snap;
        const stageName = snap.currentStage as StageNameOfDefs<TDefs>;
        const handler = handlers.get(stageName) as
          | OnStepHandler<TFlowCtx, TDefs, typeof stageName>
          | undefined;
        if (!handler) return snap;

        const stageSnapShot = ensureStageSnapshot(stageName);
        stageSnapShot.context = snap.flowContext;
        const common = {
          stage: { name: stageName },
          flow: {
            name,
            runId: snap.runId,
            flowId: snap.flowId,
            context: snap.flowContext,
            storage: stageSnapShot.storage,
            setContext: (fn: (c: TFlowCtx) => TFlowCtx) => {
              snap.flowContext = fn(snap.flowContext);
            },
            setStorage: (fn: (s: any) => any) => {
              stageSnapShot.storage = fn(stageSnapShot.storage);
            },
          },
          ctrl: {
            save: async () => ({ ...snap }),
            stop: async () => {
              stopped = true;
              return { ...snap };
            },
          },
        } as const;

        const currentStage = defs.get(stageName);
        if (!currentStage) return snap;

        // Compose instructions and inputs once per stage. Follow-up turns continue
        // from replay history plus any next-turn tool output overlays.
        const renderStartMs = Date.now();
        let instructions: string | undefined;
        let basePrompt: string | undefined;
        let contextBlocks: string[] = [];
        let instructionRenderMs = 0;
        let contextRenderMs = 0;
        let inputRenderMs = 0;
        const contextRenderTimings: Array<{
          key: string;
          durationMs: number;
          charCount: number;
        }> = [];
        const inputRenderTimings: Array<{
          key: string;
          durationMs: number;
          charCount: number;
          messageCount: number;
        }> = [];
        const shouldRenderStageContext =
          stageSnapShot.replayHistory.length === 0;
        if (shouldRenderStageContext) {
          const instructionStartMs = Date.now();
          basePrompt = currentStage.instructions.render(stageSnapShot.context);
          instructionRenderMs = Date.now() - instructionStartMs;
          const renderedContext = Object.values(currentStage.context ?? {});
          const appended: string[] = [];
          for (const c of renderedContext) {
            try {
              const contextStartMs = Date.now();
              const s = await c.render(stageSnapShot.context);
              const durationMs = Date.now() - contextStartMs;
              contextRenderMs += durationMs;
              contextRenderTimings.push({
                key: c.key,
                durationMs,
                charCount: s.length,
              });
              if (s) appended.push(s);
            } catch (err) {
              console.warn(
                '[DIAG:flow] context renderer failed key=%s error=%s',
                c.key,
                err instanceof Error ? err.message : String(err),
              );
            }
          }
          contextBlocks = appended;
          instructions = appended.length
            ? `${basePrompt}\n${appended.join('\n')}`
            : basePrompt;
        }
        const inputMsgs: AiMessage[] = [];
        if (shouldRenderStageContext) {
          const inputDefs = Object.values(currentStage.inputs ?? {});
          for (const id of inputDefs) {
            try {
              const inputStartMs = Date.now();
              const r = await id.render(stageSnapShot.context);
              const durationMs = Date.now() - inputStartMs;
              const charCount = r.reduce(
                (sum, msg) => sum + msg.content.length,
                0,
              );
              inputRenderMs += durationMs;
              inputRenderTimings.push({
                key: id.key,
                durationMs,
                charCount,
                messageCount: r.length,
              });
              inputMsgs.push(...r);
            } catch (err) {
              console.warn(
                '[DIAG:flow] input renderer failed key=%s error=%s',
                id.key,
                err instanceof Error ? err.message : String(err),
              );
            }
          }
        }
        const renderTotalMs = Date.now() - renderStartMs;
        const contextChars = contextBlocks.reduce(
          (sum, block) => sum + block.length,
          0,
        );
        const inputChars = inputMsgs.reduce(
          (sum, msg) => sum + msg.content.length,
          0,
        );
        const totalRenderedChars = contextChars + inputChars;
        const estimatedTokens = Math.ceil(totalRenderedChars / 4);
        deps.logger.debug('ai stage render timings', {
          flowId: common.flow.flowId,
          runId: common.flow.runId,
          stage: String(stageName),
          turn: stageSnapShot.turn,
          renderStageContext: shouldRenderStageContext,
          inputMsgs: inputMsgs.length,
          contextBlocks: contextBlocks.length,
          contextChars,
          inputChars,
          estimatedTokens,
          totalMs: renderTotalMs,
          instructionRenderMs,
          contextRenderMs,
          inputRenderMs,
          contextBreakdown: formatDiagTimings(contextRenderTimings),
          inputBreakdown: formatDiagTimings(inputRenderTimings),
        });
        if (estimatedTokens > 250_000) {
          deps.logger.warn('context budget exceeded', {
            flowId: common.flow.flowId,
            runId: common.flow.runId,
            stage: String(stageName),
            estimatedTokens,
            safeLimit: 250_000,
          });
        }

        // Use discriminated union on 'kind' to distinguish AnyStageDef vs AnyStreamDef
        if (currentStage.kind === 'output') {
          // Build tools descriptors from def.tools (filter only for stages with tools)
          const toolEntries = Object.values(
            (currentStage.kind === 'output' ? currentStage.tools : {}) ?? {},
          );
          assertNoExecuteToolConflict(
            String(stageName),
            toolEntries.map((tool) => tool.name),
            Boolean(currentStage.codeExecution),
          );
          const toolsDesc = toolEntries.map((t) =>
            'kind' in t && t.kind === 'custom'
              ? customToolToFunctionDescriptor(
                  t as AiCustomTool<any, any, any, any>,
                )
              : {
                  type: 'function' as const,
                  name: t.name,
                  description: t.description,
                  parameters: (t as AiTool<any, any, any, any>).parameterSchema,
                  strict: true,
                },
          );

          // Add execute tool if codeExecution is configured
          if (currentStage.codeExecution) {
            const executeTool = createExecuteTool(currentStage.codeExecution);
            toolsDesc.push({
              type: 'function' as const,
              name: executeTool.name,
              description: executeTool.description,
              parameters: executeTool.parameterSchema,
              strict: true,
            });
          }

          // Debug: log tool descriptors being sent
          deps.logger.debug('flow tools descriptors', {
            stage: String(stageName),
            toolCount: toolsDesc.length,
            tools: toolsDesc.map((t) => ({
              name: t.name,
              type: t.type,
              hasParams: !!t.parameters,
              paramKeys: t.parameters
                ? Object.keys(t.parameters as Record<string, unknown>)
                : [],
            })),
          });

          // currentStage narrowed to AnyStageDef - delegate to handleOutputStage
          return await handleOutputStage(
            currentStage as Extract<
              TDefs[typeof stageName],
              OutputStageDef<any, TFlowCtx, any, any, any, any>
            >,
            stageSnapShot,
            common,
            deps as AIDeps,
            inputMsgs,
            toolsDesc,
            instructions,
            { basePrompt, contextBlocks },
            handler,
            applyReturn,
          );
        }
        // currentStage narrowed to AnyStreamDef - delegate to handleStreamStage
        // Build tools descriptors for text stages (optional)
        const toolEntries = Object.values(
          (currentStage.kind === 'text-stream' ? currentStage.tools : {}) ?? {},
        );
        assertNoExecuteToolConflict(
          String(stageName),
          toolEntries.map((tool) => tool.name),
          Boolean(currentStage.codeExecution),
        );
        const toolsDesc = toolEntries.map((t) =>
          'kind' in t && t.kind === 'custom'
            ? customToolToFunctionDescriptor(
                t as AiCustomTool<any, any, any, any>,
              )
            : {
                type: 'function' as const,
                name: t.name,
                description: t.description,
                parameters: (t as AiTool<any, any, any, any>).parameterSchema,
                strict: true,
              },
        );

        // Add execute tool if codeExecution is configured
        if (currentStage.codeExecution) {
          const executeTool = createExecuteTool(currentStage.codeExecution);
          toolsDesc.push({
            type: 'function' as const,
            name: executeTool.name,
            description: executeTool.description,
            parameters: executeTool.parameterSchema,
            strict: true,
          });
        }

        // Evaluate tool_choice based on stage configuration and current state
        let toolChoice: 'auto' | 'required' | 'none' = 'auto';
        if (currentStage.kind === 'text-stream' && currentStage.toolChoice) {
          if (typeof currentStage.toolChoice === 'function') {
            const toolCallsMade = stageSnapShot.processedFunctionCallIds.length;
            toolChoice = currentStage.toolChoice({
              turn: stageSnapShot.turn,
              storage: stageSnapShot.storage as Record<string, unknown>,
              flowContext: stageSnapShot.context,
              toolCallsMade,
            });
          } else {
            toolChoice = currentStage.toolChoice;
          }
        }

        return await handleTextStreamStage(
          currentStage,
          stageSnapShot as StageSnapshot<
            TFlowCtx,
            StageStorageOf<TDefs[typeof stageName]>,
            string
          >,
          common,
          deps as AIDeps,
          inputMsgs,
          toolsDesc,
          toolChoice,
          instructions,
          { basePrompt, contextBlocks },
          handler,
          applyReturn,
        );
      },
      complete: async () => {
        let guard = 0;
        while (!stopped && !completed && guard < 100_000) {
          await run.step();
          guard++;
        }
        if (completed)
          return {
            status: 'completed',
            snapshot: snap,
          } as const;
        return { status: 'stopped', snapshot: snap } as const;
      },
      snapshot: () => snap,
    };
    return run;
  }

  const builder: FlowBuilder<TFlowCtx, TDefs> = {
    onStep: (stage, handler) => {
      handlers.set(stage, handler as OnStepHandler<TFlowCtx, TDefs>);
      return builder;
    },
    start: (init) => {
      const now = new Date().toISOString();
      const initial: FlowSnapshot<TFlowCtx, TDefs> = {
        version: 1,
        flowId: cryptoRandomId(),
        runId: cryptoRandomId(),
        createdAt: now,
        updatedAt: now,
        currentStage: init.firstStage,
        flowContext: init.flow,
        stages: {},
        history: [],
      };
      return buildRun(initial, init.deps);
    },
    resume: (snap, deps) => buildRun(snap, deps),
  };

  return builder;
}

function cryptoRandomId(): string {
  // Simple, readable ID (not cryptographically strong – sufficient for scaffold/testing)
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
