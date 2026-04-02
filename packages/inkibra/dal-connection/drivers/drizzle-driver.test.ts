import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import type { Logger } from '@inkibra/logger';
import type { Filter as FilterType } from '@inkibra/observable-cache';
import { Filter } from '@inkibra/observable-cache';
import { stub } from '@inkibra/test-support/stub';
import { drizzle } from 'drizzle-orm/pglite';
import type { DALConfig } from '../collections';
import { createCollection } from '../collections';
import type { CollectionSchema, Driver, TypedObjectBase } from '../driver';

// Import the base DrizzleDriver class
import { DrizzleDriver } from './drizzle-driver';

// Mock logger for testing
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Create a DrizzleDriver instance that uses PGlite instead of postgres
 * This bypasses the postgres connection setup in the constructor
 */
function createPGliteDriver(pglite: PGlite): Driver {
  const db = drizzle(pglite);

  // Create a minimal instance that bypasses the constructor
  const driver = Object.create(DrizzleDriver.prototype) as unknown as Record<
    string,
    unknown
  >;

  // Set required private fields
  driver['db'] = db;
  driver['schema'] = 'public';
  driver['tables'] = new Map<string, unknown>();
  driver['tableSchemas'] = new Map<string, CollectionSchema>();

  // Mock the client with a no-op end method
  driver['client'] = {
    end: async () => {},
  };

  return driver as unknown as Driver;
}

// Test types
interface Post extends TypedObjectBase {
  type: 'POST';
  id: string;
  postId: string;
  authorId: string;
  title: string;
  content: string;
  status: 'draft' | 'published';
  publishedAt?: string;
  tags: string[];
  created: string;
  modified: string;
}

interface Comment extends TypedObjectBase {
  type: 'COMMENT';
  id: string;
  postId: string;
  authorId: string;
  content: string;
  created: string;
  modified: string;
}

const isPost = (data: unknown): data is Post =>
  isRecord(data) && data['type'] === 'POST';
const isComment = (data: unknown): data is Comment =>
  isRecord(data) && data['type'] === 'COMMENT';

describe('DrizzleDriver with Generated Columns', () => {
  let pglite: PGlite;
  let driver: Driver;

  beforeAll(async () => {
    // Create in-memory PGlite instance
    pglite = new PGlite();

    // Create driver that uses PGlite
    driver = createPGliteDriver(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  test('should create table with generated columns for partitions', async () => {
    const schema: CollectionSchema = {
      name: 'social',
      dals: [
        {
          type: 'POST',
          valueIndexes: ['authorId', 'status'],
          arrayIndexes: ['tags'],
          partitions: [
            {
              name: 'post_partition',
              valueField: 'postId', // Changed to postId so both types use same field
            },
          ],
        },
        {
          type: 'COMMENT',
          valueIndexes: ['authorId'],
          partitions: [
            {
              name: 'post_partition',
              valueField: 'postId',
            },
          ],
        },
      ],
    };

    await driver.ensureCollection(mockLogger, schema, {
      createIfNotExists: true,
    });

    // Check that table was created with generated columns
    const result = await pglite.query(`
      SELECT column_name, data_type, is_generated
      FROM information_schema.columns
      WHERE table_name = 'social'
      ORDER BY ordinal_position;
    `);

    const columns = result.rows.flatMap((r) => {
      if (!isRecord(r)) return [];
      const name = r['column_name'];
      const type = r['data_type'];
      const generated = r['is_generated'];
      if (typeof name !== 'string' || typeof type !== 'string') return [];
      return [{ name, type, generated: String(generated) }];
    });

    // Check base columns exist
    expect(columns.find((c) => c.name === 'id')).toBeTruthy();
    expect(columns.find((c) => c.name === 'type')).toBeTruthy();
    expect(columns.find((c) => c.name === 'data')).toBeTruthy();

    // Check generated partition column exists
    const partitionCol = columns.find((c) => c.name === 'part_post_partition');
    expect(partitionCol).toBeTruthy();
    expect(partitionCol?.generated).toBe('ALWAYS');

    // Check generated value columns exist (case-insensitive)
    const authorIdCol = columns.find(
      (c) => c.name.toLowerCase() === 'val_authorid',
    );
    expect(authorIdCol).toBeTruthy();
    expect(authorIdCol?.generated).toBe('ALWAYS');

    const statusCol = columns.find(
      (c) => c.name.toLowerCase() === 'val_status',
    );
    expect(statusCol).toBeTruthy();
    expect(statusCol?.generated).toBe('ALWAYS');

    // Check generated array column exists
    const tagsCol = columns.find((c) => c.name === 'arr_tags');
    expect(tagsCol).toBeTruthy();
    expect(tagsCol?.generated).toBe('ALWAYS');
  });

  test('should create indexes on generated columns', async () => {
    // Query pg_indexes to check indexes were created
    const result = await pglite.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'social'
      ORDER BY indexname;
    `);

    const indexes = result.rows.flatMap((r) => {
      if (!isRecord(r)) return [];
      const name = r['indexname'];
      const def = r['indexdef'];
      if (typeof name !== 'string' || typeof def !== 'string') return [];
      return [{ name, def }];
    });

    // Check partition index
    const partitionIdx = indexes.find(
      (i) => i.name === 'social_part_post_partition_idx',
    );
    expect(partitionIdx).toBeTruthy();
    expect(partitionIdx?.def).toContain('type');
    expect(partitionIdx?.def).toContain('part_post_partition');

    // Check value indexes (case-insensitive)
    const authorIdIdx = indexes.find((i) =>
      i.name.toLowerCase().includes('val_authorid'),
    );
    expect(authorIdIdx).toBeTruthy();
    expect(authorIdIdx?.def).toContain('type');
    expect(authorIdIdx?.def.toLowerCase()).toContain('val_authorid');

    // Check GIN index on array column
    const tagsIdx = indexes.find((i) => i.name === 'social_arr_tags_gin_idx');
    expect(tagsIdx).toBeTruthy();
    expect(tagsIdx?.def).toContain('USING gin');
    expect(tagsIdx?.def).toContain('arr_tags');
  });

  test('should insert data and generated columns auto-populate', async () => {
    // First test: Insert data directly via PGlite to verify table structure
    await pglite.query(`
      INSERT INTO social (id, type, version, created, modified, data)
      VALUES (
        'post_test',
        'POST',
        1,
        '2024-01-01T00:00:00Z'::timestamp,
        '2024-01-01T00:00:00Z'::timestamp,
        '{"authorId": "user_direct", "title": "Direct Test", "content": "test", "status": "published", "tags": ["test"]}'::jsonb
      )
    `);

    // Verify generated columns populated
    const directCheck = await pglite.query(`
      SELECT id, type, part_post_partition, val_authorId, val_status, arr_tags
      FROM social WHERE id = 'post_test'
    `);

    expect(directCheck.rows.length).toBe(1);
    const directRow = directCheck.rows[0];
    if (!isRecord(directRow)) {
      throw new Error('Unexpected row shape from direct insert check');
    }
    expect(directRow['val_authorid'] ?? directRow['val_authorId']).toBe(
      'user_direct',
    );

    // Now test via driver
    // Note: postId must be added to data for partition column to work
    const postData: Post = {
      id: 'post_1',
      type: 'POST' as const,
      authorId: 'user_123',
      title: 'Test Post',
      content: 'This is a test post',
      status: 'published' as const,
      publishedAt: '2024-01-01T00:00:00Z',
      tags: ['test', 'demo'],
      postId: 'post_1', // Needed for partition column
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    };

    const result = await driver.insert<Post>(mockLogger, 'social', postData);
    if (result.isErr()) {
      console.error('Driver insert error:', result.error);
    }
    expect(result.isOk()).toBe(true);

    // Check that generated columns were populated
    const queryResult = await pglite.query(`
      SELECT
        id,
        type,
        part_post_partition,
        val_authorid,
        val_status,
        arr_tags
      FROM social
      WHERE id = 'post_1';
    `);

    expect(queryResult.rows.length).toBe(1);
    const row = queryResult.rows[0];
    if (!isRecord(row)) {
      throw new Error('Unexpected row shape from generated column check');
    }

    // Check generated columns have correct values
    expect(row['part_post_partition']).toBe('post_1'); // partition key = post.id
    expect(row['val_authorid']).toBe('user_123');
    expect(row['val_status']).toBe('published');
    expect(row['arr_tags']).toEqual(['test', 'demo']);
  });

  test('timestamps round-trip as RFC3339 strings', async () => {
    const postData = {
      id: 'post_time_1',
      type: 'POST' as const,
      authorId: 'user_time',
      title: 'Time Test',
      content: 'Time Test',
      status: 'published' as const,
      tags: ['time'],
      postId: 'post_time_1',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    };

    const insertRes = await driver.insert<Post>(mockLogger, 'social', postData);
    expect(insertRes.isOk()).toBe(true);

    const getRes = await driver.get<Post>(mockLogger, 'social', 'post_time_1');
    expect(getRes.isOk()).toBe(true);
    if (getRes.isErr()) return;
    expect(getRes.value.value).toBeTruthy();
    const value = getRes.value.value?.value;
    expect(typeof value?.created).toBe('string');
    expect(typeof value?.modified).toBe('string');
    expect((value?.created as string).includes('T')).toBe(true);
    expect((value?.modified as string).includes('T')).toBe(true);
    expect(value?.deleted).toBeUndefined();
  });

  test('upsert inserts and updates records', async () => {
    const created = '2024-01-05T00:00:00Z';
    const modified1 = '2024-01-05T00:00:00Z';
    const modified2 = '2024-01-06T00:00:00Z';

    const post: Post = {
      id: 'post_upsert_1',
      type: 'POST' as const,
      postId: 'post_upsert_1',
      authorId: 'user_upsert',
      title: 'Upsert Title',
      content: 'Upsert Content',
      status: 'draft',
      tags: ['upsert'],
      created,
      modified: modified1,
    };

    const upsertInsertRes = await driver.upsert<Post>(
      mockLogger,
      'social',
      post,
    );
    expect(upsertInsertRes.isOk()).toBe(true);

    const afterInsert = await driver.get<Post>(mockLogger, 'social', post.id);
    expect(afterInsert.isOk()).toBe(true);
    if (afterInsert.isErr()) return;
    expect(afterInsert.value.value?.value.title).toBe('Upsert Title');
    expect(Date.parse(afterInsert.value.value!.value.created)).toBe(
      Date.parse(created),
    );

    const updated: Post = {
      ...post,
      title: 'Upsert Title Updated',
      modified: modified2,
    };

    const upsertUpdateRes = await driver.upsert<Post>(
      mockLogger,
      'social',
      updated,
    );
    expect(upsertUpdateRes.isOk()).toBe(true);

    const afterUpdate = await driver.get<Post>(mockLogger, 'social', post.id);
    expect(afterUpdate.isOk()).toBe(true);
    if (afterUpdate.isErr()) return;
    expect(afterUpdate.value.value?.value.title).toBe('Upsert Title Updated');
    // created should not be overwritten by upsert updates
    expect(Date.parse(afterUpdate.value.value!.value.created)).toBe(
      Date.parse(created),
    );
    expect(Date.parse(afterUpdate.value.value!.value.modified)).toBe(
      Date.parse(modified2),
    );
  });

  test('upsert enforces CAS when provided', async () => {
    const created = '2024-01-07T00:00:00Z';
    const modified1 = '2024-01-07T00:00:00Z';
    const modified2 = '2024-01-08T00:00:00Z';
    const modified3 = '2024-01-09T00:00:00Z';

    const post: Post = {
      id: 'post_upsert_cas_1',
      type: 'POST' as const,
      postId: 'post_upsert_cas_1',
      authorId: 'user_upsert_cas',
      title: 'CAS Title',
      content: 'CAS Content',
      status: 'draft',
      tags: ['cas'],
      created,
      modified: modified1,
    };

    const insertRes = await driver.insert<Post>(mockLogger, 'social', post);
    expect(insertRes.isOk()).toBe(true);
    if (insertRes.isErr()) return;
    const cas1 = insertRes.value.value.cas;

    const firstUpdate: Post = {
      ...post,
      title: 'CAS Title Updated',
      modified: modified2,
    };
    const upsertWithCasOk = await driver.upsert<Post>(
      mockLogger,
      'social',
      firstUpdate,
      { cas: cas1 },
    );
    expect(upsertWithCasOk.isOk()).toBe(true);

    const secondUpdate: Post = {
      ...post,
      title: 'CAS Title Updated Again',
      modified: modified3,
    };
    const upsertWithStaleCas = await driver.upsert<Post>(
      mockLogger,
      'social',
      secondUpdate,
      { cas: cas1 },
    );
    expect(upsertWithStaleCas.isErr()).toBe(true);
  });

  test('should use generated columns in WHERE queries for better performance', async () => {
    // Insert multiple posts with unique author IDs for this test
    const posts = [
      {
        id: 'post_query_1',
        type: 'POST' as const,
        authorId: 'user_query_test',
        title: 'Post 2',
        content: 'Content 2',
        status: 'published' as const,
        tags: ['tech'],
        postId: 'post_query_1', // Needed for partition
        created: '2024-01-02T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
      },
      {
        id: 'post_query_2',
        type: 'POST' as const,
        authorId: 'user_query_test',
        title: 'Post 2b',
        content: 'Content 2b',
        status: 'published' as const,
        tags: ['tech'],
        postId: 'post_query_2', // Needed for partition
        created: '2024-01-02T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
      },
      {
        id: 'post_query_3',
        type: 'POST' as const,
        authorId: 'user_456',
        title: 'Post 3',
        content: 'Content 3',
        status: 'draft' as const,
        tags: ['personal'],
        postId: 'post_query_3', // Needed for partition
        created: '2024-01-03T00:00:00Z',
        modified: '2024-01-03T00:00:00Z',
      },
    ];

    for (const post of posts) {
      await driver.insert(mockLogger, 'social', post);
    }

    // Query using filter (should use generated column val_authorid)
    const result = await driver.find<Post>(mockLogger, 'social', 'POST', {
      filter: {
        authorId: {
          operator: Filter.Operators.EQUAL,
          value: 'user_query_test',
        },
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value.length).toBe(2); // post_query_1 and post_query_2
      expect(
        result.value.value.every((p) => p.authorId === 'user_query_test'),
      ).toBe(true);
    }

    // Verify query plan uses the generated column index
    const explainResult = await pglite.query(`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM social
      WHERE type = 'POST'
        AND deleted IS NULL
        AND val_authorid = 'user_query_test';
    `);

    const plan = JSON.stringify(explainResult.rows[0]).toLowerCase();
    // Should use one of the generated column indexes (planner chooses which one)
    const hasGeneratedColumnIndex =
      plan.includes('social_val_authorid_idx') ||
      plan.includes('social_val_status_idx');
    expect(hasGeneratedColumnIndex).toBe(true);
  });

  test('should support array filter operators (anyIn/everyIn/notAnyIn/notEveryIn)', async () => {
    const schema: CollectionSchema = {
      name: 'array_filters',
      dals: [
        {
          type: 'POST',
          valueIndexes: ['authorId'],
          arrayIndexes: ['tags'],
          partitions: [{ name: 'post_partition', valueField: 'postId' }],
        },
      ],
    };

    await driver.ensureCollection(mockLogger, schema, {
      createIfNotExists: true,
    });

    const posts: Post[] = [
      {
        id: 'post_arr_1',
        type: 'POST' as const,
        authorId: 'u1',
        title: 'A',
        content: 'A',
        status: 'draft',
        tags: ['foo', 'bar'],
        postId: 'p1',
        created: '2024-02-01T00:00:00Z',
        modified: '2024-02-01T00:00:00Z',
      },
      {
        id: 'post_arr_2',
        type: 'POST' as const,
        authorId: 'u2',
        title: 'B',
        content: 'B',
        status: 'draft',
        tags: ['baz'],
        postId: 'p2',
        created: '2024-02-01T00:00:00Z',
        modified: '2024-02-01T00:00:00Z',
      },
      {
        id: 'post_arr_3',
        type: 'POST' as const,
        authorId: 'u3',
        title: 'C',
        content: 'C',
        status: 'draft',
        tags: [],
        postId: 'p3',
        created: '2024-02-01T00:00:00Z',
        modified: '2024-02-01T00:00:00Z',
      },
    ];

    for (const post of posts) {
      await driver.insert<Post>(mockLogger, 'array_filters', post);
    }

    const anyInRes = await driver.find<Post>(
      mockLogger,
      'array_filters',
      'POST',
      {
        filter: {
          tags: { operator: 'anyIn', values: ['foo'] },
        } as unknown as FilterType<
          Post,
          keyof Post | 'created' | 'modified' | 'deleted'
        >,
      },
    );
    expect(anyInRes.isOk()).toBe(true);
    if (anyInRes.isOk()) {
      expect(anyInRes.value.value.map((p) => p.id).sort()).toEqual([
        'post_arr_1',
      ]);
    }

    const notAnyInRes = await driver.find<Post>(
      mockLogger,
      'array_filters',
      'POST',
      {
        filter: {
          tags: { operator: 'notAnyIn', values: ['foo'] },
        } as unknown as FilterType<
          Post,
          keyof Post | 'created' | 'modified' | 'deleted'
        >,
      },
    );
    expect(notAnyInRes.isOk()).toBe(true);
    if (notAnyInRes.isOk()) {
      expect(notAnyInRes.value.value.map((p) => p.id).sort()).toEqual([
        'post_arr_2',
        'post_arr_3',
      ]);
    }

    const everyInRes = await driver.find<Post>(
      mockLogger,
      'array_filters',
      'POST',
      {
        filter: {
          tags: { operator: 'everyIn', values: ['foo', 'bar'] },
        } as unknown as FilterType<
          Post,
          keyof Post | 'created' | 'modified' | 'deleted'
        >,
      },
    );
    expect(everyInRes.isOk()).toBe(true);
    if (everyInRes.isOk()) {
      // Empty arrays satisfy EVERY_IN (vacuously true)
      expect(everyInRes.value.value.map((p) => p.id).sort()).toEqual([
        'post_arr_1',
        'post_arr_3',
      ]);
    }

    const notEveryInRes = await driver.find<Post>(
      mockLogger,
      'array_filters',
      'POST',
      {
        filter: {
          tags: { operator: 'notEveryIn', values: ['foo', 'bar'] },
        } as unknown as FilterType<
          Post,
          keyof Post | 'created' | 'modified' | 'deleted'
        >,
      },
    );
    expect(notEveryInRes.isOk()).toBe(true);
    if (notEveryInRes.isOk()) {
      expect(notEveryInRes.value.value.map((p) => p.id).sort()).toEqual([
        'post_arr_2',
      ]);
    }
  });

  test('should use partition columns for findByPartition queries', async () => {
    // First insert a post to ensure it exists
    // Note: We need to add postId to the data even though it's the same as id,
    // so the partition column (data->>'postId') works for both POST and COMMENT types
    const postData = {
      id: 'post_partition_test',
      type: 'POST' as const,
      authorId: 'user_partition',
      title: 'Partition Test Post',
      content: 'Testing partitions',
      status: 'published' as const,
      tags: ['partition'],
      postId: 'post_partition_test', // Added so partition column works
      created: '2024-01-04T00:00:00Z',
      modified: '2024-01-04T00:00:00Z',
    };
    await driver.insert(mockLogger, 'social', postData);

    // Insert a comment for the post
    const comment: Comment = {
      id: 'comment_partition_test',
      type: 'COMMENT',
      postId: 'post_partition_test',
      authorId: 'user_partition',
      content: 'Great post!',
      created: '2024-01-04T00:00:00Z',
      modified: '2024-01-04T00:00:00Z',
    };
    await driver.insert(mockLogger, 'social', comment);

    // Query by partition (should use part_post_partition generated column)
    const result = await driver.findByPartition(
      mockLogger,
      'social',
      'post_partition',
      'post_partition_test',
      ['POST', 'COMMENT'],
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should find both the post (where id='post_partition_test') and comment (where postId='post_partition_test')
      expect(result.value.value.length).toBeGreaterThanOrEqual(2);

      const post = result.value.value.find((r) => r.type === 'POST');
      const comment = result.value.value.find((r) => r.type === 'COMMENT');

      expect(post).toBeTruthy();
      expect(comment).toBeTruthy();
    }

    // Verify query plan uses partition index
    const explainResult = await pglite.query(`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM social
      WHERE deleted IS NULL
        AND part_post_partition = 'post_1'
        AND type = ANY(ARRAY['POST', 'COMMENT']);
    `);

    const plan = JSON.stringify(explainResult.rows[0]);
    // Should use the partition index
    expect(plan).toContain('social_part_post_partition_idx');
  });

  test('should handle Collection with multiple DAL types', async () => {
    const postConfig: DALConfig<Post> = {
      type: 'POST',
      valueIndexes: ['authorId', 'status'],
      arrayIndexes: ['tags'],
      partitions: [{ name: 'post_partition', valueField: 'id' }],
      discriminator: isPost,
    };

    const commentConfig: DALConfig<Comment> = {
      type: 'COMMENT',
      valueIndexes: ['authorId'],
      partitions: [{ name: 'post_partition', valueField: 'postId' }],
      discriminator: isComment,
    };

    // Create collection with both DAL configs
    const collection = await createCollection(
      mockLogger,
      driver,
      {
        name: 'social_collection_test',
        partitions: ['post_partition'],
        dals: [postConfig, commentConfig],
      },
      { createIfNotExists: true },
    );

    expect(collection).toBeTruthy();
    expect(collection.getName()).toBe('social_collection_test');

    // Verify table was created with all necessary generated columns
    const result = await pglite.query(`
      SELECT column_name, is_generated
      FROM information_schema.columns
      WHERE table_name = 'social_collection_test'
        AND is_generated = 'ALWAYS'
      ORDER BY column_name;
    `);

    const generatedCols = result.rows.flatMap((r) => {
      if (!isRecord(r)) return [];
      const columnName = r['column_name'];
      return typeof columnName === 'string' ? [columnName] : [];
    });

    // Should have partition column
    expect(generatedCols).toContain('part_post_partition');

    // Should have value index columns (authorId is in both DALs, so should only appear once)
    expect(generatedCols).toContain('val_authorid');
    expect(generatedCols).toContain('val_status'); // Only in POST

    // Should have array index column
    expect(generatedCols).toContain('arr_tags'); // Only in POST
  });
});

describe('DrizzleDriver transient retry', () => {
  test('retries upsert once after transient connection errors', async () => {
    let attempts = 0;
    const driver = Object.create(DrizzleDriver.prototype) as Record<
      string,
      unknown
    >;
    driver['db'] = {
      execute: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error(
            'write CONNECTION_ENDED gcp-us-central1-1.pg.psdb.cloud:6432',
          );
          (error as Error & { code?: string }).code = 'CONNECTION_ENDED';
          throw error;
        }
        return [{ xmin: '42' }];
      },
    };
    driver['tables'] = new Map<string, unknown>();
    driver['tableSchemas'] = new Map<string, CollectionSchema>();
    driver['client'] = { end: async () => {} };
    driver['driverType'] = 'postgres-js';

    const result = await stub<DrizzleDriver>(driver).upsert(
      mockLogger,
      'test_collection',
      {
        id: 'doc-1',
        type: 'TEST',
        created: '2026-03-14T00:00:00.000Z',
        modified: '2026-03-14T00:00:00.000Z',
      },
    );

    expect(result.isOk()).toBe(true);
    expect(attempts).toBe(2);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.value.cas.value).toBe('42');
  });
});

describe('DrizzleDriver Performance with Generated Columns', () => {
  let pglite: PGlite;
  let driver: Driver;

  beforeAll(async () => {
    pglite = new PGlite();
    driver = createPGliteDriver(pglite);

    // Create collection
    await driver.ensureCollection(
      mockLogger,
      {
        name: 'posts',
        dals: [
          {
            type: 'POST',
            valueIndexes: ['authorId', 'status'],
          },
        ],
      },
      { createIfNotExists: true },
    );

    // Insert test data
    const posts: Post[] = [];
    for (let i = 0; i < 100; i++) {
      posts.push({
        id: `post_${i}`,
        type: 'POST' as const,
        postId: `post_${i}`,
        authorId: `user_${i % 10}`, // 10 different authors
        title: `Post ${i}`,
        content: `Content ${i}`,
        status: i % 2 === 0 ? 'published' : 'draft',
        tags: [`tag${i % 5}`],
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
      });
    }

    for (const post of posts) {
      await driver.insert<Post>(mockLogger, 'posts', post);
    }
  });

  afterAll(async () => {
    await pglite.close();
  });

  test('generated columns enable index-only scans', async () => {
    // Query that should use generated column index
    const explainResult = await pglite.query(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, type, data
      FROM posts
      WHERE type = 'POST'
        AND val_authorid = 'user_5'
        AND deleted IS NULL;
    `);

    const firstRow = explainResult.rows[0];
    if (!isRecord(firstRow)) {
      throw new Error('Unexpected EXPLAIN response shape');
    }
    const queryPlan = firstRow['QUERY PLAN'];
    if (!Array.isArray(queryPlan) || queryPlan.length === 0) {
      throw new Error('Unexpected EXPLAIN plan shape');
    }
    const plan = queryPlan[0];
    const planStr = JSON.stringify(plan).toLowerCase();

    // Should use the val_authorid index (case-insensitive check)
    expect(planStr).toContain('posts_val_authorid_idx');

    // Log execution time for reference
    if (isRecord(plan)) {
      console.log('Query execution time:', plan['Execution Time']);
    }
  });

  test('compare JSONB extraction vs generated column performance', async () => {
    // With generated column (optimized)
    const start1 = performance.now();
    await pglite.query(`
      SELECT COUNT(*) FROM posts
      WHERE type = 'POST'
        AND val_authorid = 'user_5';
    `);
    const time1 = performance.now() - start1;

    // With JSONB extraction (unoptimized - would be slower on real data)
    const start2 = performance.now();
    await pglite.query(`
      SELECT COUNT(*) FROM posts
      WHERE type = 'POST'
        AND data->>'authorId' = 'user_5';
    `);
    const time2 = performance.now() - start2;

    console.log(`Generated column query: ${time1.toFixed(2)}ms`);
    console.log(`JSONB extraction query: ${time2.toFixed(2)}ms`);

    // On real datasets, generated columns should be faster
    // For this small test dataset, the difference might not be significant
  });
});

describe('DrizzleDriver Transactions', () => {
  let pglite: PGlite;
  let driver: Driver;

  beforeAll(async () => {
    pglite = new PGlite();
    driver = createPGliteDriver(pglite);

    await driver.ensureCollection(
      mockLogger,
      {
        name: 'bulk_update_test',
        dals: [
          {
            type: 'POST',
            valueIndexes: ['authorId'],
          },
        ],
      },
      { createIfNotExists: true },
    );

    // Create collection for transaction tests
    await driver.ensureCollection(
      mockLogger,
      {
        name: 'tx_test',
        dals: [
          {
            type: 'POST',
            valueIndexes: ['authorId'],
          },
        ],
      },
      { createIfNotExists: true },
    );

    // Collections for commit-time failure tests (deferred FK checked at commit)
    await driver.ensureCollection(
      mockLogger,
      {
        name: 'tx_parent',
        dals: [
          {
            type: 'PARENT',
          },
        ],
      },
      { createIfNotExists: true },
    );

    await driver.ensureCollection(
      mockLogger,
      {
        name: 'tx_child',
        dals: [
          {
            type: 'CHILD',
            valueIndexes: ['parentId'],
          },
        ],
      },
      { createIfNotExists: true },
    );

    // Add a DEFERRABLE INITIALLY DEFERRED FK so violations surface on commit.
    // NOTE: tx_child has a generated `val_parentid` column from valueIndexes.
    try {
      await pglite.query(`
        ALTER TABLE "tx_child"
        ADD CONSTRAINT "tx_child_parent_fk"
        FOREIGN KEY (val_parentid)
        REFERENCES "tx_parent"(id)
        DEFERRABLE INITIALLY DEFERRED;
      `);
    } catch {
      // Ignore if already exists (tests may reuse the same in-memory db across runs)
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  test('should commit transaction with using pattern', async () => {
    // Insert within transaction using 'await using'
    {
      await using tx = await driver.beginTransaction();

      await tx.insert(mockLogger, 'tx_test', {
        id: 'tx_post_1',
        type: 'POST',
        authorId: 'tx_user_1',
        title: 'Transaction Test',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      // Should be able to read our own write within transaction
      const readResult = await tx.get(mockLogger, 'tx_test', 'tx_post_1');
      expect(readResult.isOk()).toBe(true);
      if (readResult.isOk()) {
        expect(readResult.value.value).toBeTruthy();
        expect(readResult.value.value?.value?.id).toBe('tx_post_1');
      }
      // Transaction auto-commits when tx goes out of scope
    }

    // Verify data persisted after transaction completed
    const result = await driver.get(mockLogger, 'tx_test', 'tx_post_1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value).toBeTruthy();
      expect(result.value.value?.value?.id).toBe('tx_post_1');
    }
  });

  test('should rollback transaction on explicit rollback', async () => {
    const tx = await driver.beginTransaction();

    await tx.insert(mockLogger, 'tx_test', {
      id: 'tx_post_rollback',
      type: 'POST',
      authorId: 'tx_user_1',
      title: 'Should be rolled back',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    // Explicitly rollback
    await tx.rollback();

    // Verify data was NOT persisted
    const result = await driver.get(mockLogger, 'tx_test', 'tx_post_rollback');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value).toBeUndefined();
    }
  });

  test('should support explicit commit', async () => {
    const tx = await driver.beginTransaction();

    await tx.insert(mockLogger, 'tx_test', {
      id: 'tx_post_explicit',
      type: 'POST',
      authorId: 'tx_user_1',
      title: 'Explicit commit',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    await tx.commit();

    // Verify data persisted
    const result = await driver.get(mockLogger, 'tx_test', 'tx_post_explicit');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value).toBeTruthy();
      expect(result.value.value?.value?.id).toBe('tx_post_explicit');
    }
  });

  test('commit should surface deferred constraint failures', async () => {
    const tx = await driver.beginTransaction();

    // Insert a child referencing a missing parent. Because the FK is deferrable+deferred,
    // this should succeed now and fail only at commit.
    await tx.insert(mockLogger, 'tx_child', {
      id: 'tx_child_missing_parent',
      type: 'CHILD',
      parentId: 'tx_parent_does_not_exist',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    const commitResult = await tx.commit();
    expect(commitResult.isErr()).toBe(true);

    // The failed commit should not persist the row.
    const result = await driver.get(
      mockLogger,
      'tx_child',
      'tx_child_missing_parent',
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value).toBeUndefined();
    }
  });

  test('should support upsert within transaction', async () => {
    await using tx = await driver.beginTransaction();

    // Insert first
    await tx.insert(mockLogger, 'tx_test', {
      id: 'tx_post_upsert',
      type: 'POST',
      authorId: 'tx_user_1',
      title: 'Original title',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    // Upsert to update
    await tx.upsert(mockLogger, 'tx_test', {
      id: 'tx_post_upsert',
      type: 'POST',
      authorId: 'tx_user_1',
      title: 'Updated title',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    // Check within transaction
    const readResult = await tx.get(mockLogger, 'tx_test', 'tx_post_upsert');
    expect(readResult.isOk()).toBe(true);
    if (readResult.isOk() && readResult.value.value?.value) {
      expect((readResult.value.value.value as Post).title).toBe(
        'Updated title',
      );
    }
  });

  test('should support replace within transaction', async () => {
    // First insert outside transaction
    await driver.insert(mockLogger, 'tx_test', {
      id: 'tx_post_replace',
      type: 'POST',
      authorId: 'tx_user_1',
      title: 'Before replace',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    {
      await using tx = await driver.beginTransaction();

      // Replace without CAS (transaction isolation handles concurrency)
      await tx.replace(mockLogger, 'tx_test', undefined, {
        id: 'tx_post_replace',
        type: 'POST',
        authorId: 'tx_user_1',
        title: 'After replace',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });
      // Transaction auto-commits when tx goes out of scope
    }

    // Check result after transaction (must be outside the using block to avoid deadlock)
    const result = await driver.get(mockLogger, 'tx_test', 'tx_post_replace');
    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value.value?.value) {
      expect((result.value.value.value as Post).title).toBe('After replace');
    }
  });

  test('should support remove within transaction', async () => {
    // First insert outside transaction
    await driver.insert(mockLogger, 'tx_test', {
      id: 'tx_post_remove',
      type: 'POST',
      authorId: 'tx_user_1',
      title: 'To be removed',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    {
      await using tx = await driver.beginTransaction();
      await tx.remove(mockLogger, 'tx_test', 'tx_post_remove');
      // Transaction auto-commits when tx goes out of scope
    }

    // Check result after transaction - should be deleted (must be outside using block)
    const result = await driver.get(mockLogger, 'tx_test', 'tx_post_remove');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value).toBeUndefined();
    }
  });

  test('isActive should reflect transaction state', async () => {
    const tx = await driver.beginTransaction();

    expect(tx.isActive).toBe(true);

    await tx.commit();

    expect(tx.isActive).toBe(false);
  });

  test('should support find within transaction', async () => {
    await using tx = await driver.beginTransaction();

    // Insert multiple records
    await tx.insert(mockLogger, 'tx_test', {
      id: 'tx_find_1',
      type: 'POST',
      authorId: 'find_user',
      title: 'Find test 1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    await tx.insert(mockLogger, 'tx_test', {
      id: 'tx_find_2',
      type: 'POST',
      authorId: 'find_user',
      title: 'Find test 2',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    // Find within transaction
    const result = await tx.find<Post>(mockLogger, 'tx_test', 'POST', {
      filter: {
        authorId: {
          operator: Filter.Operators.EQUAL,
          value: 'find_user',
        },
      } as FilterType<Post, keyof Post | 'created' | 'modified' | 'deleted'>,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value.length).toBe(2);
    }
  });

  test('bulkUpdate should update matching rows', async () => {
    const now = '2024-02-01T10:00:00.000Z';

    await driver.insert<Post>(mockLogger, 'bulk_update_test', {
      id: 'bulk_post_1',
      type: 'POST',
      postId: 'bulk_post_1',
      authorId: 'bulk_user_1',
      title: 'Bulk 1',
      content: 'Bulk content 1',
      status: 'draft',
      tags: [],
      created: '2024-02-01T00:00:00.000Z',
      modified: '2024-02-01T00:00:00.000Z',
    });

    await driver.insert<Post>(mockLogger, 'bulk_update_test', {
      id: 'bulk_post_2',
      type: 'POST',
      postId: 'bulk_post_2',
      authorId: 'bulk_user_1',
      title: 'Bulk 2',
      content: 'Bulk content 2',
      status: 'draft',
      tags: ['tag1'],
      created: '2024-02-01T00:00:00.000Z',
      modified: '2024-02-01T00:00:00.000Z',
    });

    await driver.insert<Post>(mockLogger, 'bulk_update_test', {
      id: 'bulk_post_3',
      type: 'POST',
      postId: 'bulk_post_3',
      authorId: 'bulk_user_2',
      title: 'Bulk 3',
      content: 'Bulk content 3',
      status: 'published',
      tags: ['tag2'],
      created: '2024-02-01T00:00:00.000Z',
      modified: '2024-02-01T00:00:00.000Z',
    });

    const updateResult = await driver.bulkUpdate<Post>(
      mockLogger,
      'bulk_update_test',
      'POST',
      {
        authorId: {
          operator: Filter.Operators.EQUAL,
          value: 'bulk_user_1',
        },
      } as FilterType<Post, keyof Post | 'created' | 'modified' | 'deleted'>,
      {
        deleted: now,
        modified: now,
      },
    );

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isOk()) {
      expect(updateResult.value.value.affected).toBe(2);
    }

    const updatedRows = await driver.find<Post>(
      mockLogger,
      'bulk_update_test',
      'POST',
      {
        filter: {
          authorId: {
            operator: Filter.Operators.EQUAL,
            value: 'bulk_user_1',
          },
        } as FilterType<Post, keyof Post | 'created' | 'modified' | 'deleted'>,
        orderBy: { field: 'id', direction: 'ASC' },
      },
    );

    expect(updatedRows.isOk()).toBe(true);
    if (updatedRows.isOk()) {
      const values = updatedRows.value.value;
      expect(values.length).toBe(0);
    }

    const rawRows = await pglite.query(`
      SELECT id, deleted, modified, data
      FROM bulk_update_test
      WHERE id IN ('bulk_post_1', 'bulk_post_2')
      ORDER BY id ASC;
    `);

    const row1 = rawRows.rows[0];
    const row2 = rawRows.rows[1];
    if (!isRecord(row1) || !isRecord(row2)) {
      throw new Error('Unexpected bulk update query response');
    }
    expect(new Date(String(row1['deleted'])).toISOString()).toBe(now);
    expect(new Date(String(row2['deleted'])).toISOString()).toBe(now);
    expect(new Date(String(row1['modified'])).toISOString()).toBe(now);
    expect(new Date(String(row2['modified'])).toISOString()).toBe(now);

    const data1 = row1['data'];
    const data2 = row2['data'];
    const parsedData1 = typeof data1 === 'string' ? JSON.parse(data1) : data1;
    const parsedData2 = typeof data2 === 'string' ? JSON.parse(data2) : data2;
    if (!isRecord(parsedData1) || !isRecord(parsedData2)) {
      throw new Error('Unexpected data column response');
    }
    expect(parsedData1['title']).toBe('Bulk 1');
    expect(parsedData2['title']).toBe('Bulk 2');

    const remainingResult = await driver.find<Post>(
      mockLogger,
      'bulk_update_test',
      'POST',
      {
        filter: {
          authorId: {
            operator: Filter.Operators.EQUAL,
            value: 'bulk_user_2',
          },
        } as FilterType<Post, keyof Post | 'created' | 'modified' | 'deleted'>,
      },
    );

    expect(remainingResult.isOk()).toBe(true);
    if (remainingResult.isOk()) {
      expect(remainingResult.value.value.length).toBe(1);
      expect(remainingResult.value.value[0]?.id).toBe('bulk_post_3');
    }
  });

  test('bulkUpdate should skip empty filters', async () => {
    const updateResult = await driver.bulkUpdate<Post>(
      mockLogger,
      'bulk_update_test',
      'POST',
      {} as FilterType<Post, keyof Post | 'created' | 'modified' | 'deleted'>,
      {
        deleted: '2024-02-02T00:00:00.000Z',
        modified: '2024-02-02T00:00:00.000Z',
      },
    );

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isOk()) {
      expect(updateResult.value.value.affected).toBe(0);
    }

    const remainingResult = await driver.find<Post>(
      mockLogger,
      'bulk_update_test',
      'POST',
      {
        filter: {
          authorId: {
            operator: Filter.Operators.EQUAL,
            value: 'bulk_user_2',
          },
        } as FilterType<Post, keyof Post | 'created' | 'modified' | 'deleted'>,
      },
    );

    expect(remainingResult.isOk()).toBe(true);
    if (remainingResult.isOk()) {
      expect(remainingResult.value.value.length).toBe(1);
      expect(remainingResult.value.value[0]?.id).toBe('bulk_post_3');
    }
  });
});
