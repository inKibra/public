import type { Logger } from '@inkibra/logger';
import { err, ok } from 'neverthrow';
import type { DbResult } from './db-result';
import type {
  CollectionSchema,
  Driver,
  EnsureCollectionOptions,
  IndexConfig,
  TypedObjectBase,
} from './driver';

/**
 * DAL configuration for a specific type within a collection
 */
export type DALConfig<TModel extends TypedObjectBase> = {
  type: TModel['type'];
  version?: TModel['version'];
  valueIndexes?: string[];
  arrayIndexes?: string[];
  partitions?: Array<{
    name: string;
    valueField: keyof TModel & string;
  }>;
  discriminator: (data: unknown) => data is TModel;
};

type AnyDALConfig = {
  type: string;
  version?: number;
  valueIndexes?: string[];
  arrayIndexes?: string[];
  partitions?: Array<{
    name: string;
    valueField: string;
  }>;
  discriminator: (data: unknown) => boolean;
};

/**
 * Collection configuration
 */
export type CollectionConfig = {
  name: string;
  partitions?: string[];
  dals: AnyDALConfig[];
  indexes?: IndexConfig[];
  generatedColumns?: Array<{
    name: string;
    expression: string;
    stored?: boolean;
  }>;
};

/**
 * Collection handle that manages multiple DALs for a single collection
 */
export class Collection {
  private driver: Driver;
  private schema: CollectionSchema;
  private dals: Map<string, AnyDALConfig>;

  constructor(driver: Driver, config: CollectionConfig) {
    this.driver = driver;
    this.dals = new Map();

    // Store DAL configs by type
    for (const dal of config.dals) {
      this.dals.set(dal.type, dal);
    }

    // Build collection schema
    this.schema = {
      name: config.name,
      partitions: config.partitions,
      indexes: config.indexes || [],
      generatedColumns: config.generatedColumns,
      dals: config.dals.map((dal) => ({
        type: dal.type,
        version: dal.version,
        valueIndexes: dal.valueIndexes,
        arrayIndexes: dal.arrayIndexes,
        partitions: dal.partitions,
      })),
    };

    // Add indexes from DAL configs
    for (const dal of config.dals) {
      // Add value indexes
      if (dal.valueIndexes) {
        for (const field of dal.valueIndexes) {
          this.schema.indexes?.push({
            fields: [field],
            composite: false,
          });
        }
      }

      // Add array indexes (in Postgres, these would be GIN indexes)
      if (dal.arrayIndexes) {
        for (const field of dal.arrayIndexes) {
          this.schema.indexes?.push({
            fields: [field],
            composite: false,
          });
        }
      }
    }
  }

  async initialize(
    logger: Logger,
    options?: EnsureCollectionOptions,
  ): Promise<void> {
    logger = logger.child({
      component: 'dal-connection: Collection',
      method: 'initialize',
    });

    logger.info('Initializing collection', { name: this.schema.name });

    // Ensure collection exists
    await this.driver.ensureCollection(logger, this.schema, options);

    // Ensure type-specific indexes for each DAL
    for (const [type, dal] of this.dals) {
      // Ensure base indexes for this type
      await this.driver.ensureIndex(
        logger,
        this.schema.name,
        { fields: ['type'], composite: false },
        type,
      );

      if (dal.version !== undefined) {
        await this.driver.ensureIndex(
          logger,
          this.schema.name,
          { fields: ['version'], composite: false },
          type,
        );
      }

      // Ensure value indexes for this type
      if (dal.valueIndexes) {
        for (const field of dal.valueIndexes) {
          await this.driver.ensureIndex(
            logger,
            this.schema.name,
            { fields: [field], composite: false },
            type,
          );
        }
      }

      // Array indexes would be handled similarly
      // In Postgres, these would use GIN indexes
      if (dal.arrayIndexes) {
        for (const field of dal.arrayIndexes) {
          logger.info(`Array index for ${field} should use GIN in Postgres`, {
            collection: this.schema.name,
            type,
            field,
          });
        }
      }
    }

    logger.info('Collection initialized', { name: this.schema.name });
  }

  getName(): string {
    return this.schema.name;
  }

  getSchema(): CollectionSchema {
    return this.schema;
  }

  getDriver(): Driver {
    return this.driver;
  }

  getDALConfig<TModel extends TypedObjectBase>(
    type: string,
  ): DALConfig<TModel> | undefined {
    return this.dals.get(type) as unknown as DALConfig<TModel> | undefined;
  }

  getAllDALConfigs(): AnyDALConfig[] {
    return Array.from(this.dals.values());
  }

  /**
   * Get DAL configs for a specific partition
   */
  getDALsForPartition(partitionName: string): AnyDALConfig[] {
    return Array.from(this.dals.values()).filter((dal) =>
      (dal.partitions ?? []).some((p) => p.name === partitionName),
    );
  }

  /**
   * Find all records in a partition across all types
   * Example: Get all posts + comments for a specific postId
   */
  async findByPartition<T extends TypedObjectBase>(
    logger: Logger,
    partitionName: string,
    partitionValue: string,
    options?: {
      types?: string[];
      limit?: number;
      orderBy?: {
        field: keyof T | 'created' | 'modified';
        direction: 'ASC' | 'DESC';
      };
    },
  ): Promise<DbResult<TypedObjectBase[]>> {
    logger = logger.child({
      component: 'dal-connection: Collection',
      method: 'findByPartition',
    });

    // Get all DALs that belong to this partition
    const partitionDALs = this.getDALsForPartition(partitionName);

    if (partitionDALs.length === 0) {
      logger.warn('No DALs found for partition', { partitionName });
      return ok({ value: [] });
    }

    // Filter by specified types if provided
    const relevantDALs = options?.types
      ? partitionDALs.filter((dal) => options.types!.includes(dal.type))
      : partitionDALs;

    if (relevantDALs.length === 0) {
      return ok({ value: [] });
    }

    const types = relevantDALs.map((dal) => dal.type);

    logger.info('Finding by partition', {
      partitionName,
      partitionValue,
      types,
    });

    // Use driver's findByPartition method
    const result = await this.driver.findByPartition<T>(
      logger,
      this.schema.name,
      partitionName,
      partitionValue,
      types,
      options,
    );

    if (result.isErr()) {
      return err(result.error);
    }

    return ok({ value: result.value.value, warnings: result.value.warnings });
  }
}

/**
 * Create and initialize a collection
 *
 * For Postgres/Drizzle: builds a pgTable schema object dynamically from metadata
 * For Couchbase: calls ensureCollection and per-DAL indexing
 */
export async function createCollection(
  logger: Logger,
  driver: Driver,
  config: CollectionConfig,
  options?: EnsureCollectionOptions,
): Promise<Collection> {
  logger = logger.child({
    component: 'dal-connection',
    method: 'createCollection',
  });

  logger.info('Creating collection', { name: config.name });

  const collection = new Collection(driver, config);
  await collection.initialize(logger, options);

  logger.info('Collection created', { name: config.name });

  return collection;
}
