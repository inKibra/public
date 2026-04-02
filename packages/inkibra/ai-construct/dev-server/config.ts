/**
 * Dev-server configuration.
 *
 * Mirrors the relevant subset of INKIBRA_WEB_ENV for running constructs.
 * Does NOT import from recordless.web — these are standalone types.
 *
 * Config can be loaded from:
 *   1. AI_CONSTRUCT_DEV_ENV (JSON env var, like INKIBRA_WEB_ENV)
 *   2. INKIBRA_WEB_ENV (extracts ai + dragonfly sections)
 *   3. Sensible defaults (PGlite, localhost Redis, Kimi model)
 *
 * The API key comes from INKIBRA_WEB_ENV.ai.apiKey (set by pulumi env).
 * Run: pulumi env run inkibra/02-inkibra-web/local -- bun dev-server/server.ts
 */

// ---------------------------------------------------------------------------
// Config types (mirrored from recordless.web/config.ts)
// ---------------------------------------------------------------------------

export type DevServerAIConfig = {
  /** OpenAI-compatible API base URL (e.g. https://openrouter.ai/api/v1) */
  baseURL: string;
  /** API key for the AI provider */
  apiKey: string;
  /** Model routing configuration */
  models: DevServerAIModelConfig;
  /** Response evaluation mode */
  responseEvalMode?: 'on' | 'advisory-only' | 'off';
};

export type DevServerAIModelStageSettings = {
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxOutputTokens?: number;
};

export type DevServerAIModelConfig = {
  defaults: DevServerAIModelStageSettings & { model: string };
  stages?: Record<string, DevServerAIModelStageSettings>;
};

export type DevServerDragonflyConfig = {
  host: string;
  port: number;
  prefix?: string;
};

export type DevServerDatabaseConfig = {
  /** PostgreSQL connection URL. If absent, PGlite is used. */
  url?: string;
};

export type DevServerConfig = {
  port: number;
  ai: DevServerAIConfig;
  dragonfly: DevServerDragonflyConfig;
  database: DevServerDatabaseConfig;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'moonshotai/kimi-k2.5';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_PORT = 4200;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Normalize model name — strip `openrouter/` prefix if present.
 * Matches recordless.web's `normalizeOpenRouterModelName()`.
 */
function normalizeModelName(model: string): string {
  return model.replace(/^openrouter\//, '');
}

/**
 * Load dev-server config from environment.
 *
 * Priority:
 *   1. AI_CONSTRUCT_DEV_ENV — full JSON config (dedicated dev-server env var)
 *   2. INKIBRA_WEB_ENV — extracts ai + dragonfly from the web config
 *   3. Defaults (no API key — LLM calls will fail)
 */
export function loadDevServerConfig(): DevServerConfig {
  // Try full JSON config first
  const jsonEnv = process.env.AI_CONSTRUCT_DEV_ENV;
  if (jsonEnv) {
    try {
      const parsed = JSON.parse(jsonEnv) as Partial<DevServerConfig>;
      return mergeWithDefaults(parsed);
    } catch {
      console.warn(
        'AI_CONSTRUCT_DEV_ENV is set but not valid JSON, falling back',
      );
    }
  }

  // Extract from INKIBRA_WEB_ENV (set by pulumi env run)
  const webEnv = process.env.INKIBRA_WEB_ENV;
  if (webEnv) {
    try {
      const parsed = JSON.parse(webEnv) as Record<string, unknown>;
      return extractFromWebEnv(parsed);
    } catch {
      // Not valid JSON, continue to defaults
    }
  }

  // Defaults only — no API key
  return buildDefaults();
}

function extractFromWebEnv(
  webConfig: Record<string, unknown>,
): DevServerConfig {
  const ai = webConfig.ai as
    | { baseURL?: string; apiKey?: string; models?: DevServerAIModelConfig }
    | undefined;
  const dragonfly = webConfig.dragonfly as
    | { host?: string; port?: number; prefix?: string }
    | undefined;

  // Also check legacy openAI.apiKey field
  const openAI = webConfig.openAI as
    | { apiKey?: string; baseURL?: string }
    | undefined;
  const apiKey = ai?.apiKey ?? openAI?.apiKey ?? '';

  const model = ai?.models?.defaults?.model ?? DEFAULT_MODEL;

  return {
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    ai: {
      baseURL: ai?.baseURL ?? DEFAULT_BASE_URL,
      apiKey,
      models: {
        ...(ai?.models ?? {}),
        defaults: {
          ...(ai?.models?.defaults ?? {}),
          model: normalizeModelName(model),
        },
      },
    },
    dragonfly: {
      host: dragonfly?.host ?? 'localhost',
      port: dragonfly?.port ?? 6379,
      prefix: dragonfly?.prefix,
    },
    database: {
      url: process.env.DATABASE_URL,
    },
  };
}

function buildDefaults(): DevServerConfig {
  return {
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    ai: {
      baseURL: DEFAULT_BASE_URL,
      apiKey: '',
      models: {
        defaults: { model: DEFAULT_MODEL },
      },
    },
    dragonfly: {
      host: 'localhost',
      port: 6379,
    },
    database: {
      url: process.env.DATABASE_URL,
    },
  };
}

function mergeWithDefaults(partial: Partial<DevServerConfig>): DevServerConfig {
  const base = buildDefaults();
  return {
    port: partial.port ?? base.port,
    ai: {
      ...base.ai,
      ...partial.ai,
      models: partial.ai?.models ?? base.ai.models,
    },
    dragonfly: {
      ...base.dragonfly,
      ...partial.dragonfly,
    },
    database: {
      ...base.database,
      ...partial.database,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage model resolution (mirrors recordless.web's resolveStageModel)
// ---------------------------------------------------------------------------

/**
 * Resolve the model + settings for a given AI stage.
 *
 * Lookup order:
 *   1. config.ai.models.stages[stageId]
 *   2. config.ai.models.defaults
 */
export function resolveStageModel(
  config: DevServerConfig,
  stageId: string,
): DevServerAIModelStageSettings & { model: string } {
  const stageOverride = config.ai.models.stages?.[stageId];
  const model = stageOverride?.model ?? config.ai.models.defaults.model;
  return {
    ...config.ai.models.defaults,
    ...stageOverride,
    model: normalizeModelName(model),
  };
}
