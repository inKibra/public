/**
 * Context Schema - defines validators for context data and typed issue channels
 *
 * Similar to defineRouteSchema, this uses validators for type-safe
 * context handling with explicit warning/error types.
 */

import type { IValidation } from 'typia/lib';

// ============================================================================
// Context Schema Types
// ============================================================================

/**
 * Context schema with validator for data and typed warning/error channels.
 *
 * @template TData - The context data type
 * @template TWarning - Non-fatal warning type emitted by enforcers
 * @template TError - Fatal error type emitted by enforcers
 */
export type ContextSchema<TData, TWarning, TError> = {
  /** Validator for context data */
  readonly dataValidator: (input: unknown) => IValidation<TData>;
  /** Phantom type marker for data */
  readonly _dataType: TData;
  /** Phantom type marker for warning */
  readonly _warningType: TWarning;
  /** Phantom type marker for error */
  readonly _errorType: TError;
};

// ============================================================================
// Context Schema Factory
// ============================================================================

/**
 * Define a context schema with a data validator.
 *
 * Warning and error types are carried as compile-time markers and are used by
 * context enforcement and handler/page ctxResult typing.
 *
 * @example
 * ```typescript
 * type AuthTokenData = {
 *   sessionId: string;
 *   userId: string;
 *   roles: string[];
 * };
 *
 * type AuthTokenWarning =
 *   | { type: 'SessionStale' };
 *
 * type AuthTokenError =
 *   | { type: 'MissingAuth' }
 *   | { type: 'InvalidToken'; reason: string }
 *   | { type: 'ExpiredToken'; expiredAt: number };
 *
 * const authTokenSchema = defineContextSchema<
 *   AuthTokenData,
 *   AuthTokenWarning,
 *   AuthTokenError
 * >({
 *   dataValidator: typia.createValidate<AuthTokenData>(),
 * });
 * ```
 */
export function defineContextSchema<
  TData,
  TWarning = never,
  TError = never,
>(config: {
  dataValidator: (input: unknown) => IValidation<TData>;
}): ContextSchema<TData, TWarning, TError>;

/**
 * Marker overload for type macro expansion.
 *
 * Usage:
 *   defineContextSchema<{ data: Data; warning: Warn; error: Err }>()
 */
export function defineContextSchema<
  TContract extends {
    data: unknown;
    warning: unknown;
    error: unknown;
  },
>(): ContextSchema<TContract['data'], TContract['warning'], TContract['error']>;

export function defineContextSchema<
  TData,
  TWarning = never,
  TError = never,
>(config?: {
  dataValidator: (input: unknown) => IValidation<TData>;
}): ContextSchema<TData, TWarning, TError> {
  if (!config) {
    throw new Error(
      'defineContextSchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
    );
  }

  return {
    dataValidator: config.dataValidator,
    _dataType: undefined as unknown as TData,
    _warningType: undefined as unknown as TWarning,
    _errorType: undefined as unknown as TError,
  };
}

// ============================================================================
// Type Extraction Utilities
// ============================================================================

/**
 * Extract the data type from a ContextSchema
 */
export type ContextSchemaDataType<T> = T extends ContextSchema<
  infer TData,
  unknown,
  unknown
>
  ? TData
  : never;

/**
 * Extract the warning type from a ContextSchema
 */
export type ContextSchemaWarningType<T> = T extends ContextSchema<
  unknown,
  infer TWarning,
  unknown
>
  ? TWarning
  : never;

/**
 * Extract the error type from a ContextSchema
 */
export type ContextSchemaErrorType<T> = T extends ContextSchema<
  unknown,
  unknown,
  infer TError
>
  ? TError
  : never;
