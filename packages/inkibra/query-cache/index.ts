/**
 * @inkibra/query-cache
 *
 * Query cache with:
 * - Entity storage by type:id
 * - Status tracking (ok, not-found, deleted, error)
 * - DSL query support
 * - Optimistic overlays (global + scoped)
 * - SSR serialize/hydrate (committed only)
 * - Subscription by DSL selection with scope support
 */

import {
  type FilterExpression,
  matchesFilters,
  type QueryParams,
} from './query-dsl';

// Re-export query-dsl types and functions for consumers
export * from './query-dsl';

// ============================================================================
// Types
// ============================================================================

export type EntityId = string;
export type EntityType = string;
export type EntityKey = `${EntityType}:${EntityId}`;

/**
 * Canonical entity status:
 * - 'ok': Data is valid
 * - 'not-found': Entity does not exist (404)
 * - 'deleted': Entity was deleted
 * - 'error': Last fetch failed (canonical/persistent error)
 */
export type CacheStatus = 'ok' | 'not-found' | 'deleted' | 'error';

/**
 * Cache entry with data and status.
 * - data present + status: 'error' = "Stale with error" (Got before, now failing)
 * - data null + status: 'error' = "Hard error" (Never got it, failing)
 * - data present + status: 'ok' = Valid data
 * - data null + status: 'not-found' = Entity does not exist
 */
export type CacheEntry<T = unknown> = {
  data: T | null;
  status: CacheStatus;
  updatedAt: number;
  type: EntityType;
  id: EntityId;
};

export type CacheConfig = {
  /** Default stale time in ms (default: 0 = always stale) */
  defaultStaleTime?: number;

  /** Per-type stale time overrides */
  staleTimeByType?: Record<EntityType, number>;
};

export type QueryCacheState = {
  entities: Record<EntityKey, CacheEntry>;
};

export type CacheSubscriber<T = unknown> = (
  entry: CacheEntry<T>,
  key: EntityKey,
) => void;

export type Selection = {
  type: EntityType;
  id?: EntityId;
  filter?: Record<string, FilterExpression>;
};

/** Options for read operations */
export type ReadOptions = {
  /** Scopes to merge (default: ['global']) */
  scopes?: string[];
};

/** Subscriber registration with scopes */
type SubscriberRegistration = {
  callback: CacheSubscriber;
  scopes: string[];
};

// ============================================================================
// QueryCache Class
// ============================================================================

export class QueryCache {
  /** Committed entity storage */
  private _entities: Map<EntityKey, CacheEntry> = new Map();

  /** Optimistic overlays keyed by scope, then by entity key */
  private _optimistic: Map<string, Map<EntityKey, CacheEntry>> = new Map();

  /** Subscribers keyed by entity key or type */
  private _subscribers: Map<
    EntityKey | EntityType,
    Set<SubscriberRegistration>
  > = new Map();

  private _config: Required<CacheConfig>;

  constructor(config: CacheConfig = {}) {
    this._config = {
      defaultStaleTime: config.defaultStaleTime ?? 0,
      staleTimeByType: config.staleTimeByType ?? {},
    };
    // Initialize global scope
    this._optimistic.set('global', new Map());
  }

  // --------------------------------------------------------------------------
  // Helper: Merged Entry Resolution
  // --------------------------------------------------------------------------

  /**
   * Get the merged entry for a key, layering committed -> global -> scoped overlays.
   * Later scopes override earlier ones.
   */
  private _getMergedEntry<T>(
    key: EntityKey,
    scopes: string[] = ['global'],
  ): CacheEntry<T> | undefined {
    // Start with committed
    let entry = this._entities.get(key) as CacheEntry<T> | undefined;

    // Layer overlays in order: global first (if in scopes), then other scopes
    for (const scope of scopes) {
      const scopeMap = this._optimistic.get(scope);
      if (scopeMap) {
        const overlay = scopeMap.get(key);
        if (overlay) {
          entry = overlay as CacheEntry<T>;
        }
      }
    }

    return entry;
  }

  /**
   * Get all entity keys for a type from committed AND optimistic scopes.
   */
  private _getAllKeysForType(
    type: EntityType,
    scopes: string[],
  ): Set<EntityKey> {
    const keys = new Set<EntityKey>();

    // Committed keys
    for (const key of this._entities.keys()) {
      if (key.startsWith(`${type}:`)) {
        keys.add(key);
      }
    }

    // Optimistic keys from relevant scopes
    for (const scope of scopes) {
      const scopeMap = this._optimistic.get(scope);
      if (scopeMap) {
        for (const key of scopeMap.keys()) {
          if (key.startsWith(`${type}:`)) {
            keys.add(key);
          }
        }
      }
    }

    return keys;
  }

  // --------------------------------------------------------------------------
  // Entity Operations (Read)
  // --------------------------------------------------------------------------

  /**
   * Get an entity by type and id, with optional scope merging.
   */
  get<T>(
    type: EntityType,
    id: EntityId,
    options?: ReadOptions,
  ): CacheEntry<T> | undefined {
    const key: EntityKey = `${type}:${id}`;
    return this._getMergedEntry<T>(key, options?.scopes ?? ['global']);
  }

  /**
   * Check if entity is stale based on config.
   * Note: Staleness is typically decided by queries, but this helper is available.
   */
  isStale(type: EntityType, id: EntityId, options?: ReadOptions): boolean {
    const entry = this.get(type, id, options);
    if (!entry) return true;

    const staleTime =
      this._config.staleTimeByType[type] ?? this._config.defaultStaleTime;
    return Date.now() - entry.updatedAt > staleTime;
  }

  // --------------------------------------------------------------------------
  // Entity Operations (Write - Committed)
  // --------------------------------------------------------------------------

  /**
   * Set an entity with data (status: 'ok')
   */
  set<T>(type: EntityType, id: EntityId, data: T): void {
    const key: EntityKey = `${type}:${id}`;
    const entry: CacheEntry<T> = {
      data,
      status: 'ok',
      updatedAt: Date.now(),
      type,
      id,
    };
    this._entities.set(key, entry);
    this._notify(key);
  }

  /**
   * Set canonical status for an entity (e.g., 'not-found', 'deleted', 'error')
   * Optionally preserves existing data for stale-with-error scenarios.
   */
  setStatus(
    type: EntityType,
    id: EntityId,
    status: CacheStatus,
    preserveData = false,
  ): void {
    const key: EntityKey = `${type}:${id}`;
    const existing = this._entities.get(key);

    const entry: CacheEntry = {
      data: preserveData && existing ? existing.data : null,
      status,
      updatedAt: Date.now(),
      type,
      id,
    };
    this._entities.set(key, entry);
    this._notify(key);
  }

  /**
   * Delete an entity from committed storage
   */
  delete(type: EntityType, id: EntityId): boolean {
    const key: EntityKey = `${type}:${id}`;
    const deleted = this._entities.delete(key);
    if (deleted) {
      this._notify(key);
    }
    return deleted;
  }

  // --------------------------------------------------------------------------
  // Optimistic Operations
  // --------------------------------------------------------------------------

  /**
   * Set an optimistic overlay for an entity in a specific scope.
   */
  setOptimistic<T>(
    type: EntityType,
    id: EntityId,
    data: T,
    scope = 'global',
  ): void {
    const key: EntityKey = `${type}:${id}`;

    // Ensure scope map exists
    if (!this._optimistic.has(scope)) {
      this._optimistic.set(scope, new Map());
    }

    const entry: CacheEntry<T> = {
      data,
      status: 'ok',
      updatedAt: Date.now(),
      type,
      id,
    };

    this._optimistic.get(scope)!.set(key, entry);
    this._notify(key);
  }

  /**
   * Remove an optimistic overlay (rollback)
   */
  removeOptimistic(type: EntityType, id: EntityId, scope = 'global'): void {
    const key: EntityKey = `${type}:${id}`;
    const scopeMap = this._optimistic.get(scope);
    if (scopeMap) {
      scopeMap.delete(key);
      this._notify(key);
    }
  }

  /**
   * Commit: Apply data to committed storage and clear optimistic overlay.
   */
  commit<T>(type: EntityType, id: EntityId, data: T, scope = 'global'): void {
    // Set committed
    this.set(type, id, data);
    // Clear optimistic for this scope
    this.removeOptimistic(type, id, scope);
  }

  /**
   * Clear all optimistic overlays for a scope
   */
  clearScope(scope: string): void {
    const scopeMap = this._optimistic.get(scope);
    if (scopeMap) {
      const keys = Array.from(scopeMap.keys());
      scopeMap.clear();
      // Notify all affected keys
      for (const key of keys) {
        this._notify(key);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Query Operations (DSL)
  // --------------------------------------------------------------------------

  /**
   * Query entities by type and optional DSL params, with scope merging.
   */
  query<T>(
    type: EntityType,
    params?: QueryParams,
    options?: ReadOptions,
  ): Array<CacheEntry<T>> {
    const scopes = options?.scopes ?? ['global'];
    const allKeys = this._getAllKeysForType(type, scopes);
    const results: Array<CacheEntry<T>> = [];

    for (const key of allKeys) {
      const entry = this._getMergedEntry<T>(key, scopes);
      if (!entry) continue;

      // Skip entries that are not 'ok' status
      if (entry.status !== 'ok') continue;
      if (entry.data === null) continue;

      // Apply filter if provided
      if (params?.filter) {
        const entity = entry.data as Record<string, unknown>;
        if (!matchesFilters(entity, params.filter)) continue;
      }

      results.push(entry);
    }

    // Apply sorting if provided
    if (params?.sortKey) {
      const direction = params.sort === 'asc' ? 1 : -1;
      const sortKey = params.sortKey;
      results.sort((a, b) => {
        const aVal = (a.data as Record<string, unknown>)[sortKey];
        const bVal = (b.data as Record<string, unknown>)[sortKey];
        // Compare values (handle string, number, date-like comparisons)
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1 * direction;
        if (bVal == null) return -1 * direction;
        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
      });
    }

    // Apply limit if provided
    if (params?.limit) {
      return results.slice(0, params.limit);
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to a specific entity with scope support.
   */
  subscribe<T>(
    type: EntityType,
    id: EntityId,
    callback: CacheSubscriber<T>,
    options?: ReadOptions,
  ): () => void {
    const key: EntityKey = `${type}:${id}`;
    return this._addSubscriber(
      key,
      callback as CacheSubscriber,
      options?.scopes ?? ['global'],
    );
  }

  /**
   * Subscribe to all entities of a type with scope support.
   */
  subscribeToType<T>(
    type: EntityType,
    callback: CacheSubscriber<T>,
    options?: ReadOptions,
  ): () => void {
    return this._addSubscriber(
      type,
      callback as CacheSubscriber,
      options?.scopes ?? ['global'],
    );
  }

  /**
   * Subscribe to entities matching a selection (DSL-based) with scope support.
   */
  subscribeToSelection<T>(
    selection: Selection,
    callback: CacheSubscriber<T>,
    options?: ReadOptions,
  ): () => void {
    const scopes = options?.scopes ?? ['global'];

    if (selection.id) {
      // Specific entity
      return this.subscribe(selection.type, selection.id, callback, options);
    }

    // Type-based subscription with filter
    const wrappedCallback: CacheSubscriber = (entry, key) => {
      if (entry.status !== 'ok' || entry.data === null) return;
      if (selection.filter) {
        const entity = entry.data as Record<string, unknown>;
        if (!matchesFilters(entity, selection.filter)) return;
      }
      callback(entry as CacheEntry<T>, key);
    };

    return this._addSubscriber(selection.type, wrappedCallback, scopes);
  }

  private _addSubscriber(
    key: EntityKey | EntityType,
    callback: CacheSubscriber,
    scopes: string[],
  ): () => void {
    if (!this._subscribers.has(key)) {
      this._subscribers.set(key, new Set());
    }

    const registration: SubscriberRegistration = { callback, scopes };
    this._subscribers.get(key)!.add(registration);

    return () => {
      this._subscribers.get(key)?.delete(registration);
    };
  }

  private _notify(key: EntityKey): void {
    // Parse type from key
    const colonIndex = key.indexOf(':');
    const type = key.substring(0, colonIndex) as EntityType;

    // Notify specific key subscribers
    const keySubscribers = this._subscribers.get(key);
    if (keySubscribers) {
      for (const reg of keySubscribers) {
        const entry = this._getMergedEntry(key, reg.scopes);
        if (entry) {
          reg.callback(entry, key);
        }
      }
    }

    // Notify type subscribers
    const typeSubscribers = this._subscribers.get(type);
    if (typeSubscribers) {
      for (const reg of typeSubscribers) {
        const entry = this._getMergedEntry(key, reg.scopes);
        if (entry) {
          reg.callback(entry, key);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Invalidation
  // --------------------------------------------------------------------------

  /**
   * Invalidate an entity (marks as stale by setting updatedAt to 0)
   */
  invalidate(type: EntityType, id: EntityId): void {
    const key: EntityKey = `${type}:${id}`;
    const entry = this._entities.get(key);
    if (entry) {
      entry.updatedAt = 0;
      this._notify(key);
    }
  }

  /**
   * Invalidate all entities of a type
   */
  invalidateType(type: EntityType): void {
    for (const [key, entry] of Array.from(this._entities.entries())) {
      if (key.startsWith(`${type}:`)) {
        entry.updatedAt = 0;
        this._notify(key);
      }
    }
  }

  /**
   * Clear all committed data (does not clear optimistic)
   */
  clear(): void {
    const keys = Array.from(this._entities.keys());
    this._entities.clear();
    // Notify subscribers that entities were cleared
    for (const key of keys) {
      this._notify(key);
    }
  }

  /**
   * Clear everything including optimistic overlays
   */
  clearAll(): void {
    // Collect all keys from committed and optimistic before clearing
    const allKeys = new Set<EntityKey>();
    for (const key of this._entities.keys()) {
      allKeys.add(key);
    }
    for (const scopeMap of this._optimistic.values()) {
      for (const key of scopeMap.keys()) {
        allKeys.add(key);
      }
    }

    this._entities.clear();
    this._optimistic.clear();
    this._optimistic.set('global', new Map());

    // Notify subscribers that entities were cleared
    for (const key of allKeys) {
      this._notify(key);
    }
  }

  // --------------------------------------------------------------------------
  // SSR Serialization (Committed Only)
  // --------------------------------------------------------------------------

  /**
   * Serialize cache state for SSR hydration (committed only, excludes optimistic)
   */
  serialize(): string {
    const state: QueryCacheState = {
      entities: Object.fromEntries(this._entities),
    };
    return JSON.stringify(state);
  }

  /**
   * Hydrate cache from serialized state (committed only)
   */
  hydrate(serialized: string): void {
    const state: QueryCacheState = JSON.parse(serialized);
    for (const [key, entry] of Object.entries(state.entities)) {
      this._entities.set(key as EntityKey, entry);
    }
  }

  /**
   * Get raw state (for embedding in HTML) - committed only
   */
  getState(): QueryCacheState {
    return {
      entities: Object.fromEntries(this._entities),
    };
  }

  /**
   * Hydrate from state object (committed only)
   */
  hydrateFromState(state: QueryCacheState): void {
    for (const [key, entry] of Object.entries(state.entities)) {
      this._entities.set(key as EntityKey, entry);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createQueryCache(config?: CacheConfig): QueryCache {
  return new QueryCache(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default QueryCache;
