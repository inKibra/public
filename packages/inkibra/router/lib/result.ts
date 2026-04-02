/**
 * Result type - a discriminated union for success/error handling
 *
 * Compatible with neverthrow's Result type API.
 */

import type { StatusCode } from '../constants/status-code';

// ============================================================================
// Core Result Types
// ============================================================================

/**
 * Success result
 */
export type Ok<T> = {
  readonly type: 'Ok';
  readonly value: T;
  readonly isOk: true;
  readonly isErr: false;
};

/**
 * Error result
 */
export type Err<E> = {
  readonly type: 'Err';
  readonly error: E;
  readonly isOk: false;
  readonly isErr: true;
};

/**
 * Result type - either Ok with value or Err with error
 */
export type Result<T, E> = Ok<T> | Err<E>;

export type SerializableOkResult<T = unknown> = {
  type: 'Ok';
  value: T;
};

export type SerializableErrResult<E = unknown> = {
  type: 'Err';
  error: E;
};

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a success result
 */
export function Ok<T>(value: T): Ok<T> {
  return {
    type: 'Ok',
    value,
    isOk: true,
    isErr: false,
  };
}

/**
 * Create an error result
 */
export function Err<E>(error: E): Err<E> {
  return {
    type: 'Err',
    error,
    isOk: false,
    isErr: true,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard - check if result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.type === 'Ok';
}

/**
 * Type guard - check if result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.type === 'Err';
}

export function isSerializableResultOk<T = unknown>(
  value: unknown,
): value is SerializableOkResult<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'Ok' &&
    'value' in value
  );
}

export function isSerializableResultErr<E = unknown>(
  value: unknown,
): value is SerializableErrResult<E> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'Err' &&
    'error' in value
  );
}

// ============================================================================
// Utility Functions (neverthrow-compatible)
// ============================================================================

/**
 * Match on result - call onOk for success, onErr for error
 */
export function match<T, E, U>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => U;
    err: (error: E) => U;
  },
): U {
  if (result.type === 'Ok') {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
}

/**
 * Map the value of an Ok result
 */
export function map<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (result.type === 'Ok') {
    return Ok(fn(result.value));
  }
  return result;
}

/**
 * Map the error of an Err result
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  if (result.type === 'Err') {
    return Err(fn(result.error));
  }
  return result;
}

/**
 * Chain result operations (flatMap)
 */
export function andThen<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  if (result.type === 'Ok') {
    return fn(result.value);
  }
  return result;
}

/**
 * Unwrap the value or throw an error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.type === 'Ok') {
    return result.value;
  }
  throw new Error(`Tried to unwrap an Err: ${JSON.stringify(result.error)}`);
}

/**
 * Unwrap the value or return a default
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.type === 'Ok') {
    return result.value;
  }
  return defaultValue;
}

/**
 * Unwrap the error or throw
 */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (result.type === 'Err') {
    return result.error;
  }
  throw new Error(`Tried to unwrapErr an Ok: ${JSON.stringify(result.value)}`);
}

// ============================================================================
// Result Namespace (for static helpers)
// ============================================================================

export namespace Result {
  export const ok = Ok;
  export const err = Err;
  export const isOk = (r: Result<unknown, unknown>): r is Ok<unknown> =>
    r.type === 'Ok';
  export const isErr = (r: Result<unknown, unknown>): r is Err<unknown> =>
    r.type === 'Err';
}

// ============================================================================
// Serializable Result (for API responses)
// ============================================================================

type NonUndefined<T> = Exclude<T, undefined>;

/**
 * Serializable result with status code - for API responses
 */
export type SerializableResult<OkType, ErrType> =
  | { type: 'Ok'; value: NonUndefined<OkType>; statusCode: StatusCode }
  | { type: 'Err'; error: NonUndefined<ErrType>; statusCode: StatusCode };

export namespace SerializableResult {
  /**
   * Success result with status code
   */
  export type OkWithStatusCode<OkType, S extends StatusCode> = {
    type: 'Ok';
    value: NonUndefined<OkType>;
    statusCode: S;
  };

  /**
   * Success result with status code and metadata
   */
  export type OkWithStatusCodeAndMetadata<
    OkType,
    S extends StatusCode,
    Metadata,
  > = {
    type: 'Ok';
    value: NonUndefined<OkType>;
    statusCode: S;
    meta: Metadata;
  };

  /**
   * Error result with status code
   */
  export type ErrWithStatusCode<ErrType, S extends StatusCode> = {
    type: 'Err';
    error: NonUndefined<ErrType>;
    statusCode: S;
  };

  /**
   * Create a success result with status code
   */
  export function toOk<OkType, S extends StatusCode>(
    value: NonUndefined<OkType>,
    statusCode: S,
  ): OkWithStatusCode<OkType, S> {
    return { type: 'Ok', value, statusCode };
  }

  /**
   * Create a success result with status code and metadata
   */
  export function toOkWithMetadata<OkType, S extends StatusCode, Metadata>(
    value: NonUndefined<OkType>,
    statusCode: S,
    meta: Metadata,
  ): OkWithStatusCodeAndMetadata<OkType, S, Metadata> {
    return { type: 'Ok', value, statusCode, meta };
  }

  /**
   * Create an error result with status code
   */
  export function toErr<ErrType, S extends StatusCode>(
    error: NonUndefined<ErrType>,
    statusCode: S,
  ): ErrWithStatusCode<ErrType, S> {
    return { type: 'Err', error, statusCode };
  }

  /**
   * Convert a SerializableResult to a Result
   */
  export function toResult<OkType, ErrType>(
    serializable: SerializableResult<OkType, ErrType>,
  ): Result<OkType, ErrType> {
    if (serializable.type === 'Ok') {
      return Ok(serializable.value);
    }
    return Err(serializable.error);
  }
}
