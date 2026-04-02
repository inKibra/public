/**
 * Context Codec - unified context definition
 *
 * A ContextCodec defines:
 * - Identity: name and storage scope
 * - Schema: validator for data type + typed warning/error channels
 * - Security: whether to sign the context (JWT)
 * - Optional enforcement rules that can emit warnings/errors
 */

import type { ContextSchema } from './context-schema';
import type { Result } from './result';
import type { StorageScope } from './transport';

// ============================================================================
// Security Mode
// ============================================================================

/**
 * Security mode for context transport
 *
 * - undefined: Plain JSON (default)
 * - 'signed': JWT - server signs, client can read payload but can't tamper
 */
export type ContextSecurityMode = 'signed';

// ============================================================================
// Decode / Enforce Result Types
// ============================================================================

/**
 * Framework-generated decode warning for context reads.
 */
export type ContextDecodeWarning =
  | { type: 'ContextNotFound' }
  | { type: 'ContextParseError'; message: string }
  | { type: 'ContextValidationError'; errors: unknown };

/**
 * Decision returned from a context enforcer.
 */
export type ContextEnforceDecision<TData, TWarning, TError> =
  | { action: 'success'; value?: TData }
  | { action: 'warning'; warning: TWarning; value?: TData }
  | { action: 'warning_default'; warning: TWarning; defaultValue?: TData }
  | { action: 'error'; error: TError; value?: TData };

/**
 * Context enforcer.
 *
 * Enforcers run after decode/default resolution and can attach warnings or emit
 * a terminal context error.
 */
type BivariantHandler<TInput, TOutput> = {
  bivarianceHack(input: TInput): TOutput;
}['bivarianceHack'];

export type ContextEnforcer<TData, TWarning, TError> = BivariantHandler<
  {
    value: TData;
    defaultValue: TData;
    decodeWarnings: readonly ContextDecodeWarning[];
    warningsSoFar: readonly TWarning[];
  },
  | ContextEnforceDecision<TData, TWarning, TError>
  | Result<TData, TError>
  | Promise<
      ContextEnforceDecision<TData, TWarning, TError> | Result<TData, TError>
    >
>;

/**
 * Handler/page-facing context result for one codec.
 */
export type ContextResult<TData, TWarning, TError> =
  | {
      type: 'Ok';
      value: TData;
      decodeWarnings: readonly ContextDecodeWarning[];
      warnings: readonly TWarning[];
    }
  | {
      type: 'Err';
      value: TData;
      decodeWarnings: readonly ContextDecodeWarning[];
      warnings: readonly TWarning[];
      error: TError;
    };

/**
 * Symbol used internally to attach decode warnings to raw execute context.
 */
export const CONTEXT_DECODE_WARNINGS_SYMBOL = Symbol.for(
  '@inkibra/router/contextDecodeWarnings',
);

// ============================================================================
// Context Codec Types
// ============================================================================

/**
 * Context codec - defines context identity, schema, security, and enforcers.
 */
export type ContextCodec<
  TName extends string,
  TScope extends StorageScope,
  TData,
  TWarning,
  TError,
> = {
  /** Unique name for this context (literal type) */
  readonly name: TName;
  /** How this context should be stored/transported (literal type preserved) */
  readonly scope: TScope;
  /** Schema with data validator and typed warning/error channels */
  readonly schema: ContextSchema<TData, TWarning, TError>;
  /**
   * Default value to use when context is missing or invalid.
   */
  readonly defaultValue: TData;
  /**
   * Security mode for transport
   * - undefined: Plain JSON
   * - 'signed': JWT (client can read, server verifies signature)
   */
  readonly secure?: ContextSecurityMode;
  /** Optional enforcers run after decode/default resolution. */
  readonly enforcers: readonly ContextEnforcer<TData, TWarning, TError>[];
  /** Phantom type marker for data */
  readonly _dataType: TData;
  /** Phantom type marker for warning */
  readonly _warningType: TWarning;
  /** Phantom type marker for error */
  readonly _errorType: TError;
};

// ============================================================================
// Lowercase Name Enforcement
// ============================================================================

/**
 * Type constraint that ensures a string is lowercase (or kebab-case).
 */
export type LowercaseName<S extends string> = Lowercase<S> extends S
  ? S
  : never;

// ============================================================================
// Context Codec Factory
// ============================================================================

/**
 * Configuration for creating a context codec.
 */
export type ContextCodecConfig<
  TName extends string,
  TScope extends StorageScope,
  TData,
  TWarning,
  TError,
> = {
  /** Unique name for this context (must be lowercase/kebab-case). */
  name: LowercaseName<TName>;
  /** How this context should be stored/transported */
  scope: TScope;
  /** Schema with data validator and typed warning/error channels */
  schema: ContextSchema<TData, TWarning, TError>;
  /** Default value to use when context is missing or invalid */
  defaultValue: TData;
  /** Security mode for transport */
  secure?: ContextSecurityMode;
  /** Optional default enforcer(s) for all uses of this codec */
  enforce?:
    | ContextEnforcer<TData, TWarning, TError>
    | readonly ContextEnforcer<TData, TWarning, TError>[];
};

/**
 * Create a context codec.
 */
export function createContextCodec<
  TName extends string,
  const TScope extends StorageScope,
  TData,
  TWarning = never,
  TError = never,
>(
  config: ContextCodecConfig<TName, TScope, TData, TWarning, TError>,
): ContextCodec<TName, TScope, TData, TWarning, TError> {
  if (config.name !== config.name.toLowerCase()) {
    throw new Error(
      `Context codec name must be lowercase (got "${config.name}"). ` +
        `Use kebab-case for multi-word names (e.g., "user-prefs" instead of "userPrefs").`,
    );
  }

  const enforcers = config.enforce
    ? Array.isArray(config.enforce)
      ? config.enforce
      : [config.enforce]
    : [];

  return {
    name: config.name,
    scope: config.scope,
    schema: config.schema,
    defaultValue: config.defaultValue,
    secure: config.secure,
    enforcers,
    _dataType: undefined as unknown as TData,
    _warningType: undefined as unknown as TWarning,
    _errorType: undefined as unknown as TError,
  };
}

/**
 * Add a route-specific enforcer to a codec.
 */
export function enforce<C extends AnyContextCodec>(
  codec: C,
  enforcer: ContextEnforcer<
    ContextCodecDataType<C>,
    ContextCodecWarningType<C>,
    ContextCodecErrorType<C>
  >,
): C {
  return {
    ...codec,
    enforcers: [...codec.enforcers, enforcer],
  } as C;
}

// ============================================================================
// Type Extraction Utilities
// ============================================================================

/**
 * Extract the name type from a ContextCodec
 */
export type ContextCodecName<T> = T extends ContextCodec<
  infer TName,
  StorageScope,
  unknown,
  unknown,
  unknown
>
  ? TName
  : never;

/**
 * Extract the scope type from a ContextCodec
 */
export type ContextCodecScope<T> = T extends ContextCodec<
  string,
  infer TScope,
  unknown,
  unknown,
  unknown
>
  ? TScope
  : never;

/**
 * Extract the data type from a ContextCodec
 */
export type ContextCodecDataType<T> = T extends ContextCodec<
  string,
  StorageScope,
  infer TData,
  unknown,
  unknown
>
  ? TData
  : never;

/**
 * Extract the warning type from a ContextCodec
 */
export type ContextCodecWarningType<T> = T extends ContextCodec<
  string,
  StorageScope,
  unknown,
  infer TWarning,
  unknown
>
  ? TWarning
  : never;

/**
 * Extract the error type from a ContextCodec
 */
export type ContextCodecErrorType<T> = T extends ContextCodec<
  string,
  StorageScope,
  unknown,
  unknown,
  infer TError
>
  ? TError
  : never;

/**
 * Any context codec (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Broad compatibility for structural map constraints
export type AnyContextCodec = ContextCodec<string, StorageScope, any, any, any>;

/**
 * Map of context codecs (for route definitions)
 */
export type ContextCodecMap = Record<string, AnyContextCodec>;

/**
 * Validated context codec map - ensures keys match codec names.
 */
export type ValidatedContextCodecMap<T extends ContextCodecMap> = {
  [K in keyof T]: T[K] extends ContextCodec<
    infer N,
    infer S,
    infer D,
    infer W,
    infer E
  >
    ? K extends N
      ? ContextCodec<N, S, D, W, E>
      : never
    : never;
};

/**
 * Assert that a codec map is valid (keys match names).
 */
export type AssertValidCodecMap<T extends ContextCodecMap> =
  T extends ValidatedContextCodecMap<T> ? unknown : never;

/**
 * Extract context data types from a codec map.
 */
export type ContextCodecMapDataTypes<T extends ContextCodecMap> = {
  [K in keyof T]: ContextCodecDataType<T[K]>;
};

/**
 * Extract context warning types from a codec map (union of all warnings).
 */
export type ContextCodecMapWarningTypes<T extends ContextCodecMap> = {
  [K in keyof T]: ContextCodecWarningType<T[K]>;
}[keyof T];

/**
 * Extract context error types from a codec map (union of all errors).
 */
export type ContextCodecMapErrorTypes<T extends ContextCodecMap> = {
  [K in keyof T]: ContextCodecErrorType<T[K]>;
}[keyof T];

/**
 * Extract context result types from a codec map.
 */
export type ContextCodecMapResultTypes<T extends ContextCodecMap> = {
  [K in keyof T]: ContextResult<
    ContextCodecDataType<T[K]>,
    ContextCodecWarningType<T[K]>,
    ContextCodecErrorType<T[K]>
  >;
};

/**
 * Decode warnings map keyed by codec key.
 */
export type ContextDecodeWarningsByCodec<T extends ContextCodecMap> = Partial<{
  [K in keyof T]: readonly ContextDecodeWarning[];
}>;

function isResult<TData, TError>(
  input: unknown,
): input is Result<TData, TError> {
  return (
    typeof input === 'object' &&
    input !== null &&
    'type' in input &&
    ((input as { type: string }).type === 'Ok' ||
      (input as { type: string }).type === 'Err')
  );
}

/**
 * Resolve one codec value + decode warnings into handler/page-facing ContextResult.
 */
export async function resolveContextResult<
  TName extends string,
  TScope extends StorageScope,
  TData,
  TWarning,
  TError,
>(
  codec: ContextCodec<TName, TScope, TData, TWarning, TError>,
  input: {
    value: TData | undefined;
    decodeWarnings?: readonly ContextDecodeWarning[];
  },
): Promise<ContextResult<TData, TWarning, TError>> {
  let value = input.value === undefined ? codec.defaultValue : input.value;
  const decodeWarnings: readonly ContextDecodeWarning[] =
    input.decodeWarnings ??
    (input.value === undefined ? [{ type: 'ContextNotFound' }] : []);
  const warnings: TWarning[] = [];

  for (const enforcer of codec.enforcers) {
    const rawDecision = await enforcer({
      value,
      defaultValue: codec.defaultValue,
      decodeWarnings,
      warningsSoFar: warnings,
    });

    const decision: ContextEnforceDecision<TData, TWarning, TError> = isResult(
      rawDecision,
    )
      ? rawDecision.type === 'Ok'
        ? { action: 'success', value: rawDecision.value }
        : { action: 'error', error: rawDecision.error }
      : rawDecision;

    if (decision.action === 'success') {
      if (decision.value !== undefined) {
        value = decision.value;
      }
      continue;
    }

    if (decision.action === 'warning') {
      warnings.push(decision.warning);
      if (decision.value !== undefined) {
        value = decision.value;
      }
      continue;
    }

    if (decision.action === 'warning_default') {
      warnings.push(decision.warning);
      value = decision.defaultValue ?? codec.defaultValue;
      continue;
    }

    if (decision.action === 'error') {
      if (decision.value !== undefined) {
        value = decision.value;
      }

      return {
        type: 'Err',
        value,
        decodeWarnings,
        warnings,
        error: decision.error,
      };
    }
  }

  return {
    type: 'Ok',
    value,
    decodeWarnings,
    warnings,
  };
}
