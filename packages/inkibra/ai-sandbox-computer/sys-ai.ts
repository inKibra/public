/**
 * sys/ai — Lightweight LLM SDK available inside preview code.
 *
 * Provides extract, search, and generate functions with budget limits
 * and model presets configured by the developer.
 *
 * See spec §15 tier 2.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiModelPreset = 'fast' | 'thinking' | 'default';

export type AiExtractOptions = {
  model?: AiModelPreset;
};

export type AiSearchOptions = {
  model?: AiModelPreset;
};

export type SearchResult = {
  title: string;
  snippet: string;
  url?: string;
};

export type AiGenerateOptions = {
  model?: AiModelPreset;
  maxTokens?: number;
};

export type AiSdkConfig = {
  /** Model mapping: preset → actual model ID */
  models?: Record<AiModelPreset, string>;
  /** Max tokens budget per impulse for sys/ai calls */
  budgetPerImpulse?: number;
  /** Actual LLM call implementation. If not provided, calls throw. */
  provider?: AiProvider;
};

export type AiProvider = {
  generate: (args: {
    model: string;
    prompt: string;
    maxTokens?: number;
  }) => Promise<string>;
};

export type AiSdk = {
  extract: <T>(
    text: string,
    schema: unknown,
    options?: AiExtractOptions,
  ) => Promise<T>;
  search: (query: string, options?: AiSearchOptions) => Promise<SearchResult[]>;
  generate: (prompt: string, options?: AiGenerateOptions) => Promise<string>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<AiModelPreset, string> = {
  fast: 'gpt-4o-mini',
  thinking: 'o3-mini',
  default: 'gpt-4o-mini',
};

/**
 * Create the sys/ai SDK instance for use inside preview code.
 */
export function createAiSdk(config: AiSdkConfig = {}): AiSdk {
  const models = { ...DEFAULT_MODELS, ...config.models };
  const budget = config.budgetPerImpulse ?? 5000;
  let tokensUsed = 0;

  function resolveModel(preset?: AiModelPreset): string {
    return models[preset ?? 'default'];
  }

  function checkBudget(estimatedTokens: number): void {
    if (tokensUsed + estimatedTokens > budget) {
      throw new Error(
        `sys/ai budget exceeded: used ${tokensUsed}/${budget} tokens. ` +
          `Requested ${estimatedTokens} more.`,
      );
    }
  }

  async function callProvider(
    model: string,
    prompt: string,
    maxTokens?: number,
  ): Promise<string> {
    if (!config.provider) {
      throw new Error(
        'sys/ai: no LLM provider configured. ' +
          'The developer must provide a provider via AiSdkConfig.',
      );
    }
    const estimated = maxTokens ?? 500;
    checkBudget(estimated);
    const result = await config.provider.generate({ model, prompt, maxTokens });
    tokensUsed += estimated;
    return result;
  }

  return {
    async extract<T>(
      text: string,
      schema: unknown,
      options?: AiExtractOptions,
    ): Promise<T> {
      const model = resolveModel(options?.model);
      const prompt = `Extract structured data from the following text according to the schema.\n\nSchema: ${JSON.stringify(schema)}\n\nText: ${text}\n\nReturn valid JSON only.`;
      const result = await callProvider(model, prompt, 500);
      try {
        return JSON.parse(result) as T;
      } catch {
        throw new Error(
          `sys/ai.extract: failed to parse LLM response as JSON: ${result.slice(0, 200)}`,
        );
      }
    },

    async search(
      query: string,
      options?: AiSearchOptions,
    ): Promise<SearchResult[]> {
      const model = resolveModel(options?.model);
      const prompt = `Research the following topic and return results as a JSON array of objects with "title", "snippet", and optional "url" fields.\n\nQuery: ${query}\n\nReturn valid JSON array only.`;
      const result = await callProvider(model, prompt, 1000);
      try {
        const parsed = JSON.parse(result);
        return Array.isArray(parsed)
          ? (parsed as SearchResult[])
          : [{ title: query, snippet: result }];
      } catch {
        return [{ title: query, snippet: result }];
      }
    },

    async generate(
      prompt: string,
      options?: AiGenerateOptions,
    ): Promise<string> {
      const model = resolveModel(options?.model);
      return callProvider(model, prompt, options?.maxTokens);
    },
  };
}
