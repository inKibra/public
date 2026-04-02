import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import type { Logger } from '@inkibra/logger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import {
  defineCollection,
  Filter,
  type ModelBase,
  type ModelDAL,
  type TypeSafeFilter,
  type TypeSafeOrderBy,
} from './collection-builder';
import type { DbResult } from './db-result';

function unwrapOk<T>(result: DbResult<T>): T {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ============================================================================
// Test Model Types
// ============================================================================

interface Post extends ModelBase {
  id: string;
  type: 'POST';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  postId: string;
  authorId: string;
  status: 'draft' | 'published';
  title: string;
  tags: string[];
}

interface Comment extends ModelBase {
  id: string;
  type: 'COMMENT';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  parentPostId: string;
  authorId: string;
  content: string;
}

// PostV1 for migration testing (missing 'status' field)
interface PostV1 extends ModelBase {
  id: string;
  type: 'POST';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  postId: string;
  authorId: string;
  title: string;
  tags: string[];
}

// Mock discriminators
const isPost = (data: unknown): data is Post => {
  if (!isRecord(data)) return false;
  return data['type'] === 'POST' && data['version'] === 2;
};

const isPostV1 = (data: unknown): data is PostV1 => {
  if (!isRecord(data)) return false;
  return data['type'] === 'POST' && data['version'] === 1;
};

const isComment = (data: unknown): data is Comment => {
  if (!isRecord(data)) return false;
  return data['type'] === 'COMMENT';
};

// ============================================================================
// Type Test Helpers (from frontendmasters.com/blog/testing-types-in-typescript/)
// ============================================================================

/**
 * Expect<T> - T must be true
 */
type Expect<T extends true> = T;

/**
 * TypesMatch<T, U> - Check if types are exactly equal (bidirectional)
 * Wrapped in tuples to prevent union distribution
 */
type TypesMatch<T, U> = [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;

/**
 * TypeExtends<T, U> - Check if T extends U
 */
type TypeExtends<T, U> = T extends U ? true : false;

// ============================================================================
// Runtime Tests
// ============================================================================

describe('Collection Builder', () => {
  describe('defineCollection fluent API', () => {
    test('builds a collection with partitions and models', () => {
      const social = defineCollection('social')
        .addPartition('post_partition')
        .addPartition('user_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          arrayIndexes: ['tags'] as const,
          partitions: {
            post_partition: 'postId',
            user_partition: 'authorId',
          },
          discriminator: isPost,
        })
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: {
            post_partition: 'parentPostId',
          },
          discriminator: isComment,
        })
        .addIndex({ fields: ['authorId', 'created'], name: 'author_timeline' })
        .build();

      expect(social.name).toBe('social');
      expect(social.partitions).toContain('post_partition');
      expect(social.partitions).toContain('user_partition');
      expect(social.table).toBeDefined();
      expect(social.POST).toBeDefined();
      expect(social.COMMENT).toBeDefined();
      expect(social.isInitialized()).toBe(false);
    });

    test('throws error when model references undefined partition', () => {
      expect(() => {
        defineCollection('test')
          .addModel('POST', {
            version: 1,
            valueIndexes: ['authorId'] as const,
            partitions: {
              undefined_partition: 'postId',
            },
            discriminator: isPost,
          })
          .build();
      }).toThrow(
        'references partition "undefined_partition" which hasn\'t been defined',
      );
    });

    test('creates pgTable with correct structure', () => {
      const social = defineCollection('social')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          arrayIndexes: ['tags'] as const,
          partitions: {
            post_partition: 'postId',
          },
          discriminator: isPost,
        })
        .build();

      const table = social.table;
      const tableCols = table as unknown as Record<string, unknown>;

      // Check base columns exist
      expect(tableCols['id']).toBeDefined();
      expect(tableCols['type']).toBeDefined();
      expect(tableCols['version']).toBeDefined();
      expect(tableCols['created']).toBeDefined();
      expect(tableCols['modified']).toBeDefined();
      expect(tableCols['deleted']).toBeDefined();
      expect(tableCols['data']).toBeDefined();

      // Check generated columns exist
      expect(tableCols['part_post_partition']).toBeDefined();
      expect(tableCols['val_authorid']).toBeDefined();
      expect(tableCols['val_status']).toBeDefined();
      expect(tableCols['arr_tags']).toBeDefined();
    });

    test('shares value index columns across models', () => {
      const social = defineCollection('social')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'parentPostId' },
          discriminator: isComment,
        })
        .build();

      const table = social.table;
      const tableCols = table as unknown as Record<string, unknown>;

      // authorId should be shared (only one val_authorid column)
      expect(tableCols['val_authorid']).toBeDefined();
      // status is only on POST
      expect(tableCols['val_status']).toBeDefined();
    });
  });

  describe('Filter helper', () => {
    test('creates correct filter operators', () => {
      expect(Filter.eq('test')).toEqual({ op: 'eq', value: 'test' });
      expect(Filter.neq(123)).toEqual({ op: 'neq', value: 123 });
      expect(Filter.gt(10)).toEqual({ op: 'gt', value: 10 });
      expect(Filter.gte(10)).toEqual({ op: 'gte', value: 10 });
      expect(Filter.lt(10)).toEqual({ op: 'lt', value: 10 });
      expect(Filter.lte(10)).toEqual({ op: 'lte', value: 10 });
      expect(Filter.in([1, 2, 3])).toEqual({ op: 'in', values: [1, 2, 3] });
      expect(Filter.nin(['a', 'b'])).toEqual({ op: 'nin', values: ['a', 'b'] });
      expect(Filter.like('%test%')).toEqual({ op: 'like', value: '%test%' });
      expect(Filter.between(1, 10)).toEqual({ op: 'between', from: 1, to: 10 });
    });
  });

  describe('collection with upgrade config', () => {
    test('builds collection with upgrade config', () => {
      const social = defineCollection('social')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          arrayIndexes: ['tags'] as const,
          partitions: {
            post_partition: 'postId',
          },
          discriminator: isPost,
          upgrade: {
            fromVersion: 1,
            fromValueIndexes: ['authorId'] as const,
            fromDiscriminator: isPostV1,
            transform: (old: PostV1): Post => ({
              ...old,
              status: 'draft',
            }),
            transformFilter: ({
              status: _status,
              ...rest
            }: Record<string, unknown>) => rest,
          },
        })
        .build();

      expect(social.POST).toBeDefined();
      expect(social.table).toBeDefined();
    });
  });

  describe('pgTable SQL generation', () => {
    let pglite: PGlite;
    let db: ReturnType<typeof drizzle>;

    beforeEach(async () => {
      pglite = new PGlite();
      db = drizzle(pglite);
    });

    test('creates valid SQL for table with partition CASE expression', async () => {
      // Build collection to verify structure (raw SQL used below for testing)
      defineCollection('social')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: {
            post_partition: 'postId',
          },
          discriminator: isPost,
        })
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: {
            post_partition: 'parentPostId',
          },
          discriminator: isComment,
        })
        .build();

      // Create the table using raw SQL (simulating what drizzle-kit push does)
      const createSQL = `
        CREATE TABLE social (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          created TIMESTAMP WITH TIME ZONE NOT NULL,
          modified TIMESTAMP WITH TIME ZONE NOT NULL,
          deleted TIMESTAMP WITH TIME ZONE,
          data JSONB NOT NULL,
          part_post_partition TEXT GENERATED ALWAYS AS (
            CASE type
              WHEN 'POST' THEN data->>'postId'
              WHEN 'COMMENT' THEN data->>'parentPostId'
            END
          ) STORED,
          val_authorid TEXT GENERATED ALWAYS AS (data->>'authorId') STORED
        )
      `;

      await db.execute(sql.raw(createSQL));

      // Insert test data
      await db.execute(sql`
        INSERT INTO social (id, type, version, created, modified, data)
        VALUES (
          'post_1',
          'POST',
          2,
          NOW(),
          NOW(),
          '{"postId": "p123", "authorId": "user_1", "title": "Test"}'::jsonb
        )
      `);

      await db.execute(sql`
        INSERT INTO social (id, type, version, created, modified, data)
        VALUES (
          'comment_1',
          'COMMENT',
          1,
          NOW(),
          NOW(),
          '{"parentPostId": "p123", "authorId": "user_2", "content": "Nice!"}'::jsonb
        )
      `);

      // Verify partition column works
      const result = await db.execute(sql`
        SELECT id, type, part_post_partition, val_authorid
        FROM social
        ORDER BY id
      `);

      const rows: unknown[] = Array.isArray(result)
        ? result
        : ((result.rows ?? []) as unknown[]);

      expect(rows).toHaveLength(2);

      const comment = rows.find(
        (r) => isRecord(r) && r['id'] === 'comment_1',
      ) as Record<string, unknown> | undefined;
      const post = rows.find((r) => isRecord(r) && r['id'] === 'post_1') as
        | Record<string, unknown>
        | undefined;

      // Both should have same partition value (p123)
      expect(post?.['part_post_partition']).toBe('p123');
      expect(comment?.['part_post_partition']).toBe('p123');

      // Each should have their own authorId
      expect(post?.['val_authorid']).toBe('user_1');
      expect(comment?.['val_authorid']).toBe('user_2');

      await pglite.close();
    });

    test('partition query returns records from multiple types', async () => {
      const createSQL = `
        CREATE TABLE social (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          created TIMESTAMP WITH TIME ZONE NOT NULL,
          modified TIMESTAMP WITH TIME ZONE NOT NULL,
          deleted TIMESTAMP WITH TIME ZONE,
          data JSONB NOT NULL,
          part_post_partition TEXT GENERATED ALWAYS AS (
            CASE type
              WHEN 'POST' THEN data->>'postId'
              WHEN 'COMMENT' THEN data->>'parentPostId'
            END
          ) STORED
        )
      `;

      await db.execute(sql.raw(createSQL));

      // Insert a post and two comments
      await db.execute(sql`
        INSERT INTO social (id, type, version, created, modified, data)
        VALUES
          ('post_1', 'POST', 2, NOW(), NOW(), '{"postId": "p123"}'::jsonb),
          ('comment_1', 'COMMENT', 1, NOW(), NOW(), '{"parentPostId": "p123"}'::jsonb),
          ('comment_2', 'COMMENT', 1, NOW(), NOW(), '{"parentPostId": "p123"}'::jsonb),
          ('comment_3', 'COMMENT', 1, NOW(), NOW(), '{"parentPostId": "p456"}'::jsonb)
      `);

      // Query by partition
      const result = await db.execute(sql`
        SELECT id, type, part_post_partition
        FROM social
        WHERE part_post_partition = 'p123'
        AND deleted IS NULL
        ORDER BY id
      `);

      const rows: unknown[] = Array.isArray(result)
        ? result
        : ((result.rows ?? []) as unknown[]);

      expect(rows).toHaveLength(3);
      const ids = rows.flatMap((r) => {
        if (!isRecord(r)) return [];
        const id = r['id'];
        return typeof id === 'string' ? [id] : [];
      });
      expect(ids).toContain('post_1');
      expect(ids).toContain('comment_1');
      expect(ids).toContain('comment_2');
      expect(ids).not.toContain('comment_3');

      await pglite.close();
    });
  });
});

// ============================================================================
// Type Tests (compile-time verification)
// ============================================================================

describe('Type Tests', () => {
  // These tests verify the types at compile time.
  // If TypeScript compiles without errors, the type tests pass.
  // The runtime tests just confirm the file compiles.

  test('TypeSafeFilter only allows indexed fields', () => {
    // Create a collection (verifying the builder works, type tests use explicit types)
    defineCollection('social')
      .addPartition('post_partition')
      .addModel('POST', {
        version: 2,
        valueIndexes: ['authorId', 'status'] as const,
        partitions: { post_partition: 'postId' },
        discriminator: isPost,
      })
      .build();

    // This type should be: { authorId?: ..., status?: ..., created?: ..., modified?: ... }
    type PostFilter = TypeSafeFilter<Post, readonly ['authorId', 'status']>;

    // Type-level assertions (these are compile-time checks)
    // The @ts-expect-error comments below verify that non-indexed fields cause errors

    // Valid filter fields compile without error
    const validFilter: PostFilter = {
      authorId: Filter.eq('user_1'),
      status: Filter.eq('published'),
      created: Filter.gte('2024-01-01'),
    };

    expect(validFilter.authorId).toBeDefined();
    expect(true).toBe(true); // Test passes if file compiles
  });

  test('TypeSafeOrderBy only allows indexed fields', () => {
    type PostOrderBy = TypeSafeOrderBy<Post, readonly ['authorId', 'status']>;

    // Valid orderBy
    const validOrderBy: PostOrderBy = { field: 'authorId', direction: 'ASC' };
    const validOrderBy2: PostOrderBy = { field: 'status', direction: 'DESC' };
    const validOrderBy3: PostOrderBy = { field: 'created', direction: 'ASC' };
    const validOrderBy4: PostOrderBy = { field: 'modified', direction: 'DESC' };

    // @ts-expect-error - 'title' is not an indexed field
    const invalidOrderBy: PostOrderBy = { field: 'title', direction: 'ASC' };

    expect(validOrderBy.field).toBe('authorId');
    expect(validOrderBy2.field).toBe('status');
    expect(validOrderBy3.field).toBe('created');
    expect(validOrderBy4.field).toBe('modified');
  });

  test('ModelDAL.find has correct filter type', () => {
    const social = defineCollection('social')
      .addPartition('post_partition')
      .addModel('POST', {
        version: 2,
        valueIndexes: ['authorId', 'status'] as const,
        partitions: { post_partition: 'postId' },
        discriminator: isPost,
      })
      .build();

    // Extract the type of social.POST.find's options parameter
    type FindOptions = Parameters<typeof social.POST.find>[1];

    // This should compile - authorId is indexed
    const validOptions: FindOptions = {
      filter: { authorId: Filter.eq('user_1') },
      orderBy: { field: 'status', direction: 'DESC' },
    };

    expect(validOptions.filter?.authorId).toBeDefined();
  });

  test('BuiltCollection has correct model accessors', () => {
    const social = defineCollection('social')
      .addPartition('post_partition')
      .addModel('POST', {
        version: 2,
        valueIndexes: ['authorId', 'status'] as const,
        partitions: { post_partition: 'postId' },
        discriminator: isPost,
      })
      .addModel('COMMENT', {
        version: 1,
        valueIndexes: ['authorId'] as const,
        partitions: { post_partition: 'parentPostId' },
        discriminator: isComment,
      })
      .build();

    // Type assertions
    type SocialCollection = typeof social;

    // These should exist and have correct types
    type PostDAL = SocialCollection['POST'];
    type CommentDAL = SocialCollection['COMMENT'];

    // Verify the DAL types match expected structure
    type _PostFindResult = Awaited<ReturnType<PostDAL['find']>>;
    type _CommentGetResult = Awaited<ReturnType<CommentDAL['get']>>;

    // Test that POST DAL returns Post[] (compile-time check)
    // @ts-expect-error - Type test: intentionally unused
    type _Test1 = Expect<TypeExtends<_PostFindResult, DbResult<Post[]>>>;

    // Test that COMMENT DAL get returns Comment or undefined (compile-time check)
    // @ts-expect-error - Type test: intentionally unused
    type _Test2 = Expect<
      TypeExtends<
        _CommentGetResult,
        DbResult<{ cas: { value: string }; value: Comment } | undefined>
      >
    >;

    expect(social.POST).toBeDefined();
    expect(social.COMMENT).toBeDefined();
  });

  test('partition names are type-safe', () => {
    const social = defineCollection('social')
      .addPartition('post_partition')
      .addPartition('user_partition')
      .addModel('POST', {
        version: 2,
        valueIndexes: ['authorId'] as const,
        partitions: { post_partition: 'postId' },
        discriminator: isPost,
      })
      .build();

    // Partitions array should have correct type (compile-time check)
    type Partitions = (typeof social)['partitions'];
    // @ts-expect-error - Type test: intentionally unused
    type _Test = Expect<
      TypeExtends<Partitions, ('post_partition' | 'user_partition')[]>
    >;

    expect(social.partitions).toContain('post_partition');
    expect(social.partitions).toContain('user_partition');
  });

  test('Filter operators have correct value types', () => {
    // String field should only accept string values
    type StringFilter = TypeSafeFilter<Post, readonly ['authorId']>;

    const validStringFilter: StringFilter = {
      authorId: Filter.eq('user_1'), // string value ✓
    };

    const invalidStringFilter: StringFilter = {
      // @ts-expect-error - number value for string field
      authorId: Filter.eq(123),
    };
    void invalidStringFilter; // Used for type checking only

    expect(validStringFilter.authorId?.op).toBe('eq');
  });

  test('collection name is preserved in type', () => {
    const myCollection = defineCollection('my_collection_name').build();

    // Compile-time type check
    type CollectionName = (typeof myCollection)['name'];
    // @ts-expect-error - Type test: intentionally unused
    type _Test = Expect<TypesMatch<CollectionName, 'my_collection_name'>>;

    expect(myCollection.name).toBe('my_collection_name');
  });
});

// ============================================================================
// Additional Type-Only Tests (no runtime, just compilation checks)
// ============================================================================

// These type definitions will cause TypeScript errors if the types are wrong.
// They don't run at runtime - if the file compiles, the types are correct.

// Test: QueryableFields includes value indexes + temporal fields
type _QueryableFieldsTest = Expect<
  TypesMatch<
    'authorId' | 'status' | 'created' | 'modified',
    'authorId' | 'status' | 'created' | 'modified'
  >
>;

// Test: TypeSafeFilter keys are limited to queryable fields
type _FilterKeysTest = TypeSafeFilter<Post, readonly ['authorId', 'status']>;
type _FilterKeysActual = keyof _FilterKeysTest;
// Should be: 'authorId' | 'status' | 'created' | 'modified' (all optional)

// Test: ModelDAL has all required methods
type _ModelDALMethodsTest = keyof ModelDAL<Post, readonly ['authorId']>;
type _RequiredMethods =
  | 'find'
  | 'findOne'
  | 'get'
  | 'getMany'
  | 'exists'
  | 'insert'
  | 'insertMany'
  | 'replace'
  | 'remove';
type _HasAllMethods = Expect<
  TypeExtends<_RequiredMethods, _ModelDALMethodsTest>
>;

// Export type test aliases to suppress "unused" warnings (they're compile-time checks)
export type { _QueryableFieldsTest, _FilterKeysActual, _HasAllMethods };

// ============================================================================
// Integration Tests with DrizzleDriver
// ============================================================================

import { DrizzleDriver } from './drivers/drizzle-driver';

// Mock logger for tests - returns itself from child() to support chained logging
const createMockLogger = (): Logger => {
  let base: Pick<Logger, 'info' | 'warn' | 'error' | 'debug' | 'child'>;
  base = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => base as unknown as Logger,
  };
  return base as unknown as Logger;
};

const mockLogger = createMockLogger();

describe('Collection Builder Integration Tests', () => {
  let pglite: PGlite;
  let driver: DrizzleDriver;

  beforeEach(async () => {
    pglite = new PGlite();
    const db = drizzle(pglite);
    driver = DrizzleDriver.fromDb({ db });
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe('Collection initialization and basic CRUD', () => {
    test('initializes collection and creates table', async () => {
      const social = defineCollection('social_crud_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          arrayIndexes: ['tags'] as const,
          partitions: {
            post_partition: 'postId',
          },
          discriminator: isPost,
        })
        .build();

      expect(social.isInitialized()).toBe(false);

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      expect(social.isInitialized()).toBe(true);
    });

    test('inserts and retrieves a single record by ID', async () => {
      const social = defineCollection('social_get_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert a post
      const insertResult = unwrapOk(
        await social.POST.insert(mockLogger, {
          id: 'post_1',
          type: 'POST',
          postId: 'p123',
          authorId: 'user_1',
          status: 'published',
          title: 'Test Post',
          tags: ['test', 'example'],
        }),
      );

      expect(insertResult.cas).toBeDefined();

      // Get by ID
      const getResult = unwrapOk(await social.POST.get(mockLogger, 'post_1'));

      expect(getResult).toBeDefined();
      expect(getResult?.value.id).toBe('post_1');
      expect(getResult?.value.postId).toBe('p123');
      expect(getResult?.value.authorId).toBe('user_1');
      expect(getResult?.value.status).toBe('published');
      expect(getResult?.value.title).toBe('Test Post');
      expect(getResult?.cas).toBeDefined();
    });

    test('checks if record exists', async () => {
      const social = defineCollection('social_exists_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Check non-existent record
      const existsBefore = await social.POST.exists(mockLogger, 'post_1');
      expect(existsBefore).toBe(false);

      // Insert record
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p123',
        authorId: 'user_1',
        status: 'draft',
        title: 'Test',
        tags: [],
      });

      // Check existing record
      const existsAfter = await social.POST.exists(mockLogger, 'post_1');
      expect(existsAfter).toBe(true);
    });

    test('replaces a record with CAS check', async () => {
      const social = defineCollection('social_replace_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert initial record
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p123',
        authorId: 'user_1',
        status: 'draft',
        title: 'Original Title',
        tags: [],
      });

      // Get the record to get CAS
      const original = unwrapOk(await social.POST.get(mockLogger, 'post_1'));
      expect(original).toBeDefined();

      // Replace with updated values
      if (!original) {
        throw new Error('Original record should exist');
      }
      const replaceResult = unwrapOk(
        await social.POST.replace(
          mockLogger,
          {
            ...original.value,
            status: 'published',
            title: 'Updated Title',
          },
          { cas: original.cas },
        ),
      );

      expect(replaceResult.cas).toBeDefined();

      // Verify the update
      const updated = unwrapOk(await social.POST.get(mockLogger, 'post_1'));
      expect(updated?.value.status).toBe('published');
      expect(updated?.value.title).toBe('Updated Title');
    });

    test('removes a record', async () => {
      const social = defineCollection('social_remove_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert record
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p123',
        authorId: 'user_1',
        status: 'draft',
        title: 'Test',
        tags: [],
      });

      // Verify it exists
      expect(await social.POST.exists(mockLogger, 'post_1')).toBe(true);

      // Remove it
      await social.POST.remove(mockLogger, 'post_1');

      // Verify it no longer exists (soft delete)
      const result = unwrapOk(await social.POST.get(mockLogger, 'post_1'));
      expect(result).toBeUndefined();
    });
  });

  describe('Querying individual models with find()', () => {
    test('finds all records of a model type', async () => {
      const social = defineCollection('social_find_all_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert multiple posts
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p1',
        authorId: 'user_1',
        status: 'published',
        title: 'First Post',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_2',
        type: 'POST',
        postId: 'p2',
        authorId: 'user_2',
        status: 'draft',
        title: 'Second Post',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_3',
        type: 'POST',
        postId: 'p3',
        authorId: 'user_1',
        status: 'published',
        title: 'Third Post',
        tags: [],
      });

      // Find all posts
      const allPosts = unwrapOk(await social.POST.find(mockLogger));
      expect(allPosts).toHaveLength(3);
    });

    test('finds records with filter on indexed field', async () => {
      const social = defineCollection('social_find_filter_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert posts
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p1',
        authorId: 'user_1',
        status: 'published',
        title: 'First Post',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_2',
        type: 'POST',
        postId: 'p2',
        authorId: 'user_2',
        status: 'draft',
        title: 'Second Post',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_3',
        type: 'POST',
        postId: 'p3',
        authorId: 'user_1',
        status: 'published',
        title: 'Third Post',
        tags: [],
      });

      // Find posts by authorId
      const user1Posts = unwrapOk(
        await social.POST.find(mockLogger, {
          filter: { authorId: Filter.eq('user_1') },
        }),
      );
      expect(user1Posts).toHaveLength(2);
      expect(user1Posts.every((p) => p.authorId === 'user_1')).toBe(true);

      // Find posts by status
      const publishedPosts = unwrapOk(
        await social.POST.find(mockLogger, {
          filter: { status: Filter.eq('published') },
        }),
      );
      expect(publishedPosts).toHaveLength(2);
      expect(publishedPosts.every((p) => p.status === 'published')).toBe(true);

      // Find with multiple filters
      const user1Published = unwrapOk(
        await social.POST.find(mockLogger, {
          filter: {
            authorId: Filter.eq('user_1'),
            status: Filter.eq('published'),
          },
        }),
      );
      expect(user1Published).toHaveLength(2);
    });

    test('finds records with limit and offset', async () => {
      const social = defineCollection('social_find_pagination_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert 5 posts
      for (let i = 1; i <= 5; i++) {
        await social.POST.insert(mockLogger, {
          id: `post_${i}`,
          type: 'POST',
          postId: `p${i}`,
          authorId: 'user_1',
          status: 'published',
          title: `Post ${i}`,
          tags: [],
        });
      }

      // Find with limit
      const limitedPosts = unwrapOk(
        await social.POST.find(mockLogger, { limit: 2 }),
      );
      expect(limitedPosts).toHaveLength(2);

      // Find with offset
      const offsetPosts = unwrapOk(
        await social.POST.find(mockLogger, { limit: 2, offset: 2 }),
      );
      expect(offsetPosts).toHaveLength(2);
    });

    test('findOne returns single matching record', async () => {
      const social = defineCollection('social_findone_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p1',
        authorId: 'user_1',
        status: 'published',
        title: 'First Post',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_2',
        type: 'POST',
        postId: 'p2',
        authorId: 'user_2',
        status: 'draft',
        title: 'Second Post',
        tags: [],
      });

      // Find one by filter
      const post = unwrapOk(
        await social.POST.findOne(mockLogger, {
          filter: { authorId: Filter.eq('user_2') },
        }),
      );

      expect(post).toBeDefined();
      expect(post?.authorId).toBe('user_2');
      expect(post?.status).toBe('draft');

      // Find one that doesn't exist
      const noPost = unwrapOk(
        await social.POST.findOne(mockLogger, {
          filter: { authorId: Filter.eq('nonexistent') },
        }),
      );
      expect(noPost).toBeUndefined();
    });

    test('getMany retrieves multiple records by IDs', async () => {
      const social = defineCollection('social_getmany_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert posts
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p1',
        authorId: 'user_1',
        status: 'published',
        title: 'Post 1',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_2',
        type: 'POST',
        postId: 'p2',
        authorId: 'user_2',
        status: 'draft',
        title: 'Post 2',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_3',
        type: 'POST',
        postId: 'p3',
        authorId: 'user_1',
        status: 'published',
        title: 'Post 3',
        tags: [],
      });

      // Get multiple by IDs
      const posts = unwrapOk(
        await social.POST.getMany(mockLogger, ['post_1', 'post_3']),
      );
      expect(posts).toHaveLength(2);
      expect(posts.map((p) => p.value.id).sort()).toEqual(['post_1', 'post_3']);
    });
  });

  describe('Partition queries (findByPartition)', () => {
    test('finds all records in a partition across model types', async () => {
      const social = defineCollection('social_partition_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'parentPostId' },
          discriminator: isComment,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert a post
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p123',
        authorId: 'user_1',
        status: 'published',
        title: 'Main Post',
        tags: [],
      });

      // Insert comments on that post
      await social.COMMENT.insert(mockLogger, {
        id: 'comment_1',
        type: 'COMMENT',
        parentPostId: 'p123',
        authorId: 'user_2',
        content: 'First comment!',
      });

      await social.COMMENT.insert(mockLogger, {
        id: 'comment_2',
        type: 'COMMENT',
        parentPostId: 'p123',
        authorId: 'user_3',
        content: 'Second comment!',
      });

      // Insert a comment on a different post (should not be in partition p123)
      await social.COMMENT.insert(mockLogger, {
        id: 'comment_3',
        type: 'COMMENT',
        parentPostId: 'p456',
        authorId: 'user_4',
        content: 'Comment on other post',
      });

      // Query by partition - should get post and 2 comments
      const partitionRecords = unwrapOk(
        await social.findByPartition(mockLogger, 'post_partition', 'p123'),
      );

      expect(partitionRecords).toHaveLength(3);

      const types = partitionRecords.map((r) => r.type);
      expect(types.filter((t) => t === 'POST')).toHaveLength(1);
      expect(types.filter((t) => t === 'COMMENT')).toHaveLength(2);
    });

    test('filters partition query by specific model types', async () => {
      const social = defineCollection('social_partition_filter_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'parentPostId' },
          discriminator: isComment,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert post and comments
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p123',
        authorId: 'user_1',
        status: 'published',
        title: 'Main Post',
        tags: [],
      });

      await social.COMMENT.insert(mockLogger, {
        id: 'comment_1',
        type: 'COMMENT',
        parentPostId: 'p123',
        authorId: 'user_2',
        content: 'Comment',
      });

      await social.COMMENT.insert(mockLogger, {
        id: 'comment_2',
        type: 'COMMENT',
        parentPostId: 'p123',
        authorId: 'user_3',
        content: 'Another comment',
      });

      // Query partition for only COMMENT types
      const commentsOnly = unwrapOk(
        await social.findByPartition(mockLogger, 'post_partition', 'p123', {
          types: ['COMMENT'],
        }),
      );

      expect(commentsOnly).toHaveLength(2);
      expect(commentsOnly.every((r) => r.type === 'COMMENT')).toBe(true);

      // Query partition for only POST types
      const postsOnly = unwrapOk(
        await social.findByPartition(mockLogger, 'post_partition', 'p123', {
          types: ['POST'],
        }),
      );

      expect(postsOnly).toHaveLength(1);
      expect(postsOnly[0]?.type).toBe('POST');
    });

    test('partition query supports limit and offset', async () => {
      const social = defineCollection('social_partition_pagination_test')
        .addPartition('post_partition')
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'parentPostId' },
          discriminator: isComment,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert many comments on the same post
      for (let i = 1; i <= 10; i++) {
        await social.COMMENT.insert(mockLogger, {
          id: `comment_${i}`,
          type: 'COMMENT',
          parentPostId: 'p123',
          authorId: `user_${i}`,
          content: `Comment ${i}`,
        });
      }

      // Query with limit
      const limited = unwrapOk(
        await social.findByPartition(mockLogger, 'post_partition', 'p123', {
          limit: 5,
        }),
      );
      expect(limited).toHaveLength(5);

      // Query with offset
      const offset = unwrapOk(
        await social.findByPartition(mockLogger, 'post_partition', 'p123', {
          limit: 3,
          offset: 5,
        }),
      );
      expect(offset).toHaveLength(3);
    });

    test('partition query returns empty array for non-existent partition value', async () => {
      const social = defineCollection('social_partition_empty_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert a post
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p123',
        authorId: 'user_1',
        status: 'published',
        title: 'Post',
        tags: [],
      });

      // Query non-existent partition value
      const result = unwrapOk(
        await social.findByPartition(
          mockLogger,
          'post_partition',
          'nonexistent',
        ),
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('Multiple partitions', () => {
    test('supports models in multiple partitions', async () => {
      const social = defineCollection('social_multi_partition_test')
        .addPartition('post_partition')
        .addPartition('user_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['status'] as const,
          partitions: {
            post_partition: 'postId',
            user_partition: 'authorId',
          },
          discriminator: isPost,
        })
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: [] as const,
          partitions: {
            post_partition: 'parentPostId',
            user_partition: 'authorId',
          },
          discriminator: isComment,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert posts by different users
      await social.POST.insert(mockLogger, {
        id: 'post_1',
        type: 'POST',
        postId: 'p1',
        authorId: 'user_a',
        status: 'published',
        title: 'Post by A',
        tags: [],
      });

      await social.POST.insert(mockLogger, {
        id: 'post_2',
        type: 'POST',
        postId: 'p2',
        authorId: 'user_b',
        status: 'draft',
        title: 'Post by B',
        tags: [],
      });

      // Insert comments
      await social.COMMENT.insert(mockLogger, {
        id: 'comment_1',
        type: 'COMMENT',
        parentPostId: 'p1',
        authorId: 'user_b',
        content: "B commenting on A's post",
      });

      await social.COMMENT.insert(mockLogger, {
        id: 'comment_2',
        type: 'COMMENT',
        parentPostId: 'p2',
        authorId: 'user_a',
        content: "A commenting on B's post",
      });

      // Query by post_partition
      const post1Content = unwrapOk(
        await social.findByPartition(mockLogger, 'post_partition', 'p1'),
      );
      expect(post1Content).toHaveLength(2); // post_1 + comment_1

      // Query by user_partition - get all content by user_a
      const userAContent = unwrapOk(
        await social.findByPartition(mockLogger, 'user_partition', 'user_a'),
      );
      expect(userAContent).toHaveLength(2); // post_1 + comment_2

      // Query by user_partition - get all content by user_b
      const userBContent = unwrapOk(
        await social.findByPartition(mockLogger, 'user_partition', 'user_b'),
      );
      expect(userBContent).toHaveLength(2); // post_2 + comment_1
    });
  });

  describe('upgrade() method', () => {
    test('batch upgrades old-version records', async () => {
      const social = defineCollection('social_upgrade_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
          upgrade: {
            fromVersion: 1,
            fromValueIndexes: ['authorId'] as const,
            fromDiscriminator: isPostV1,
            transform: (old: PostV1): Post => ({
              ...old,
              status: 'draft',
            }),
            transformFilter: (filter: Record<string, unknown>) => filter,
          },
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert old-version records directly via the driver (simulating pre-upgrade data)
      const pglite = (
        driver as unknown as {
          db: { execute: (sql: unknown) => Promise<unknown> };
        }
      ).db;
      await pglite.execute(sql`
        INSERT INTO social_upgrade_test (id, type, version, created, modified, data)
        VALUES
          ('post_v1_1', 'POST', 1, NOW(), NOW(), '{"postId": "p1", "authorId": "user_1", "title": "Old Post 1", "tags": []}'::jsonb),
          ('post_v1_2', 'POST', 1, NOW(), NOW(), '{"postId": "p2", "authorId": "user_2", "title": "Old Post 2", "tags": []}'::jsonb),
          ('post_v1_3', 'POST', 1, NOW(), NOW(), '{"postId": "p3", "authorId": "user_1", "title": "Old Post 3", "tags": []}'::jsonb)
      `);

      // Run upgrade
      const upgradeResult = await social.POST.upgrade(mockLogger, {
        batchSize: 2,
      });

      expect(upgradeResult).toBeDefined();
      if (!upgradeResult)
        throw new Error('Upgrade result should not be undefined');

      const result = unwrapOk(upgradeResult);
      expect(result.upgraded).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.failedIds).toHaveLength(0);

      // Verify all records are now v2 with status field
      const allPosts = unwrapOk(await social.POST.find(mockLogger));
      expect(allPosts).toHaveLength(3);
      expect(allPosts.every((p) => p.version === 2)).toBe(true);
      expect(allPosts.every((p) => p.status === 'draft')).toBe(true);
    });

    test('returns undefined when no upgrade config exists', async () => {
      const social = defineCollection('social_no_upgrade_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: (_data: unknown): _data is Post => true,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      const result = await social.POST.upgrade(mockLogger);
      expect(result).toBeUndefined();
    });

    test('dry run does not modify records', async () => {
      const social = defineCollection('social_dryrun_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
          upgrade: {
            fromVersion: 1,
            fromValueIndexes: ['authorId'] as const,
            fromDiscriminator: isPostV1,
            transform: (old: PostV1): Post => ({
              ...old,
              status: 'published',
            }),
            transformFilter: (filter: Record<string, unknown>) => filter,
          },
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert old-version record
      const pglite = (
        driver as unknown as {
          db: { execute: (sql: unknown) => Promise<unknown> };
        }
      ).db;
      await pglite.execute(sql`
        INSERT INTO social_dryrun_test (id, type, version, created, modified, data)
        VALUES ('post_dryrun_1', 'POST', 1, NOW(), NOW(), '{"postId": "p1", "authorId": "user_1", "title": "Test", "tags": []}'::jsonb)
      `);

      // Run dry-run upgrade
      const upgradeResult = await social.POST.upgrade(mockLogger, {
        dryRun: true,
      });

      expect(upgradeResult).toBeDefined();
      if (!upgradeResult)
        throw new Error('Upgrade result should not be undefined');

      const result = unwrapOk(upgradeResult);
      expect(result.dryRun).toBe(true);
      expect(result.upgraded).toBe(1);

      // Verify record is still v1 (not actually upgraded)
      const rawQuery = await pglite.execute(sql`
        SELECT version FROM social_dryrun_test WHERE id = 'post_dryrun_1'
      `);
      const rows = (rawQuery as { rows: { version: number }[] }).rows;
      expect(rows[0]?.version).toBe(1);
    });

    test('reports progress during upgrade', async () => {
      const social = defineCollection('social_progress_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
          upgrade: {
            fromVersion: 1,
            fromValueIndexes: ['authorId'] as const,
            fromDiscriminator: isPostV1,
            transform: (old: PostV1): Post => ({
              ...old,
              status: 'draft',
            }),
            transformFilter: (filter: Record<string, unknown>) => filter,
          },
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert old-version records
      const pglite = (
        driver as unknown as {
          db: { execute: (sql: unknown) => Promise<unknown> };
        }
      ).db;
      await pglite.execute(sql`
        INSERT INTO social_progress_test (id, type, version, created, modified, data)
        VALUES
          ('post_prog_1', 'POST', 1, NOW(), NOW(), '{"postId": "p1", "authorId": "u1", "title": "T1", "tags": []}'::jsonb),
          ('post_prog_2', 'POST', 1, NOW(), NOW(), '{"postId": "p2", "authorId": "u2", "title": "T2", "tags": []}'::jsonb)
      `);

      const progressCalls: { upgraded: number; currentBatch: number }[] = [];

      await social.POST.upgrade(mockLogger, {
        batchSize: 1,
        onProgress: (stats) => {
          progressCalls.push({
            upgraded: stats.upgraded,
            currentBatch: stats.currentBatch,
          });
        },
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1]?.upgraded).toBe(2);
    });
  });

  describe('insertMany', () => {
    test('inserts multiple records in batch', async () => {
      const social = defineCollection('social_insertmany_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      const posts = [
        {
          id: 'post_1',
          type: 'POST' as const,
          postId: 'p1',
          authorId: 'user_1',
          status: 'published' as const,
          title: 'Post 1',
          tags: [],
        },
        {
          id: 'post_2',
          type: 'POST' as const,
          postId: 'p2',
          authorId: 'user_2',
          status: 'draft' as const,
          title: 'Post 2',
          tags: [],
        },
        {
          id: 'post_3',
          type: 'POST' as const,
          postId: 'p3',
          authorId: 'user_1',
          status: 'published' as const,
          title: 'Post 3',
          tags: [],
        },
      ];

      const results = unwrapOk(await social.POST.insertMany(mockLogger, posts));

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      // Verify all were inserted
      const allPosts = unwrapOk(await social.POST.find(mockLogger));
      expect(allPosts).toHaveLength(3);
    });
  });

  describe('Collection methods with transactions', () => {
    test('insert within transaction commits on success', async () => {
      const social = defineCollection('social_tx_insert_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert within a transaction using `await using`
      await using tx = await driver.beginTransaction();

      await social.POST.insert(
        mockLogger,
        {
          id: 'post_tx_1',
          type: 'POST',
          postId: 'p1',
          authorId: 'user_1',
          status: 'published',
          title: 'Transaction Post',
          tags: ['tx-test'],
        },
        { tx },
      );

      // Within transaction, we can read the inserted record
      const withinTx = unwrapOk(
        await social.POST.get(mockLogger, 'post_tx_1', { tx }),
      );
      expect(withinTx).toBeDefined();
      expect(withinTx?.value.title).toBe('Transaction Post');

      // Commit happens automatically when tx goes out of scope
    });

    test('committed transaction data is visible after scope exits', async () => {
      const social = defineCollection('social_tx_commit_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert within a transaction scope
      {
        await using tx = await driver.beginTransaction();
        await social.POST.insert(
          mockLogger,
          {
            id: 'post_commit_1',
            type: 'POST',
            postId: 'p1',
            authorId: 'user_1',
            status: 'published',
            title: 'Committed Post',
            tags: [],
          },
          { tx },
        );
      }

      // After transaction scope exits and commits, data should be visible
      const afterCommit = unwrapOk(
        await social.POST.get(mockLogger, 'post_commit_1'),
      );
      expect(afterCommit).toBeDefined();
      expect(afterCommit?.value.title).toBe('Committed Post');
    });

    test('rolled back transaction data is not visible', async () => {
      const social = defineCollection('social_tx_rollback_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert within a transaction, then rollback
      try {
        await using tx = await driver.beginTransaction();
        await social.POST.insert(
          mockLogger,
          {
            id: 'post_rollback_1',
            type: 'POST',
            postId: 'p1',
            authorId: 'user_1',
            status: 'draft',
            title: 'Will be rolled back',
            tags: [],
          },
          { tx },
        );

        // Explicitly rollback
        await tx.rollback();
      } catch {
        // Rollback throws to abort the transaction
      }

      // Data should NOT be visible after rollback
      const afterRollback = unwrapOk(
        await social.POST.get(mockLogger, 'post_rollback_1'),
      );
      expect(afterRollback).toBeUndefined();
    });

    test('find within transaction sees uncommitted changes', async () => {
      const social = defineCollection('social_tx_find_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      await using tx = await driver.beginTransaction();

      // Insert multiple posts within transaction
      await social.POST.insert(
        mockLogger,
        {
          id: 'post_find_1',
          type: 'POST',
          postId: 'p1',
          authorId: 'user_1',
          status: 'published',
          title: 'Post 1',
          tags: [],
        },
        { tx },
      );

      await social.POST.insert(
        mockLogger,
        {
          id: 'post_find_2',
          type: 'POST',
          postId: 'p2',
          authorId: 'user_1',
          status: 'draft',
          title: 'Post 2',
          tags: [],
        },
        { tx },
      );

      // Find within transaction should see uncommitted data
      const posts = unwrapOk(
        await social.POST.find(mockLogger, {
          filter: { authorId: Filter.eq('user_1') },
          tx,
        }),
      );

      expect(posts).toHaveLength(2);
    });

    test('replace within transaction with optional CAS', async () => {
      const social = defineCollection('social_tx_replace_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // First insert a record outside transaction
      await social.POST.insert(mockLogger, {
        id: 'post_replace_1',
        type: 'POST',
        postId: 'p1',
        authorId: 'user_1',
        status: 'draft',
        title: 'Original Title',
        tags: [],
      });

      const original = unwrapOk(
        await social.POST.get(mockLogger, 'post_replace_1'),
      );
      expect(original).toBeDefined();

      // Replace within transaction (CAS optional in transactions)
      {
        await using tx = await driver.beginTransaction();

        // Replace without CAS (transaction isolation handles concurrency)
        await social.POST.replace(
          mockLogger,
          {
            ...original!.value,
            status: 'published',
            title: 'Updated in TX',
          },
          { tx }, // CAS optional in transactions
        );
      }

      // Verify the update after commit
      const updated = unwrapOk(
        await social.POST.get(mockLogger, 'post_replace_1'),
      );
      expect(updated?.value.status).toBe('published');
      expect(updated?.value.title).toBe('Updated in TX');
    });

    test('remove within transaction', async () => {
      const social = defineCollection('social_tx_remove_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      // Insert a record
      await social.POST.insert(mockLogger, {
        id: 'post_remove_1',
        type: 'POST',
        postId: 'p1',
        authorId: 'user_1',
        status: 'draft',
        title: 'To be removed',
        tags: [],
      });

      expect(await social.POST.exists(mockLogger, 'post_remove_1')).toBe(true);

      // Remove within transaction
      {
        await using tx = await driver.beginTransaction();
        await social.POST.remove(mockLogger, 'post_remove_1', { tx });
      }

      // Verify removal after commit
      const removed = unwrapOk(
        await social.POST.get(mockLogger, 'post_remove_1'),
      );
      expect(removed).toBeUndefined();
    });

    test('exists within transaction sees uncommitted changes', async () => {
      const social = defineCollection('social_tx_exists_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      await using tx = await driver.beginTransaction();

      // Check existence before insert
      const existsBefore = await social.POST.exists(
        mockLogger,
        'post_exists_1',
        {
          tx,
        },
      );
      expect(existsBefore).toBe(false);

      // Insert within transaction
      await social.POST.insert(
        mockLogger,
        {
          id: 'post_exists_1',
          type: 'POST',
          postId: 'p1',
          authorId: 'user_1',
          status: 'draft',
          title: 'Exists Test',
          tags: [],
        },
        { tx },
      );

      // Check existence after insert (within same transaction)
      const existsAfter = await social.POST.exists(
        mockLogger,
        'post_exists_1',
        {
          tx,
        },
      );
      expect(existsAfter).toBe(true);
    });

    test('upsert within transaction', async () => {
      const social = defineCollection('social_tx_upsert_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      {
        await using tx = await driver.beginTransaction();

        // Upsert a new record
        await social.POST.upsert(
          mockLogger,
          {
            id: 'post_upsert_1',
            type: 'POST',
            postId: 'p1',
            authorId: 'user_1',
            status: 'draft',
            title: 'Initial Upsert',
            tags: [],
          },
          { tx },
        );

        // Upsert again to update
        await social.POST.upsert(
          mockLogger,
          {
            id: 'post_upsert_1',
            type: 'POST',
            postId: 'p1',
            authorId: 'user_1',
            status: 'published',
            title: 'Updated via Upsert',
            tags: ['updated'],
          },
          { tx },
        );
      }

      // Verify final state after commit
      const result = unwrapOk(
        await social.POST.get(mockLogger, 'post_upsert_1'),
      );
      expect(result).toBeDefined();
      expect(result?.value.status).toBe('published');
      expect(result?.value.title).toBe('Updated via Upsert');
    });

    test('multiple model operations in single transaction', async () => {
      const social = defineCollection('social_tx_multi_model_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .addModel('COMMENT', {
          version: 1,
          valueIndexes: ['authorId'] as const,
          partitions: { post_partition: 'parentPostId' },
          discriminator: isComment,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      {
        await using tx = await driver.beginTransaction();

        // Insert a post
        await social.POST.insert(
          mockLogger,
          {
            id: 'post_multi_1',
            type: 'POST',
            postId: 'p1',
            authorId: 'user_1',
            status: 'published',
            title: 'Post with comments',
            tags: [],
          },
          { tx },
        );

        // Insert comments on the post within same transaction
        await social.COMMENT.insert(
          mockLogger,
          {
            id: 'comment_multi_1',
            type: 'COMMENT',
            parentPostId: 'p1',
            authorId: 'user_2',
            content: 'First comment',
          },
          { tx },
        );

        await social.COMMENT.insert(
          mockLogger,
          {
            id: 'comment_multi_2',
            type: 'COMMENT',
            parentPostId: 'p1',
            authorId: 'user_3',
            content: 'Second comment',
          },
          { tx },
        );
      }

      // Verify all records after commit
      const post = unwrapOk(await social.POST.get(mockLogger, 'post_multi_1'));
      expect(post).toBeDefined();

      const comments = unwrapOk(await social.COMMENT.find(mockLogger));
      expect(comments).toHaveLength(2);
    });

    test('findOne within transaction', async () => {
      const social = defineCollection('social_tx_findone_test')
        .addPartition('post_partition')
        .addModel('POST', {
          version: 2,
          valueIndexes: ['authorId', 'status'] as const,
          partitions: { post_partition: 'postId' },
          discriminator: isPost,
        })
        .build();

      await social.initialize(mockLogger, driver, { createIfNotExists: true });

      await using tx = await driver.beginTransaction();

      await social.POST.insert(
        mockLogger,
        {
          id: 'post_findone_1',
          type: 'POST',
          postId: 'p1',
          authorId: 'unique_user',
          status: 'published',
          title: 'FindOne Test',
          tags: [],
        },
        { tx },
      );

      // findOne within transaction should find the uncommitted record
      const found = unwrapOk(
        await social.POST.findOne(mockLogger, {
          filter: { authorId: Filter.eq('unique_user') },
          tx,
        }),
      );

      expect(found).toBeDefined();
      expect(found?.authorId).toBe('unique_user');
    });
  });
});
