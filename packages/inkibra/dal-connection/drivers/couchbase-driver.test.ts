import { describe, expect, test } from 'bun:test';
import type { Logger } from '@inkibra/logger';
import type { Filter as FilterType } from '@inkibra/observable-cache';
import { Filter } from '@inkibra/observable-cache';
import type { CollectionSchema, FindOptions, TypedObjectBase } from '../driver';
import { CouchbaseDalConnection, CouchbaseDriver } from './couchbase-driver';

function createMockLogger(): Logger {
  let base: Pick<Logger, 'child' | 'info' | 'warn' | 'debug' | 'error'>;
  base = {
    child: () => base as unknown as Logger,
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: () => {},
  };
  return base as unknown as Logger;
}

const mockLogger = createMockLogger();

type CapturedQuery = {
  collection?: string;
  query?: string;
  params?: unknown;
};

interface TrainingSession extends TypedObjectBase {
  type: 'nkttrainingsess';
  ownerId: string;
}

function createFakeCouchbaseConnection(): {
  connection: CouchbaseDalConnection;
  captured: CapturedQuery;
} {
  const captured: CapturedQuery = {};

  // CouchbaseDalConnection's constructor is guarded, so for unit tests we create
  // a prototyped object and override the methods CouchbaseDriver uses.
  const connection: CouchbaseDalConnection = Object.create(
    CouchbaseDalConnection.prototype,
  );

  connection.ensureCollection = async (
    _logger: Logger,
    _collection: string,
  ) => {};
  connection.ensureIndex = async (
    _logger: Logger,
    _indexedProperty: string,
    _typeAndCollection?: { type: string; collection: string },
  ) => {};
  connection.disconnect = async () => {};
  connection.query = async (
    collection: string,
    query: string,
    params?: unknown,
    _options?: {
      logger?: Logger;
      adhoc?: boolean;
      consistency?: unknown;
    },
  ) => {
    captured.collection = collection;
    captured.query = query;
    captured.params = params;

    if (query.startsWith('SELECT COUNT(*) as totalSize')) {
      return [{ totalSize: 0 }];
    }

    if (collection === 'tempo-api') {
      return [
        {
          'tempo-api': {
            id: 'doc-1',
            type: 'nkttrainingsess',
            ownerId: 'owner-1',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          },
        },
      ];
    }

    return [];
  };

  return { connection, captured };
}

function requireCapturedQuery(captured: CapturedQuery): string {
  if (!captured.query) throw new Error('Query was not captured');
  return captured.query;
}

describe('CouchbaseDriver query identifier quoting', () => {
  test('find() backtick-quotes hyphenated collections', async () => {
    const { connection, captured } = createFakeCouchbaseConnection();
    const driver = new CouchbaseDriver(connection);

    const options: FindOptions<TrainingSession> = {
      limit: 1,
      filter: {
        ownerId: { operator: Filter.Operators.EQUAL, value: 'owner-1' },
      },
    };

    const res = await driver.find<TrainingSession>(
      mockLogger,
      'tempo-api',
      'nkttrainingsess',
      options,
    );

    expect(res.isOk()).toBe(true);
    expect(captured.collection).toBe('tempo-api');
    expect(requireCapturedQuery(captured)).toContain(
      'SELECT * FROM `tempo-api`',
    );
  });

  test('countFiltered() backtick-quotes hyphenated collections', async () => {
    const { connection, captured } = createFakeCouchbaseConnection();
    const driver = new CouchbaseDriver(connection);

    const filter: FilterType<
      TrainingSession,
      keyof TrainingSession | 'created' | 'modified' | 'deleted'
    > = {
      ownerId: { operator: Filter.Operators.EQUAL, value: 'owner-1' },
    };

    const res = await driver.countFiltered<TrainingSession>(
      mockLogger,
      'tempo-api',
      'nkttrainingsess',
      filter,
    );

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().value).toBe(0);
    expect(requireCapturedQuery(captured)).toContain(
      'SELECT COUNT(*) as totalSize FROM `tempo-api`',
    );
  });

  test('findByPartition() backtick-quotes hyphenated collections', async () => {
    const { connection, captured } = createFakeCouchbaseConnection();
    const driver = new CouchbaseDriver(connection);

    const schema: CollectionSchema = {
      name: 'tempo-api',
      dals: [
        {
          type: 'nkttrainingsess',
          partitions: [{ name: 'owner', valueField: 'ownerId' }],
        },
      ],
    };

    await driver.ensureCollection(mockLogger, schema);

    const res = await driver.findByPartition<TrainingSession>(
      mockLogger,
      'tempo-api',
      'owner',
      'owner-1',
      ['nkttrainingsess'],
      { limit: 1 },
    );

    expect(res.isOk()).toBe(true);
    expect(requireCapturedQuery(captured)).toContain(
      'SELECT * FROM `tempo-api`',
    );
  });

  test('identifier quoting escapes backticks', async () => {
    const { connection, captured } = createFakeCouchbaseConnection();
    const driver = new CouchbaseDriver(connection);

    const collection = 'weird`name';
    const res = await driver.find<TrainingSession>(
      mockLogger,
      collection,
      'TYPE',
      { limit: 1 },
    );

    expect(res.isOk()).toBe(true);
    expect(requireCapturedQuery(captured)).toContain(
      'SELECT * FROM `weird``name`',
    );
  });
});
