/**
 * Storage Driver - abstract storage interface for client context persistence
 *
 * The storage driver handles persisting context data on the client.
 * Different environments (web, mobile) can provide different implementations.
 *
 * Storage is organized by scope (from context definition):
 * - 'session': Cleared when browser session ends
 * - 'device': Persists across sessions
 * - 'authentication': Cleared on logout
 */

import type { StorageScope } from './transport';

// ============================================================================
// Storage Driver Interface
// ============================================================================

/**
 * Storage driver interface for persisting context data
 *
 * Implementations handle where/how to store data based on scope and name.
 * All methods are async to support various storage backends.
 */
export type StorageDriver = {
  /**
   * Get a stored context value
   * @param scope - The storage scope (from context definition)
   * @param name - The context name (from context definition)
   * @returns The stored value as string, or null if not found
   */
  get(scope: StorageScope, name: string): Promise<string | null>;

  /**
   * Set a context value in storage
   * @param scope - The storage scope
   * @param name - The context name
   * @param value - The value to store (already serialized to string)
   */
  set(scope: StorageScope, name: string, value: string): Promise<void>;

  /**
   * Remove a context value from storage
   * @param scope - The storage scope
   * @param name - The context name
   */
  remove(scope: StorageScope, name: string): Promise<void>;

  /**
   * Clear all context values for a given scope
   * Useful for logout (clears 'authentication' scope)
   * @param scope - The storage scope to clear
   */
  clearScope(scope: StorageScope): Promise<void>;
};

// ============================================================================
// Web Storage Driver
// ============================================================================

/**
 * Create the storage key for a context
 */
function createStorageKey(scope: StorageScope, name: string): string {
  return `ctx:${scope}:${name}`;
}

/**
 * Get all keys for a scope (for clearScope)
 */
function getKeysForScope(storage: Storage, scope: StorageScope): string[] {
  const prefix = `ctx:${scope}:`;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Web storage driver using localStorage and sessionStorage
 *
 * Scope mapping:
 * - 'session' → sessionStorage (cleared when browser closes)
 * - 'device' → localStorage (persists)
 * - 'authentication' → localStorage (cleared on logout via clearScope)
 */
export const webStorageDriver: StorageDriver = {
  get: async (scope, name) => {
    const storage = scope === 'session' ? sessionStorage : localStorage;
    const key = createStorageKey(scope, name);
    return storage.getItem(key);
  },

  set: async (scope, name, value) => {
    const storage = scope === 'session' ? sessionStorage : localStorage;
    const key = createStorageKey(scope, name);
    storage.setItem(key, value);
  },

  remove: async (scope, name) => {
    const storage = scope === 'session' ? sessionStorage : localStorage;
    const key = createStorageKey(scope, name);
    storage.removeItem(key);
  },

  clearScope: async (scope) => {
    const storage = scope === 'session' ? sessionStorage : localStorage;
    const keys = getKeysForScope(storage, scope);
    for (const key of keys) {
      storage.removeItem(key);
    }
  },
};

// ============================================================================
// In-Memory Storage Driver (for SSR/testing)
// ============================================================================

/**
 * Create an in-memory storage driver
 * Useful for SSR (no localStorage) or testing
 */
export function createInMemoryStorageDriver(): StorageDriver {
  const storage = new Map<string, string>();

  return {
    get: async (scope, name) => {
      const key = createStorageKey(scope, name);
      return storage.get(key) ?? null;
    },

    set: async (scope, name, value) => {
      const key = createStorageKey(scope, name);
      storage.set(key, value);
    },

    remove: async (scope, name) => {
      const key = createStorageKey(scope, name);
      storage.delete(key);
    },

    clearScope: async (scope) => {
      const prefix = `ctx:${scope}:`;
      for (const key of storage.keys()) {
        if (key.startsWith(prefix)) {
          storage.delete(key);
        }
      }
    },
  };
}
