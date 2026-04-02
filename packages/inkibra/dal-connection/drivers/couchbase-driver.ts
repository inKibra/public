import type { Logger } from '@inkibra/logger';
import { Filter } from '@inkibra/observable-cache';
import type { Cas } from 'couchbase';
import * as couchbase from 'couchbase';
import { QueryScanConsistency } from 'couchbase';
import InternalStorage from 'internal-storage';
import { err, ok } from 'neverthrow';
import type { DbResult } from '../db-result';
import type {
  BulkUpdate,
  CollectionSchema,
  Driver,
  Cas as DriverCas,
  EnsureCollectionOptions,
  FindOptions,
  IndexConfig,
  MutationResult,
  Transaction,
  TransactionOptions,
  TypedObjectBase,
  UpsertOptions,
} from '../driver';
import { DALErrors } from '../error-codes';

// ============================================================================
// Couchbase Types
// ============================================================================

export type CouchbaseConfiguration = Readonly<{
  user: string;
  host: string;
  password: string;
  bucket: Readonly<{
    name: string;
    ramQuotaMB: number;
    replicaNumber: 0;
    flushEnabled: boolean;
  }>;
  scope: string;
}>;

interface ICouchbasePrivateStorage {
  cluster: couchbase.Cluster;
  bucket: couchbase.Bucket;
  config: CouchbaseConfiguration;
}

export interface ITypedCouchbaseObject {
  id: string;
  type: string;
  version?: number;
  modified: string;
  created: string;
  deleted?: string;
}

// ============================================================================
// Internal Storage & Singleton
// ============================================================================

const couchbaseDalStorage = InternalStorage<
  CouchbaseDalConnection,
  ICouchbasePrivateStorage
>();

const couchbaseDalConstructionSymbol = Symbol('Single Construction Guard');

let couchbaseDalSingleton: CouchbaseDalConnection;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function quoteIdentifier(identifier: string): string {
  // N1QL identifiers must be backtick-quoted when they contain special characters
  // like `-` (e.g. `tempo-api`).
  const escaped = identifier.split('`').join('``');
  return `\`${escaped}\``;
}

function findIndex(
  indexes: readonly unknown[],
  name: string,
  keyspaceId: string,
): unknown {
  return indexes.find((index) => {
    if (!isRecord(index)) return false;
    return index['name'] === name && index['keyspaceId'] === keyspaceId;
  });
}

// ============================================================================
// CouchbaseDalConnection Class
// ============================================================================

export class CouchbaseDalConnection {
  constructor(symbol: symbol) {
    // Guards against constructions from the outside
    if (symbol !== couchbaseDalConstructionSymbol) {
      throw DALErrors.dbIllegalConstruction();
    }
  }
  public async flushBucket(): Promise<boolean> {
    const storage = couchbaseDalStorage;
    if (storage(this).config.bucket.flushEnabled === false) {
      return false;
    }
    await storage(this)
      .cluster.buckets()
      .flushBucket(storage(this).bucket.name);
    return true;
  }
  public async disconnect() {
    const storage = couchbaseDalStorage;
    await storage(this).cluster.close();
  }
  public get scope() {
    return couchbaseDalStorage(this).config.scope;
  }
  public async listIndexes(logger: Logger) {
    const indexes = await this._managementQuery(
      logger,
      'SELECT indexes.name, indexes.keyspace_id as keyspaceId FROM system:indexes',
    );
    return indexes as Array<{ keyspaceId: string; name: string }>;
  }
  public async ensureIndex(
    logger: Logger,
    indexedProperty: string,
    typeAndCollection?: { type: string; collection: string },
  ) {
    logger = logger.child({
      component: 'dal-connection: CouchbaseDalConnection',
      method: 'ensureIndex',
    });

    const storage = couchbaseDalStorage;
    const indexes = await this.listIndexes(logger);
    const indexName = `${indexedProperty}${
      typeAndCollection !== undefined
        ? `_${typeAndCollection.collection}__${typeAndCollection.type}`
        : ''
    }`;
    logger.info(
      `Ensuring index ${indexName} for property ${indexedProperty}...`,
    );
    const index = findIndex(
      indexes,
      `${storage(this).config.bucket.name}_${indexName}`,
      storage(this).config.bucket.name,
    );

    if (index === undefined) {
      logger.info(`Index ${indexName} not found, creating...`);
      if (typeAndCollection === undefined) {
        logger.info('Index is top level (no type and collection)');
        await this._managementQuery(
          logger,
          `CREATE INDEX \`${
            storage(this).config.bucket.name
          }_${indexName}\` IF NOT EXISTS ON bucket(\`${indexedProperty}\`)`,
          undefined,
          { adhoc: true },
        );
        logger.info('Index created');
      } else {
        logger.info('Index is scoped (type and collection)');
        await this.query(
          typeAndCollection.collection,
          `CREATE INDEX \`${
            storage(this).config.bucket.name
          }_${indexName}\` IF NOT EXISTS ON bucket(\`${indexedProperty}\`) WHERE type="${
            typeAndCollection.type
          }"`,
          undefined,
          { adhoc: true, logger },
        );
        logger.info('Index created');
      }
    } else {
      logger.info('Index already exists');
    }
    return;
  }
  public async ensureArrayIndex(
    logger: Logger,
    arrayField: string,
    typeAndCollection: { type: string; collection: string },
  ) {
    logger = logger.child({
      component: 'dal-connection: CouchbaseDalConnection',
      method: 'ensureArrayIndex',
    });

    const storage = couchbaseDalStorage;
    const indexes = await this.listIndexes(logger);
    const indexName = `${arrayField}_array_${typeAndCollection.collection}__${typeAndCollection.type}`;
    logger.info(
      `Ensuring array index ${indexName} for array field ${arrayField}...`,
    );
    const index = findIndex(
      indexes,
      `${storage(this).config.bucket.name}_${indexName}`,
      storage(this).config.bucket.name,
    );

    if (index === undefined) {
      logger.info(`Array index ${indexName} not found, creating...`);
      logger.info('Array index is scoped (type and collection)');
      await this.query(
        typeAndCollection.collection,
        `CREATE INDEX \`${
          storage(this).config.bucket.name
        }_${indexName}\` IF NOT EXISTS ON bucket(DISTINCT ARRAY v FOR v IN \`${arrayField}\` END) WHERE type="${
          typeAndCollection.type
        }"`,
        undefined,
        { adhoc: true, logger },
      );
      logger.info('Array index created');
    } else {
      logger.info('Array index already exists');
    }
    return;
  }
  public async ensureCollection(logger: Logger, collection: string) {
    // Create Collection
    logger = logger.child({
      component: 'dal-connection: CouchbaseDalConnection',
      method: 'ensureCollection',
    });
    let query = 'CREATE COLLECTION bucket IF NOT EXISTS';
    query = query
      .split('bucket')
      .join(
        `\`${couchbaseDalStorage(this).config.bucket.name}\`.\`${
          this.scope
        }\`.\`${collection}\``,
      );
    logger.info('Ensuring collection', { collection, query });
    await this._managementQuery(logger, query, { raw: true, adhoc: true });
    logger.info('Collection ensured', { collection });

    // Create Primary Index for
    let indexQuery =
      'CREATE PRIMARY INDEX IF NOT EXISTS ON bucket WITH {"defer_build":false}';
    logger.info('Ensuring primary index for collection', {
      collection,
      scope: this.scope,
      indexQuery,
    });
    indexQuery = indexQuery
      .split('bucket')
      .join(
        `\`${couchbaseDalStorage(this).config.bucket.name}\`.\`${
          this.scope
        }\`.\`${collection}\``,
      );
    await this._managementQuery(logger, indexQuery, { raw: true, adhoc: true });
    logger.info('Primary index ensured for collection', {
      collection,
      scope: this.scope,
    });
  }
  public getQueryStream(
    collection: string,
    query: string,
    params?: couchbase.QueryOptions['parameters'],
    {
      logger,
      adhoc = false,
      consistency = couchbase.QueryScanConsistency.RequestPlus,
    }: {
      logger?: Logger;
      adhoc?: boolean;
      consistency?: couchbase.QueryScanConsistency;
    } = {},
  ) {
    query = query
      .split('bucket')
      .join(
        `\`${couchbaseDalStorage(this).config.bucket.name}\`.\`${
          this.scope
        }\`.\`${collection}\``,
      );
    query = query.split('collection').join(`\`${collection}\``);
    if (logger) {
      logger
        .child({
          component: 'dal-connection: CouchbaseDalConnection',
          method: 'query',
        })
        .debug('Started Query', { query, params, consistency, adhoc });
    }
    return couchbaseDalStorage(this).bucket.scope(this.scope).query(query, {
      parameters: params,
      scanConsistency: consistency,
      adhoc,
    });
  }
  public async query(
    collection: string,
    query: string,
    params?: couchbase.QueryOptions['parameters'],
    {
      logger,
      adhoc = false,
      consistency = couchbase.QueryScanConsistency.RequestPlus,
    }: {
      logger?: Logger;
      adhoc?: boolean;
      consistency?: couchbase.QueryScanConsistency;
    } = {},
  ) {
    const queryStream = this.getQueryStream(collection, query, params, {
      logger,
      adhoc,
      consistency,
    });
    const queryResults = await queryStream;
    if (logger) {
      logger
        .child({
          component: 'dal-connection: CouchbaseDalConnection',
          method: 'query',
        })
        .debug('Query Answered', {
          query,
          params,
          consistency,
          adhoc,
          queryResultsMeta: queryResults.meta,
          queryResultsRowCount: queryResults.rows.length,
        });
    }
    return queryResults.rows;
  }
  public async _managementQuery(
    logger: Logger,
    query: string,
    params?: readonly unknown[] | Record<string, unknown>,
    {
      raw = false,
      adhoc = true,
      consistency = couchbase.QueryScanConsistency.RequestPlus,
    }: {
      raw?: boolean;
      adhoc?: boolean;
      consistency?: couchbase.QueryScanConsistency;
    } = {},
  ) {
    if (!raw) {
      query = query
        .split('bucket')
        .join(`\`${couchbaseDalStorage(this).config.bucket.name}\``);
    }
    logger
      .child({
        component: 'dal-connection: CouchbaseDalConnection',
        method: '_managementQuery',
      })
      .info('Management Query', { query, params, consistency, adhoc });
    return new Promise((resolve, reject) => {
      void couchbaseDalStorage(this).bucket.cluster.query(
        query,
        { parameters: params, scanConsistency: consistency, adhoc },
        (err, res) => {
          if (err) {
            return reject(err);
          }
          return resolve(res?.rows || []);
        },
      );
    });
  }
  public async insert(
    collection: string,
    value: ITypedCouchbaseObject,
    { expiryInMs }: { expiryInMs?: number } = {},
  ) {
    return new Promise<couchbase.MutationResult>((resolve, reject) => {
      void couchbaseDalStorage(this)
        .bucket.scope(this.scope)
        .collection(collection)
        .insert(value.id, value, { expiry: expiryInMs }, (err, res) => {
          if (err || !res) {
            return reject(err);
          }
          return resolve(res);
        });
    });
  }
  public async insertMany(
    collection: string,
    values: ITypedCouchbaseObject[],
    { expiryInMs }: { expiryInMs?: number } = {},
  ) {
    return Promise.allSettled(
      values.map(async (value) => {
        return await couchbaseDalStorage(this)
          .bucket.scope(this.scope)
          .collection(collection)
          .insert(value.id, value, { expiry: expiryInMs });
      }),
    );
  }
  public async touch(collection: string, key: string, expiryInMs: number) {
    return new Promise<couchbase.MutationResult>((resolve, reject) => {
      void couchbaseDalStorage(this)
        .bucket.scope(this.scope)
        .collection(collection)
        .touch(key, expiryInMs, {}, (err, res) => {
          if (err || !res) {
            return reject(err);
          }
          return resolve(res);
        });
    });
  }
  public async upsert<T extends ITypedCouchbaseObject>(
    collection: string,
    value: T,
    {
      expiryInMs,
    }: {
      expiryInMs?: number;
    } = {},
  ) {
    return new Promise<couchbase.MutationResult>((resolve, reject) => {
      void couchbaseDalStorage(this)
        .bucket.scope(this.scope)
        .collection(collection)
        .upsert(value.id, value, { expiry: expiryInMs }, (err, res) => {
          if (err || !res) {
            return reject(err);
          }
          return resolve(res);
        });
    });
  }
  public async replace<T extends ITypedCouchbaseObject>(
    collection: string,
    value: T,
    {
      expiryInMs,
      cas,
    }: {
      expiryInMs?: number;
      cas?: Cas;
    } = {},
  ) {
    return new Promise<{ cas: Cas }>((resolve, reject) => {
      void couchbaseDalStorage(this)
        .bucket.scope(this.scope)
        .collection(collection)
        .replace(value.id, value, { expiry: expiryInMs, cas }, (err, res) => {
          if (err || !res) {
            return reject(err);
          }
          return resolve(res);
        });
    });
  }
  public async remove(
    collection: string,
    key: string,
    {
      cas,
    }: {
      cas?: Cas;
    } = {},
  ) {
    return new Promise<couchbase.MutationResult>((resolve, reject) => {
      void couchbaseDalStorage(this)
        .bucket.scope(this.scope)
        .collection(collection)
        .remove(key, { cas }, (err, res) => {
          if (err || !res) {
            return reject(err);
          }
          return resolve(res);
        });
    });
  }
  public async get<T extends ITypedCouchbaseObject>(
    collection: string,
    key: string,
  ) {
    return new Promise<{ cas: Cas; value: T } | undefined>(
      (resolve, reject) => {
        void couchbaseDalStorage(this)
          .bucket.scope(this.scope)
          .collection(collection)
          .get(key, {}, (err, res) => {
            if (err) {
              // Check if it's a "document not found" error
              if (
                (err as unknown as { code: string }).code ===
                  'DOCUMENT_NOT_FOUND' ||
                (err as unknown as { code: number }).code === 13
              ) {
                return resolve(undefined);
              }
              return reject(err);
            }
            if (!res) {
              return resolve(undefined);
            }
            return resolve(res);
          });
      },
    );
  }
  public async exists(collection: string, key: string) {
    const res = await couchbaseDalStorage(this)
      .bucket.scope(this.scope)
      .collection(collection)
      .exists(key);
    return res;
  }
  public async safeMultiGet<T extends ITypedCouchbaseObject>(
    collection: string,
    keys: string[],
  ) {
    const res = await Promise.all(
      keys.map(async (key) => {
        const exists = await this.exists(collection, key);
        return { key, exists };
      }),
    );
    const existingKeys = res.filter(({ exists }) => exists.exists);
    return Promise.all(
      existingKeys.map(async ({ key }) => {
        return await this.get<T>(collection, key);
      }),
    );
  }
  public async cloneScopeCollection(
    logger: Logger,
    source: { scope: string; collection: string },
    destination: { scope: string; collection: string },
  ) {
    logger = logger.child({
      component: 'dal-connection: CouchbaseDalConnection',
      method: 'cloneScopeCollection',
    });
    logger.info('Cloning scope collection', { source, destination });
    const query = `INSERT INTO bucket.\`${destination.scope}\`.\`${destination.collection}\` (KEY META().id) SELECT \`${source.collection}\`.* FROM bucket.\`${source.scope}\`.\`${source.collection}\``;
    await this._managementQuery(logger, query, undefined, { adhoc: true });
    logger.info('Cloned scope collection', { source, destination });
  }
  public get bucket() {
    return couchbaseDalStorage(this).config.bucket.name;
  }
  public get bucketId() {
    return `\`${couchbaseDalStorage(this).config.bucket.name}\``;
  }
}

// ============================================================================
// Initialization Functions
// ============================================================================

async function startupCouchbase(
  logger: Logger,
  self: CouchbaseDalConnection,
  config: CouchbaseConfiguration,
) {
  logger = logger.child({
    component: 'dal-connection: InitCouchbaseDalConnection',
    method: 'startupCouchbase',
  });
  const storage = couchbaseDalStorage;
  storage(self).config = config;
  logger.info(`Connecting to couchbase at ${config.host}...`);

  storage(self).cluster = await couchbase.connect(config.host, {
    username: storage(self).config.user,
    password: storage(self).config.password,
  });

  const diag = await storage(self).cluster.diagnostics();
  logger.info('Couchbase Diagnostics: ', diag);

  logger.info('Connected to couchbase.');
  logger.info('Getting bucket: ', config.bucket.name);
  storage(self).bucket = storage(self).cluster.bucket(config.bucket.name);

  logger.info('Got bucket: ', storage(self).bucket);
  const indexes = await self.listIndexes(logger);
  logger.info('Got indexes: ', indexes);
  const primaryIndex = findIndex(
    indexes,
    storage(self).config.bucket.name,
    storage(self).config.bucket.name,
  );
  logger.info('Got primary index: ', primaryIndex);

  if (primaryIndex === undefined) {
    logger.info('Creating primary index: ', config.bucket.name);
    await self._managementQuery(
      logger,
      'CREATE PRIMARY INDEX bucket ON bucket WITH {"defer_build":false}',
      undefined,
      { adhoc: true },
    );
  }
  logger.info('Ensuring main indexes exist...');
  await self.ensureIndex(logger, 'type');
  await self.ensureIndex(logger, 'id');
  logger.info('Ensured main indexes exist.');
  logger.info('Couchbase connection initialized.');
  return;
}

export async function InitCouchbaseDalConnection(
  logger: Logger,
  config: CouchbaseConfiguration,
  options?: { overrideSingleton?: boolean },
): Promise<CouchbaseDalConnection>;
export async function InitCouchbaseDalConnection(
  logger: Logger,
): Promise<CouchbaseDalConnection>;
export async function InitCouchbaseDalConnection(
  logger: Logger,
  config?: CouchbaseConfiguration,
  options?: { overrideSingleton?: boolean },
) {
  // If overrideSingleton is true, always create a new instance
  if (options?.overrideSingleton && config !== undefined) {
    const newConnection = new CouchbaseDalConnection(
      couchbaseDalConstructionSymbol,
    );
    await startupCouchbase(logger, newConnection, config);
    return newConnection;
  }

  // Otherwise use singleton pattern
  if (couchbaseDalSingleton === undefined) {
    if (config !== undefined) {
      couchbaseDalSingleton = new CouchbaseDalConnection(
        couchbaseDalConstructionSymbol,
      );
      await startupCouchbase(logger, couchbaseDalSingleton, config);
    } else {
      throw new Error(
        'Host and Config must be provided for first time startup',
      );
    }
  }
  return couchbaseDalSingleton;
}

// ============================================================================
// CouchbaseDriver - Driver Interface Implementation
// ============================================================================

/**
 * CouchbaseDriver wraps CouchbaseDalConnection and implements the Driver interface
 */
export class CouchbaseDriver implements Driver {
  private schemas = new Map<string, CollectionSchema>();

  constructor(private connection: CouchbaseDalConnection) {}

  async ensureCollection(
    logger: Logger,
    schema: CollectionSchema,
    _options?: EnsureCollectionOptions,
  ): Promise<void> {
    logger = logger.child({
      component: 'dal-connection: CouchbaseDriver',
      method: 'ensureCollection',
    });

    // For Couchbase, always ensure the collection exists (no validate-only mode)
    await this.connection.ensureCollection(logger, schema.name);
    this.schemas.set(schema.name, schema);

    // Ensure indexes if specified
    if (schema.indexes) {
      for (const index of schema.indexes) {
        await this.ensureIndex(logger, schema.name, index);
      }
    }

    // Note: Couchbase doesn't support generated columns natively
    if (schema.generatedColumns && schema.generatedColumns.length > 0) {
      logger.warn('Generated columns not supported in Couchbase', {
        columns: schema.generatedColumns,
      });
    }
  }

  async ensureIndex(
    logger: Logger,
    collection: string,
    index: IndexConfig,
    typeFilter?: string,
  ): Promise<void> {
    logger = logger.child({
      component: 'dal-connection: CouchbaseDriver',
      method: 'ensureIndex',
    });

    if (index.composite && index.fields.length > 1) {
      // Composite index - not directly supported by current implementation
      // Would need to create a compound index in Couchbase
      logger.warn('Composite indexes require custom implementation', {
        index,
      });
      // For now, create individual indexes
      for (const field of index.fields) {
        await this.connection.ensureIndex(
          logger,
          field,
          typeFilter ? { type: typeFilter, collection } : undefined,
        );
      }
    } else if (index.fields[0]) {
      // Single field index
      const field = index.fields[0];
      await this.connection.ensureIndex(
        logger,
        field,
        typeFilter ? { type: typeFilter, collection } : undefined,
      );
    }
  }

  async find<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    options: FindOptions<T>,
  ): Promise<DbResult<T[]>> {
    try {
      const { limit = 100, offset, filter, orderBy } = options;

      // Build query
      let queryClause = '';
      const queryArgs: unknown[] = [type];
      let paramIndex = 2;

      // Add filter conditions
      if (filter) {
        for (const key in filter) {
          if (Reflect.has(filter, key)) {
            const condition = Reflect.get(filter, key) as Filter.Filters;
            if (condition && 'operator' in condition) {
              switch (condition.operator) {
                case Filter.Operators.EQUAL:
                  queryClause += ` AND \`${key}\`=$${paramIndex++}`;
                  queryArgs.push(condition.value);
                  break;
                case Filter.Operators.IN:
                  queryClause += ` AND \`${key}\` IN $${paramIndex++}`;
                  queryArgs.push(condition.values);
                  break;
                // Add more operators as needed
              }
            }
          }
        }
      }

      // Add order by
      let orderByClause = '';
      if (orderBy) {
        orderByClause = ` ORDER BY \`${String(orderBy.field)}\` ${orderBy.direction}`;
      }

      // Build full query
      const query = `SELECT * FROM ${quoteIdentifier(collection)} WHERE deleted IS MISSING AND type=$1 ${queryClause}${orderByClause} LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''}`;

      const res = await this.connection.query(collection, query, queryArgs, {
        logger,
        consistency: QueryScanConsistency.RequestPlus,
      });

      const ret = res.flatMap((row) => {
        if (!isRecord(row)) return [];
        const doc = row[collection];
        return doc !== undefined ? [doc as T] : [];
      });
      return ok({ value: ret });
    } catch (error) {
      logger.warn('find failed', { error });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async get<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<DbResult<{ cas: DriverCas; value: T } | undefined>> {
    try {
      const res = await this.connection.get<T>(collection, id);
      if (!res) {
        return ok({ value: undefined });
      }
      return ok({
        value: { cas: res.cas as unknown as DriverCas, value: res.value },
      });
    } catch (error) {
      logger.warn('get failed', { error, id });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async getMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    ids: string[],
  ): Promise<DbResult<{ value: T; cas: DriverCas }[]>> {
    try {
      const res = await this.connection.safeMultiGet<T>(collection, ids);
      const ret: { value: T; cas: DriverCas }[] = [];

      for (const item of res) {
        if (item && 'value' in item && 'cas' in item) {
          ret.push({
            value: item.value,
            cas: item.cas as unknown as DriverCas,
          });
        }
      }
      return ok({ value: ret });
    } catch (error) {
      logger.warn('getMany failed', { error });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async exists(
    _logger: Logger,
    collection: string,
    id: string,
  ): Promise<{ exists: boolean }> {
    return await this.connection.exists(collection, id);
  }

  async insert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
  ): Promise<DbResult<MutationResult>> {
    try {
      const result = await this.connection.insert(collection, value);
      return ok({ value: { cas: result.cas as unknown as DriverCas } });
    } catch (error) {
      logger.warn('insert failed', { error });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async insertMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    values: T[],
  ): Promise<DbResult<PromiseSettledResult<MutationResult>[]>> {
    try {
      const results = await this.connection.insertMany(collection, values);
      const mapped = results.map((r) => {
        if (r.status === 'fulfilled') {
          return {
            status: 'fulfilled' as const,
            value: { cas: r.value.cas as unknown as DriverCas },
          };
        }
        return r;
      });
      return ok({ value: mapped as PromiseSettledResult<MutationResult>[] });
    } catch (error) {
      logger.warn('insertMany failed', { error });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async upsert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
    options?: UpsertOptions,
  ): Promise<DbResult<MutationResult>> {
    try {
      const cas = options?.cas?.value;
      if (cas) {
        try {
          const replaced = await this.connection.replace(collection, value, {
            cas: cas as unknown as Cas,
          });
          return ok({ value: { cas: replaced.cas as unknown as DriverCas } });
        } catch (e) {
          if (e instanceof couchbase.DocumentNotFoundError) {
            const inserted = await this.connection.insert(collection, value);
            return ok({ value: { cas: inserted.cas as unknown as DriverCas } });
          }
          if (e instanceof couchbase.CasMismatchError) {
            return err(
              DALErrors.dbQuery(
                'CAS mismatch - document was modified by another process',
              ),
            );
          }
          throw e;
        }
      }

      const result = await this.connection.upsert(collection, value);
      return ok({ value: { cas: result.cas as unknown as DriverCas } });
    } catch (error) {
      logger.warn('upsert failed', { error });
      return err(DALErrors.dbQuery('upsert operation failed'));
    }
  }

  async upsertMany<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    values: T[],
  ): Promise<DbResult<PromiseSettledResult<MutationResult>[]>> {
    const settled: PromiseSettledResult<MutationResult>[] = [];
    for (const v of values) {
      const result = await this.upsert(logger, collection, v);
      if (result.isOk()) {
        settled.push({ status: 'fulfilled', value: result.value.value });
      } else {
        settled.push({ status: 'rejected', reason: result.error });
      }
    }
    return ok({ value: settled });
  }

  async replace<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    cas: DriverCas,
    value: T,
  ): Promise<DbResult<{ cas: DriverCas }>> {
    try {
      const result = await this.connection.replace(collection, value, {
        cas: cas as unknown as Cas,
      });
      return ok({ value: { cas: result.cas as unknown as DriverCas } });
    } catch (error) {
      logger.warn('replace failed', { error });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async remove(
    logger: Logger,
    collection: string,
    id: string,
    cas?: DriverCas,
  ): Promise<DbResult<MutationResult>> {
    try {
      const result = await this.connection.remove(collection, id, {
        cas: cas as unknown as Cas,
      });
      return ok({ value: { cas: result.cas as unknown as DriverCas } });
    } catch (error) {
      logger.warn('remove failed', { error });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async countFiltered<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    filter: Filter<T, keyof T | 'created' | 'modified' | 'deleted'>,
  ): Promise<DbResult<number>> {
    try {
      // Build filter query similar to find
      let queryClause = '';
      const queryArgs: unknown[] = [type];
      let paramIndex = 2;

      for (const key in filter) {
        if (Reflect.has(filter, key)) {
          const condition = Reflect.get(filter, key) as Filter.Filters;
          if (condition && 'operator' in condition) {
            switch (condition.operator) {
              case Filter.Operators.EQUAL:
                queryClause += ` AND \`${key}\`=$${paramIndex++}`;
                queryArgs.push(condition.value);
                break;
              case Filter.Operators.IN:
                queryClause += ` AND \`${key}\` IN $${paramIndex++}`;
                queryArgs.push(condition.values);
                break;
            }
          }
        }
      }

      const query = `SELECT COUNT(*) as totalSize FROM ${quoteIdentifier(collection)} WHERE deleted IS MISSING AND type=$1 ${queryClause}`;
      const res = await this.connection.query(collection, query, queryArgs, {
        logger,
        consistency: QueryScanConsistency.RequestPlus,
      });

      const first = res[0];
      if (!isRecord(first)) {
        throw new Error('Unexpected countFiltered response shape');
      }
      const rawTotalSize = first['totalSize'];
      if (typeof rawTotalSize === 'number') {
        return ok({ value: rawTotalSize });
      }
      if (typeof rawTotalSize === 'string') {
        const parsed = Number(rawTotalSize);
        if (!Number.isNaN(parsed)) {
          return ok({ value: parsed });
        }
      }
      throw new Error('Unexpected totalSize type');
    } catch (error) {
      logger.warn('countFiltered failed', { error });
      return err(DALErrors.dbQuery('unknown'));
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
      const updateFragments: string[] = [];
      const updateValues: unknown[] = [];
      let updateIndex = 1;

      if (updates.type !== undefined) {
        updateFragments.push('type=$' + updateIndex++);
        updateValues.push(updates.type);
      }
      if (updates.version !== undefined) {
        updateFragments.push('version=$' + updateIndex++);
        updateValues.push(updates.version);
      }
      if (updates.created !== undefined) {
        updateFragments.push('created=$' + updateIndex++);
        updateValues.push(updates.created);
      }
      if (updates.modified !== undefined) {
        updateFragments.push('modified=$' + updateIndex++);
        updateValues.push(updates.modified);
      }
      if (updates.deleted !== undefined) {
        updateFragments.push('deleted=$' + updateIndex++);
        updateValues.push(updates.deleted);
      }

      if (updateFragments.length === 0) {
        return ok({ value: { affected: 0 } });
      }

      let queryClause = '';
      const queryArgs: unknown[] = [...updateValues, type];
      let paramIndex = updateIndex + 1;

      for (const key in filter) {
        if (Reflect.has(filter, key)) {
          const condition = Reflect.get(filter, key) as Filter.Filters;
          if (condition && 'operator' in condition) {
            switch (condition.operator) {
              case Filter.Operators.EQUAL:
                queryClause += ` AND \`${key}\`=$${paramIndex++}`;
                queryArgs.push(condition.value);
                break;
              case Filter.Operators.IN:
                queryClause += ` AND \`${key}\` IN $${paramIndex++}`;
                queryArgs.push(condition.values);
                break;
            }
          }
        }
      }

      const countResult = await this.countFiltered(
        logger,
        collection,
        type,
        filter,
      );
      if (countResult.isErr()) {
        return err(countResult.error);
      }

      const updateQuery = `UPDATE ${quoteIdentifier(collection)} SET ${updateFragments.join(', ')} WHERE deleted IS MISSING AND type=$${updateIndex} ${queryClause}`;
      await this.connection.query(collection, updateQuery, queryArgs, {
        logger,
        consistency: QueryScanConsistency.RequestPlus,
      });

      return ok({ value: { affected: countResult.value.value } });
    } catch (error) {
      logger.warn('bulkUpdate failed', { error });
      return err(DALErrors.dbQuery('unknown'));
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

      const schema = this.schemas.get(collection);
      const dalConfigs = schema?.dals ?? [];
      const allowedTypes =
        types && types.length > 0 ? new Set(types) : undefined;

      const whereClauses: string[] = [];
      for (const dal of dalConfigs) {
        if (allowedTypes && !allowedTypes.has(dal.type)) continue;
        const partitions = dal.partitions ?? [];
        const partition = partitions.find((p) => p.name === partitionName);
        if (!partition) continue;
        whereClauses.push(
          `(type='${dal.type}' AND \`${partition.valueField}\`=$1)`,
        );
      }

      if (whereClauses.length === 0) {
        return ok({ value: [] });
      }

      const queryClause = `WHERE deleted IS MISSING AND (${whereClauses.join(' OR ')})`;
      const queryArgs: unknown[] = [partitionValue];

      // Add order by
      let orderByClause = '';
      if (orderBy) {
        orderByClause = ` ORDER BY \`${String(orderBy.field)}\` ${orderBy.direction}`;
      }

      // Build full query
      const query = `SELECT * FROM ${quoteIdentifier(collection)} ${queryClause}${orderByClause} LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''}`;

      const res = await this.connection.query(collection, query, queryArgs, {
        logger,
        consistency: QueryScanConsistency.RequestPlus,
      });

      const ret = res.flatMap((row) => {
        if (!isRecord(row)) return [];
        const doc = row[collection];
        return doc !== undefined ? [doc as T] : [];
      });
      return ok({ value: ret });
    } catch (error) {
      logger.warn('findByPartition failed', { error });
      return err(DALErrors.dbQuery('unknown'));
    }
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  getConnection(): CouchbaseDalConnection {
    return this.connection;
  }

  /**
   * Begin a new transaction.
   * Note: Couchbase transaction support is not yet implemented.
   * This will throw an error until full Couchbase transaction support is added.
   */
  async beginTransaction(_options?: TransactionOptions): Promise<Transaction> {
    throw new Error(
      'Couchbase transactions not yet implemented. Use DrizzleDriver for transaction support.',
    );
  }
}
