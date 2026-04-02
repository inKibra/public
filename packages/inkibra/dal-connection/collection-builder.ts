import type { Logger } from '@inkibra/logger';
import {
  Filter as ObservableCacheFilter,
  type Filter as ObservableFilter,
} from '@inkibra/observable-cache';
import { sql } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  AnyPgColumn,
  PgColumnBuilderBase,
} from 'drizzle-orm/pg-core/columns/common';
import type { IndexBuilder } from 'drizzle-orm/pg-core/indexes';
import { err, ok } from 'neverthrow';
import type { DbResult, DbWarning, NonEmptyArray } from './db-result';
import type {
  Cas,
  Driver,
  EnsureCollectionOptions,
  FindOptions,
  Transaction,
  TypedObjectBase,
} from './driver';

const DriverFilterOperators = ObservableCacheFilter.Operators;

function mergeWarnings(
  a?: NonEmptyArray<DbWarning>,
  b?: NonEmptyArray<DbWarning>,
): NonEmptyArray<DbWarning> | undefined {
  if (a && b) return [...a, ...b] as NonEmptyArray<DbWarning>;
  return a ?? b;
}

function appendWarning(
  warnings: NonEmptyArray<DbWarning> | undefined,
  warning: DbWarning,
): NonEmptyArray<DbWarning> {
  if (!warnings) return [warning];
  return [...warnings, warning] as NonEmptyArray<DbWarning>;
}

// ============================================================================
// Base Types
// ============================================================================

/**
 * Base interface for all models in a collection
 */
export interface ModelBase extends TypedObjectBase {
  id: string;
  type: string;
  version: number;
  created: string;
  modified: string;
  deleted?: string;
}

/**
 * Filter operators for queries
 */
export type FilterOperator<T> =
  | { op: 'eq'; value: T }
  | { op: 'neq'; value: T }
  | { op: 'gt'; value: T }
  | { op: 'gte'; value: T }
  | { op: 'lt'; value: T }
  | { op: 'lte'; value: T }
  | { op: 'in'; values: T[] }
  | { op: 'nin'; values: T[] }
  | { op: 'like'; value: string }
  | { op: 'between'; from: T; to: T };

/**
 * Helper to create filter operators
 */
export const Filter = {
  eq: <T>(value: T): FilterOperator<T> => ({ op: 'eq', value }),
  neq: <T>(value: T): FilterOperator<T> => ({ op: 'neq', value }),
  gt: <T>(value: T): FilterOperator<T> => ({ op: 'gt', value }),
  gte: <T>(value: T): FilterOperator<T> => ({ op: 'gte', value }),
  lt: <T>(value: T): FilterOperator<T> => ({ op: 'lt', value }),
  lte: <T>(value: T): FilterOperator<T> => ({ op: 'lte', value }),
  in: <T>(values: T[]): FilterOperator<T> => ({ op: 'in', values }),
  nin: <T>(values: T[]): FilterOperator<T> => ({ op: 'nin', values }),
  like: (value: string): FilterOperator<string> => ({ op: 'like', value }),
  between: <T>(from: T, to: T): FilterOperator<T> => ({
    op: 'between',
    from,
    to,
  }),
};

// ============================================================================
// Type-Safe Filter Types
// ============================================================================

/**
 * Queryable fields = value indexes + base temporal fields
 */
type QueryableFields<
  TModel extends ModelBase,
  TValueIndexes extends readonly (keyof TModel & string)[],
> = TValueIndexes[number] | 'created' | 'modified';

/**
 * Type-safe filter where only indexed fields can be queried
 */
export type TypeSafeFilter<
  TModel extends ModelBase,
  TValueIndexes extends readonly (keyof TModel & string)[],
> = {
  [K in QueryableFields<TModel, TValueIndexes>]?: FilterOperator<
    K extends keyof TModel ? TModel[K] : string
  >;
};

/**
 * Type-safe orderBy where only indexed fields can be sorted
 */
export type TypeSafeOrderBy<
  TModel extends ModelBase,
  TValueIndexes extends readonly (keyof TModel & string)[],
> = {
  field: QueryableFields<TModel, TValueIndexes>;
  direction: 'ASC' | 'DESC';
};

/**
 * Type-safe find options
 */
export type TypeSafeFindOptions<
  TModel extends ModelBase,
  TValueIndexes extends readonly (keyof TModel & string)[],
> = {
  filter?: TypeSafeFilter<TModel, TValueIndexes>;
  limit?: number;
  offset?: number;
  orderBy?: TypeSafeOrderBy<TModel, TValueIndexes>;
};

// ============================================================================
// Upgrade Types
// ============================================================================

/**
 * Upgrade configuration for upgrading JSONB data from a previous version
 */
export type UpgradeConfig<
  TOld extends ModelBase,
  TNew extends ModelBase,
  TFromValueIndexes extends readonly string[],
> = {
  /** How to handle errors when querying both versions */
  mode?: 'strict' | 'best_effort';
  /** The version number to upgrade from */
  fromVersion: number;
  /** Value indexes that existed on the old version (for query compatibility) */
  fromValueIndexes: TFromValueIndexes;
  /** Type guard to identify old version records */
  fromDiscriminator: (data: unknown) => data is TOld;
  /** Transform function to upgrade old data to new format */
  transform: (old: TOld) => TNew;
  /** Transform filters when querying to handle old field names */
  transformFilter: (
    filter: Partial<Record<string, unknown>>,
  ) => Partial<Record<string, unknown>>;
};

/**
 * Options for the batch upgrade operation
 */
export type UpgradeOptions = {
  /** Number of records to process per batch (default: 100) */
  batchSize?: number;
  /** If true, only log what would be upgraded without making changes */
  dryRun?: boolean;
  /** Callback for progress updates */
  onProgress?: (stats: UpgradeProgressStats) => void;
};

/**
 * Progress statistics during upgrade
 */
export type UpgradeProgressStats = {
  /** Number of records upgraded so far */
  upgraded: number;
  /** Number of records that failed to upgrade */
  failed: number;
  /** Total number of records to upgrade (may increase as batches are processed) */
  total: number;
  /** Current batch number */
  currentBatch: number;
};

/**
 * Final result of an upgrade operation
 */
export type UpgradeResult = {
  /** Total number of records successfully upgraded */
  upgraded: number;
  /** Total number of records that failed */
  failed: number;
  /** IDs of records that failed to upgrade */
  failedIds: string[];
  /** Whether this was a dry run */
  dryRun: boolean;
};

// ============================================================================
// Model DAL Types
// ============================================================================

/**
 * Options for ModelDAL.get operation
 */
export type ModelGetOptions = {
  /** Transaction context for transactional operations */
  tx?: Transaction;
};

/**
 * Options for ModelDAL.exists operation
 */
export type ModelExistsOptions = {
  /** Transaction context for transactional operations */
  tx?: Transaction;
};

/**
 * Options for ModelDAL.insert operation
 */
export type ModelInsertOptions = {
  /** Transaction context for transactional operations */
  tx?: Transaction;
};

/**
 * Options for ModelDAL.replace operation
 */
export type ModelReplaceOptions = {
  /** CAS token for optimistic concurrency (optional in transactions) */
  cas?: Cas;
  /** Transaction context for transactional operations */
  tx?: Transaction;
};

/**
 * Options for ModelDAL.upsert operation
 */
export type ModelUpsertOptions = {
  /** CAS token for optimistic concurrency (optional) */
  cas?: Cas;
  /** Transaction context for transactional operations */
  tx?: Transaction;
};

/**
 * Options for ModelDAL.remove operation
 */
export type ModelRemoveOptions = {
  /** CAS token for optimistic concurrency (optional) */
  cas?: Cas;
  /** Transaction context for transactional operations */
  tx?: Transaction;
};

/**
 * Type-safe DAL interface for a specific model
 *
 * All mutation methods accept an optional options object with `tx` for transactions.
 * When `tx` is provided, the operation uses the transaction context.
 *
 * @example
 * ```typescript
 * // Without transaction
 * await collection.POST.insert(logger, postDoc);
 * await collection.POST.find(logger, { filter: { authorId: Filter.eq('user_1') } });
 *
 * // With transaction
 * await using tx = await driver.beginTransaction();
 * await collection.POST.insert(logger, postDoc, { tx });
 * await collection.POST.replace(logger, updatedDoc, { cas, tx });
 * await collection.COMMENT.insert(logger, commentDoc, { tx });
 * // auto-commits when tx goes out of scope
 * ```
 */
export type ModelDAL<
  TModel extends ModelBase,
  TValueIndexes extends readonly (keyof TModel & string)[],
> = {
  /**
   * Find multiple records with type-safe filters
   * Only indexed fields can be used in filter and orderBy
   */
  find: (
    logger: Logger,
    options?: TypeSafeFindOptions<TModel, TValueIndexes> & { tx?: Transaction },
  ) => Promise<DbResult<TModel[]>>;

  /**
   * Find a single record with type-safe filters
   */
  findOne: (
    logger: Logger,
    options?: Pick<TypeSafeFindOptions<TModel, TValueIndexes>, 'filter'> & {
      tx?: Transaction;
    },
  ) => Promise<DbResult<TModel | undefined>>;

  /**
   * Get a record by ID
   */
  get: (
    logger: Logger,
    id: string,
    options?: ModelGetOptions,
  ) => Promise<DbResult<{ cas: Cas; value: TModel } | undefined>>;

  /**
   * Get multiple records by IDs
   * Note: getMany is not available in transactions (use multiple get calls instead)
   */
  getMany: (
    logger: Logger,
    ids: string[],
  ) => Promise<DbResult<{ cas: Cas; value: TModel }[]>>;

  /**
   * Check if a record exists
   */
  exists: (
    logger: Logger,
    id: string,
    options?: ModelExistsOptions,
  ) => Promise<boolean>;

  /**
   * Insert a new record
   */
  insert: (
    logger: Logger,
    value: Omit<TModel, 'version' | 'created' | 'modified'>,
    options?: ModelInsertOptions,
  ) => Promise<DbResult<{ cas: Cas }>>;

  /**
   * Insert multiple records
   * Note: insertMany is not available in transactions (use multiple insert calls instead)
   */
  insertMany: (
    logger: Logger,
    values: Omit<TModel, 'version' | 'created' | 'modified'>[],
  ) => Promise<DbResult<PromiseSettledResult<{ cas: Cas }>[]>>;

  /**
   * Replace an existing record
   * CAS is optional in transactions - transaction isolation handles concurrency
   */
  replace: (
    logger: Logger,
    value: TModel,
    options?: ModelReplaceOptions,
  ) => Promise<DbResult<{ cas: Cas }>>;

  /**
   * Upsert a record (insert or update)
   */
  upsert: (
    logger: Logger,
    value: Omit<TModel, 'version' | 'created' | 'modified'>,
    options?: ModelUpsertOptions,
  ) => Promise<DbResult<{ cas: Cas }>>;

  /**
   * Remove a record
   */
  remove: (
    logger: Logger,
    id: string,
    options?: ModelRemoveOptions,
  ) => Promise<DbResult<{ cas: Cas }>>;

  /**
   * Batch upgrade old-version records to the current version.
   * Only available if an upgrade config was provided.
   * Returns undefined if no upgrade config exists.
   * Note: upgrade is not available in transactions
   */
  upgrade: (
    logger: Logger,
    options?: UpgradeOptions,
  ) => Promise<DbResult<UpgradeResult> | undefined>;
};

// ============================================================================
// Builder State Types (Internal)
// ============================================================================

type ModelState = {
  type: string;
  version: number;
  valueIndexes: readonly string[];
  arrayIndexes: readonly string[];
  partitions: Record<string, string>;
  discriminator: (data: unknown) => boolean;
  upgrade?: {
    mode?: 'strict' | 'best_effort';
    fromVersion: number;
    fromValueIndexes: readonly string[];
    fromDiscriminator: (data: unknown) => boolean;
    transform: (old: unknown) => unknown;
    transformFilter: (
      filter: Partial<Record<string, unknown>>,
    ) => Partial<Record<string, unknown>>;
  };
};

type BuilderState<TName extends string> = {
  name: TName;
  partitions: Map<string, true>;
  models: Map<string, ModelState>;
  customIndexes: CustomIndexConfig[];
};

/**
 * Custom index configuration
 */
export type CustomIndexConfig = {
  fields: readonly string[];
  name?: string;
  unique?: boolean;
};

// ============================================================================
// Model Registry (tracks type info per model)
// ============================================================================

/**
 * Registry entry for a model's type information
 */
type ModelRegistryEntry<
  TModel extends ModelBase,
  TValueIndexes extends readonly (keyof TModel & string)[],
> = {
  model: TModel;
  valueIndexes: TValueIndexes;
};

type AnyModelRegistryEntry = {
  model: ModelBase;
  valueIndexes: readonly string[];
};

/**
 * Built collection type with full type safety
 */
export type BuiltCollection<
  TName extends string,
  TPartitions extends string,
  TModelRegistry extends Record<string, AnyModelRegistryEntry>,
> = {
  /** The collection name */
  name: TName;

  /** The pgTable for drizzle-kit */
  table: AnyPgTable;

  /** Available partition names */
  partitions: TPartitions[];

  /** Initialize the collection with a driver */
  initialize: (
    logger: Logger,
    driver: Driver,
    options?: EnsureCollectionOptions,
  ) => Promise<void>;

  /** Check if collection is initialized */
  isInitialized: () => boolean;

  /** Find by partition across model types */
  findByPartition: <TType extends keyof TModelRegistry>(
    logger: Logger,
    partitionName: TPartitions,
    partitionValue: string,
    options?: {
      types?: TType[];
      limit?: number;
      offset?: number;
      orderBy?: { field: string; direction: 'ASC' | 'DESC' };
    },
  ) => Promise<DbResult<TModelRegistry[TType]['model'][]>>;
} & {
  /** Type-safe model DAL accessors */
  [K in keyof TModelRegistry]: TModelRegistry[K] extends {
    model: infer TModel extends ModelBase;
    valueIndexes: infer TValueIndexes;
  }
    ? TValueIndexes extends readonly (keyof TModel & string)[]
      ? ModelDAL<TModel, TValueIndexes>
      : never
    : never;
};

// ============================================================================
// Collection Builder
// ============================================================================

/**
 * Collection builder with fluent API and type tracking
 */
class CollectionBuilder<
  TName extends string,
  TPartitions extends string = never,
  TModelRegistry extends Record<string, AnyModelRegistryEntry> = {},
> {
  private state: BuilderState<TName>;

  constructor(name: TName) {
    this.state = {
      name,
      partitions: new Map(),
      models: new Map(),
      customIndexes: [],
    };
  }

  private fork<
    TNextPartitions extends string,
    TNextModelRegistry extends Record<string, AnyModelRegistryEntry>,
  >(): CollectionBuilder<TName, TNextPartitions, TNextModelRegistry> {
    const next = new CollectionBuilder<
      TName,
      TNextPartitions,
      TNextModelRegistry
    >(this.state.name);
    next.state = {
      name: this.state.name,
      partitions: new Map(this.state.partitions),
      models: new Map(this.state.models),
      customIndexes: [...this.state.customIndexes],
    };
    return next;
  }

  /**
   * Add a partition to the collection
   */
  addPartition<TPartitionName extends string>(
    partitionName: TPartitionName,
  ): CollectionBuilder<TName, TPartitions | TPartitionName, TModelRegistry> {
    const next = this.fork<TPartitions | TPartitionName, TModelRegistry>();
    next.state.partitions.set(partitionName, true);
    return next;
  }

  /**
   * Add a model to the collection with type-safe configuration
   */
  addModel<
    TType extends string,
    TModel extends ModelBase & { type: TType },
    TValueIndexes extends readonly (keyof TModel & string)[],
    TArrayIndexes extends readonly (keyof TModel & string)[] = readonly [],
    TOldModel extends ModelBase = never,
    TFromValueIndexes extends readonly string[] = readonly [],
    TModelPartitions extends {
      [K in TPartitions]?: keyof TModel & string;
    } = {},
  >(
    type: TType,
    config: {
      version?: number;
      valueIndexes: TValueIndexes;
      arrayIndexes?: TArrayIndexes;
      partitions?: TModelPartitions;
      discriminator: (data: unknown) => data is TModel;
      upgrade?: UpgradeConfig<TOldModel, TModel, TFromValueIndexes>;
    },
  ): CollectionBuilder<
    TName,
    TPartitions,
    TModelRegistry & { [K in TType]: ModelRegistryEntry<TModel, TValueIndexes> }
  > {
    const next = this.fork<
      TPartitions,
      TModelRegistry & {
        [K in TType]: ModelRegistryEntry<TModel, TValueIndexes>;
      }
    >();
    // Validate partition references
    if (config.partitions) {
      for (const partitionName of Object.keys(config.partitions)) {
        if (!next.state.partitions.has(partitionName)) {
          throw new Error(
            `Model "${type}" references partition "${partitionName}" which hasn't been defined. ` +
              `Call .addPartition("${partitionName}") before adding this model.`,
          );
        }
      }
    }

    next.state.models.set(type, {
      type,
      version: config.version ?? 0,
      valueIndexes: config.valueIndexes,
      arrayIndexes: config.arrayIndexes ?? [],
      partitions: (config.partitions ?? {}) as Record<string, string>,
      discriminator: config.discriminator,
      upgrade: config.upgrade
        ? ((upgradeConfig) => ({
            mode: upgradeConfig.mode,
            fromVersion: upgradeConfig.fromVersion,
            fromValueIndexes: upgradeConfig.fromValueIndexes,
            fromDiscriminator: (data: unknown) =>
              upgradeConfig.fromDiscriminator(data),
            transform: (old: unknown) =>
              upgradeConfig.transform(old as TOldModel),
            transformFilter: upgradeConfig.transformFilter,
          }))(config.upgrade)
        : undefined,
    });

    return next;
  }

  /**
   * Add a custom composite index
   */
  addIndex(
    config: CustomIndexConfig,
  ): CollectionBuilder<TName, TPartitions, TModelRegistry> {
    this.state.customIndexes.push(config);
    return this;
  }

  /**
   * Build the collection
   */
  build(): BuiltCollection<TName, TPartitions, TModelRegistry> {
    const state = this.state;
    const table = this.buildPgTable();

    // Runtime state
    let driver: Driver | null = null;
    let initialized = false;

    // Build the collection object
    const collection: Record<string, unknown> = {
      name: state.name,
      table,
      partitions: Array.from(state.partitions.keys()),

      initialize: async (
        logger: Logger,
        d: Driver,
        options?: EnsureCollectionOptions,
      ) => {
        driver = d;

        // Build DAL configs with proper partition handling
        const dalConfigs = Array.from(state.models.values()).map((m) => {
          const partitionEntries = Object.entries(m.partitions);

          return {
            type: m.type,
            version: m.version,
            valueIndexes: [...m.valueIndexes],
            arrayIndexes: [...m.arrayIndexes],
            partitions: partitionEntries.map(([name, valueField]) => ({
              name,
              valueField,
            })),
          };
        });

        // Ensure collection exists with schema
        await driver.ensureCollection(
          logger,
          {
            name: state.name,
            dals: dalConfigs,
          },
          options,
        );

        initialized = true;
      },

      isInitialized: () => initialized,

      findByPartition: async (
        logger: Logger,
        partitionName: string,
        partitionValue: string,
        options?: {
          types?: string[];
          limit?: number;
          offset?: number;
          orderBy?: { field: string; direction: 'ASC' | 'DESC' };
        },
      ) => {
        if (!driver)
          throw new Error(
            'Collection not initialized. Call initialize() first.',
          );

        const result = await driver.findByPartition(
          logger,
          state.name,
          partitionName,
          partitionValue,
          options?.types,
          options
            ? {
                limit: options.limit,
                offset: options.offset,
                orderBy: options.orderBy as {
                  field: keyof TypedObjectBase | 'created' | 'modified';
                  direction: 'ASC' | 'DESC';
                },
              }
            : undefined,
        );

        if (result.isErr()) {
          return err(result.error);
        }

        const filtered: unknown[] = [];
        const allowedTypes = options?.types
          ? new Set(options.types)
          : undefined;

        for (const item of result.value.value) {
          const model = state.models.get(item.type);
          if (!model) continue;
          if (allowedTypes && !allowedTypes.has(item.type)) continue;

          const upgraded =
            model.upgrade && item.version === model.upgrade.fromVersion
              ? model.upgrade.transform(item)
              : item;

          if (model.discriminator(upgraded)) {
            filtered.push(upgraded);
          }
        }

        return ok({
          value: filtered,
          warnings: result.value.warnings,
        });
      },
    };

    // Add model DAL accessors
    for (const [type, modelConfig] of state.models) {
      collection[type] = this.buildModelDAL(
        state.name,
        type,
        modelConfig,
        () => driver,
      );
    }

    return collection as BuiltCollection<TName, TPartitions, TModelRegistry>;
  }

  /**
   * Build the pgTable from configuration
   */
  private buildPgTable(): AnyPgTable {
    const tableName = this.state.name;

    // Base columns
    const columns: Record<string, PgColumnBuilderBase> = {
      id: text('id').primaryKey(),
      type: text('type').notNull(),
      version: integer('version').notNull().default(0),
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

    // Track generated columns to avoid duplicates
    const generatedColumns = new Set<string>();

    // Build partition columns with CASE expressions
    for (const partitionName of this.state.partitions.keys()) {
      const columnName = `part_${partitionName}`;

      // Build CASE expression for different model mappings
      const caseWhenClauses: string[] = [];
      for (const [type, model] of this.state.models) {
        const field = model.partitions[partitionName];
        if (field) {
          // Check if it's a base column or needs JSONB extraction
          const isBaseColumn = [
            'id',
            'type',
            'version',
            'created',
            'modified',
            'deleted',
          ].includes(field);
          const expression = isBaseColumn ? field : `data->>'${field}'`;
          caseWhenClauses.push(`WHEN type = '${type}' THEN ${expression}`);
        }
      }

      if (caseWhenClauses.length > 0) {
        const caseExpression = `CASE ${caseWhenClauses.join(' ')} END`;
        columns[columnName] = text(columnName).generatedAlwaysAs(
          sql.raw(`(${caseExpression})`),
        );
        generatedColumns.add(columnName);
      }
    }

    // Build value index columns (shared across models)
    const valueIndexFields = new Set<string>();
    for (const model of this.state.models.values()) {
      for (const field of model.valueIndexes) {
        valueIndexFields.add(field);
      }
      // Include upgrade's fromValueIndexes too
      if (model.upgrade) {
        for (const field of model.upgrade.fromValueIndexes) {
          valueIndexFields.add(field);
        }
      }
    }

    for (const field of valueIndexFields) {
      const columnName = `val_${field.toLowerCase()}`;
      if (!generatedColumns.has(columnName)) {
        columns[columnName] = text(columnName).generatedAlwaysAs(
          sql.raw(`(data->>'${field}')`),
        );
        generatedColumns.add(columnName);
      }
    }

    // Build array index columns
    const arrayIndexFields = new Set<string>();
    for (const model of this.state.models.values()) {
      for (const field of model.arrayIndexes) {
        arrayIndexFields.add(field);
      }
    }

    for (const field of arrayIndexFields) {
      const columnName = `arr_${field.toLowerCase()}`;
      if (!generatedColumns.has(columnName)) {
        columns[columnName] = jsonb(columnName).generatedAlwaysAs(
          sql.raw(`(data->'${field}')`),
        );
        generatedColumns.add(columnName);
      }
    }

    // Build indexes
    const indexBuilder = (table: unknown): IndexBuilder[] => {
      const columnTable = table as Record<string, AnyPgColumn | undefined> & {
        type: AnyPgColumn;
        version: AnyPgColumn;
      };

      const indexes: IndexBuilder[] = [
        index(`${tableName}_type_idx`).on(columnTable.type),
        index(`${tableName}_type_version_idx`).on(
          columnTable.type,
          columnTable.version,
        ),
      ];

      // Partition indexes
      for (const partitionName of this.state.partitions.keys()) {
        const columnName = `part_${partitionName}`;
        const column = columnTable[columnName];
        if (column) {
          indexes.push(
            index(`${tableName}_${columnName}_idx`).on(
              columnTable.type,
              column,
            ),
          );
        }
      }

      // Value indexes
      for (const field of valueIndexFields) {
        const columnName = `val_${field.toLowerCase()}`;
        const column = columnTable[columnName];
        if (column) {
          indexes.push(
            index(`${tableName}_${columnName}_idx`).on(
              columnTable.type,
              column,
            ),
          );
        }
      }

      // Array indexes (GIN)
      for (const field of arrayIndexFields) {
        const columnName = `arr_${field.toLowerCase()}`;
        const column = columnTable[columnName];
        if (column) {
          indexes.push(
            index(`${tableName}_${columnName}_gin_idx`).using('gin', column),
          );
        }
      }

      // Custom indexes
      for (const customIndex of this.state.customIndexes) {
        const indexName =
          customIndex.name ||
          `${tableName}_${customIndex.fields.join('_')}_idx`;
        const indexColumns = customIndex.fields
          .map((f) => {
            // Check if it's a generated column or base column
            const valCol = `val_${f.toLowerCase()}`;
            return columnTable[valCol] ?? columnTable[f];
          })
          .filter((c): c is AnyPgColumn => c !== undefined);

        const [col0, col1, col2] = indexColumns;
        if (indexColumns.length === 1 && col0) {
          indexes.push(index(indexName).on(col0));
        } else if (indexColumns.length === 2 && col0 && col1) {
          indexes.push(index(indexName).on(col0, col1));
        } else if (indexColumns.length >= 3 && col0 && col1 && col2) {
          indexes.push(index(indexName).on(col0, col1, col2));
        }
      }

      return indexes;
    };

    return pgTable(tableName, columns, indexBuilder);
  }

  private convertFilterForDriver(
    filter:
      | TypeSafeFilter<ModelBase, readonly (keyof ModelBase & string)[]>
      | undefined,
  ):
    | ObservableFilter<
        ModelBase,
        keyof ModelBase | 'created' | 'modified' | 'deleted'
      >
    | undefined {
    if (!filter) return undefined;

    const result: Record<string, unknown> = {};
    const entries = Object.entries(filter) as Array<
      [string, FilterOperator<unknown>]
    >;
    for (const [key, op] of entries) {
      if (!op) continue;

      switch (op.op) {
        case 'eq':
          result[key] = {
            operator: DriverFilterOperators.EQUAL,
            value: op.value,
          };
          break;
        case 'neq':
          result[key] = {
            operator: DriverFilterOperators.NOT_EQUAL,
            value: op.value,
          };
          break;
        case 'gt':
          result[key] = {
            operator: DriverFilterOperators.GREATER_THAN,
            value: op.value,
          };
          break;
        case 'gte':
          result[key] = {
            operator: DriverFilterOperators.GREATER_THAN_OR_EQUAL,
            value: op.value,
          };
          break;
        case 'lt':
          result[key] = {
            operator: DriverFilterOperators.LESS_THAN,
            value: op.value,
          };
          break;
        case 'lte':
          result[key] = {
            operator: DriverFilterOperators.LESS_THAN_OR_EQUAL,
            value: op.value,
          };
          break;
        case 'in':
          result[key] = {
            operator: DriverFilterOperators.IN,
            values: op.values,
          };
          break;
        case 'nin':
          result[key] = {
            operator: DriverFilterOperators.NOT_IN,
            values: op.values,
          };
          break;
        case 'like':
          result[key] = {
            operator: DriverFilterOperators.LIKE_AND,
            values: [op.value],
          };
          break;
        case 'between':
          result[key] = {
            operator: DriverFilterOperators.BETWEEN,
            firstValue: op.from,
            secondValue: op.to,
          };
          break;
      }
    }

    return result as ObservableFilter<
      ModelBase,
      keyof ModelBase | 'created' | 'modified' | 'deleted'
    >;
  }

  /**
   * Build a model DAL accessor
   */
  private buildModelDAL(
    collectionName: string,
    type: string,
    modelConfig: ModelState,
    getDriver: () => Driver | null,
  ): ModelDAL<ModelBase, readonly (keyof ModelBase & string)[]> {
    const ensureDriver = (): Driver => {
      const driver = getDriver();
      if (!driver)
        throw new Error('Collection not initialized. Call initialize() first.');
      return driver;
    };

    const convertFilter = (
      filter:
        | TypeSafeFilter<ModelBase, readonly (keyof ModelBase & string)[]>
        | undefined,
    ) => this.convertFilterForDriver(filter);

    const dal: ModelDAL<ModelBase, readonly (keyof ModelBase & string)[]> = {
      find: async (
        logger: Logger,
        options?: TypeSafeFindOptions<
          ModelBase,
          readonly (keyof ModelBase & string)[]
        > & { tx?: Transaction },
      ) => {
        const driver = ensureDriver();
        const { tx, ...findOpts } = options ?? {};

        // If upgrade config exists and not in transaction, query both versions
        if (modelConfig.upgrade && !tx) {
          return this.findWithUpgrade(
            logger,
            driver,
            collectionName,
            type,
            modelConfig,
            findOpts,
          );
        }

        const convertedFilter = convertFilter(findOpts?.filter);
        const findOptions: FindOptions<ModelBase> = {
          limit: findOpts?.limit,
          offset: findOpts?.offset,
          orderBy: findOpts?.orderBy as {
            field: keyof ModelBase | 'created' | 'modified';
            direction: 'ASC' | 'DESC';
          },
          filter: {
            ...convertedFilter,
            version: {
              operator: DriverFilterOperators.EQUAL,
              value: modelConfig.version,
            },
          } as ObservableFilter<
            ModelBase,
            keyof ModelBase | 'created' | 'modified' | 'deleted'
          >,
        };

        // Use transaction if provided, otherwise use driver
        const result = tx
          ? await tx.find<ModelBase>(logger, collectionName, type, findOptions)
          : await driver.find<ModelBase>(
              logger,
              collectionName,
              type,
              findOptions,
            );

        if (result.isErr()) return err(result.error);
        return ok({
          value: result.value.value.filter(
            modelConfig.discriminator,
          ) as ModelBase[],
          warnings: result.value.warnings,
        });
      },

      findOne: async (
        logger: Logger,
        options?: Pick<
          TypeSafeFindOptions<ModelBase, readonly (keyof ModelBase & string)[]>,
          'filter'
        > & { tx?: Transaction },
      ) => {
        ensureDriver();
        const { tx, ...findOpts } = options ?? {};
        const results = await dal.find(logger, {
          filter: findOpts?.filter,
          limit: 1,
          tx,
        });
        if (results.isErr()) return err(results.error);
        const [first] = results.value.value;
        return ok({ value: first, warnings: results.value.warnings });
      },

      get: async (logger, id, options?) => {
        const driver = ensureDriver();
        const tx = options?.tx;

        // Use transaction if provided, otherwise use driver
        const result = tx
          ? await tx.get<ModelBase>(logger, collectionName, id)
          : await driver.get<ModelBase>(logger, collectionName, id);

        if (result.isErr()) return err(result.error);
        if (!result.value.value)
          return ok({ value: undefined, warnings: result.value.warnings });

        // Handle upgrade if needed
        if (
          modelConfig.upgrade &&
          result.value.value.value.version === modelConfig.upgrade.fromVersion
        ) {
          const upgraded = modelConfig.upgrade.transform(
            result.value.value.value,
          );
          return ok({
            value: {
              cas: result.value.value.cas,
              value: upgraded as ModelBase,
            },
            warnings: result.value.warnings,
          });
        }

        if (!modelConfig.discriminator(result.value.value.value)) {
          return ok({ value: undefined, warnings: result.value.warnings });
        }
        return ok({
          value: result.value.value,
          warnings: result.value.warnings,
        });
      },

      getMany: async (logger, ids) => {
        const driver = ensureDriver();
        const result = await driver.getMany<ModelBase>(
          logger,
          collectionName,
          ids,
        );

        if (result.isErr()) return err(result.error);

        const mapped = result.value.value
          .map((item) => {
            // Handle upgrade if needed
            if (
              modelConfig.upgrade &&
              item.value.version === modelConfig.upgrade.fromVersion
            ) {
              return {
                cas: item.cas,
                value: modelConfig.upgrade.transform(item.value),
              };
            }
            return item;
          })
          .filter((item) => modelConfig.discriminator(item.value));

        return ok({
          value: mapped as { cas: Cas; value: ModelBase }[],
          warnings: result.value.warnings,
        });
      },

      exists: async (logger, id, options?) => {
        const driver = ensureDriver();
        const tx = options?.tx;

        // Use transaction if provided, otherwise use driver
        const result = tx
          ? await tx.exists(logger, collectionName, id)
          : await driver.exists(logger, collectionName, id);

        return result.exists;
      },

      insert: async (
        logger: Logger,
        value: Omit<ModelBase, 'version' | 'created' | 'modified'>,
        options?: ModelInsertOptions,
      ) => {
        const driver = ensureDriver();
        const tx = options?.tx;
        const now = new Date().toISOString();
        const doc = {
          ...value,
          version: modelConfig.version,
          created: now,
          modified: now,
        } as ModelBase;

        // Use transaction if provided, otherwise use driver
        const result = tx
          ? await tx.insert<ModelBase>(logger, collectionName, doc)
          : await driver.insert<ModelBase>(logger, collectionName, doc);

        if (result.isErr()) return err(result.error);
        return ok({
          value: result.value.value,
          warnings: result.value.warnings,
        });
      },

      insertMany: async (
        logger: Logger,
        values: Omit<ModelBase, 'version' | 'created' | 'modified'>[],
      ) => {
        const driver = ensureDriver();
        const now = new Date().toISOString();
        const result = await driver.insertMany<ModelBase>(
          logger,
          collectionName,
          values.map((v) => ({
            ...v,
            version: modelConfig.version,
            created: now,
            modified: now,
          })),
        );

        if (result.isErr()) return err(result.error);
        return ok({
          value: result.value.value,
          warnings: result.value.warnings,
        });
      },

      replace: async (
        logger: Logger,
        value: ModelBase,
        options?: ModelReplaceOptions,
      ) => {
        const driver = ensureDriver();
        const { cas, tx } = options ?? {};
        const updatedValue = {
          ...value,
          modified: new Date().toISOString(),
        };

        // Use transaction if provided, otherwise use driver
        // In transactions, CAS is optional (transaction isolation handles concurrency)
        if (tx) {
          const result = await tx.replace<ModelBase>(
            logger,
            collectionName,
            cas,
            updatedValue,
          );
          if (result.isErr()) return err(result.error);
          return ok({
            value: result.value.value,
            warnings: result.value.warnings,
          });
        }

        // Outside transactions, CAS is required
        if (!cas) {
          throw new Error(
            'CAS is required for replace outside of transactions',
          );
        }
        const result = await driver.replace<ModelBase>(
          logger,
          collectionName,
          cas,
          updatedValue,
        );

        if (result.isErr()) return err(result.error);
        return ok({
          value: result.value.value,
          warnings: result.value.warnings,
        });
      },

      upsert: async (
        logger: Logger,
        value: Omit<ModelBase, 'version' | 'created' | 'modified'>,
        options?: ModelUpsertOptions,
      ) => {
        const driver = ensureDriver();
        const tx = options?.tx;
        const now = new Date().toISOString();
        const doc = {
          ...value,
          version: modelConfig.version,
          created: now,
          modified: now,
        } as ModelBase;

        // Use transaction if provided, otherwise use driver
        const result = tx
          ? await tx.upsert<ModelBase>(logger, collectionName, doc)
          : await driver.upsert<ModelBase>(logger, collectionName, doc);

        if (result.isErr()) return err(result.error);
        return ok({
          value: result.value.value,
          warnings: result.value.warnings,
        });
      },

      remove: async (
        logger: Logger,
        id: string,
        options?: ModelRemoveOptions,
      ) => {
        const driver = ensureDriver();
        const { cas, tx } = options ?? {};

        // Use transaction if provided, otherwise use driver
        const result = tx
          ? await tx.remove(logger, collectionName, id, cas)
          : await driver.remove(logger, collectionName, id, cas);

        if (result.isErr()) return err(result.error);
        return ok({
          value: result.value.value,
          warnings: result.value.warnings,
        });
      },

      upgrade: async (
        logger: Logger,
        options?: UpgradeOptions,
      ): Promise<DbResult<UpgradeResult> | undefined> => {
        // No upgrade config = nothing to do
        if (!modelConfig.upgrade) {
          return undefined;
        }

        const driver = ensureDriver();
        const upgradeConfig = modelConfig.upgrade;
        const batchSize = options?.batchSize ?? 100;
        const dryRun = options?.dryRun ?? false;

        const result: UpgradeResult = {
          upgraded: 0,
          failed: 0,
          failedIds: [],
          dryRun,
        };

        let currentBatch = 0;
        let hasMore = true;

        while (hasMore) {
          currentBatch++;

          // Query old-version records
          const batchResult = await driver.find<ModelBase>(
            logger,
            collectionName,
            type,
            {
              limit: batchSize,
              filter: {
                version: {
                  operator: DriverFilterOperators.EQUAL,
                  value: upgradeConfig.fromVersion,
                },
              } as ObservableFilter<
                ModelBase,
                keyof ModelBase | 'created' | 'modified' | 'deleted'
              >,
            },
          );

          if (batchResult.isErr()) {
            return err(batchResult.error);
          }

          const records = batchResult.value.value.filter(
            upgradeConfig.fromDiscriminator,
          );

          if (records.length === 0) {
            hasMore = false;
            break;
          }

          // Process each record
          for (const record of records) {
            try {
              // Transform the record
              const upgraded = upgradeConfig.transform(record) as ModelBase;
              upgraded.version = modelConfig.version;
              upgraded.modified = new Date().toISOString();

              if (!dryRun) {
                // Get the current CAS for this record
                const getResult = await driver.get<ModelBase>(
                  logger,
                  collectionName,
                  record.id,
                );

                if (getResult.isErr()) {
                  result.failed++;
                  result.failedIds.push(record.id);
                  continue;
                }

                if (!getResult.value.value) {
                  // Record was deleted between find and get
                  result.failed++;
                  result.failedIds.push(record.id);
                  continue;
                }

                // Replace with upgraded version
                const replaceResult = await driver.replace<ModelBase>(
                  logger,
                  collectionName,
                  getResult.value.value.cas,
                  upgraded,
                );

                if (replaceResult.isErr()) {
                  result.failed++;
                  result.failedIds.push(record.id);
                  continue;
                }
              }

              result.upgraded++;
            } catch {
              result.failed++;
              result.failedIds.push(record.id);
            }
          }

          // Report progress
          options?.onProgress?.({
            upgraded: result.upgraded,
            failed: result.failed,
            total: result.upgraded + result.failed + records.length,
            currentBatch,
          });

          // If we got fewer records than batchSize, we're done
          if (records.length < batchSize) {
            hasMore = false;
          }
        }

        return ok({ value: result, warnings: undefined });
      },
    };

    return dal;
  }

  /**
   * Find with upgrade support - queries both versions and upgrades old data
   */
  private async findWithUpgrade(
    logger: Logger,
    driver: Driver,
    collectionName: string,
    type: string,
    modelConfig: ModelState,
    options?: TypeSafeFindOptions<
      ModelBase,
      readonly (keyof ModelBase & string)[]
    >,
  ): Promise<DbResult<ModelBase[]>> {
    const upgradeConfig = modelConfig.upgrade!;

    // Transform filter for old version
    const convertedFilter = this.convertFilterForDriver(options?.filter);
    const oldFilter = upgradeConfig.transformFilter(
      (convertedFilter ?? {}) as Partial<Record<string, unknown>>,
    );

    // Query old version
    const oldResult = await driver.find<ModelBase>(
      logger,
      collectionName,
      type,
      {
        limit: options?.limit,
        offset: options?.offset,
        orderBy: options?.orderBy as {
          field: keyof ModelBase | 'created' | 'modified';
          direction: 'ASC' | 'DESC';
        },
        filter: {
          ...(oldFilter as Record<string, unknown>),
          version: {
            operator: DriverFilterOperators.EQUAL,
            value: upgradeConfig.fromVersion,
          },
        } as ObservableFilter<
          ModelBase,
          keyof ModelBase | 'created' | 'modified' | 'deleted'
        >,
      },
    );

    // Query new version
    const newResult = await driver.find<ModelBase>(
      logger,
      collectionName,
      type,
      {
        limit: options?.limit,
        offset: options?.offset,
        orderBy: options?.orderBy as {
          field: keyof ModelBase | 'created' | 'modified';
          direction: 'ASC' | 'DESC';
        },
        filter: {
          ...(convertedFilter ?? {}),
          version: {
            operator: DriverFilterOperators.EQUAL,
            value: modelConfig.version,
          },
        } as ObservableFilter<
          ModelBase,
          keyof ModelBase | 'created' | 'modified' | 'deleted'
        >,
      },
    );

    const mode = upgradeConfig.mode ?? 'strict';

    if (mode === 'strict') {
      if (oldResult.isErr()) return err(oldResult.error);
      if (newResult.isErr()) return err(newResult.error);

      const oldData = oldResult.value.value
        .filter(upgradeConfig.fromDiscriminator)
        .map((v) => upgradeConfig.transform(v) as ModelBase);
      const newData = newResult.value.value.filter(modelConfig.discriminator);
      return ok({
        value: [...oldData, ...newData],
        warnings: mergeWarnings(
          oldResult.value.warnings,
          newResult.value.warnings,
        ),
      });
    }

    // best_effort
    if (oldResult.isErr() && newResult.isErr()) {
      return err(oldResult.error);
    }

    const oldData = oldResult.isOk()
      ? oldResult.value.value
          .filter(upgradeConfig.fromDiscriminator)
          .map((v) => upgradeConfig.transform(v) as ModelBase)
      : [];
    const newData = newResult.isOk()
      ? newResult.value.value.filter(modelConfig.discriminator)
      : [];

    let warnings = mergeWarnings(
      oldResult.isOk() ? oldResult.value.warnings : undefined,
      newResult.isOk() ? newResult.value.warnings : undefined,
    );

    if (oldResult.isErr()) {
      warnings = appendWarning(warnings, {
        code: 'PARTIAL_UPGRADE_READ',
        message:
          'Old-version read failed during upgrade; returning new-version data only',
        data: {
          collection: collectionName,
          type,
          failedSide: 'old',
          error: oldResult.error.message,
        },
      });
    }
    if (newResult.isErr()) {
      warnings = appendWarning(warnings, {
        code: 'PARTIAL_UPGRADE_READ',
        message:
          'New-version read failed during upgrade; returning old-version upgraded data only',
        data: {
          collection: collectionName,
          type,
          failedSide: 'new',
          error: newResult.error.message,
        },
      });
    }

    return ok({ value: [...oldData, ...newData], warnings });
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start building a collection definition
 *
 * @example
 * ```typescript
 * const social = defineCollection('social')
 *   .addPartition('post_partition')
 *   .addModel<Post>('POST', {
 *     version: 1,
 *     valueIndexes: ['authorId', 'status'] as const,
 *     discriminator: isPost,
 *   })
 *   .build();
 *
 * // Type-safe: only indexed fields allowed
 * await social.POST.find(logger, {
 *   filter: { authorId: Filter.eq('user_1') }
 * });
 * ```
 */
export function defineCollection<TName extends string>(
  name: TName,
): CollectionBuilder<TName> {
  return new CollectionBuilder(name);
}
