import type { Logger } from '@inkibra/logger';
import { Filter } from '@inkibra/observable-cache';
import { type SQL, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import {
  type AnyPgTable,
  integer,
  jsonb,
  type PgColumnBuilderBase,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, ok } from 'neverthrow';
import postgres from 'postgres';
import type { DbResult } from '../db-result';
import type {
  BulkUpdate,
  Cas,
  CollectionSchema,
  Driver,
  EnsureCollectionOptions,
  FindOptions,
  IndexConfig,
  MutationResult,
  Transaction,
  TransactionIsolation,
  TransactionOptions,
  TypedObjectBase,
  UpsertOptions,
} from '../driver';
import type { DbTransactionError } from '../error-codes';
import { DALErrors } from '../error-codes';

export type DrizzleConfiguration = Readonly<{
  connectionString: string;
  schema?: string;
  maxConnections?: number;
  idleTimeout?: number;
  connectTimeout?: number;
  /** Enable SSL (required for PlanetScale and most cloud providers) */
  ssl?: boolean | 'require' | 'prefer';
}>;

type DrizzleDb = PostgresJsDatabase | PgliteDatabase | BunSQLDatabase;

/**
 * Supported database driver types.
 * Different drivers have different JSONB serialization behaviors:
 * - postgres-js: Requires JSON.stringify() for JSONB data
 * - pglite: Requires JSON.stringify() for JSONB data
 * - bun-sql: Auto-serializes objects, so pass raw objects to avoid double-encoding
 */
export type DrizzleDriverType = 'postgres-js' | 'bun-sql' | 'pglite';

type ClientWithEnd = {
  end: (options?: { timeout?: number }) => Promise<void>;
};

type RowObject = Record<string, unknown>;

const MAX_TRANSIENT_QUERY_ATTEMPTS = 2;

/** Circuit breaker: if this many connection errors occur within the window, fail fast. */
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_WINDOW_MS = 30_000;
const CIRCUIT_BREAKER_COOL_DOWN_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWithJitter(baseMs: number): Promise<void> {
  const jitter = Math.random() * baseMs;
  return sleep(baseMs + jitter);
}

function isRowObject(value: unknown): value is RowObject {
  return value !== null && typeof value === 'object';
}

function readObjectField(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRowObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRowObject(value) ? value : {};
}

function readNullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Date
  ) {
    return String(value);
  }
  return undefined;
}

/**
 * Convert data to a JSONB SQL fragment.
 * Different SQL drivers handle JSONB parameters differently:
 * - postgres-js/pglite: Need JSON.stringify + ::jsonb cast
 * - bun-sql: Auto-serializes objects, so pass raw objects to avoid double-encoding
 *
 * @param data - The object to convert to JSONB
 * @param driverType - The driver type to determine serialization behavior
 */
function toJsonbSql(
  data: Record<string, unknown>,
  driverType: DrizzleDriverType,
): SQL {
  if (driverType === 'bun-sql') {
    // Bun SQL auto-serializes objects to JSON, so pass raw object
    return sql`${data}::jsonb`;
  }
  // postgres-js and pglite need explicit JSON.stringify
  return sql`${JSON.stringify(data)}::jsonb`;
}

/**
 * Extract detailed error information from postgres-js errors.
 * The postgres-js library provides rich error details that are often lost
 * when converting to generic Error objects.
 *
 * Note: Drizzle/postgres-js often wraps the actual PostgresError inside
 * a `cause` property, so we check both the error itself and error.cause.
 */
function extractPgErrorDetails(error: unknown): {
  code?: string;
  severity?: string;
  detail?: string;
  hint?: string;
  constraint?: string;
  table?: string;
  column?: string;
  message?: string;
} {
  if (error === null || typeof error !== 'object') {
    return {};
  }

  const err = error as Record<string, unknown>;

  // Check if the actual Postgres error is nested in 'cause' (common with Drizzle/postgres-js)
  // The cause often contains the PostgresError with code, severity, detail, etc.
  const cause = err['cause'];
  const pgError =
    cause !== null && typeof cause === 'object'
      ? (cause as Record<string, unknown>)
      : err;

  // Helper to get string value from either pgError (cause) or err (fallback)
  const getString = (key: string): string | undefined => {
    if (typeof pgError[key] === 'string') return pgError[key] as string;
    if (typeof err[key] === 'string') return err[key] as string;
    return undefined;
  };

  return {
    code: getString('code'),
    severity: getString('severity'),
    detail: getString('detail'),
    hint: getString('hint'),
    constraint: getString('constraint_name') ?? getString('constraint'),
    table: getString('table_name') ?? getString('table'),
    column: getString('column_name') ?? getString('column'),
    message: getString('message'),
  };
}

function isRetryablePgConnectionError(error: unknown): boolean {
  const details = extractPgErrorDetails(error);
  const code = details.code?.toUpperCase();
  const message = (details.message ?? '').toLowerCase();

  if (code === 'CONNECTION_ENDED' || code === 'CONNECTION_CLOSED') {
    return true;
  }

  return [
    'connection ended',
    'connection closed',
    'connection terminated',
    'connection reset',
    'broken pipe',
    'econnreset',
    'etimedout',
    'timeout',
  ].some((needle) => message.includes(needle));
}

/**
 * Configuration for creating a driver from an existing Drizzle database instance
 * Useful for PGlite, Bun SQL, and testing scenarios
 */
export type DrizzleFromDbConfiguration = Readonly<{
  /** Drizzle database instance (postgres.js, PGlite, or Bun SQL) */
  db: DrizzleDb;
  /** Optional mock client for disconnect() - defaults to no-op */
  client?: ClientWithEnd;
  /** Driver type for JSONB serialization behavior - defaults to 'pglite' */
  driverType?: DrizzleDriverType;
}>;

// ============================================================================
// Transaction Implementation
// ============================================================================

/**
 * Maps our isolation level to PostgreSQL isolation level string
 */
function mapIsolationLevel(
  isolation: TransactionIsolation,
): 'read committed' | 'repeatable read' | 'serializable' {
  switch (isolation) {
    case 'read_committed':
      return 'read committed';
    case 'repeatable_read':
      return 'repeatable read';
    case 'serializable':
      return 'serializable';
  }
}

/**
 * Marker error for explicit rollback
 */
class TransactionRollbackError extends Error {
  constructor() {
    super('Transaction rolled back');
    this.name = 'TransactionRollbackError';
  }
}

/**
 * DrizzleTransaction implements the Transaction interface for PostgreSQL
 * using Drizzle's transaction callback internally, exposed as a non-callback API.
 *
 * Supports both `await using` and explicit commit/rollback patterns.
 */
class DrizzleTransaction implements Transaction {
  private _isActive = true;
  private committed = false;
  private rolledBack = false;
  private commitSignal!: () => void;
  private rollbackSignal!: (error: Error) => void;
  private underlyingTransactionPromise: Promise<void> | undefined;
  /** Promise that the Drizzle transaction callback waits on */
  readonly completionPromise: Promise<void>;

  constructor(
    private tx: DrizzleDb,
    private tableSchemas: Map<string, CollectionSchema>,
    private driverType: DrizzleDriverType,
  ) {
    // Create the completion promise that controls when the transaction ends
    this.completionPromise = new Promise<void>((resolve, reject) => {
      this.commitSignal = resolve;
      this.rollbackSignal = reject;
    });
  }

  /**
   * Attach the promise returned by Drizzle's `db.transaction(...)`.
   * This allows `commit()` / `rollback()` to await the actual transaction completion
   * (including serialization/commit-time errors) instead of returning immediately
   * after signaling the callback.
   */
  attachUnderlyingTransactionPromise(promise: Promise<void>): void {
    if (this.underlyingTransactionPromise) {
      throw new Error('Underlying transaction promise already attached');
    }
    this.underlyingTransactionPromise = promise;
  }

  private getUnderlyingTransactionPromise(): Promise<void> {
    if (!this.underlyingTransactionPromise) {
      throw new Error('Underlying transaction promise not attached');
    }
    return this.underlyingTransactionPromise;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  // Helper methods for SQL operations (duplicated from driver for transaction context)
  private extractRows(result: unknown): unknown[] {
    if (Array.isArray(result)) {
      return result;
    }
    if (result && typeof result === 'object' && 'rows' in result) {
      const rows = (result as { rows?: unknown }).rows;
      return Array.isArray(rows) ? rows : [];
    }
    return [];
  }

  private decodeTypedObjectRow<T extends TypedObjectBase>(
    row: unknown,
  ): T | undefined {
    if (!isRowObject(row)) return undefined;

    const id = readNullableString(row['id']);
    const type = readNullableString(row['type']);
    if (!id || !type) return undefined;

    const versionRaw = row['version'];
    const version =
      typeof versionRaw === 'number' ? versionRaw : Number(versionRaw ?? 0);

    const created = readNullableString(row['created']) ?? '';
    const modified = readNullableString(row['modified']) ?? '';
    const deleted = readNullableString(row['deleted']);
    const data = readObjectField(row['data']);

    const base: Record<string, unknown> = {
      ...data,
      id,
      type,
      version,
      created,
      modified,
    };
    if (deleted !== undefined) base['deleted'] = deleted;

    return base as T;
  }

  private decodeCasFromRow(row: unknown): Cas {
    if (!isRowObject(row)) return { value: '0' };
    return { value: readNullableString(row['xmin']) ?? '0' };
  }

  private ident(name: string): SQL {
    return sql`${sql.identifier(name)}`;
  }

  private getFieldReference(collection: string, field: string): SQL {
    const isBaseColumn = [
      'id',
      'type',
      'version',
      'created',
      'modified',
      'deleted',
    ].includes(field);

    if (isBaseColumn) {
      return this.ident(field);
    }

    const schema = this.tableSchemas.get(collection);
    if (schema?.dals) {
      for (const dal of schema.dals) {
        if (dal.valueIndexes?.includes(field)) {
          return this.ident(`val_${field.toLowerCase()}`);
        }
      }
    }

    return sql`data->>${field}`;
  }

  private ensureActive(): void {
    if (!this._isActive) {
      throw DALErrors.dbQuery('transaction is no longer active');
    }
  }

  async get<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<DbResult<{ cas: Cas; value: T } | undefined>> {
    this.ensureActive();
    try {
      const result = await this.tx.execute(sql`
        SELECT
          id,
          type,
          version,
          to_json(created)#>>'{}' as created,
          to_json(modified)#>>'{}' as modified,
          to_json(deleted)#>>'{}' as deleted,
          data,
          xmin::text::bigint
        FROM ${sql.identifier(collection)}
        WHERE id = ${id}
        LIMIT 1
      `);

      const rows = this.extractRows(result);
      if (rows.length === 0) {
        return ok({ value: undefined });
      }

      const row = rows[0];
      const value = this.decodeTypedObjectRow<T>(row);
      if (!value) return ok({ value: undefined });
      return ok({ value: { cas: this.decodeCasFromRow(row), value } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('transaction get failed', { error, id, pgDetails });
      return err(DALErrors.dbQuery('transaction get operation failed'));
    }
  }

  async find<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    options: FindOptions<T>,
  ): Promise<DbResult<T[]>> {
    this.ensureActive();
    try {
      const { limit = 100, offset, filter, orderBy } = options;
      const conditions: SQL[] = [sql`type = ${type}`, sql`deleted IS NULL`];

      // Build filter conditions (simplified version)
      if (filter) {
        for (const key in filter) {
          if (Reflect.has(filter, key)) {
            const condition = Reflect.get(filter, key) as Filter.Filters;
            if (condition && 'operator' in condition) {
              const fieldRef = this.getFieldReference(collection, key);
              if (condition.operator === Filter.Operators.EQUAL) {
                conditions.push(sql`${fieldRef} = ${condition.value}`);
              }
            }
          }
        }
      }

      let query = sql`
        SELECT
          id,
          type,
          version,
          to_json(created)#>>'{}' as created,
          to_json(modified)#>>'{}' as modified,
          to_json(deleted)#>>'{}' as deleted,
          data
        FROM ${sql.identifier(collection)}
        WHERE ${sql.join(conditions, sql` AND `)}
      `;

      if (orderBy) {
        const orderField = String(orderBy.field);
        const fieldRef = this.getFieldReference(collection, orderField);
        const direction = orderBy.direction === 'ASC' ? sql` ASC` : sql` DESC`;
        query = sql`${query} ORDER BY ${fieldRef}${direction}`;
      }

      query = sql`${query} LIMIT ${limit}`;
      if (offset) {
        query = sql`${query} OFFSET ${offset}`;
      }

      const result = await this.tx.execute(query);
      const rows = this.extractRows(result);

      const ret: T[] = [];
      for (const row of rows) {
        const decoded = this.decodeTypedObjectRow<T>(row);
        if (decoded) ret.push(decoded);
      }

      return ok({ value: ret });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('transaction find failed', { error, pgDetails });
      return err(DALErrors.dbQuery('transaction find operation failed'));
    }
  }

  async exists(
    _logger: Logger,
    collection: string,
    id: string,
  ): Promise<{ exists: boolean }> {
    this.ensureActive();
    const result = await this.tx.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM ${sql.identifier(collection)}
        WHERE id = ${id}
      ) as exists
    `);

    const rows = this.extractRows(result);
    const first = rows[0];
    if (!isRowObject(first)) return { exists: false };
    return { exists: Boolean(first['exists']) };
  }

  async insert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
  ): Promise<DbResult<MutationResult>> {
    this.ensureActive();
    try {
      const { id, type, version, created, modified, deleted, ...data } = value;

      const result = await this.tx.execute(sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES (
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )
        RETURNING xmin::text::bigint
      `);

      const rows = this.extractRows(result);
      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('transaction insert failed', { error, pgDetails });
      return err(DALErrors.dbQuery('transaction insert operation failed'));
    }
  }

  async upsert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
    options?: UpsertOptions,
  ): Promise<DbResult<MutationResult>> {
    this.ensureActive();
    try {
      const { id, type, version, created, modified, deleted, ...data } = value;
      const cas = options?.cas;

      const result = await this.tx.execute(sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES (
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          version = EXCLUDED.version,
          modified = EXCLUDED.modified,
          deleted = EXCLUDED.deleted,
          data = EXCLUDED.data
        ${
          cas
            ? sql`WHERE ${sql.identifier(collection)}.xmin::text::bigint = ${cas.value}::bigint`
            : sql``
        }
        RETURNING xmin::text::bigint
      `);

      const rows = this.extractRows(result);
      if (rows.length === 0) {
        return err(DALErrors.dbQuery('transaction CAS mismatch'));
      }

      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('transaction upsert failed', { error, pgDetails });
      return err(DALErrors.dbQuery('transaction upsert operation failed'));
    }
  }

  async replace<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    cas: Cas | undefined,
    value: T,
  ): Promise<DbResult<{ cas: Cas }>> {
    this.ensureActive();
    try {
      const { id, type, version, created, modified, deleted, ...data } = value;

      // If CAS provided, use it for additional safety check
      // Otherwise, just update (transaction isolation handles concurrency)
      const result = await this.tx.execute(sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES (
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          version = EXCLUDED.version,
          modified = EXCLUDED.modified,
          deleted = EXCLUDED.deleted,
          data = EXCLUDED.data
        ${
          cas
            ? sql`WHERE ${sql.identifier(collection)}.xmin::text::bigint = ${cas.value}::bigint`
            : sql``
        }
        RETURNING xmin::text::bigint
      `);

      const rows = this.extractRows(result);
      if (rows.length === 0) {
        return err(
          DALErrors.dbQuery('transaction CAS mismatch or record not found'),
        );
      }

      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('transaction replace failed', { error, pgDetails });
      return err(DALErrors.dbQuery('transaction replace operation failed'));
    }
  }

  async remove(
    logger: Logger,
    collection: string,
    id: string,
    cas?: Cas,
  ): Promise<DbResult<MutationResult>> {
    this.ensureActive();
    try {
      if (cas) {
        const result = await this.tx.execute(sql`
          DELETE FROM ${sql.identifier(collection)}
          WHERE id = ${id} AND xmin::text::bigint = ${cas.value}::bigint
          RETURNING xmin::text::bigint
        `);

        const rows = this.extractRows(result);
        if (rows.length === 0) {
          return err(DALErrors.dbQuery('transaction CAS mismatch'));
        }
        return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
      }

      const result = await this.tx.execute(sql`
        DELETE FROM ${sql.identifier(collection)}
        WHERE id = ${id}
        RETURNING xmin::text::bigint
      `);

      const rows = this.extractRows(result);
      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('transaction remove failed', { error, pgDetails });
      return err(DALErrors.dbQuery('transaction remove operation failed'));
    }
  }

  async commit(): Promise<DbResult<void, DbTransactionError>> {
    if (!this._isActive) {
      return err(DALErrors.txNotActive());
    }
    if (this.committed || this.rolledBack) {
      return err(DALErrors.txAlreadyCompleted());
    }

    // Signal the Drizzle transaction callback to complete successfully
    this.commitSignal();

    this.committed = true;
    this._isActive = false;

    // Await the underlying Drizzle transaction completion so commit-time failures
    // (e.g. serialization errors, deferred constraint violations) are surfaced to callers.
    try {
      await this.getUnderlyingTransactionPromise();
      return ok({ value: undefined });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown commit error';
      return err(DALErrors.txCommitFailed(message));
    }
  }

  async rollback(): Promise<DbResult<void, DbTransactionError>> {
    if (!this._isActive) {
      return err(DALErrors.txNotActive());
    }
    if (this.committed || this.rolledBack) {
      return err(DALErrors.txAlreadyCompleted());
    }

    // Signal the Drizzle transaction callback to throw and rollback
    this.rollbackSignal(new TransactionRollbackError());

    this.rolledBack = true;
    this._isActive = false;

    // Await completion; swallow our marker error but surface unexpected failures.
    try {
      await this.getUnderlyingTransactionPromise();
    } catch (error) {
      if (error instanceof TransactionRollbackError)
        return ok({ value: undefined });
      if (error instanceof Error && error.name === 'TransactionRollbackError')
        return ok({ value: undefined });
      const message =
        error instanceof Error ? error.message : 'Unknown rollback error';
      return err(DALErrors.txRollbackFailed(message));
    }
    return ok({ value: undefined });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this._isActive) {
      // Already committed or rolled back
      return;
    }

    // Auto-commit on normal scope exit
    const result = await this.commit();
    if (result.isErr()) {
      // Re-throw commit errors to surface them in `await using` blocks
      throw result.error;
    }
  }
}

/**
 * DrizzleDriver implements the Driver interface using Drizzle ORM for Postgres
 */
export class DrizzleDriver implements Driver {
  private client!: ClientWithEnd;
  private db!: DrizzleDb;
  private tables: Map<string, AnyPgTable>;
  private tableSchemas: Map<string, CollectionSchema>;
  private driverType: DrizzleDriverType;
  private connectionConfig?: DrizzleConfiguration;
  private reconnectPromise?: Promise<void>;
  private circuitBreakerErrors: number[] = [];
  private circuitBreakerOpenUntil = 0;

  constructor(config: DrizzleConfiguration) {
    this.connectionConfig = config;
    this.reconnectPromise = undefined;
    this.tables = new Map();
    this.tableSchemas = new Map();
    this.driverType = 'postgres-js';
    this.initializePostgresClient(config);
  }

  private initializePostgresClient(config: DrizzleConfiguration): void {
    // Determine SSL configuration
    // PlanetScale and most cloud providers require SSL
    let sslConfig: boolean | 'require' | 'prefer' | undefined;
    if (config.ssl !== undefined) {
      sslConfig = config.ssl;
    } else if (
      config.connectionString.includes('pscale.') ||
      config.connectionString.includes('planetscale.')
    ) {
      // Auto-enable SSL for PlanetScale connections
      sslConfig = 'require';
    }

    const pgClient = postgres(config.connectionString, {
      max: config.maxConnections || 10,
      idle_timeout: config.idleTimeout || 20,
      connect_timeout: config.connectTimeout || 10,
      ssl: sslConfig,
    });
    this.client = pgClient;
    this.db = drizzle(pgClient);
  }

  /**
   * Create a DrizzleDriver from an existing Drizzle database instance
   * Useful for PGlite, Bun SQL, and testing scenarios where you already have a db instance
   */
  static fromDb(config: DrizzleFromDbConfiguration): DrizzleDriver {
    const driver = Object.create(DrizzleDriver.prototype) as DrizzleDriver;
    driver.db = config.db;
    driver.client = config.client || { end: async () => {} };
    driver.tables = new Map();
    driver.tableSchemas = new Map();
    // Default to 'pglite' for backwards compatibility with tests
    driver.driverType = config.driverType ?? 'pglite';
    driver.connectionConfig = undefined;
    driver.reconnectPromise = undefined;
    return driver;
  }

  private async reconnectPostgresClient(
    logger: Logger,
    operation: string,
  ): Promise<void> {
    if (this.driverType !== 'postgres-js' || !this.connectionConfig) {
      return;
    }

    if (!this.reconnectPromise) {
      this.reconnectPromise = (async () => {
        try {
          await this.client.end({ timeout: 1 });
        } catch {
          // Best-effort cleanup only.
        }
        this.initializePostgresClient(this.connectionConfig!);
        // Warm the connection pool so subsequent queries don't pay connect cost
        try {
          await this.db.execute(sql`SELECT 1`);
        } catch {
          // Pool warmup is best-effort
        }
        logger.warn(
          'Recreated postgres client after transient connection error',
          {
            operation,
          },
        );
      })().finally(() => {
        this.reconnectPromise = undefined;
      });
    }

    await this.reconnectPromise;
  }

  /**
   * Execute raw SQL against the underlying database.
   * Primarily intended for tooling (e.g. migration reset) and tests.
   */
  async executeRaw(logger: Logger, statement: string): Promise<void> {
    logger = logger.child({
      component: 'dal-connection: DrizzleDriver',
      method: 'executeRaw',
    });
    logger.debug('Executing raw SQL', { sql: statement });
    await this.db.execute(sql.raw(statement));
  }

  /**
   * Snapshot pg_stat_activity to diagnose slow queries or lock contention.
   * Best-effort — failures are silently ignored.
   */
  private async snapshotPgStatActivity(
    logger: Logger,
    operation: string,
    elapsedMs: number,
  ): Promise<void> {
    try {
      const result = await this.db.execute(sql`
        SELECT pid, state, wait_event_type, wait_event,
               query_start, left(query, 120) as query_prefix
        FROM pg_stat_activity
        WHERE state != 'idle' AND pid != pg_backend_pid()
        ORDER BY query_start
        LIMIT 10
      `);
      const rows = this.extractRows(result);
      logger.warn('slow query pg_stat_activity snapshot', {
        operation,
        elapsedMs,
        activeBackends: rows.length,
        rows,
      });
    } catch {
      // Best-effort diagnostic — don't let this fail the real operation
    }
  }

  private async executeWithRetry(
    logger: Logger,
    operation: string,
    query: SQL,
  ): Promise<unknown> {
    // Circuit breaker: fail fast if too many recent connection errors
    const now = Date.now();
    if (now < this.circuitBreakerOpenUntil) {
      throw new Error(
        `Circuit breaker open: too many connection errors in the last ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s. Cooling down.`,
      );
    }

    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= MAX_TRANSIENT_QUERY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const startMs = Date.now();
        const result = await this.db.execute(query);
        const elapsedMs = Date.now() - startMs;
        if (elapsedMs > 5000) {
          logger.warn('slow query detected', {
            operation,
            elapsedMs,
          });
          void this.snapshotPgStatActivity(logger, operation, elapsedMs);
        }
        return result;
      } catch (error) {
        lastError = error;
        if (
          !isRetryablePgConnectionError(error) ||
          attempt >= MAX_TRANSIENT_QUERY_ATTEMPTS
        ) {
          throw error;
        }

        // Track connection error for circuit breaker
        const errorNow = Date.now();
        this.circuitBreakerErrors.push(errorNow);
        // Prune old errors outside the window
        this.circuitBreakerErrors = this.circuitBreakerErrors.filter(
          (t) => errorNow - t < CIRCUIT_BREAKER_WINDOW_MS,
        );
        if (this.circuitBreakerErrors.length >= CIRCUIT_BREAKER_THRESHOLD) {
          this.circuitBreakerOpenUntil =
            errorNow + CIRCUIT_BREAKER_COOL_DOWN_MS;
          logger.error('Circuit breaker tripped: too many connection errors', {
            operation,
            recentErrors: this.circuitBreakerErrors.length,
            coolDownMs: CIRCUIT_BREAKER_COOL_DOWN_MS,
          });
          throw error;
        }

        const pgDetails = extractPgErrorDetails(error);
        logger.warn('Retrying transient database query error', {
          operation,
          attempt,
          maxAttempts: MAX_TRANSIENT_QUERY_ATTEMPTS,
          pgDetails,
        });
        await this.reconnectPostgresClient(logger, operation);
        await sleepWithJitter(100 * attempt);
      }
    }

    throw lastError;
  }

  /**
   * Extract rows from query result
   * Handles both postgres driver format (returns array) and PGlite format (returns {rows: []})
   */
  private extractRows(result: unknown): unknown[] {
    if (Array.isArray(result)) {
      return result;
    }
    if (result && typeof result === 'object' && 'rows' in result) {
      const rows = (result as { rows?: unknown }).rows;
      return Array.isArray(rows) ? rows : [];
    }
    return [];
  }

  private decodeTypedObjectRow<T extends TypedObjectBase>(
    row: unknown,
  ): T | undefined {
    if (!isRowObject(row)) return undefined;

    const id = readNullableString(row['id']);
    const type = readNullableString(row['type']);
    if (!id || !type) return undefined;

    const versionRaw = row['version'];
    const version =
      typeof versionRaw === 'number' ? versionRaw : Number(versionRaw ?? 0);

    const created = readNullableString(row['created']) ?? '';
    const modified = readNullableString(row['modified']) ?? '';
    const deleted = readNullableString(row['deleted']);
    const data = readObjectField(row['data']);

    const base: Record<string, unknown> = {
      ...data,
      id,
      type,
      version,
      created,
      modified,
    };
    if (deleted !== undefined) base['deleted'] = deleted;

    return base as T;
  }

  private decodeCasFromRow(row: unknown): Cas {
    if (!isRowObject(row)) return { value: '0' };
    return { value: readNullableString(row['xmin']) ?? '0' };
  }

  private ident(name: string): SQL {
    return sql`${sql.identifier(name)}`;
  }

  /**
   * Build a dynamic pgTable schema for type safety
   * NOTE: Generated columns are created via raw SQL in ensureCollection, not in the pgTable definition
   * This is because Drizzle doesn't support generated columns in the schema builder API yet
   */
  private buildTableSchema(schema: CollectionSchema) {
    const tableName = schema.name;

    // Base columns that every table has
    const columns: Record<string, PgColumnBuilderBase> = {
      id: text('id').primaryKey(),
      type: text('type').notNull(),
      version: integer('version'),
      created: timestamp('created', {
        withTimezone: true,
        mode: 'string',
      }).notNull(),
      modified: timestamp('modified', {
        withTimezone: true,
        mode: 'string',
      }).notNull(),
      deleted: timestamp('deleted', { withTimezone: true, mode: 'string' }),
      data: jsonb('data').notNull(),
    };

    // Add column definitions for generated columns (for type reference only)
    // Actual columns are created via SQL in ensureCollection
    if (schema.dals) {
      const generatedColumnNames = new Set<string>();

      // Add partition column definitions
      for (const dal of schema.dals) {
        const partitions = dal.partitions ?? [];
        for (const partition of partitions) {
          const columnName = `part_${partition.name}`;
          if (!generatedColumnNames.has(columnName)) {
            columns[columnName] = text(columnName);
            generatedColumnNames.add(columnName);
          }
        }
      }

      // Add value index column definitions
      // NOTE: All value columns are TEXT because Postgres generated columns with type casts
      // (::integer, ::timestamp) are NOT immutable and cause errors
      for (const dal of schema.dals) {
        if (dal.valueIndexes) {
          for (const field of dal.valueIndexes) {
            const columnName = `val_${field.toLowerCase()}`;
            if (!generatedColumnNames.has(columnName)) {
              columns[columnName] = text(columnName);
              generatedColumnNames.add(columnName);
            }
          }
        }

        // Add array index column definitions
        if (dal.arrayIndexes) {
          for (const field of dal.arrayIndexes) {
            const columnName = `arr_${field.toLowerCase()}`;
            if (!generatedColumnNames.has(columnName)) {
              columns[columnName] = jsonb(columnName);
              generatedColumnNames.add(columnName);
            }
          }
        }
      }
    }

    const table = pgTable(tableName, columns);

    this.tables.set(tableName, table);
    this.tableSchemas.set(tableName, schema);

    return table;
  }

  /**
   * Get expected column definitions from schema
   * Returns a map of column name -> column info (type, nullable, generated expression)
   */
  private getExpectedColumns(
    schema: CollectionSchema,
  ): Map<string, { type: string; nullable: boolean; generated?: string }> {
    const columns = new Map<
      string,
      { type: string; nullable: boolean; generated?: string }
    >();

    // Base columns
    columns.set('id', { type: 'text', nullable: false });
    columns.set('type', { type: 'text', nullable: false });
    columns.set('version', { type: 'integer', nullable: true });
    columns.set('created', {
      type: 'timestamp with time zone',
      nullable: false,
    });
    columns.set('modified', {
      type: 'timestamp with time zone',
      nullable: false,
    });
    columns.set('deleted', {
      type: 'timestamp with time zone',
      nullable: true,
    });
    columns.set('data', { type: 'jsonb', nullable: false });

    if (!schema.dals) return columns;

    const baseColumns = [
      'id',
      'type',
      'version',
      'created',
      'modified',
      'deleted',
    ];
    const generatedColumnNames = new Set<string>();

    // Add partition generated columns
    const partitions = new Map<
      string,
      Array<{ type: string; valueField: string }>
    >();
    for (const dal of schema.dals) {
      for (const partition of dal.partitions ?? []) {
        const existing = partitions.get(partition.name) ?? [];
        existing.push({ type: dal.type, valueField: partition.valueField });
        partitions.set(partition.name, existing);
      }
    }

    for (const [partitionName, mappings] of partitions) {
      const columnName = `part_${partitionName}`;
      if (generatedColumnNames.has(columnName)) continue;

      const caseWhenClauses = mappings.map((m) => {
        const isBaseColumn = baseColumns.includes(m.valueField);
        const expression = isBaseColumn
          ? m.valueField
          : `data->>'${m.valueField}'`;
        return `WHEN type = '${m.type}' THEN ${expression}`;
      });

      const caseExpression = `CASE ${caseWhenClauses.join(' ')} END`;
      columns.set(columnName, {
        type: 'text',
        nullable: true,
        generated: `(${caseExpression})`,
      });
      generatedColumnNames.add(columnName);
    }

    // Add value index generated columns
    for (const dal of schema.dals) {
      if (dal.valueIndexes) {
        for (const field of dal.valueIndexes) {
          const columnName = `val_${field.toLowerCase()}`;
          if (!generatedColumnNames.has(columnName)) {
            columns.set(columnName, {
              type: 'text',
              nullable: true,
              generated: `(data->>'${field}')`,
            });
            generatedColumnNames.add(columnName);
          }
        }
      }

      // Add array index generated columns
      if (dal.arrayIndexes) {
        for (const field of dal.arrayIndexes) {
          const columnName = `arr_${field.toLowerCase()}`;
          if (!generatedColumnNames.has(columnName)) {
            columns.set(columnName, {
              type: 'jsonb',
              nullable: true,
              generated: `(data->'${field}')`,
            });
            generatedColumnNames.add(columnName);
          }
        }
      }
    }

    return columns;
  }

  /**
   * Get expected indexes from schema
   * Returns a set of index names
   */
  private getExpectedIndexes(schema: CollectionSchema): Set<string> {
    const indexes = new Set<string>();
    const tableName = schema.name;

    // Base type index
    indexes.add(`${tableName}_type_idx`);

    if (!schema.dals) return indexes;

    // Partition indexes
    const partitionNames = new Set<string>();
    for (const dal of schema.dals) {
      for (const partition of dal.partitions ?? []) {
        partitionNames.add(partition.name);
      }
    }
    for (const partitionName of partitionNames) {
      const columnName = `part_${partitionName}`;
      indexes.add(`${tableName}_${columnName}_idx`);
    }

    // Value indexes
    for (const dal of schema.dals) {
      if (dal.valueIndexes) {
        for (const field of dal.valueIndexes) {
          const columnName = `val_${field.toLowerCase()}`;
          indexes.add(`${tableName}_${columnName}_idx`);
        }
      }

      // Array indexes (GIN)
      if (dal.arrayIndexes) {
        for (const field of dal.arrayIndexes) {
          const columnName = `arr_${field.toLowerCase()}`;
          indexes.add(`${tableName}_${columnName}_gin_idx`);
        }
      }
    }

    return indexes;
  }

  /**
   * Validate that the database schema matches our expected schema
   * Returns validation result with any mismatches found
   */
  async validateSchema(
    logger: Logger,
    schema: CollectionSchema,
  ): Promise<{ valid: boolean; mismatches: string[] }> {
    const tableName = schema.name;
    const mismatches: string[] = [];

    // Check if table exists
    const tableExistsResult = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${tableName}
      ) as exists
    `);
    const tableRows = this.extractRows(tableExistsResult);
    const existsValue = isRowObject(tableRows[0])
      ? tableRows[0]['exists']
      : undefined;
    const tableExists =
      existsValue === true ||
      existsValue === 't' ||
      existsValue === 1 ||
      existsValue === '1';
    if (!tableExists) {
      return {
        valid: false,
        mismatches: [`Table "${tableName}" does not exist`],
      };
    }

    // Get actual columns from database
    const columnsResult = await this.db.execute(sql`
      SELECT
        column_name,
        data_type,
        is_nullable,
        generation_expression
      FROM information_schema.columns
      WHERE table_name = ${tableName}
      ORDER BY ordinal_position
    `);
    const actualColumns = new Map<
      string,
      { type: string; nullable: boolean; generated?: string }
    >();
    for (const row of this.extractRows(columnsResult)) {
      if (!isRowObject(row)) continue;
      const columnName = readNullableString(row['column_name']);
      const dataType = readNullableString(row['data_type']);
      const isNullable = readNullableString(row['is_nullable']);
      const generationExpression = readNullableString(
        row['generation_expression'],
      );
      if (!columnName || !dataType || !isNullable) continue;
      actualColumns.set(columnName, {
        type: dataType,
        nullable: isNullable === 'YES',
        generated: generationExpression || undefined,
      });
    }

    // Compare columns
    const expectedColumns = this.getExpectedColumns(schema);
    for (const [name, expected] of expectedColumns) {
      const actual = actualColumns.get(name);
      if (!actual) {
        mismatches.push(`Missing column: ${name}`);
        continue;
      }

      // Normalize type comparison (postgres returns slightly different type names)
      const normalizeType = (t: string) =>
        t.toLowerCase().replace('timestamp with time zone', 'timestamptz');
      if (
        normalizeType(actual.type) !== normalizeType(expected.type) &&
        !(
          expected.type === 'timestamp with time zone' &&
          actual.type === 'timestamp with time zone'
        )
      ) {
        mismatches.push(
          `Column "${name}" type mismatch: expected ${expected.type}, got ${actual.type}`,
        );
      }

      // Check generated expression (if expected)
      if (expected.generated && !actual.generated) {
        mismatches.push(`Column "${name}" should be generated but is not`);
      }
    }

    // Check for unexpected columns (not strictly an error, just log)
    for (const [name] of actualColumns) {
      if (!expectedColumns.has(name)) {
        logger.debug(`Extra column in database: ${name}`);
      }
    }

    // Get actual indexes from database
    const indexesResult = await this.db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = ${tableName}
    `);
    const actualIndexes = new Set<string>();
    for (const row of this.extractRows(indexesResult)) {
      if (!isRowObject(row)) continue;
      const indexName = readNullableString(row['indexname']);
      if (indexName) actualIndexes.add(indexName);
    }

    // Compare indexes
    const expectedIndexes = this.getExpectedIndexes(schema);
    for (const indexName of expectedIndexes) {
      if (!actualIndexes.has(indexName)) {
        mismatches.push(`Missing index: ${indexName}`);
      }
    }

    return { valid: mismatches.length === 0, mismatches };
  }

  /**
   * Generate CREATE TABLE SQL from schema definition
   * Used when createIfNotExists option is true
   */
  private generateCreateTableSQL(schema: CollectionSchema): string {
    const tableName = schema.name;
    const columnDefs: string[] = [
      'id TEXT PRIMARY KEY',
      'type TEXT NOT NULL',
      'version INTEGER',
      'created TIMESTAMP WITH TIME ZONE NOT NULL',
      'modified TIMESTAMP WITH TIME ZONE NOT NULL',
      'deleted TIMESTAMP WITH TIME ZONE',
      'data JSONB NOT NULL',
    ];

    if (!schema.dals) {
      return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columnDefs.join(',\n  ')}\n);`;
    }

    // Track generated columns to avoid duplicates
    const generatedColumnNames = new Set<string>();

    // Add partition generated columns
    const baseColumns = [
      'id',
      'type',
      'version',
      'created',
      'modified',
      'deleted',
    ];
    const partitions = new Map<
      string,
      Array<{ type: string; valueField: string }>
    >();
    for (const dal of schema.dals) {
      for (const partition of dal.partitions ?? []) {
        const existing = partitions.get(partition.name) ?? [];
        existing.push({ type: dal.type, valueField: partition.valueField });
        partitions.set(partition.name, existing);
      }
    }

    for (const [partitionName, mappings] of partitions) {
      const columnName = `part_${partitionName}`;
      if (generatedColumnNames.has(columnName)) continue;

      const caseWhenClauses = mappings.map((m) => {
        const isBaseColumn = baseColumns.includes(m.valueField);
        const expression = isBaseColumn
          ? m.valueField
          : `data->>'${m.valueField}'`;
        return `WHEN type = '${m.type}' THEN ${expression}`;
      });
      const caseExpression = `CASE ${caseWhenClauses.join(' ')} END`;

      columnDefs.push(
        `${columnName} TEXT GENERATED ALWAYS AS (${caseExpression}) STORED`,
      );
      generatedColumnNames.add(columnName);
    }

    // Add value index generated columns
    for (const dal of schema.dals) {
      if (dal.valueIndexes) {
        for (const field of dal.valueIndexes) {
          const columnName = `val_${field.toLowerCase()}`;
          if (!generatedColumnNames.has(columnName)) {
            columnDefs.push(
              `${columnName} TEXT GENERATED ALWAYS AS (data->>'${field}') STORED`,
            );
            generatedColumnNames.add(columnName);
          }
        }
      }

      // Add array index generated columns
      if (dal.arrayIndexes) {
        for (const field of dal.arrayIndexes) {
          const columnName = `arr_${field.toLowerCase()}`;
          if (!generatedColumnNames.has(columnName)) {
            columnDefs.push(
              `${columnName} JSONB GENERATED ALWAYS AS (data->'${field}') STORED`,
            );
            generatedColumnNames.add(columnName);
          }
        }
      }
    }

    return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columnDefs.join(',\n  ')}\n);`;
  }

  /**
   * Generate CREATE INDEX SQL statements from schema definition
   * Used when createIfNotExists option is true
   */
  private generateIndexSQL(schema: CollectionSchema): string[] {
    const sqls: string[] = [];
    const tableName = schema.name;

    // Base type index
    sqls.push(
      `CREATE INDEX IF NOT EXISTS "${tableName}_type_idx" ON "${tableName}" (type);`,
    );

    if (!schema.dals) {
      return sqls;
    }

    // Track which indexes we've already created
    const createdIndexes = new Set<string>();

    // Partition indexes (composite: type + partition field)
    const partitionNames = new Set<string>();
    for (const dal of schema.dals) {
      for (const partition of dal.partitions ?? []) {
        partitionNames.add(partition.name);
      }
    }
    for (const partitionName of partitionNames) {
      const columnName = `part_${partitionName}`;
      const indexName = `${tableName}_${columnName}_idx`;

      if (!createdIndexes.has(indexName)) {
        sqls.push(
          `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (type, ${columnName});`,
        );
        createdIndexes.add(indexName);
      }
    }

    // Value indexes (composite: type + value field)
    for (const dal of schema.dals) {
      if (dal.valueIndexes) {
        for (const field of dal.valueIndexes) {
          const columnName = `val_${field.toLowerCase()}`;
          const indexName = `${tableName}_${columnName}_idx`;

          if (!createdIndexes.has(indexName)) {
            sqls.push(
              `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (type, ${columnName});`,
            );
            createdIndexes.add(indexName);
          }
        }
      }

      // Array indexes (GIN)
      if (dal.arrayIndexes) {
        for (const field of dal.arrayIndexes) {
          const columnName = `arr_${field.toLowerCase()}`;
          const indexName = `${tableName}_${columnName}_gin_idx`;

          if (!createdIndexes.has(indexName)) {
            sqls.push(
              `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" USING GIN (${columnName});`,
            );
            createdIndexes.add(indexName);
          }
        }
      }
    }

    return sqls;
  }

  async ensureCollection(
    logger: Logger,
    schema: CollectionSchema,
    options?: EnsureCollectionOptions,
  ): Promise<void> {
    logger = logger.child({
      component: 'dal-connection: DrizzleDriver',
      method: 'ensureCollection',
    });

    const createIfNotExists = options?.createIfNotExists ?? false;

    logger.info('Ensuring collection', {
      collection: schema.name,
      createIfNotExists,
    });

    // Build pgTable schema (for type safety and Drizzle operations)
    this.buildTableSchema(schema);

    if (createIfNotExists) {
      // Create tables and indexes via raw SQL (for tests and development)
      const createTableSQL = this.generateCreateTableSQL(schema);
      logger.debug('Creating table', { sql: createTableSQL });
      await this.db.execute(sql.raw(createTableSQL));

      const indexSQLs = this.generateIndexSQL(schema);
      for (const indexSQL of indexSQLs) {
        logger.debug('Creating index', { sql: indexSQL });
        await this.db.execute(sql.raw(indexSQL));
      }

      // Create any additional custom indexes from schema
      if (schema.indexes) {
        for (const idx of schema.indexes) {
          await this.ensureIndex(logger, schema.name, idx);
        }
      }

      logger.info('Collection created', { collection: schema.name });
    } else {
      // Validate that the database schema matches what we expect
      const { valid, mismatches } = await this.validateSchema(logger, schema);

      if (!valid) {
        const message =
          `Schema mismatch for collection "${schema.name}". ` +
          `Run "bunx drizzle-kit push" to sync the schema.`;

        if (options?.strict) {
          // In strict mode (tests), throw an error
          logger.error(message, { collection: schema.name, mismatches });
          throw new Error(
            `${message}\nMismatches:\n  - ${mismatches.join('\n  - ')}`,
          );
        }
        // In normal mode (production), warn but continue
        logger.warn(message, { collection: schema.name, mismatches });
      } else {
        logger.info('Collection validated', { collection: schema.name });
      }
    }
  }

  async ensureIndex(
    logger: Logger,
    collection: string,
    index: IndexConfig,
    typeFilter?: string,
  ): Promise<void> {
    logger = logger.child({
      component: 'dal-connection: DrizzleDriver',
      method: 'ensureIndex',
    });

    const indexName =
      index.name || `${collection}_${index.fields.join('_')}_idx`;

    logger.info(`Ensuring index ${indexName}`, { collection, index });

    try {
      if (index.composite && index.fields.length > 1) {
        // Composite index on multiple fields
        // Note: Using raw SQL for DDL to avoid parameterization issues with PGlite
        const fieldExprs = index.fields.map((f) => {
          const isBaseColumn = [
            'id',
            'type',
            'version',
            'created',
            'modified',
            'deleted',
          ].includes(f);
          return isBaseColumn ? f : `(data->>'${f}')`;
        });

        const uniqueClause = index.unique ? ' UNIQUE' : '';
        const whereClause = typeFilter ? ` WHERE type = '${typeFilter}'` : '';

        const createIndexSQL = `
          CREATE${uniqueClause} INDEX IF NOT EXISTS "${indexName}"
          ON "${collection}" (${fieldExprs.join(', ')})${whereClause}
        `;

        await this.db.execute(sql.raw(createIndexSQL));
      } else {
        // Single field index
        // Note: Using raw SQL for DDL to avoid parameterization issues with PGlite
        const field = index.fields[0];
        if (!field) {
          logger.warn('Index has no fields specified', { indexName });
          return;
        }

        const isBaseColumn = [
          'id',
          'type',
          'version',
          'created',
          'modified',
          'deleted',
        ].includes(field);
        const uniqueClause = index.unique ? ' UNIQUE' : '';
        const whereClause = typeFilter ? ` WHERE type = '${typeFilter}'` : '';

        const fieldExpr = isBaseColumn ? field : `(data->>'${field}')`;
        const createIndexSQL = `
          CREATE${uniqueClause} INDEX IF NOT EXISTS "${indexName}"
          ON "${collection}" (${fieldExpr})${whereClause}
        `;

        await this.db.execute(sql.raw(createIndexSQL));
      }

      logger.info('Index ensured', { indexName });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.error('Failed to create index', { error, indexName, pgDetails });
      throw error;
    }
  }

  /**
   * Get the generated column name for a field if it exists in the schema
   * Returns the column identifier or JSONB expression
   */
  private getFieldReference(collection: string, field: string): SQL {
    const isBaseColumn = [
      'id',
      'type',
      'version',
      'created',
      'modified',
      'deleted',
    ].includes(field);

    if (isBaseColumn) {
      return this.ident(field);
    }

    // Check if this field has a generated column
    const schema = this.tableSchemas.get(collection);
    if (schema?.dals) {
      // Check all DALs for this field in valueIndexes
      for (const dal of schema.dals) {
        if (dal.valueIndexes?.includes(field)) {
          // Use generated column (lowercase to match SQL column names)
          return this.ident(`val_${field.toLowerCase()}`);
        }
      }
    }

    // Fall back to JSONB extraction
    return sql`data->>${field}`;
  }

  /**
   * Get a JSONB array field reference, preferring generated arr_ columns when available.
   */
  private getArrayFieldReference(collection: string, field: string): SQL {
    const schema = this.tableSchemas.get(collection);
    if (schema?.dals) {
      for (const dal of schema.dals) {
        if (dal.arrayIndexes?.includes(field)) {
          return this.ident(`arr_${field.toLowerCase()}`);
        }
      }
    }

    return sql`data->${field}`;
  }

  private buildWhereConditions<T extends TypedObjectBase>(
    collection: string,
    type: string,
    filter?: Filter<T, keyof T | 'created' | 'modified' | 'deleted'>,
    includeDeleted = false,
  ): SQL[] {
    const conditions: SQL[] = [sql`type = ${type}`];
    if (!includeDeleted) {
      conditions.push(sql`deleted IS NULL`);
    }

    if (!filter) return conditions;

    const buildInOrExpression = (
      left: SQL,
      values: Array<string | number | boolean>,
    ) => {
      if (values.length === 0) return sql`false`;
      const parts = values.map((v) => sql`${left} = ${v}`);
      return parts.length === 1
        ? parts[0]!
        : sql`(${sql.join(parts, sql` OR `)})`;
    };

    const buildNotInAndExpression = (
      left: SQL,
      values: Array<string | number | boolean>,
    ) => {
      if (values.length === 0) return sql`true`;
      const parts = values.map((v) => sql`${left} != ${v}`);
      return parts.length === 1
        ? parts[0]!
        : sql`(${sql.join(parts, sql` AND `)})`;
    };

    for (const key in filter) {
      if (Reflect.has(filter, key)) {
        const condition = Reflect.get(filter, key) as Filter.Filters;

        if (condition && 'operator' in condition) {
          const fieldRef = this.getFieldReference(collection, key);

          switch (condition.operator) {
            case Filter.Operators.EQUAL:
              conditions.push(sql`${fieldRef} = ${condition.value}`);
              break;
            case Filter.Operators.NOT_EQUAL:
              conditions.push(sql`${fieldRef} != ${condition.value}`);
              break;
            case Filter.Operators.GREATER_THAN:
              conditions.push(sql`${fieldRef} > ${condition.value}`);
              break;
            case Filter.Operators.LESS_THAN:
              conditions.push(sql`${fieldRef} < ${condition.value}`);
              break;
            case Filter.Operators.GREATER_THAN_OR_EQUAL:
              conditions.push(sql`${fieldRef} >= ${condition.value}`);
              break;
            case Filter.Operators.LESS_THAN_OR_EQUAL:
              conditions.push(sql`${fieldRef} <= ${condition.value}`);
              break;
            case Filter.Operators.BETWEEN:
              conditions.push(
                sql`${fieldRef} BETWEEN ${condition.firstValue} AND ${condition.secondValue}`,
              );
              break;
            case Filter.Operators.IN:
              conditions.push(buildInOrExpression(fieldRef, condition.values));
              break;
            case Filter.Operators.NOT_IN:
              conditions.push(
                buildNotInAndExpression(fieldRef, condition.values),
              );
              break;
            case Filter.Operators.LIKE_AND:
              for (const value of condition.values) {
                conditions.push(sql`${fieldRef} LIKE ${'%' + value + '%'}`);
              }
              break;
            case Filter.Operators.LIKE_OR: {
              const likeConditions = condition.values.map(
                (v) => sql`${fieldRef} LIKE ${'%' + v + '%'}`,
              );
              conditions.push(sql`(${sql.join(likeConditions, sql` OR `)})`);
              break;
            }
            case Filter.Operators.ANY_IN: {
              const arrayRef = this.getArrayFieldReference(collection, key);
              const valuesText = condition.values.map(String);
              const elemRef = this.ident('elem');

              if (valuesText.length === 0) {
                conditions.push(sql`false`);
                break;
              }

              conditions.push(sql`
                EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(${arrayRef}, '[]'::jsonb)) AS elem
                  WHERE ${buildInOrExpression(elemRef, valuesText)}
                )
              `);
              break;
            }
            case Filter.Operators.EVERY_IN: {
              const arrayRef = this.getArrayFieldReference(collection, key);
              const valuesText = condition.values.map(String);
              const elemRef = this.ident('elem');

              if (valuesText.length === 0) {
                // True only when array is empty or null
                conditions.push(sql`
                  NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(${arrayRef}, '[]'::jsonb)) AS elem
                  )
                `);
                break;
              }

              conditions.push(sql`
                NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(${arrayRef}, '[]'::jsonb)) AS elem
                  WHERE NOT (${buildInOrExpression(elemRef, valuesText)})
                )
              `);
              break;
            }
            case Filter.Operators.NOT_ANY_IN: {
              const arrayRef = this.getArrayFieldReference(collection, key);
              const valuesText = condition.values.map(String);
              const elemRef = this.ident('elem');

              conditions.push(sql`
                NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(${arrayRef}, '[]'::jsonb)) AS elem
                  WHERE ${buildInOrExpression(elemRef, valuesText)}
                )
              `);
              break;
            }
            case Filter.Operators.NOT_EVERY_IN: {
              const arrayRef = this.getArrayFieldReference(collection, key);
              const valuesText = condition.values.map(String);
              const elemRef = this.ident('elem');

              conditions.push(sql`
                EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(${arrayRef}, '[]'::jsonb)) AS elem
                  WHERE NOT (${buildInOrExpression(elemRef, valuesText)})
                )
              `);
              break;
            }
          }
        }
      }
    }

    return conditions;
  }

  async find<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    options: FindOptions<T>,
  ): Promise<DbResult<T[]>> {
    try {
      const { limit = 100, offset, filter, orderBy } = options;
      const conditions = this.buildWhereConditions(collection, type, filter);

      let query = sql`
        SELECT
          id,
          type,
          version,
          to_json(created)#>>'{}' as created,
          to_json(modified)#>>'{}' as modified,
          to_json(deleted)#>>'{}' as deleted,
          data
        FROM ${sql.identifier(collection)}
        WHERE ${sql.join(conditions, sql` AND `)}
      `;

      if (orderBy) {
        const orderField = String(orderBy.field);
        const fieldRef = this.getFieldReference(collection, orderField);
        const direction = orderBy.direction === 'ASC' ? sql` ASC` : sql` DESC`;
        query = sql`${query} ORDER BY ${fieldRef}${direction}`;
      }

      query = sql`${query} LIMIT ${limit}`;
      if (offset) {
        query = sql`${query} OFFSET ${offset}`;
      }

      const result = await this.db.execute(query);
      const rows = this.extractRows(result);

      const ret: T[] = [];
      for (const row of rows) {
        const decoded = this.decodeTypedObjectRow<T>(row);
        if (decoded) ret.push(decoded);
      }

      return ok({ value: ret });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('find failed', { error, pgDetails });
      return err(DALErrors.dbQuery('find operation failed'));
    }
  }

  async get<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<DbResult<{ cas: Cas; value: T } | undefined>> {
    try {
      const result = await this.db.execute(sql`
        SELECT
          id,
          type,
          version,
          to_json(created)#>>'{}' as created,
          to_json(modified)#>>'{}' as modified,
          to_json(deleted)#>>'{}' as deleted,
          data,
          xmin::text::bigint
        FROM ${sql.identifier(collection)}
        WHERE id = ${id}
        LIMIT 1
      `);

      const rows = this.extractRows(result);
      if (rows.length === 0) {
        return ok({ value: undefined });
      }

      const row = rows[0];
      const value = this.decodeTypedObjectRow<T>(row);
      if (!value) return ok({ value: undefined });
      return ok({ value: { cas: this.decodeCasFromRow(row), value } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('get failed', { error, id, pgDetails });
      return err(DALErrors.dbQuery('get operation failed'));
    }
  }

  async getMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    ids: string[],
  ): Promise<DbResult<{ value: T; cas: Cas }[]>> {
    try {
      if (ids.length === 0) {
        return ok({ value: [] });
      }

      // Use IN clause with OR conditions for PGlite compatibility
      // ANY(array) doesn't work well with PGlite's parameter handling
      const idConditions = ids.map((id) => sql`id = ${id}`);
      const result = await this.db.execute(sql`
        SELECT
          id,
          type,
          version,
          to_json(created)#>>'{}' as created,
          to_json(modified)#>>'{}' as modified,
          to_json(deleted)#>>'{}' as deleted,
          data,
          xmin::text::bigint
        FROM ${sql.identifier(collection)}
        WHERE ${sql.join(idConditions, sql` OR `)}
      `);

      const rows = this.extractRows(result);
      const ret: { value: T; cas: Cas }[] = [];
      for (const row of rows) {
        const value = this.decodeTypedObjectRow<T>(row);
        if (!value) continue;
        ret.push({ cas: this.decodeCasFromRow(row), value });
      }

      return ok({ value: ret });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('getMany failed', { error, pgDetails });
      return err(DALErrors.dbQuery('getMany operation failed'));
    }
  }

  async exists(
    _logger: Logger,
    collection: string,
    id: string,
  ): Promise<{ exists: boolean }> {
    const result = await this.db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM ${sql.identifier(collection)}
        WHERE id = ${id}
      ) as exists
    `);

    const rows = this.extractRows(result);
    const first = rows[0];
    if (!isRowObject(first)) return { exists: false };
    return { exists: Boolean(first['exists']) };
  }

  async insert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
  ): Promise<DbResult<MutationResult>> {
    try {
      const { id, type, version, created, modified, deleted, ...data } = value;

      const result = await this.executeWithRetry(
        logger,
        'insert',
        sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES (
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )
        RETURNING xmin::text::bigint
      `,
      );

      const rows = this.extractRows(result);
      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('insert failed', { error, pgDetails });
      return err(DALErrors.dbQuery('insert operation failed'));
    }
  }

  async insertMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    values: T[],
  ): Promise<DbResult<PromiseSettledResult<MutationResult>[]>> {
    try {
      if (values.length === 0) {
        return ok({ value: [] });
      }

      // Build bulk insert query
      const valueRows = values.map((v) => {
        const { id, type, version, created, modified, deleted, ...data } = v;
        return sql`(
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )`;
      });

      const result = await this.executeWithRetry(
        logger,
        'insertMany',
        sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES ${sql.join(valueRows, sql`, `)}
        RETURNING xmin::text::bigint
      `,
      );

      // Convert results to PromiseSettledResult format for backward compatibility
      const rows = this.extractRows(result);
      const settledResults: PromiseSettledResult<MutationResult>[] = rows.map(
        (row) => ({
          status: 'fulfilled' as const,
          value: { cas: this.decodeCasFromRow(row) },
        }),
      );

      return ok({ value: settledResults });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('insertMany failed', { error, pgDetails });
      return err(DALErrors.dbQuery('insertMany operation failed'));
    }
  }

  async upsert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
    options?: UpsertOptions,
  ): Promise<DbResult<MutationResult>> {
    try {
      const { id, type, version, created, modified, deleted, ...data } = value;
      const cas = options?.cas;

      const result = await this.executeWithRetry(
        logger,
        'upsert',
        sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES (
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          version = EXCLUDED.version,
          modified = EXCLUDED.modified,
          deleted = EXCLUDED.deleted,
          data = EXCLUDED.data
        ${
          cas
            ? sql`WHERE ${sql.identifier(collection)}.xmin::text::bigint = ${cas.value}::bigint`
            : sql``
        }
        RETURNING xmin::text::bigint
      `,
      );

      const rows = this.extractRows(result);
      if (rows.length === 0) {
        return err(
          DALErrors.dbQuery(
            'CAS mismatch - document was modified by another process',
          ),
        );
      }

      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('upsert failed', { error, pgDetails });
      return err(DALErrors.dbQuery('upsert operation failed'));
    }
  }

  async upsertMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    values: T[],
  ): Promise<DbResult<PromiseSettledResult<MutationResult>[]>> {
    try {
      if (values.length === 0) {
        return ok({ value: [] });
      }

      const valueRows = values.map((v) => {
        const { id, type, version, created, modified, deleted, ...data } = v;
        return sql`(
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )`;
      });

      const result = await this.executeWithRetry(
        logger,
        'upsertMany',
        sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES ${sql.join(valueRows, sql`, `)}
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          version = EXCLUDED.version,
          modified = EXCLUDED.modified,
          deleted = EXCLUDED.deleted,
          data = EXCLUDED.data
        RETURNING xmin::text::bigint
      `,
      );

      const rows = this.extractRows(result);
      const settledResults: PromiseSettledResult<MutationResult>[] = rows.map(
        (row) => ({
          status: 'fulfilled' as const,
          value: { cas: this.decodeCasFromRow(row) },
        }),
      );

      return ok({ value: settledResults });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('upsertMany failed', { error, pgDetails });
      return err(DALErrors.dbQuery('upsertMany operation failed'));
    }
  }

  async replace<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    cas: Cas,
    value: T,
  ): Promise<DbResult<{ cas: Cas }>> {
    try {
      const { id, type, version, created, modified, deleted, ...data } = value;

      // Optimistic locking: check current xmin matches provided CAS
      const result = await this.executeWithRetry(
        logger,
        'replace',
        sql`
        INSERT INTO ${sql.identifier(collection)}
          (id, type, version, created, modified, deleted, data)
        VALUES (
          ${id},
          ${type},
          ${version ?? 0},
          ${created}::timestamptz,
          ${modified}::timestamptz,
          ${deleted ? sql`${deleted}::timestamptz` : sql`NULL`},
          ${toJsonbSql(data, this.driverType)}
        )
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          version = EXCLUDED.version,
          modified = EXCLUDED.modified,
          deleted = EXCLUDED.deleted,
          data = EXCLUDED.data
        WHERE ${sql.identifier(collection)}.xmin::text::bigint = ${cas.value}::bigint
        RETURNING xmin::text::bigint
      `,
      );

      const rows = this.extractRows(result);
      if (rows.length === 0) {
        return err(
          DALErrors.dbQuery(
            'CAS mismatch - document was modified by another process',
          ),
        );
      }

      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('replace failed', { error, pgDetails });
      return err(DALErrors.dbQuery('replace operation failed'));
    }
  }

  async remove(
    logger: Logger,
    collection: string,
    id: string,
    cas?: Cas,
  ): Promise<DbResult<MutationResult>> {
    try {
      if (cas) {
        // With CAS check for optimistic locking
        const result = await this.executeWithRetry(
          logger,
          'remove',
          sql`
          DELETE FROM ${sql.identifier(collection)}
          WHERE id = ${id} AND xmin::text::bigint = ${cas.value}::bigint
          RETURNING xmin::text::bigint
        `,
        );

        const rows = this.extractRows(result);
        if (rows.length === 0) {
          return err(
            DALErrors.dbQuery(
              'CAS mismatch - document was modified by another process',
            ),
          );
        }
        return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
      }
      // Without CAS check
      const result = await this.executeWithRetry(
        logger,
        'remove',
        sql`
          DELETE FROM ${sql.identifier(collection)}
          WHERE id = ${id}
          RETURNING xmin::text::bigint
        `,
      );

      const rows = this.extractRows(result);
      return ok({ value: { cas: this.decodeCasFromRow(rows[0]) } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('remove failed', { error, pgDetails });
      return err(DALErrors.dbQuery('remove operation failed'));
    }
  }

  async countFiltered<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    filter: Filter<T, keyof T | 'created' | 'modified' | 'deleted'>,
  ): Promise<DbResult<number>> {
    try {
      const conditions = this.buildWhereConditions(collection, type, filter);

      const query = sql`
        SELECT COUNT(*) as total_size
        FROM ${sql.identifier(collection)}
        WHERE ${sql.join(conditions, sql` AND `)}
      `;

      const result = await this.db.execute(query);
      const rows = this.extractRows(result);
      const first = rows[0];
      if (!isRowObject(first)) return ok({ value: 0 });
      const totalRaw = first['total_size'];
      const total =
        typeof totalRaw === 'number' ? totalRaw : Number(totalRaw ?? 0);
      return ok({ value: total });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('countFiltered failed', { error, pgDetails });
      return err(DALErrors.dbQuery('countFiltered operation failed'));
    }
  }

  async bulkUpdate<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    filter: Filter<T, keyof T | 'created' | 'modified' | 'deleted'>,
    updates: BulkUpdate<T>,
  ): Promise<DbResult<{ affected: number }>> {
    try {
      if (!filter || Object.keys(filter).length === 0) {
        return ok({ value: { affected: 0 } });
      }
      const conditions = this.buildWhereConditions(collection, type, filter);

      const updateClauses: SQL[] = [];
      if (updates.type !== undefined) {
        updateClauses.push(sql`${this.ident('type')} = ${updates.type}`);
      }
      if (updates.version !== undefined) {
        updateClauses.push(sql`${this.ident('version')} = ${updates.version}`);
      }
      if (updates.created !== undefined) {
        updateClauses.push(
          sql`${this.ident('created')} = ${updates.created}::timestamptz`,
        );
      }
      if (updates.modified !== undefined) {
        updateClauses.push(
          sql`${this.ident('modified')} = ${updates.modified}::timestamptz`,
        );
      }
      if (updates.deleted !== undefined) {
        updateClauses.push(
          sql`${this.ident('deleted')} = ${updates.deleted}::timestamptz`,
        );
      }

      if (updateClauses.length === 0) {
        return ok({ value: { affected: 0 } });
      }

      const result = await this.db.execute(sql`
        UPDATE ${sql.identifier(collection)}
        SET ${sql.join(updateClauses, sql`, `)}
        WHERE ${sql.join(conditions, sql` AND `)}
        RETURNING id
      `);

      const rows = this.extractRows(result);
      return ok({ value: { affected: rows.length } });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('bulkUpdate failed', { error, pgDetails });
      return err(DALErrors.dbQuery('bulkUpdate operation failed'));
    }
  }

  async findByPartition<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    partitionName: string,
    partitionValue: string,
    types?: string[],
    options?: Omit<FindOptions<T>, 'filter'>,
  ): Promise<DbResult<T[]>> {
    try {
      const { limit = 1000, offset, orderBy } = options || {};

      // Build conditions for partition query
      const conditions: SQL[] = [sql`deleted IS NULL`];

      conditions.push(
        sql`${this.ident(`part_${partitionName}`)} = ${partitionValue}`,
      );

      // Add type filter if specified
      if (types && types.length > 0) {
        // Use IN instead of ANY for better compatibility with Drizzle + PGlite
        const typeConditions = types.map((t) => sql`type = ${t}`);
        conditions.push(sql`(${sql.join(typeConditions, sql` OR `)})`);
      }

      let query = sql`
        SELECT
          id,
          type,
          version,
          to_json(created)#>>'{}' as created,
          to_json(modified)#>>'{}' as modified,
          to_json(deleted)#>>'{}' as deleted,
          data
        FROM ${sql.identifier(collection)}
        WHERE ${sql.join(conditions, sql` AND `)}
      `;

      // Add ordering - use generated columns if available
      if (orderBy) {
        const orderField = String(orderBy.field);
        const orderFieldRef = this.getFieldReference(collection, orderField);
        const direction = orderBy.direction === 'ASC' ? sql` ASC` : sql` DESC`;
        query = sql`${query} ORDER BY ${orderFieldRef}${direction}`;
      }

      query = sql`${query} LIMIT ${limit}`;
      if (offset) {
        query = sql`${query} OFFSET ${offset}`;
      }

      const result = await this.db.execute(query);
      const rows = this.extractRows(result);

      const ret: T[] = [];
      for (const row of rows) {
        const decoded = this.decodeTypedObjectRow<T>(row);
        if (decoded) ret.push(decoded);
      }

      return ok({ value: ret });
    } catch (error) {
      const pgDetails = extractPgErrorDetails(error);
      logger.warn('findByPartition failed', { error, pgDetails });
      return err(DALErrors.dbQuery('findByPartition operation failed'));
    }
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  getDb(): DrizzleDb {
    return this.db;
  }

  /**
   * Get the underlying client (postgres.Sql for postgres.js, mock for PGlite)
   * Returns undefined if using PGlite (no direct client access needed)
   */
  getClient(): postgres.Sql | undefined {
    // Only return the client if it's a real postgres.Sql instance
    if ('CLOSE' in this.client) {
      return this.client as postgres.Sql;
    }
    return undefined;
  }

  /**
   * Begin a new transaction.
   * Use with `await using` for automatic commit/rollback, or explicit commit()/rollback().
   *
   * Default isolation: 'repeatable_read' (matches Couchbase snapshot isolation)
   */
  async beginTransaction(options?: TransactionOptions): Promise<Transaction> {
    const isolation = options?.isolation ?? 'repeatable_read';
    const pgIsolation = mapIsolationLevel(isolation);

    // We need to create the transaction and wait for it to be ready
    let transaction: DrizzleTransaction;
    let transactionReady: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      transactionReady = resolve;
    });

    // Type assertion needed because DrizzleDb is a union type
    // All our supported DB types (postgres.js, PGlite, Bun SQL) support .transaction()
    const db = this.db as PostgresJsDatabase;

    // Start the Drizzle transaction - it runs until we signal completion
    const txPromise = db.transaction(
      async (drizzleTx) => {
        // Create our transaction wrapper with the Drizzle transaction context
        transaction = new DrizzleTransaction(
          drizzleTx,
          this.tableSchemas,
          this.driverType,
        );
        // Signal that the transaction is ready
        transactionReady!();
        // Wait for commit or rollback signal
        await transaction.completionPromise;
      },
      {
        isolationLevel: pgIsolation,
      },
    );

    // Handle the transaction promise in the background
    // It will complete when commit() or rollback() is called
    void txPromise.catch((error) => {
      // Mark rejection as handled to avoid unhandled rejection warnings.
      // Callers that await commit()/rollback() will observe the real failure there.
      if (error instanceof TransactionRollbackError) return;
    });

    // Wait for the transaction to be ready
    await readyPromise;

    // Attach the underlying promise so commit()/rollback() can await completion and
    // rethrow commit-time failures to the caller.
    transaction!.attachUnderlyingTransactionPromise(txPromise);

    return transaction!;
  }
}
