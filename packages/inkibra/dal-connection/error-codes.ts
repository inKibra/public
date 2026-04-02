import { ErrorDescriptor } from '@inkibra/error-base';

// ============================================================================
// Database Error Descriptors
// ============================================================================

export type DbQueryError = ErrorDescriptor<
  'DB_QUERY',
  `Database query failed: ${string}`,
  { reason?: string; pgCode?: string; pgDetail?: string }
>;

export type DbConnectionError = ErrorDescriptor<
  'DB_CONN',
  'Database connection failed',
  { host?: string }
>;

export type DbMultipleBucketsError = ErrorDescriptor<
  'DB_FATAL_MULTIPLE_BUCKETS',
  'Too many couchbase buckets with the same name',
  { bucketName: string }
>;

export type DbIllegalConstructionError = ErrorDescriptor<
  'DB_ILLEGAL_CONSTRUCTION',
  'Cannot construct couchbase without a construction symbol',
  undefined
>;

// ============================================================================
// Transaction Error Descriptors
// ============================================================================

export type TxNotActiveError = ErrorDescriptor<
  'TX_NOT_ACTIVE',
  'Transaction is no longer active',
  undefined
>;

export type TxAlreadyCompletedError = ErrorDescriptor<
  'TX_ALREADY_COMPLETED',
  'Transaction already completed',
  undefined
>;

export type TxCommitFailedError = ErrorDescriptor<
  'TX_COMMIT_FAILED',
  `Transaction commit failed: ${string}`,
  { cause?: string }
>;

export type TxRollbackFailedError = ErrorDescriptor<
  'TX_ROLLBACK_FAILED',
  `Transaction rollback failed: ${string}`,
  { cause?: string }
>;

// ============================================================================
// Union Types
// ============================================================================

/** All database-related errors */
export type DbError =
  | DbQueryError
  | DbConnectionError
  | DbMultipleBucketsError
  | DbIllegalConstructionError;

/** All transaction-related errors */
export type DbTransactionError =
  | TxNotActiveError
  | TxAlreadyCompletedError
  | TxCommitFailedError
  | TxRollbackFailedError;

// ============================================================================
// Error Factories
// ============================================================================

export const DALErrors = {
  // Database errors
  dbQuery: (
    reason: string,
    pgInfo?: { code?: string; detail?: string },
  ): DbQueryError =>
    ErrorDescriptor.create<DbQueryError>(
      'DB_QUERY',
      `Database query failed: ${reason}`,
      {
        reason,
        pgCode: pgInfo?.code,
        pgDetail: pgInfo?.detail,
      },
    ),

  dbConnection: (host?: string): DbConnectionError =>
    ErrorDescriptor.create<DbConnectionError>(
      'DB_CONN',
      'Database connection failed',
      {
        host,
      },
    ),

  dbMultipleBuckets: (bucketName: string): DbMultipleBucketsError =>
    ErrorDescriptor.create<DbMultipleBucketsError>(
      'DB_FATAL_MULTIPLE_BUCKETS',
      'Too many couchbase buckets with the same name',
      { bucketName },
    ),

  dbIllegalConstruction: (): DbIllegalConstructionError =>
    ErrorDescriptor.create<DbIllegalConstructionError>(
      'DB_ILLEGAL_CONSTRUCTION',
      'Cannot construct couchbase without a construction symbol',
      undefined,
    ),

  // Transaction errors
  txNotActive: (): TxNotActiveError =>
    ErrorDescriptor.create<TxNotActiveError>(
      'TX_NOT_ACTIVE',
      'Transaction is no longer active',
      undefined,
    ),

  txAlreadyCompleted: (): TxAlreadyCompletedError =>
    ErrorDescriptor.create<TxAlreadyCompletedError>(
      'TX_ALREADY_COMPLETED',
      'Transaction already completed',
      undefined,
    ),

  txCommitFailed: (cause: string): TxCommitFailedError =>
    ErrorDescriptor.create<TxCommitFailedError>(
      'TX_COMMIT_FAILED',
      `Transaction commit failed: ${cause}`,
      { cause },
    ),

  txRollbackFailed: (cause: string): TxRollbackFailedError =>
    ErrorDescriptor.create<TxRollbackFailedError>(
      'TX_ROLLBACK_FAILED',
      `Transaction rollback failed: ${cause}`,
      { cause },
    ),
};

// ============================================================================
// Legacy exports (deprecated, for backward compatibility)
// ============================================================================

/** @deprecated Use DALErrors instead */
export { DALErrors as DALConnectionErrorCodes };
