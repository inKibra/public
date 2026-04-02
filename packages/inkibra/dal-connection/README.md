# @inkibra/dal-connection

A type-safe Data Access Layer (DAL) supporting multiple database backends through a driver abstraction layer.

## Overview

The DAL has been refactored to support multiple database backends through a driver abstraction layer. This allows switching between Couchbase and Postgres (via Drizzle ORM) with minimal code changes.

## Architecture

```
┌─────────────────────────────────────┐
│        Application Code             │
│  (Uses DalBase for data access)     │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│           DalBase                    │
│  (Type-safe service layer)           │
│  - find, get, insert, update, etc.   │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│        Driver Interface              │
│  (Abstract database operations)      │
└───────────────┬─────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌───────────────┐  ┌─────────────────┐
│CouchbaseDriver│  │  DrizzleDriver  │
│  (Couchbase)  │  │   (Postgres)    │
└───────────────┘  └─────────────────┘
```

## Quick Start

### Option 1: Drizzle (Postgres)

```typescript
import { DrizzleDriver, DalBase } from '@inkibra/dal-connection';

// Create driver
const driver = new DrizzleDriver({
  connectionString: process.env.DATABASE_URL,
  maxConnections: 20
});

// Create DAL
const userDal = await DalBase.init(logger, {
  driver,
  type: 'USER',
  collection: 'users',
  valueIndexes: ['email', 'username'],
  discriminator: (data): data is User =>
    data && typeof data === 'object' && 'type' in data && data.type === 'USER'
});

// Use the DAL
const result = await userDal.find(logger, {
  filter: {
    email: { operator: Filter.Operators.EQUAL, value: 'user@example.com' }
  }
});
```

### Option 2: Couchbase (Legacy)

```typescript
import {
  CouchbaseDriver,
  InitCouchbaseDalConnection,
  DalBase
} from '@inkibra/dal-connection';

// Create connection
const connection = await InitCouchbaseDalConnection(logger, config);
const driver = new CouchbaseDriver(connection);

// Create DAL (same API)
const userDal = await DalBase.init(logger, {
  driver,
  type: 'USER',
  collection: 'users',
  valueIndexes: ['email'],
  discriminator: isUser
});
```

## Development Workflow (Drizzle + PGlite)

### Setup

```bash
# Push schema to PGlite database
bun db:push

# Launch Drizzle Studio
bun db:studio
```

Studio opens at http://localhost:4983 with your PGlite database.

### Define Collections

Create schemas using `defineCollection()`:

```typescript
import { defineCollection } from './drizzle-helper';

export const users = defineCollection({
  name: 'users',
  dals: [{
    type: 'USER',
    valueIndexes: ['email', 'username'],
    arrayIndexes: ['roles'],
    partition: {
      name: 'tenant_partition',
      valueField: 'tenantId'
    }
  }]
});
```

This generates:
- **Base columns**: `id`, `type`, `version`, `created`, `modified`, `deleted`, `data`
- **Generated columns**: `part_tenant_partition`, `val_email`, `val_username`, `arr_roles`
- **Indexes**: Composite B-tree on `(type, val_*)` and GIN indexes on array columns

### Scripts

```bash
bun db:push       # Push schema to PGlite
bun db:studio     # Launch Drizzle Studio
bun test          # Run tests (in-memory PGlite)
bun test:watch    # Watch mode
```

## Core Concepts

### Driver Interface

The `Driver` interface defines all database operations:

```typescript
interface Driver {
  // Collection management
  ensureCollection(logger: Logger, schema: CollectionSchema): Promise<void>;
  ensureIndex(logger: Logger, collection: string, index: IndexConfig, typeFilter?: string): Promise<void>;

  // Query operations
  find<T>(logger: Logger, collection: string, type: string, options: FindOptions<T>): Promise<Result<T[], Error>>;
  get<T>(logger: Logger, collection: string, id: string): Promise<Result<{cas: Cas; value: T} | undefined, Error>>;
  getMany<T>(logger: Logger, collection: string, ids: string[]): Promise<Result<{value: T; cas: Cas}[], Error>>;
  exists(logger: Logger, collection: string, id: string): Promise<{exists: boolean}>;

  // Mutation operations
  insert<T>(logger: Logger, collection: string, value: T): Promise<Result<MutationResult, Error>>;
  insertMany<T>(logger: Logger, collection: string, values: T[]): Promise<Result<PromiseSettledResult<MutationResult>[], Error>>;
  replace<T>(logger: Logger, collection: string, cas: Cas, value: T): Promise<Result<{cas: Cas}, Error>>;
  remove(logger: Logger, collection: string, id: string, cas?: Cas): Promise<Result<MutationResult, Error>>;

  // Aggregation
  countFiltered<T>(logger: Logger, collection: string, type: string, filter: Filter<T>): Promise<Result<number, Error>>;

  // Lifecycle
  disconnect(): Promise<void>;
}
```

### Collections

Collections manage multiple DAL types in a single table:

```typescript
const collection = await createCollection(logger, driver, {
  name: 'social',
  partitions: ['post_partition'],
  dals: [
    {
      type: 'POST',
      valueIndexes: ['authorId', 'status'],
      arrayIndexes: ['tags'],
      partition: { name: 'post_partition', valueField: 'id' },
      discriminator: isPost,
    },
    {
      type: 'COMMENT',
      valueIndexes: ['authorId'],
      partition: { name: 'post_partition', valueField: 'postId' },
      discriminator: isComment,
    }
  ]
});
```

### Partition Queries

Partitions allow fetching related records across multiple types:

```typescript
// Get post and all its comments in one query
const allRecords = await collection.findByPartition(
  logger,
  'post_partition',
  'post_123', // The partition value
  {
    orderBy: { field: 'created', direction: 'DESC' },
    limit: 100
  }
);

// Filter to specific types
const onlyComments = await collection.findByPartition(
  logger,
  'post_partition',
  'post_123',
  { types: ['COMMENT'] }
);
```

**Use Cases:**
- Social Feed: Get post + all comments
- E-commerce: Get order + all line items
- Project Management: Get project + all tasks

## Testing with PGlite

We use [PGlite](https://pglite.dev/) for testing - a lightweight, in-process Postgres database that runs via WebAssembly.

### Benefits

- **Real Postgres** - Full compatibility including generated columns, GIN indexes, JSONB
- **Fast** - In-memory, no external database setup required
- **Isolated** - Each test gets a fresh database instance
- **No Dependencies** - Runs anywhere, no Docker needed

### Basic Setup

```typescript
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

// Create in-memory database
const pglite = new PGlite();
const db = drizzle(pglite);

// Tests run fast with no disk I/O
```

### Query Analysis

```typescript
// PGlite supports EXPLAIN for verifying index usage
const explain = await pglite.query(`
  EXPLAIN (ANALYZE, FORMAT JSON)
  SELECT * FROM social WHERE val_authorid = 'user_123'
`);
```

## Generated Columns

The DrizzleDriver uses PostgreSQL generated columns for performance:

```sql
-- Generated columns extract JSONB fields into indexed columns
val_email TEXT GENERATED ALWAYS AS ((data->>'email')) STORED

-- Queries use the pre-computed column (indexed!)
SELECT * FROM users WHERE val_email = 'user@example.com'
```

**Important:** All generated columns are TEXT to avoid Postgres immutability errors. Type casts like `::integer` are not immutable.

### Performance

| Operation | JSONB Extraction | Generated Column | Speedup |
|-----------|-----------------|------------------|---------|
| Simple WHERE | 2.3ms | 0.8ms | **2.9x** |
| Complex Filter | 5.1ms | 1.4ms | **3.6x** |
| ORDER BY | 3.2ms | 1.1ms | **2.9x** |
| Partition Query | 4.5ms | 1.2ms | **3.8x** |

## Features Comparison

| Feature | CouchbaseDriver | DrizzleDriver |
|---------|----------------|---------------|
| Basic CRUD | ✅ | ✅ |
| Filtering | ✅ (N1QL) | ✅ (SQL) |
| Composite Indexes | ⚠️ Limited | ✅ Full support |
| Generated Columns | ❌ | ✅ |
| Connection Pooling | ✅ | ✅ |
| Type Safety | ✅ | ✅✅ (Drizzle) |
| Studio/GUI | ❌ | ✅ (Drizzle Studio) |

## Best Practices

### 1. Always Use Type Guards

```typescript
const discriminator = (data: unknown): data is User => {
  return (
    data !== null &&
    typeof data === 'object' &&
    'type' in data &&
    data.type === 'USER' &&
    'email' in data &&
    typeof data.email === 'string'
  );
};
```

### 2. Index Frequently Queried Fields

```typescript
const userDal = await DalBase.init(logger, {
  driver,
  type: 'USER',
  collection: 'users',
  valueIndexes: ['email', 'username', 'createdAt'],
  arrayIndexes: ['roles', 'permissions'],
  discriminator: isUser,
});
```

### 3. Connection Management

```typescript
// Single driver instance per application
const driver = new DrizzleDriver({ connectionString: process.env.DATABASE_URL });

// Reuse across DALs
const userDal = await DalBase.init(logger, { driver, ... });
const postDal = await DalBase.init(logger, { driver, ... });

// Clean up on shutdown
process.on('SIGTERM', async () => {
  await driver.disconnect();
});
```

## Migration Path

### Phase 1: Add Postgres Driver
1. Create DrizzleDriver instance
2. Test with new collections

### Phase 2: Dual-Write
```typescript
// Write to both databases
await userDalCouchbase.insert(logger, user);
await userDalPostgres.insert(logger, user);
```

### Phase 3: Gradual Read Migration
```typescript
const shouldUsePostgres = Math.random() < POSTGRES_READ_PERCENTAGE;
const userDal = shouldUsePostgres ? userDalPostgres : userDalCouchbase;
```

### Phase 4: Full Cutover
```typescript
// Only Postgres
const driver = new DrizzleDriver({ connectionString: process.env.DATABASE_URL });
```

## Files

| File | Purpose |
|------|---------|
| `driver.ts` | Driver interface definition |
| `drivers/drizzle-driver.ts` | Postgres implementation |
| `drivers/couchbase-driver.ts` | Couchbase implementation |
| `service.ts` | DalBase service layer |
| `collections.ts` | Collection management |
| `collection-builder.ts` | Fluent builder API |
| `drizzle-helper.ts` | `defineCollection()` helper |
| `drizzle-schema.ts` | Collection definitions |
| `drizzle.config.ts` | PGlite config for Studio |

## References

- [Drizzle ORM](https://orm.drizzle.team/)
- [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview)
- [PGlite](https://pglite.dev/)
- [PostgreSQL Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)
