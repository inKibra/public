/**
 * Context Manager Types
 *
 * Types for the context management system where agents can discover,
 * read, and write context as markdown files with YAML frontmatter.
 */

/**
 * Metadata stored in the frontmatter of context files
 */
export type ContextMeta = {
  /** Unique identifier for this context */
  id: string;
  /** Searchable tags */
  tags: string[];
  /** ISO timestamp when created */
  created: string;
  /** ISO timestamp when last updated */
  updated: string;
  /** Optional validation schema name */
  schema?: string;
  /** Version number for conflict detection */
  version?: number;
  /** Additional custom metadata */
  [key: string]: unknown;
};

/**
 * A loaded context with its metadata and content
 */
export type LoadedContext<TData = unknown> = {
  /** Metadata from the frontmatter */
  meta: ContextMeta;
  /** Raw markdown content (without frontmatter) */
  content: string;
  /** Parsed/validated data (if schema provided) */
  data?: TData;
};

/**
 * Filter options for listing contexts
 */
export type ContextFilter = {
  /** Filter by tags (context must have all specified tags) */
  tags?: string[];
  /** Maximum number of results */
  limit?: number;
  /** Sort order */
  orderBy?: 'created' | 'updated' | 'id';
  /** Sort direction */
  order?: 'asc' | 'desc';
};

/**
 * Options for staging context
 */
export type ContextStageOptions<TData = unknown> = {
  /** ID of the context (generated if not provided) */
  id?: string;
  /** Tags for the context */
  tags?: string[];
  /** Markdown content */
  content: string;
  /** Structured data (validated against schema if provided) */
  data?: TData;
  /** Custom metadata */
  meta?: Record<string, unknown>;
};

/**
 * Result of a context search
 */
export type ContextSearchResult = {
  /** Matched contexts (metadata only) */
  results: ContextMeta[];
  /** Total count (may be more than returned if limited) */
  total: number;
};

/**
 * Change tracking for a single context
 */
export type ContextChange = {
  /** Context ID */
  id: string;
  /** Type of change */
  action: 'created' | 'modified' | 'deleted';
  /** Original source of the context */
  source: string;
  /** Timestamp of the change */
  timestamp: number;
};

/**
 * Persistence adapter interface for different storage backends
 */
export interface ContextPersistence {
  /**
   * Load a context by ID
   */
  load(id: string): Promise<{ meta: ContextMeta; content: string } | null>;

  /**
   * List contexts matching the filter
   */
  list(filter?: ContextFilter): Promise<ContextMeta[]>;

  /**
   * Write a context (create or update)
   */
  write(ctx: { id: string; meta: ContextMeta; content: string }): Promise<void>;

  /**
   * Remove a context by ID
   */
  remove(id: string): Promise<void>;

  /**
   * Write multiple contexts in a batch (for efficiency)
   */
  writeAll?(
    contexts: Array<{ id: string; meta: ContextMeta; content: string }>,
  ): Promise<void>;

  /**
   * Search contexts by query string
   */
  search?(query: string, filter?: ContextFilter): Promise<ContextSearchResult>;

  /**
   * Optional filesystem-oriented listing hook.
   * Allows backends to provide efficient directory listing without full scans.
   */
  listFs?(path: string): Promise<
    Array<{
      name: string;
      path: string;
      type: 'file' | 'directory';
      size?: number;
      modified?: string;
    }>
  >;
}

/**
 * Configuration for the context manager
 */
export type ContextManagerConfig = {
  /** The persistence adapter to use */
  persistence: ContextPersistence;
  /** Schema validators keyed by schema name */
  schemas?: Record<
    string,
    (raw: string) => { success: boolean; data?: unknown; errors?: unknown[] }
  >;
  /** Sandbox config for filesystem isolation during flow execution */
  sandbox?: {
    /** Use overlay filesystem */
    filesystem?: 'memory' | 'overlay';
    /** Base directory for overlay */
    baseDir?: string;
  };
};

/**
 * Internal state for tracking context changes
 */
export type ContextState = {
  /** Original content when loaded */
  original: { meta: ContextMeta; content: string } | null;
  /** Current content (may be modified) */
  current: { meta: ContextMeta; content: string } | null;
  /** Whether the context has been modified */
  dirty: boolean;
  /** Source identifier */
  source: string;
};
