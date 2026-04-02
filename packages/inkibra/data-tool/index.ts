import {
  type CouchbaseConfiguration,
  type CouchbaseDalConnection,
  InitCouchbaseDalConnection,
  type ITypedCouchbaseObject,
} from '@inkibra/dal-connection/drivers/couchbase-driver';

import { GetEnvironmentVariable } from '@inkibra/environment';
import * as Logger from '@inkibra/logger';
import fs from 'fs';

const logger = Logger.init('data-tool');

export namespace InkibraDataTool {
  export interface CollectionTypeSpec {
    collection: string;
    type?: string;
  }

  export async function startup() {
    const db = await InitCouchbaseDalConnection(logger, {
      host: GetEnvironmentVariable('DATA_TOOL_CLI_COUCHBASE_HOST'),
      user: GetEnvironmentVariable('DATA_TOOL_CLI_COUCHBASE_USER'),
      password: GetEnvironmentVariable('DATA_TOOL_CLI_COUCHBASE_PASSWORD'),
      bucket: {
        name: GetEnvironmentVariable('DATA_TOOL_CLI_COUCHBASE_BUCKET'),
        ramQuotaMB: 128,
        replicaNumber: 0,
        flushEnabled: false,
      },
      scope: GetEnvironmentVariable('DATA_TOOL_CLI_COUCHBASE_SCOPE'),
    });

    return db;
  }

  export function getDbConfigFromEnv(prefix: string): CouchbaseConfiguration {
    return {
      host: GetEnvironmentVariable(`${prefix}_COUCHBASE_HOST`),
      user: GetEnvironmentVariable(`${prefix}_COUCHBASE_USER`),
      password: GetEnvironmentVariable(`${prefix}_COUCHBASE_PASSWORD`),
      bucket: {
        name: GetEnvironmentVariable(`${prefix}_COUCHBASE_BUCKET`),
        ramQuotaMB: 128,
        replicaNumber: 0,
        flushEnabled: false,
      },
      scope: GetEnvironmentVariable(`${prefix}_COUCHBASE_SCOPE`),
    };
  }

  export function parseCollectionSpecs(specs: string[]): CollectionTypeSpec[] {
    return specs.map((spec) => {
      const parts = spec.split(':');
      if (parts.length === 1 && parts[0]) {
        return { collection: parts[0].trim() };
      }
      if (parts.length === 2 && parts[0] && parts[1]) {
        return { collection: parts[0].trim(), type: parts[1].trim() };
      }
      throw new Error(
        `Invalid collection spec format: ${spec}. Expected 'collection' or 'collection:type'`,
      );
    });
  }

  export async function cloneCollections(
    sourceConfig: CouchbaseConfiguration,
    destConfig: CouchbaseConfiguration,
    collectionSpecs: CollectionTypeSpec[],
  ) {
    logger.info('Starting clone operation', {
      collectionSpecs,
      sourceHost: sourceConfig.host,
      destHost: destConfig.host,
    });

    // Create source and destination connections with override singleton
    const sourceDb = await InitCouchbaseDalConnection(
      logger.child({ component: 'clone-source', connection: 'source' }),
      sourceConfig,
      { overrideSingleton: true },
    );

    const destDb = await InitCouchbaseDalConnection(
      logger.child({
        component: 'clone-destination',
        connection: 'destination',
      }),
      destConfig,
      { overrideSingleton: true },
    );

    try {
      // Process each collection spec
      for (const spec of collectionSpecs) {
        const { collection, type } = spec;
        logger.info(
          `Cloning ${type ? `type '${type}' from ` : ''}collection: ${collection}`,
        );

        // Ensure the collection exists in the destination
        await destDb.ensureCollection(logger, collection);

        // Build query based on whether type is specified
        let query = 'SELECT * FROM bucket';
        const queryArgs: Array<string | boolean | number> = [];
        if (type) {
          query += ' WHERE type=$1';
          queryArgs.push(type);
        }

        // Query documents from source collection
        const sourceData = await sourceDb.query(collection, query, queryArgs, {
          logger,
          adhoc: true,
        });

        logger.info(
          `Found ${sourceData.length} documents in ${collection}${type ? ` with type '${type}'` : ''}`,
        );

        // Extract the actual documents from the query results
        const documents = sourceData
          .map((row) => row[collection] as ITypedCouchbaseObject)
          .filter((doc): doc is ITypedCouchbaseObject => doc !== undefined);

        if (documents.length > 0) {
          // Upsert documents in batches to the destination
          const batchSize = 100;
          for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            const results = await Promise.allSettled(
              batch.map((doc) => destDb.upsert(collection, doc)),
            );

            const successCount = results.filter(
              (r) => r.status === 'fulfilled',
            ).length;
            const failureCount = results.filter(
              (r) => r.status === 'rejected',
            ).length;

            logger.info(
              `Batch ${Math.floor(i / batchSize) + 1}: ${successCount} succeeded, ${failureCount} failed`,
            );

            if (failureCount > 0) {
              const failures = results
                .filter(
                  (r): r is PromiseRejectedResult => r.status === 'rejected',
                )
                .map((r) => r.reason);
              logger.warn('Some documents failed to upsert', { failures });
            }
          }
        }

        logger.info(
          `Completed cloning ${type ? `type '${type}' from ` : ''}collection: ${collection}`,
        );
      }

      logger.info('Clone operation completed successfully');
    } finally {
      // Always disconnect both connections
      await sourceDb.disconnect();
      await destDb.disconnect();
    }
  }

  export async function clearDestinationTypes(
    destConfig: CouchbaseConfiguration,
    collectionSpecs: CollectionTypeSpec[],
  ) {
    logger.info('Starting clear destination types operation', {
      collectionSpecs,
      destHost: destConfig.host,
    });

    // Create destination connection
    const destDb = await InitCouchbaseDalConnection(
      logger.child({ component: 'clear-destination' }),
      destConfig,
      { overrideSingleton: true },
    );

    try {
      // Process each collection spec that has a type
      for (const spec of collectionSpecs) {
        const { collection, type } = spec;

        if (type) {
          logger.info(`Clearing type '${type}' from collection: ${collection}`);

          // Ensure the collection exists in the destination
          await destDb.ensureCollection(logger, collection);

          // Delete documents of the specified type
          const deleteResult = await deleteOfType(destDb, type, collection);

          logger.info(
            `Cleared ${deleteResult.length} documents of type '${type}' from collection: ${collection}`,
          );
        } else {
          logger.info(
            `Skipping collection '${collection}' - no type specified for clearing`,
          );
        }
      }

      logger.info('Clear destination types operation completed successfully');
    } finally {
      // Always disconnect the connection
      await destDb.disconnect();
    }
  }

  export async function countOfType(
    db: CouchbaseDalConnection,
    type: string,
    collection: string,
  ) {
    let queryClause = 'WHERE type=$1';
    const queryArgs: Array<string | boolean | number> = [type];
    queryClause = `${queryClause}`;

    logger.info(`SELECT Count(*) FROM bucket ${queryClause}`, {
      queryArgs,
      collection,
    });
    return await db.query(
      collection,
      `SELECT Count(*) FROM bucket ${queryClause}`,
      queryArgs,
      { logger, adhoc: true },
    );
  }
  export async function countAll(
    db: CouchbaseDalConnection,
    collection: string,
  ) {
    logger.info('Getting total count and type breakdown', { collection });

    // Get total count
    const totalCountResult = await db.query(
      collection,
      'SELECT Count(*) as total FROM bucket',
      {},
      { logger, adhoc: true },
    );

    // Get count by type
    const typeCountResult = await db.query(
      collection,
      'SELECT type, Count(*) as count FROM bucket WHERE type IS NOT NULL GROUP BY type ORDER BY count DESC',
      {},
      { logger, adhoc: true },
    );

    // Get count of documents without type
    const noTypeCountResult = await db.query(
      collection,
      'SELECT Count(*) as count FROM bucket WHERE type IS NULL OR type IS MISSING',
      {},
      { logger, adhoc: true },
    );

    const totalCount = totalCountResult[0]?.total || 0;
    const typeCounts = typeCountResult.map((row) => ({
      type: row.type,
      count: row.count,
    }));
    const noTypeCount = noTypeCountResult[0]?.count || 0;

    const result = {
      total: totalCount,
      byType: typeCounts,
      withoutType: noTypeCount,
    };

    logger.info('Count results', { collection, result });

    return result;
  }
  export async function downloadAllAndSave(
    db: CouchbaseDalConnection,
    collection: string,
    path: string,
  ) {
    logger.info('SELECT * FROM bucket', { collection });
    const data = await db.query(
      collection,
      'SELECT * FROM bucket',
      {},
      { logger, adhoc: true },
    );
    fs.writeFileSync(path, JSON.stringify(data));
  }
  export async function uploadFromSave(
    db: CouchbaseDalConnection,
    collectionName: string,
    path: string,
  ) {
    logger.info('Starting upload', { collectionName, path });
    const data = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(data) as {
      [collection: string]: ITypedCouchbaseObject;
    }[];
    const result = await db.insertMany(
      collectionName,
      parsed
        .map((val) => val[collectionName])
        .filter((item): item is ITypedCouchbaseObject => item !== undefined),
    );
    logger.info('Finished upload', {
      collectionName,
      path,
      result,
    });
  }
  export async function uploadFromObjectList(
    db: CouchbaseDalConnection,
    collectionName: string,
    path: string,
  ) {
    logger.info('Uploading from object list', { collectionName, path });
    const data = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(data) as ITypedCouchbaseObject[];
    const result = await db.insertMany(collectionName, parsed);
    logger.info('Finished upload', {
      collectionName,
      path,
      result,
    });
  }
  export async function deleteOfType(
    db: CouchbaseDalConnection,
    type: string,
    collection: string,
  ) {
    let queryClause = 'WHERE type=$1';
    const queryArgs: Array<string | boolean | number> = [type];
    queryClause = `${queryClause}`;

    logger.info(`DELETE FROM bucket ${queryClause} RETURNING meta().id`, {
      queryArgs,
      collection,
    });
    return await db.query(
      collection,
      `DELETE FROM bucket ${queryClause} RETURNING meta().id`,
      queryArgs,
      { logger, adhoc: true },
    );
  }

  export async function deleteAll(
    db: CouchbaseDalConnection,
    collection: string,
  ) {
    logger.info('DELETE FROM bucket RETURNING meta().id', { collection });
    return await db.query(
      collection,
      'DELETE FROM bucket RETURNING meta().id',
      {},
      { logger, adhoc: true },
    );
  }
}
