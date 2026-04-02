import type { Logger } from '@inkibra/logger';
import type OpenAI from 'openai';
import type { IValidation } from 'typia/lib';

// Base type for all AI flow contexts
type BaseAIFlowContext = {
  generationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
};

// Generic type for tool parameters
type BaseToolCallParameter = {
  reasoningMessage: string;
};

type ToolSuccess<TContext extends Record<string, unknown>> = {
  success: true;
  context: TContext;
  message: string;
};

// Error result helper
type ToolError<TContext extends Record<string, unknown>> = {
  success: false;
  context: TContext;
  message: string;
};

// Union type for tool results
type ToolResult<TContext extends Record<string, unknown>> =
  | ToolSuccess<TContext>
  | ToolError<TContext>;

// Helper functions for creating results
export const aiFlowToolSuccess = <TContext extends Record<string, unknown>>(
  context: TContext,
  message: string,
): ToolSuccess<TContext> => ({
  success: true,
  context,
  message,
});

export const aiFlowToolError = <TContext extends Record<string, unknown>>(
  context: TContext,
  message: string,
): ToolError<TContext> => ({
  success: false,
  context,
  message,
});

// Generic type for a tool definition
type AIFlowTool<
  TContext extends Record<string, unknown>,
  TParams extends BaseToolCallParameter,
  TDeps = unknown,
> = {
  // Tool description for OpenAI
  toolDescription: OpenAI.Chat.Completions.ChatCompletionFunctionTool;

  // Parameter type guard function
  parseParameters: (args: string) => IValidation<TParams>;

  // Execute function that processes the tool call
  execute: (
    params: TParams,
    context: TContext,
    deps: TDeps,
  ) => Promise<ToolResult<TContext>>;
};

// Tool creation options
type CreateToolOptions<
  TContext extends Record<string, unknown>,
  TParams extends BaseToolCallParameter,
  TDeps = unknown,
> = {
  /** Tool name for OpenAI function calling */
  name: string;

  /** Description of what the tool does */
  description: string;

  /** JSON schema for the tool parameters */
  parameterSchema: Record<string, unknown>;

  /** Function to validate and parse parameters from JSON string */
  parseParameters: (args: string) => IValidation<TParams>;

  /** The core tool logic */
  execute: (
    params: TParams,
    context: TContext,
    deps: TDeps,
  ) => Promise<ToolResult<TContext>>;

  /** Whether to use strict mode for OpenAI function calling (default: true) */
  strict?: boolean;
};

export function createAiFlowTool<
  TContext extends Record<string, unknown>,
  TParams extends BaseToolCallParameter,
  TDeps = unknown,
>(
  options: CreateToolOptions<TContext, TParams, TDeps>,
): AIFlowTool<TContext, TParams, TDeps> {
  const {
    name,
    description,
    parameterSchema,
    parseParameters,
    execute,
    strict = true,
  } = options;

  return {
    toolDescription: {
      type: 'function',
      function: {
        name,
        description,
        strict,
        parameters: parameterSchema,
      },
    },
    parseParameters,
    execute,
  };
}

type AnyParameterTool<
  TContext extends Record<string, unknown>,
  TDeps,
  // biome-ignore lint/suspicious/noExplicitAny: for internal use
> = AIFlowTool<TContext, any, TDeps>;

// Named context part definition
type NamedContextPart<TContext extends BaseAIFlowContext> = {
  render: (
    context: TContext,
  ) =>
    | OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    | Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]>;
};

// Configuration for AI flow processor
type AIFlowConfig<
  TContext extends BaseAIFlowContext,
  TContextParts extends string,
> = {
  renderDefaultPrompt: (context: TContext) => string;

  // Named context parts that can be activated
  context: Record<TContextParts, NamedContextPart<TContext>>;

  // OpenAI model to use
  model: string;

  // Metadata for the OpenAI call
  metadata?: Record<string, string>;

  maxSteps: number;
};

// Response from an LLM tool execution
type ToolCallResponse<TContext extends BaseAIFlowContext> = {
  context: TContext;
  response: OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
  reasoningMessage: string;
};

// Helper function to process tool calls from LLM
async function processToolCall<
  TContext extends BaseAIFlowContext,
  TDeps extends { logger: Logger },
>(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
  context: TContext,
  tools: Record<string, AnyParameterTool<TContext, TDeps>>,
  deps: TDeps,
): Promise<ToolCallResponse<TContext>> {
  const toolName = toolCall.function.name;
  const tool = tools[toolName];

  if (!tool) {
    deps.logger.warn(`Unknown tool: ${toolName}`);
    return {
      context,
      response: {
        role: 'tool',
        content: `Unknown tool: ${toolName}`,
        tool_call_id: toolCall.id,
      },
      reasoningMessage: 'The assistant encountered an unknown tool.',
    };
  }

  const parameterValidation = tool.parseParameters(toolCall.function.arguments);
  if (!parameterValidation.success) {
    const errorMessage = parameterValidation.errors
      .map(
        (error) =>
          `${error.path} found ${error.value} but expected (${error.expected})`,
      )
      .join('\n');
    deps.logger.warn(
      '(processToolCall) Failed to parse call parameters for tool',
      {
        toolName,
        errorMessage,
      },
    );
    return {
      context,
      response: {
        role: 'tool',
        content: `Failed to parse call parameters for tool: ${toolName}. ${errorMessage}`,
        tool_call_id: toolCall.id,
      },
      reasoningMessage: `Failed to parse call parameters for tool: ${toolName}. ${errorMessage}`,
    };
  }

  const executeResult = await tool.execute(
    parameterValidation.data,
    context,
    deps,
  );

  const messagePrefix = executeResult.success
    ? 'Tool call completed.'
    : 'Tool call failed.';
  return {
    context: executeResult.context,
    response: {
      role: 'tool',
      content: `${messagePrefix} ${executeResult.message}`,
      tool_call_id: toolCall.id,
    },
    reasoningMessage: `${messagePrefix}: ${parameterValidation.data.reasoningMessage}`,
  };
}

// Query the LLM for the next action
async function queryLLMForNextStep<
  TContext extends BaseAIFlowContext,
  TDeps,
  TContextParts extends string,
  TConfig extends AIFlowConfig<TContext, TContextParts>,
>(
  context: TContext,
  systemMessage: string,
  activatedContextParts: TContextParts[],
  config: TConfig,
  tools: AnyParameterTool<TContext, TDeps>[],
  deps: {
    openAI: OpenAI;
    logger: Logger;
  },
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  try {
    const toolDescriptions = tools.map((tool) => tool.toolDescription);

    // Render activated context parts
    const contextMessages = await Promise.all(
      activatedContextParts.map(async (partName) => {
        const contextPart = config.context[partName];
        if (!contextPart) {
          deps.logger.warn(`Unknown context part: ${partName}`);
          return [];
        }
        try {
          return await contextPart.render(context);
        } catch (error) {
          deps.logger.error(`Error rendering context part: ${partName}`, error);
          return [];
        }
      }),
    );

    const completion = await deps.openAI.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: systemMessage,
        },
        ...contextMessages.flat(),
        ...context.generationHistory,
      ],
      tools: toolDescriptions,
      metadata: {
        component: 'inkibra-ai-flow-processor',
        ...config.metadata,
      },
      tool_choice: 'required',
    });

    const message = completion.choices.at(0)?.message;
    if (!message) {
      throw new Error('No message returned from LLM');
    }

    return message;
  } catch (error) {
    deps.logger.error('Error querying LLM for next step', error);
    throw error;
  }
}

// Execute LLM responses and tool calls
async function respondToLLM<
  TContext extends BaseAIFlowContext,
  TDeps extends { logger: Logger },
>(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
  context: TContext,
  tools: Record<string, AnyParameterTool<TContext, TDeps>>,
  deps: TDeps,
): Promise<{
  context: TContext;
  responses: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  reasoningMessages: string[];
}> {
  if (message.tool_calls === undefined || message.tool_calls.length === 0) {
    return {
      context,
      responses: [message],
      reasoningMessages: [],
    };
  }

  // Handle all tool calls
  let updatedContext = { ...context };
  const responses: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const reasoningMessages: string[] = [];

  for (const toolCall of message.tool_calls) {
    if (toolCall.type !== 'function') {
      deps.logger.warn(`Unknown tool call type: ${toolCall.type}`);
      continue;
    }
    try {
      const result = await processToolCall<TContext, TDeps>(
        toolCall,
        updatedContext,
        tools,
        deps,
      );
      updatedContext = result.context;
      responses.push(result.response);
      if (result.reasoningMessage) {
        reasoningMessages.push(result.reasoningMessage);
      }
    } catch (error: unknown) {
      deps.logger.error(`Error processing tool call ${toolCall.id}`, error);
      responses.push({
        role: 'tool',
        content: `Error processing tool call: ${error instanceof Error ? error.message : 'Unknown error'}`,
        tool_call_id: toolCall.id,
      });
    }
  }

  return {
    context: updatedContext,
    responses,
    reasoningMessages,
  };
}
type ToolContextMapping<
  TFullContext extends Record<string, unknown>,
  TSubsetContext extends Record<string, unknown>,
> = {
  // Extract the subset from full context
  extract: (fullContext: TFullContext) => TSubsetContext;
  // Merge the updated subset back into full context
  merge: (
    fullContext: TFullContext,
    subsetContext: TSubsetContext,
  ) => TFullContext;
};

type ActivateToolFunction<TContext extends BaseAIFlowContext, TDeps> = {
  // Subset tool with context mapping (new usage)
  <TSubsetContext extends Record<string, unknown>>(
    tool: AnyParameterTool<TSubsetContext, TDeps>,
    contextMapping: ToolContextMapping<TContext, TSubsetContext>,
  ): void;
};

type ActivateContextFunction<TContextParts extends string> = {
  (contextPartName: TContextParts): void;
};

// Discriminated union for AI flow processor states
type AIFlowProcessorState<
  TContext extends BaseAIFlowContext,
  TDeps,
  TContextParts extends string,
> = {
  context: TContext;
  activateTool: ActivateToolFunction<TContext, TDeps>;
  activateContext: ActivateContextFunction<TContextParts>;
  addPrompt: (prompt: string) => void;
  lastReasoningMessages: string[];
};

// Generic AI flow processor generator
export async function* aiFlowProcessor<
  TContext extends BaseAIFlowContext,
  TDeps extends { logger: Logger; openAI: OpenAI },
  TConfig extends AIFlowConfig<TContext, any>,
>(
  initialContext: TContext,
  config: TConfig,
  deps: TDeps,
): AsyncGenerator<
  AIFlowProcessorState<TContext, TDeps, keyof TConfig['context'] & string>,
  void,
  unknown
> {
  // Initialize context
  let context = initialContext;
  let calls = 0;

  let lastReasoningMessages: string[] = [];

  // Main processing loop
  while (calls < config.maxSteps) {
    const activatedTools = new Set<AnyParameterTool<TContext, TDeps>>();
    const activatedContextParts = new Set<keyof TConfig['context'] & string>();
    let systemMessage = config.renderDefaultPrompt(context);

    yield {
      context,
      activateTool: (tool, contextMapping) => {
        const adaptedTool: AnyParameterTool<TContext, TDeps> = {
          ...tool,
          execute: async (params, fullContext, deps) => {
            const subsetContext = contextMapping.extract(fullContext);
            const result = await tool.execute(params, subsetContext, deps);
            const mergedContext = contextMapping.merge(
              fullContext,
              result.context,
            );
            return {
              ...result,
              context: mergedContext,
            };
          },
        };
        activatedTools.add(adaptedTool);
      },
      activateContext: (contextPartName: keyof TConfig['context'] & string) => {
        activatedContextParts.add(contextPartName);
      },
      addPrompt: (prompt: string) => {
        systemMessage = `${systemMessage}\n\n${prompt}`;
      },
      lastReasoningMessages,
    };

    // Query LLM for next action
    const message = await queryLLMForNextStep<
      TContext,
      TDeps,
      keyof TConfig['context'] & string,
      TConfig
    >(
      context,
      systemMessage,
      Array.from(activatedContextParts),
      config,
      Array.from(activatedTools),
      deps,
    );

    // Add LLM's response to conversation history
    context = {
      ...context,
      generationHistory: [...context.generationHistory, message],
    };

    // Execute the tool call
    try {
      const {
        context: updatedContext,
        responses,
        reasoningMessages,
      } = await respondToLLM<TContext, TDeps>(
        message,
        context,
        Object.fromEntries(
          Array.from(activatedTools).map((tool) => [
            tool.toolDescription.function.name,
            tool,
          ]),
        ),
        deps,
      );

      // Consider adding last reasoning messages to the context
      lastReasoningMessages = reasoningMessages;

      // Add the tool call results to conversation history
      context = {
        ...updatedContext,
        generationHistory: [...context.generationHistory, ...responses],
      };

      calls++;
      deps.logger.trace('(aiFlowProcessor) Call', {
        calls,
        maxSteps: config.maxSteps,
        reasoningMessages,
      });
    } catch (error) {
      deps.logger.error('Error executing tool call', { error, message });
    }
  }

  deps.logger.trace('(aiFlowProcessor) Returning final context');

  // Return final context
  return;
}
