import type OpenAI from 'openai';
import { createAiTool, type Validation } from '../flow';

export type WebSearchResult = {
  query: string;
  output: string;
};

export type WebSearchToolOptions = {
  model?: string;
  searchContextSize?: 'low' | 'medium' | 'high';
  verbosity?: OpenAI.Responses.ResponseTextConfig['verbosity'];
  reasoningEffort?: OpenAI.ReasoningEffort;
  reasoningSummary?: OpenAI.Reasoning['summary'];
  serviceTier?: OpenAI.Responses.ResponseCreateParams['service_tier'];
  maxOutputTokens?: OpenAI.Responses.ResponseCreateParams['max_output_tokens'];
};

export function createWebSearchTool<
  TFlowCtx extends Record<string, unknown>,
  TDeps extends { openAI: OpenAI },
>(options: WebSearchToolOptions = {}) {
  return createAiTool<TFlowCtx, { query: string }, WebSearchResult, TDeps>(
    'web_search',
    {
      description: 'Search the web for information and return a brief summary.',
      parameterSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      parseParameters: (raw): Validation<{ query: string }> => {
        try {
          const parsed = JSON.parse(raw) as { query?: string };
          if (parsed && typeof parsed.query === 'string') {
            return { success: true, data: { query: parsed.query } };
          }
          return {
            success: false,
            errors: [
              { path: 'query', expected: 'string', value: parsed.query },
            ],
          };
        } catch (error) {
          return {
            success: false,
            errors: [
              {
                message:
                  error instanceof Error ? error.message : 'Invalid JSON',
              },
            ],
          };
        }
      },
      execute: async ({ query }, _ctx, deps) => {
        try {
          const response = await deps.openAI.responses.create({
            model: options.model ?? 'gpt-5.4',
            service_tier: options.serviceTier,
            input: [
              {
                role: 'user',
                type: 'message',
                content: query,
              },
            ],
            tools: [
              {
                type: 'web_search',
                search_context_size: options.searchContextSize ?? 'low',
              },
            ],
            text: {
              verbosity: options.verbosity,
              format: { type: 'text' },
            },
            reasoning: {
              summary: options.reasoningSummary,
              effort: options.reasoningEffort,
            },
            max_output_tokens: options.maxOutputTokens,
          });
          return {
            success: true,
            data: {
              query,
              output: response.output_text ?? '',
            },
          };
        } catch (error) {
          return {
            success: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
      render: (result) => result.output || '(no results)',
    },
  );
}
