import type { Result } from 'neverthrow';
import type { DbError, DbQueryError, DbTransactionError } from './error-codes';

export type NonEmptyArray<T> = readonly [T, ...T[]];

export type DbWarning = Readonly<{
  code: string;
  message: string;
  data?: unknown;
}>;

export type DbOk<T> = Readonly<{
  value: T;
  /**
   * When present, must be non-empty.
   * Use this for partial reads/writes, fallbacks, etc.
   */
  warnings?: NonEmptyArray<DbWarning>;
}>;

// Re-export error types from error-codes for convenience
export type { DbError, DbQueryError, DbTransactionError };

/**
 * Generic database result type.
 * @template T - The success value type
 * @template E - The error type (defaults to DbQueryError for backward compatibility)
 */
export type DbResult<T, E = DbQueryError> = Result<DbOk<T>, E>;
