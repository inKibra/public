# Transaction Support Implementation Plan

## Overview

Add transaction support to the Driver interface that works consistently across both PostgreSQL (Drizzle) and Couchbase backends, defaulting to `repeatable_read` isolation to match Couchbase's snapshot isolation semantics.

## Design Goals

1. **Consistent behavior** - Same semantics whether using Drizzle or Couchbase
2. **Two usage patterns** - Both `using` (TS 5.2+) and callback-based
3. **CAS optional in transactions** - Transaction isolation handles concurrency
4. **Match Couchbase defaults** - `repeatable_read` isolation by default

---

## 1. New Types (driver.ts)

```typescript
/**
 * Transaction isolation levels
 * Default: 'repeatable_read' to match Couchbase's snapshot isolation
 */
export type TransactionIsolation =
  | 'read_committed'    // PostgreSQL only, Couchbase ignores (uses snapshot)
  | 'repeatable_read'   // Default - matches Couchbase behavior
  | 'serializable';     // Strictest - both backends support

/**
 * Couchbase durability levels (PostgreSQL ignores)
 */
export type TransactionDurability =
  | 'majority'           // Default - in-memory on majority of replicas
  | 'persist_to_majority' // Persisted to disk on majority
  | 'persist_to_active';  // Persisted to disk on active node

/**
 * Options for beginning a transaction
 */
export type TransactionOptions = {
  /** Isolation level (default: 'repeatable_read') */
  isolation?: TransactionIsolation;
  /** Couchbase durability (default: 'majority', ignored by Drizzle) */
  durability?: TransactionDurability;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
};

/**
 * Transaction context - provides transactional operations
 * Implements AsyncDisposable for use with `await using`
 */
export interface Transaction extends AsyncDisposable {
  /** Get a document by ID (within transaction) */
  get<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    id: string,
  ): Promise<DbResult<{ cas: Cas; value: T } | undefined>>;

  /** Insert a document (within transaction) */
  insert<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    value: T,
  ): Promise<DbResult<MutationResult>>;

  /** Replace a document (CAS optional in transaction) */
  replace<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    cas: Cas | undefined,  // Optional in transactions
    value: T,
  ): Promise<DbResult<{ cas: Cas }>>;

  /** Remove a document */
  remove(
    logger: Logger,
    collection: string,
    id: string,
    cas?: Cas,
  ): Promise<DbResult<MutationResult>>;

  /** Find documents */
  find<T extends TypedObjectBase>(
    logger: Logger,
    collection: string,
    type: string,
    options: FindOptions<T>,
  ): Promise<DbResult<T[]>>;

  /** Explicitly commit the transaction */
  commit(): Promise<void>;

  /** Explicitly rollback the transaction */
  rollback(): Promise<void>;

  /** Check if transaction is still active */
  readonly isActive: boolean;
}
```

---

## 2. Driver Interface Changes (driver.ts)

Add to the `Driver` interface:

```typescript
export interface Driver {
  // ... existing methods ...

  /**
   * Begin a new transaction (for use with `await using`)
   * Returns a Transaction that auto-commits on dispose, auto-rollbacks on error
   *
   * @example
   * await using tx = await driver.beginTransaction();
   * await tx.insert(logger, 'social', doc);
   * // auto-commits when tx goes out of scope
   */
  beginTransaction(options?: TransactionOptions): Promise<Transaction>;

  /**
   * Execute a function within a transaction (callback pattern)
   * Auto-commits on success, auto-rollbacks on error
   *
   * @example
   * const result = await driver.transaction(async (tx) => {
   *   const doc = await tx.get(logger, 'social', 'doc_1');
   *   await tx.insert(logger, 'social', newDoc);
   *   return doc;
   * });
   */
  transaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}
```

---

## 3. DrizzleDriver Implementation

### Transaction Class

```typescript
class DrizzleTransaction implements Transaction {
  private _isActive = true;
  private committed = false;
  private rolledBack = false;

  constructor(
    private drizzleTx: PgTransaction,
    private options: TransactionOptions,
  ) {}

  get isActive() { return this._isActive; }

  async get<T>(logger: Logger, collection: string, id: string) {
    // Use drizzleTx for queries
  }

  async insert<T>(logger: Logger, collection: string, value: T) {
    // Use drizzleTx for insert
  }

  async replace<T>(logger: Logger, collection: string, cas: Cas | undefined, value: T) {
    // CAS optional - if provided, verify modified timestamp matches
    // If not provided, just update (transaction provides isolation)
  }

  async commit() {
    // Drizzle auto-commits when callback completes
    // This is a no-op for callback pattern
    // For `using` pattern, we track state
    this.committed = true;
    this._isActive = false;
  }

  async rollback() {
    // Throw to trigger rollback in Drizzle
    this.rolledBack = true;
    this._isActive = false;
    throw new TransactionRollbackError();
  }

  async [Symbol.asyncDispose]() {
    if (this._isActive && !this.committed && !this.rolledBack) {
      // Auto-commit on normal scope exit
      await this.commit();
    }
  }
}
```

### Driver Methods

```typescript
// DrizzleDriver class
async beginTransaction(options?: TransactionOptions): Promise<Transaction> {
  const isolation = options?.isolation ?? 'repeatable_read';

  // Map to Drizzle/PG isolation
  const pgIsolation = {
    'read_committed': 'read committed',
    'repeatable_read': 'repeatable read',
    'serializable': 'serializable',
  }[isolation];

  // Start transaction with isolation level
  // Return wrapped Transaction object
}

async transaction<T>(
  fn: (tx: Transaction) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return this.db.transaction(async (drizzleTx) => {
    const tx = new DrizzleTransaction(drizzleTx, options);
    return fn(tx);
  }, {
    isolationLevel: mapIsolation(options?.isolation),
  });
}
```

---

## 4. CouchbaseDriver Implementation

### Transaction Class

```typescript
class CouchbaseTransaction implements Transaction {
  private _isActive = true;

  constructor(
    private ctx: TransactionAttemptContext,  // From Couchbase SDK
    private connection: CouchbaseDalConnection,
  ) {}

  get isActive() { return this._isActive; }

  async get<T>(logger: Logger, collection: string, id: string) {
    const coll = this.getCollection(collection);
    const result = await this.ctx.get(coll, id);
    return ok({
      value: {
        cas: { value: result.cas.toString() },
        value: result.content as T,
      }
    });
  }

  async insert<T>(logger: Logger, collection: string, value: T) {
    const coll = this.getCollection(collection);
    const result = await this.ctx.insert(coll, value.id, value);
    return ok({ value: { cas: { value: result.cas.toString() } } });
  }

  async replace<T>(logger: Logger, collection: string, cas: Cas | undefined, value: T) {
    // In Couchbase transactions, must get first then replace
    const coll = this.getCollection(collection);
    const doc = await this.ctx.get(coll, value.id);
    await this.ctx.replace(doc, value);
    return ok({ value: { cas: { value: 'transaction' } } });
  }

  async commit() {
    // Couchbase auto-commits when callback completes
    this._isActive = false;
  }

  async rollback() {
    this._isActive = false;
    throw new Error('Transaction rolled back');
  }

  // For `using` pattern - Couchbase doesn't support this well
  // because transactions must complete within the callback
  async [Symbol.asyncDispose]() {
    // No-op for Couchbase - commit happens at callback end
  }
}
```

### Driver Methods

```typescript
// CouchbaseDriver class
async beginTransaction(options?: TransactionOptions): Promise<Transaction> {
  // Couchbase doesn't really support this pattern well
  // We could throw or return a limited implementation
  throw new Error(
    'Couchbase requires callback-based transactions. Use driver.transaction() instead.'
  );
}

async transaction<T>(
  fn: (tx: Transaction) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const durability = mapDurability(options?.durability ?? 'majority');

  return this.connection.cluster.transactions().run(
    async (ctx) => {
      const tx = new CouchbaseTransaction(ctx, this.connection);
      return fn(tx);
    },
    { durabilityLevel: durability }
  );
}
```

---

## 5. Error Handling

### New Error Codes (error-codes.ts)

```typescript
export const DALConnectionErrorCodes = {
  // ... existing ...

  TX_CONFLICT: createError('TX_CONFLICT', 'Transaction conflict - retry recommended'),
  TX_TIMEOUT: createError('TX_TIMEOUT', 'Transaction timed out'),
  TX_ROLLED_BACK: createError('TX_ROLLED_BACK', 'Transaction was rolled back'),
  TX_NOT_ACTIVE: createError('TX_NOT_ACTIVE', 'Transaction is no longer active'),
};
```

### Serialization Failure Handling

```typescript
// Wrap transaction to handle retries for serialization failures
async transactionWithRetry<T>(
  fn: (tx: Transaction) => Promise<T>,
  options?: TransactionOptions & { maxRetries?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.transaction(fn, options);
    } catch (e) {
      if (isSerializationFailure(e) && attempt < maxRetries - 1) {
        continue; // Retry
      }
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## 6. Usage Examples

### Pattern 1: `using` keyword (Drizzle only)

```typescript
async function transferFunds(from: string, to: string, amount: number) {
  await using tx = await driver.beginTransaction();

  const fromAcct = await tx.get(logger, 'accounts', from);
  const toAcct = await tx.get(logger, 'accounts', to);

  if (!fromAcct.value || !toAcct.value) {
    await tx.rollback();
    return;
  }

  await tx.replace(logger, 'accounts', undefined, {
    ...fromAcct.value.value,
    balance: fromAcct.value.value.balance - amount,
  });

  await tx.replace(logger, 'accounts', undefined, {
    ...toAcct.value.value,
    balance: toAcct.value.value.balance + amount,
  });

  // Auto-commits when tx goes out of scope
}
```

### Pattern 2: Callback (both drivers)

```typescript
async function transferFunds(from: string, to: string, amount: number) {
  await driver.transaction(async (tx) => {
    const fromAcct = await tx.get(logger, 'accounts', from);
    const toAcct = await tx.get(logger, 'accounts', to);

    await tx.replace(logger, 'accounts', undefined, {
      ...fromAcct.value.value,
      balance: fromAcct.value.value.balance - amount,
    });

    await tx.replace(logger, 'accounts', undefined, {
      ...toAcct.value.value,
      balance: toAcct.value.value.balance + amount,
    });
  });
}
```

### Pattern 3: With retry for conflicts

```typescript
await driver.transactionWithRetry(async (tx) => {
  // ... operations that might conflict ...
}, { maxRetries: 3, isolation: 'serializable' });
```

---

## 7. Implementation Order

1. **Add types to driver.ts**
   - TransactionIsolation, TransactionDurability, TransactionOptions
   - Transaction interface with AsyncDisposable
   - Add beginTransaction and transaction to Driver interface

2. **Add error codes**
   - TX_CONFLICT, TX_TIMEOUT, TX_ROLLED_BACK, TX_NOT_ACTIVE

3. **Implement DrizzleDriver transactions**
   - DrizzleTransaction class
   - beginTransaction method
   - transaction method

4. **Implement CouchbaseDriver transactions**
   - CouchbaseTransaction class
   - transaction method (beginTransaction throws)

5. **Add tests**
   - Basic transaction commit
   - Transaction rollback on error
   - Isolation behavior (read sees snapshot)
   - Conflict detection and retry
   - `using` keyword pattern

6. **Optional: Add to collection-builder**
   - Collection-level transaction helper
   - Type-safe transaction context per model

---

## 8. Questions to Resolve

1. **`using` pattern for Couchbase** - Couchbase SDK requires callback pattern. Options:
   - Throw error for `beginTransaction()` on Couchbase
   - Implement with background promise (risky)
   - Document as Drizzle-only feature

2. **CAS behavior in transactions** - Should we:
   - Completely ignore CAS in transactions?
   - Use CAS as additional check even within transaction?
   - Make it configurable?

3. **Cross-collection transactions** - Both backends support this. Do we need explicit API or just document that it works?

4. **Nested transactions / savepoints** - PostgreSQL supports savepoints. Couchbase doesn't. Skip for v1?

---

## 9. Behavior Matrix

| Scenario | PostgreSQL (Drizzle) | Couchbase |
|----------|---------------------|-----------|
| Default isolation | REPEATABLE READ | Snapshot (implicit) |
| `read_committed` | Uses READ COMMITTED | Ignored (snapshot) |
| `serializable` | Uses SERIALIZABLE | Same as default |
| Conflict on write | Serialization error | Auto-retry by SDK |
| `using` pattern | Supported | Not supported |
| Callback pattern | Supported | Supported |
| Durability option | Ignored | Applied |
| Timeout | Via statement_timeout | Via SDK config |
