/**
 * Context Manager
 *
 * Manages context lifecycle including loading, staging, change tracking,
 * and persistence to/from various backends.
 */

import { completeContextMeta, generateContextId } from './frontmatter';
import type {
  ContextChange,
  ContextFilter,
  ContextManagerConfig,
  ContextMeta,
  ContextPersistence,
  ContextStageOptions,
  ContextState,
  LoadedContext,
} from './types';

/**
 * Context manager for loading, staging, and tracking context changes
 */
export class ContextManager {
  private persistence: ContextPersistence;
  private schemas: Map<
    string,
    (raw: string) => { success: boolean; data?: unknown; errors?: unknown[] }
  >;
  private states: Map<string, ContextState>;

  constructor(config: ContextManagerConfig) {
    this.persistence = config.persistence;
    this.schemas = new Map(Object.entries(config.schemas || {}));
    this.states = new Map();
  }

  /**
   * List available contexts matching the filter
   */
  async list(filter?: ContextFilter): Promise<ContextMeta[]> {
    return this.persistence.list(filter);
  }

  /**
   * Load a context by ID
   */
  async load<TData = unknown>(
    id: string,
  ): Promise<LoadedContext<TData> | null> {
    // Check if already loaded and tracked
    const existing = this.states.get(id);
    if (existing?.current) {
      return this.hydrateData<TData>(
        existing.current.meta,
        existing.current.content,
      );
    }

    // Load from persistence
    const result = await this.persistence.load(id);
    if (!result) return null;

    // Track the loaded state
    this.states.set(id, {
      original: { meta: result.meta, content: result.content },
      current: { meta: result.meta, content: result.content },
      dirty: false,
      source: 'persistence',
    });

    return this.hydrateData<TData>(result.meta, result.content);
  }

  /**
   * Stage a context change (create or update)
   */
  async stage<TData = unknown>(
    options: ContextStageOptions<TData>,
  ): Promise<string> {
    const id = options.id || generateContextId();
    const now = new Date().toISOString();

    // Get existing state if updating
    const existing = this.states.get(id);
    const existingMeta = existing?.current?.meta;

    // Build complete metadata
    const meta = completeContextMeta({
      ...existingMeta,
      ...options.meta,
      id,
      tags: options.tags ?? existingMeta?.tags,
      created: existingMeta?.created || now,
    });

    // Update tracked state
    this.states.set(id, {
      original: existing?.original || null,
      current: { meta, content: options.content },
      dirty: true,
      source: existing?.source || 'new',
    });

    return id;
  }

  /**
   * Stage context removal by ID
   */
  async remove(id: string): Promise<void> {
    const state = this.states.get(id);

    if (state) {
      // Mark as deleted but don't persist yet
      this.states.set(id, {
        ...state,
        current: null,
        dirty: true,
      });
    } else {
      // Track deletion of unloaded context
      this.states.set(id, {
        original: null,
        current: null,
        dirty: true,
        source: 'persistence',
      });
    }
  }

  /**
   * Search for contexts by query
   */
  async search(
    query: string,
    options?: { limit?: number },
  ): Promise<ContextMeta[]> {
    if (this.persistence.search) {
      const result = await this.persistence.search(query, options);
      return result.results;
    }

    // Fallback: load all and filter
    const all = await this.list({ limit: options?.limit });
    const queryLower = query.toLowerCase();

    return all.filter((meta) => {
      const tagsMatch = meta.tags.some((tag) =>
        tag.toLowerCase().includes(queryLower),
      );
      const idMatch = meta.id.toLowerCase().includes(queryLower);
      return tagsMatch || idMatch;
    });
  }

  /**
   * Get all tracked changes
   */
  getChanges(): ContextChange[] {
    const changes: ContextChange[] = [];

    for (const [id, state] of this.states.entries()) {
      if (!state.dirty) continue;

      let action: ContextChange['action'];

      if (!state.original && state.current) {
        action = 'created';
      } else if (state.original && !state.current) {
        action = 'deleted';
      } else {
        action = 'modified';
      }

      changes.push({
        id,
        action,
        source: state.source,
        timestamp: Date.now(),
      });
    }

    return changes;
  }

  /**
   * Commit all changes (or specific context) to persistence
   */
  async commit(id?: string): Promise<void> {
    const toCommit = id ? [id] : Array.from(this.states.keys());

    for (const contextId of toCommit) {
      const state = this.states.get(contextId);
      if (!state || !state.dirty) continue;

      if (state.current) {
        // Write or update
        await this.persistence.write({
          id: contextId,
          meta: state.current.meta,
          content: state.current.content,
        });

        // Update tracked state
        this.states.set(contextId, {
          original: state.current,
          current: state.current,
          dirty: false,
          source: 'persistence',
        });
      } else if (state.original) {
        // Remove
        await this.persistence.remove(contextId);
        this.states.delete(contextId);
      }
    }
  }

  /**
   * Discard changes for a specific context (or all)
   */
  discard(id?: string): void {
    const toDiscard = id ? [id] : Array.from(this.states.keys());

    for (const contextId of toDiscard) {
      const state = this.states.get(contextId);
      if (!state) continue;

      if (state.original) {
        // Revert to original
        this.states.set(contextId, {
          ...state,
          current: state.original,
          dirty: false,
        });
      } else {
        // Remove newly created context
        this.states.delete(contextId);
      }
    }
  }

  /**
   * Check if a context has unsaved changes
   */
  isDirty(id?: string): boolean {
    if (id) {
      return this.states.get(id)?.dirty || false;
    }

    for (const state of this.states.values()) {
      if (state.dirty) return true;
    }

    return false;
  }

  /**
   * Clear all tracked state (use with caution)
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Hydrate data by validating against schema if available
   */
  private hydrateData<TData>(
    meta: ContextMeta,
    content: string,
  ): LoadedContext<TData> {
    const result: LoadedContext<TData> = { meta, content };

    if (meta.schema && this.schemas.has(meta.schema)) {
      const validator = this.schemas.get(meta.schema)!;
      const validation = validator(content);

      if (validation.success) {
        result.data = validation.data as TData;
      }
    }

    return result;
  }
}

/**
 * Factory function to create a context manager
 */
export function createContextManager(
  config: ContextManagerConfig,
): ContextManager {
  return new ContextManager(config);
}
