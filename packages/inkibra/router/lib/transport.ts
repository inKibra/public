/**
 * Transport Layer - Storage scope and transport error types
 *
 * The transport layer handles:
 * - Storage scope definitions (how context is persisted)
 * - Transport-level errors (network, timeout, etc.)
 * - Context-level errors (codec failures)
 *
 * Context definition and encoding is now in context-codec.ts.
 * Transport plugins (backend/fetch-provider level) use these types
 * to read/write context strings based on scope.
 */

import type { Result } from './result';

// ============================================================================
// Storage Scope
// ============================================================================

/**
 * Storage scope determines how context is persisted on the client
 * and how the transport plugin handles reading/writing
 *
 * - 'session': Cleared when browser session ends (e.g., session-specific tokens)
 *              Maps to sessionStorage on web, ephemeral storage on native
 * - 'device': Persists across sessions on this device (e.g., device ID, preferences)
 *             Maps to localStorage on web, persisted storage on native
 */
export type StorageScope = 'session' | 'device';

// ============================================================================
// Transport Level Errors
// ============================================================================

/**
 * Network error - connection failed
 */
export type NetworkError = {
  readonly type: 'NetworkError';
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Timeout error - request timed out
 */
export type TimeoutError = {
  readonly type: 'TimeoutError';
  readonly message: string;
  readonly timeoutMs: number;
};

/**
 * Server error - server returned 5xx
 */
export type ServerError = {
  readonly type: 'ServerError';
  readonly message: string;
  readonly statusCode: number;
  readonly body?: unknown;
};

/**
 * Parse error - failed to parse response
 */
export type ParseError = {
  readonly type: 'ParseError';
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Validation error - response failed validation
 */
export type ValidationError = {
  readonly type: 'ValidationError';
  readonly message: string;
  readonly errors: unknown[];
};

/**
 * Union of all transport-level errors
 */
export type TransportLevelError =
  | NetworkError
  | TimeoutError
  | ServerError
  | ParseError
  | ValidationError;

/**
 * Create transport error helpers
 */
export const TransportError = {
  network: (message: string, cause?: unknown): NetworkError => ({
    type: 'NetworkError',
    message,
    cause,
  }),

  timeout: (message: string, timeoutMs: number): TimeoutError => ({
    type: 'TimeoutError',
    message,
    timeoutMs,
  }),

  server: (
    message: string,
    statusCode: number,
    body?: unknown,
  ): ServerError => ({
    type: 'ServerError',
    message,
    statusCode,
    body,
  }),

  parse: (message: string, cause?: unknown): ParseError => ({
    type: 'ParseError',
    message,
    cause,
  }),

  validation: (message: string, errors: unknown[]): ValidationError => ({
    type: 'ValidationError',
    message,
    errors,
  }),
};

// ============================================================================
// Context Level Errors
// ============================================================================

/**
 * Context-level error - context codec failed
 *
 * @template TError - The context-specific error type
 */
export type ContextLevelError<TError> = {
  readonly type: 'ContextError';
  readonly contextName: string;
  readonly error: TError;
};

/**
 * Create a context-level error
 */
export function createContextError<TError>(
  contextName: string,
  error: TError,
): ContextLevelError<TError> {
  return {
    type: 'ContextError',
    contextName,
    error,
  };
}

// ============================================================================
// Transport Callbacks
// ============================================================================

/**
 * Transport-level callbacks for request lifecycle
 */
export type TransportCallbacks<TArgs, TResponse> = {
  /** Called before sending request */
  onSend?: (args: TArgs) => void;
  /** Called on successful response */
  onSuccess?: (response: TResponse, args: TArgs) => void;
  /** Called on error */
  onError?: (error: TransportLevelError, args: TArgs) => void;
};

// ============================================================================
// Route Result Type
// ============================================================================

/**
 * Full result type from a route call
 *
 * Distinguishes between:
 * - Transport errors (network, timeout, server crash)
 * - Context errors (auth failed, invalid token)
 * - Success with business logic result
 */
export type RouteResult<TResponse, TContextError, TApiError> =
  | { type: 'TransportError'; error: TransportLevelError }
  | { type: 'ContextError'; contextName: string; error: TContextError }
  | { type: 'Success'; result: Result<TResponse, TApiError> };
