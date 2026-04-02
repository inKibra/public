import type { Logger } from '@inkibra/logger';
import type { Filter } from '@inkibra/observable-cache';
import type { DbResult, DbTransactionError } from './db-result';

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Transaction isolation levels.
 * Default: 'repeatable_read' to match Couchbase's snapshot isolation semantics.
 */
export type TransactionIsolation =
  | 'read_committed' // PostgreSQL only, Couchbase uses snapshot regardless
  | 'repeatable_read' // Default - matches Couchbase behavior
  | 'serializable'; // Strictest - both backends support

/**
 * Couchbase durability levels (PostgreSQL ignores this option)
 */
export type TransactionDurability =
  | 'majority' // Default - in-memory on majority of replicas
  | 'persist_to_majority' // Persisted to disk on majority
  | 'persist_to_active'; // Persisted to disk on active node only

/**
 * Options for beginning a transaction
 */
export type TransactionOptions = {
  /** Isolation level (default: 'repeatable_read') */
  isolation?: TransactionIsolation;
  /** Couchbase durability (default: 'majority', ignored by PostgreSQL) */
  durability?: TransactionDurability;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
};

/**
 * Transaction context - provides transactional operations.
 * Implements AsyncDisposable for use with `await using`.
 *
 * @example
 * // Pattern 1: using (preferred)
 * await using tx = await driver.beginTransaction();
 * await tx.insert(logger, 'collection', doc);
 * // auto-commits when tx goes out of scope
 *
 * @example
 * // Pattern 2: explicit
 * const tx = await driver.beginTransaction();
 * try {
 *   await tx.insert(logger, 'collection', doc);
 *   await tx.commit();
 * } catch (e) {
 *   await tx.rollback();
 *   throw e;
 * }
 */
export interface Transaction extends AsyncDisposable {
  /** Get a document by ID within the transaction */
  get<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<DbResult<{ cas: Cas; value: T } | undefined>>;

  /** Find documents within the transaction */
  find<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    options: FindOptions<T>,
  ): Promise<DbResult<T[]>>;

  /** Check if a document exists within the transaction */
  exists(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<{ exists: boolean }>;

  /** Insert a new document within the transaction */
  insert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
  ): Promise<DbResult<MutationResult>>;

  /**
   * Insert or update a document within the transaction.
   * CAS is optional - if provided, used as additional safety check.
   */
  upsert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
    options?: UpsertOptions,
  ): Promise<DbResult<MutationResult>>;

  /**
   * Replace a document within the transaction.
   * CAS is optional in transactions - if provided, used as additional check.
   */
  replace<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    cas: Cas | undefined,
    value: T,
  ): Promise<DbResult<{ cas: Cas }>>;

  /** Remove a document within the transaction */
  remove(
    logger: Logger,
    collection: string,
    id: string,
    cas?: Cas,
  ): Promise<DbResult<MutationResult>>;

  /** Explicitly commit the transaction */
  commit(): Promise<DbResult<void, DbTransactionError>>;

  /** Explicitly rollback the transaction */
  rollback(): Promise<DbResult<void, DbTransactionError>>;

  /** Whether the transaction is still active (not committed or rolled back) */
  readonly isActive: boolean;
}

/**
 * Base interface for all typed objects in the DAL
 */
export interface TypedObjectBase {
  id: string;
  type: string;
  version?: number;
  modified: string;
  created: string;
  deleted?: string;
}

/**
 * Partition descriptor for grouping related records across types
 * Example: "post_partition" groups post and comment records under a single postId
 */
export type PartitionDescriptor<
  PartitionName extends string,
  Model extends TypedObjectBase,
  Field extends keyof Model & string,
> = {
  name: PartitionName;
  valueField: Field;
};

/**
 * CAS (Compare-And-Swap) token for optimistic locking
 */
export type Cas = {
  value: string;
};

/**
 * Mutation result from insert/update/delete operations
 */
export type MutationResult = {
  cas: Cas;
};

export type BulkUpdate<T extends TypedObjectBase> = Partial<
  Pick<T, 'type' | 'version' | 'created' | 'modified' | 'deleted'>
>;

/**
 * Options for upsert operations
 */
export type UpsertOptions = {
  /**
   * Optional CAS token for optimistic concurrency.
   * If provided and the document exists, the update must match the CAS.
   * If the document does not exist, the insert should succeed (CAS is ignored).
   */
  cas?: Cas;
};

/**
 * Index configuration
 */
export type IndexConfig = {
  fields: string[];
  composite?: boolean;
  unique?: boolean;
  name?: string;
};

/**
 * Generated column configuration
 */
export type GeneratedColumnConfig = {
  name: string;
  expression: string;
  stored?: boolean;
};

/**
 * DAL configuration for a specific type (imported from collections.ts)
 * This is a minimal definition needed for driver.ts to avoid circular dependency
 */
export type DALConfigForDriver = {
  type: string;
  version?: number;
  valueIndexes?: string[];
  arrayIndexes?: string[];
  partitions?: Array<{
    name: string;
    valueField: string;
  }>;
};

/**
 * Collection schema configuration
 */
export type CollectionSchema = {
  name: string;
  partitions?: string[];
  indexes?: IndexConfig[];
  generatedColumns?: GeneratedColumnConfig[];
  dals?: DALConfigForDriver[];
};

/**
 * Query options for find operations
 */
export type FindOptions<T extends TypedObjectBase> = {
  limit?: number;
  offset?: number;
  filter?: Filter<T, keyof T | 'created' | 'modified' | 'deleted'>;
  orderBy?: {
    field: keyof T | 'created' | 'modified';
    direction: 'ASC' | 'DESC';
  };
};

/**
 * Options for ensureCollection
 */
export type EnsureCollectionOptions = {
  /**
   * If true, create tables/indexes if they don't exist.
   * This is intended for explicit startup bootstrap in development environments.
   * Request-time usage is forbidden.
   * If false (default), only validate that the schema matches.
   * Use drizzle-kit push for production schema migrations.
   */
  createIfNotExists?: boolean;
  /**
   * If true, throw an error when schema mismatches are found (for tests).
   * If false (default), only log a warning and continue.
   */
  strict?: boolean;
};

/**
 * Generic driver interface that all backend-specific drivers must implement
 */
export interface Driver {
  /**
   * Ensure a collection exists with the given schema.
   * Intended for service startup/bootstrap only (never request path).
   * By default, validates that the database schema matches expectations.
   * Pass createIfNotExists: true only for explicit development bootstrap.
   */
  ensureCollection(
    logger: Logger,
    schema: CollectionSchema,
    options?: EnsureCollectionOptions,
  ): Promise<void>;

  /**
   * Ensure an index exists on the given collection
   */
  ensureIndex(
    logger: Logger,
    collection: string,
    index: IndexConfig,
    typeFilter?: string,
  ): Promise<void>;

  /**
   * Find documents matching the given criteria
   */
  find<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    options: FindOptions<T>,
  ): Promise<DbResult<T[]>>;

  /**
   * Get a single document by ID
   */
  get<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<DbResult<{ cas: Cas; value: T } | undefined>>;

  /**
   * Get multiple documents by IDs
   */
  getMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    ids: string[],
  ): Promise<DbResult<{ value: T; cas: Cas }[]>>;

  /**
   * Check if a document exists
   */
  exists(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<{ exists: boolean }>;

  /**
   * Insert a new document
   */
  insert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
  ): Promise<DbResult<MutationResult>>;

  /**
   * Insert multiple documents
   */
  insertMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    values: T[],
  ): Promise<DbResult<PromiseSettledResult<MutationResult>[]>>;

  /**
   * Insert or update a document by ID.
   * If opts.cas is provided and the document exists, the update must match the CAS.
   * If the document does not exist, an insert should succeed (CAS is ignored).
   */
  upsert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
    options?: UpsertOptions,
  ): Promise<DbResult<MutationResult>>;

  /**
   * Insert or update multiple documents by ID in a single round-trip.
   * Does not support CAS — all rows are unconditionally upserted.
   */
  upsertMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    values: T[],
  ): Promise<DbResult<PromiseSettledResult<MutationResult>[]>>;

  /**
   * Replace a document with CAS check
   */
  replace<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    cas: Cas,
    value: T,
  ): Promise<DbResult<{ cas: Cas }>>;

  /**
   * Remove a document
   */
  remove(
    logger: Logger,
    collection: string,
    id: string,
    cas?: Cas,
  ): Promise<DbResult<MutationResult>>;

  /**
   * Count documents matching the given filter
   */
  countFiltered<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    filter: Filter<T, keyof T | 'created' | 'modified' | 'deleted'>,
  ): Promise<DbResult<number>>;

  /**
   * Bulk update base columns for documents matching a filter.
   * Intended for operations like soft deletes.
   */
  bulkUpdate<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    filter: Filter<T, keyof T | 'created' | 'modified' | 'deleted'>,
    updates: BulkUpdate<T>,
  ): Promise<DbResult<{ affected: number }>>;

  /**
   * Find all documents in a partition across multiple types
   * Used for partition-aware querying (e.g., get all posts + comments for a postId)
   */
  findByPartition<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    partitionName: string,
    partitionValue: string,
    types?: string[],
    options?: Omit<FindOptions<T>, 'filter'>,
  ): Promise<DbResult<T[]>>;

  /**
   * Disconnect from the database
   */
  disconnect(): Promise<void>;

  /**
   * Begin a new transaction.
   * Use with `await using` for automatic commit/rollback, or explicit commit()/rollback().
   *
   * Default isolation: 'repeatable_read' (matches Couchbase snapshot isolation)
   *
   * @example
   * // Pattern 1: using (preferred)
   * await using tx = await driver.beginTransaction();
   * await tx.insert(logger, 'collection', doc);
   * // auto-commits when tx goes out of scope
   *
   * @example
   * // Pattern 2: explicit
   * const tx = await driver.beginTransaction();
   * try {
   *   await tx.insert(logger, 'collection', doc);
   *   await tx.commit();
   * } catch (e) {
   *   await tx.rollback();
   *   throw e;
   * }
   */
  beginTransaction(options?: TransactionOptions): Promise<Transaction>;
}
