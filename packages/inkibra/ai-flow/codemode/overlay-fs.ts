/**
 * Overlay Filesystem
 *
 * A virtual filesystem that layers an in-memory overlay on top of a persistent backend.
 * Reads fall through to the backend, writes are captured in memory.
 * Supports configurable persistence - some paths can be persistent, others ephemeral.
 */

import type { Logger } from '@inkibra/logger';
import {
  completeContextMeta,
  parseContextFile,
  serializeContextFile,
} from '../context/frontmatter';
import type { ContextPersistence } from '../context/types';
/**
 * Entry in a directory listing
 */
export type FsEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
};

/**
 * Configuration for persistent paths
 */
export type PersistentPathConfig = {
  /** Path prefix (e.g., '/context/') */
  prefix: string;
  /** Backend for persistence */
  backend: ContextPersistence;
};

/**
 * Configuration for the overlay filesystem
 */
export type OverlayFsConfig = {
  /** Persistent path configurations */
  persistent?: PersistentPathConfig[];
  /** Initial files to mount (ephemeral) */
  mount?: Record<string, string>;
  /** Optional logger for diagnostics (no-op when absent) */
  logger?: Logger;
};

/**
 * Public interface for overlay filesystem operations.
 * Use this instead of the OverlayFs class when you need a structural type
 * (e.g., for wrappers like ZonedOverlayFs that delegate to an underlying fs).
 */
export interface IOverlayFs {
  readonly cwd: string;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<FsEntry[]>;
  fork(): IOverlayFs;
  getDirtyPaths(): string[];
  flush(): Promise<void>;
  flushCurrent(): Promise<void>;
}

/**
 * Overlay filesystem implementation
 *
 * Provides a unified filesystem interface where:
 * - Reads check memory first, then fall through to persistent backend
 * - Writes go to memory, and are flushed to persistent backend on demand
 * - Some paths can be configured as persistent, others are ephemeral
 */
export class OverlayFs implements IOverlayFs {
  /** In-memory file storage */
  private memory: Map<string, string> = new Map();
  /** Tracks deleted files (to hide from backend reads) */
  private deleted: Set<string> = new Set();
  /** Tracks modified persistent files that need flushing */
  private dirty: Set<string> = new Set();
  /**
   * Tracks the content hash of each persistent file as last persisted
   * (or as loaded from backend). Used to skip no-op writes.
   */
  private persistedHash: Map<string, string> = new Map();
  /** Current working directory */
  private _cwd = '/';
  /** Persistent path configurations */
  private persistentPaths: PersistentPathConfig[];
  /** In-flight flushes keyed by dirty-set signature */
  private flushesInFlight: Map<string, Promise<void>> = new Map();
  private duplicateFlushCount = 0;
  private logger?: Logger;
  /**
   * Parent OverlayFs for read-through on forked instances.
   * When a fork doesn't find a file in its own memory, it falls
   * through to the parent (which may have persistent backends).
   * Writes never propagate to the parent — fork isolation is preserved.
   */
  private _parent: OverlayFs | null = null;

  constructor(config: OverlayFsConfig = {}) {
    this.persistentPaths = config.persistent ?? [];

    // Mount initial files
    if (config.mount) {
      for (const [path, content] of Object.entries(config.mount)) {
        this.memory.set(this.normalizePath(path), content);
      }
    }
    // Attach logger child if provided
    this.logger = config.logger?.child({ component: 'overlay-fs' });
  }

  /** Current working directory */
  get cwd(): string {
    return this._cwd;
  }

  /**
   * Normalize a path to absolute form
   */
  normalizePath(path: string): string {
    // Handle relative paths
    if (!path.startsWith('/')) {
      path = this._cwd + (this._cwd.endsWith('/') ? '' : '/') + path;
    }

    // Resolve . and ..
    const parts = path.split('/').filter(Boolean);
    const resolved: string[] = [];

    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    return `/${resolved.join('/')}`;
  }

  /**
   * Get the persistent config for a path, if any
   */
  private getPersistentConfig(path: string): PersistentPathConfig | undefined {
    return this.persistentPaths.find((p) => path.startsWith(p.prefix));
  }

  /**
   * Convert a filesystem path to a persistence ID
   */
  private pathToId(path: string, config: PersistentPathConfig): string {
    // Remove prefix and .md extension
    let id = path.slice(config.prefix.length);
    // Remove leading slash
    if (id.startsWith('/')) {
      id = id.slice(1);
    }
    return id;
  }

  /**
   * Convert a persistence ID to a filesystem path
   */
  private idToPath(id: string, config: PersistentPathConfig): string {
    const normalized = id.startsWith('/') ? id.slice(1) : id;
    return `${config.prefix}${normalized}`;
  }

  /**
   * Read a file
   */
  async read(path: string): Promise<string> {
    const normalPath = this.normalizePath(path);

    // Check if deleted
    if (this.deleted.has(normalPath)) {
      throw new Error(`ENOENT: no such file: ${normalPath}`);
    }

    // Check memory first
    if (this.memory.has(normalPath)) {
      return this.memory.get(normalPath)!;
    }

    // Check persistent backend
    const config = this.getPersistentConfig(normalPath);
    if (config) {
      const id = this.pathToId(normalPath, config);
      const ctx = await config.backend.load(id);
      if (ctx) {
        const content = serializeContextFile(ctx.meta, ctx.content);
        // Cache in memory for subsequent reads
        this.memory.set(normalPath, content);
        // Record persisted hash so no-op writes can be skipped
        this.persistedHash.set(normalPath, content);
        return content;
      }
    }

    // Fall through to parent (for forked instances with DAL-backed parents)
    if (this._parent) {
      return this._parent.read(normalPath);
    }

    throw new Error(`ENOENT: no such file: ${normalPath}`);
  }

  /**
   * Write a file
   */
  async write(path: string, content: string): Promise<void> {
    const normalPath = this.normalizePath(path);

    // Remove from deleted set if present
    this.deleted.delete(normalPath);

    // Write to memory
    this.memory.set(normalPath, content);

    // Mark as dirty if persistent path — but skip if content hasn't changed
    // since the last persist (no-op write detection).
    const config = this.getPersistentConfig(normalPath);
    if (config) {
      const lastPersisted = this.persistedHash.get(normalPath);
      if (lastPersisted !== content) {
        this.dirty.add(normalPath);
      }
    }
  }

  /**
   * Check if a file exists
   */
  async exists(path: string): Promise<boolean> {
    const normalPath = this.normalizePath(path);

    // Check if deleted
    if (this.deleted.has(normalPath)) {
      return false;
    }

    // Check memory
    if (this.memory.has(normalPath)) {
      return true;
    }

    // Check persistent backend
    const config = this.getPersistentConfig(normalPath);
    if (config) {
      const id = this.pathToId(normalPath, config);
      const ctx = await config.backend.load(id);
      if (ctx !== null) return true;
    }

    // Fall through to parent
    if (this._parent) {
      return this._parent.exists(normalPath);
    }

    return false;
  }

  /**
   * Delete a file
   */
  async delete(path: string): Promise<void> {
    const normalPath = this.normalizePath(path);

    // Remove from memory
    this.memory.delete(normalPath);

    // Mark as deleted (hides from backend)
    this.deleted.add(normalPath);

    // Mark as dirty if persistent
    const config = this.getPersistentConfig(normalPath);
    if (config) {
      this.dirty.add(normalPath);
    }
  }

  /**
   * List directory contents
   */
  async list(path: string): Promise<FsEntry[]> {
    const normalPath = this.normalizePath(path);
    const prefix = normalPath.endsWith('/') ? normalPath : `${normalPath}/`;
    const entries = new Map<string, FsEntry>();

    // Collect from memory
    for (const filePath of this.memory.keys()) {
      if (filePath.startsWith(prefix) && !this.deleted.has(filePath)) {
        const relativePath = filePath.slice(prefix.length);
        const parts = relativePath.split('/');
        const name = parts[0]!;
        const isDir = parts.length > 1;

        if (!entries.has(name)) {
          entries.set(name, {
            name,
            path: prefix + name + (isDir ? '/' : ''),
            type: isDir ? 'directory' : 'file',
          });
        }
      }
    }

    // Collect from persistent backends
    for (const config of this.persistentPaths) {
      if (
        normalPath.startsWith(config.prefix) ||
        config.prefix.startsWith(normalPath)
      ) {
        if (typeof config.backend.listFs === 'function') {
          const backendEntries = await config.backend.listFs(normalPath);
          for (const entry of backendEntries) {
            // Only include entries whose paths fall within this backend's prefix.
            // Backends may share underlying storage (e.g. namespaced wrappers around
            // a single DAL) and return entries belonging to other prefixes.
            if (
              !entry.path.startsWith(config.prefix) &&
              !config.prefix.startsWith(entry.path)
            ) {
              continue;
            }
            if (!entries.has(entry.name) && !this.deleted.has(entry.path)) {
              entries.set(entry.name, entry);
            }
          }
          continue;
        }

        const backendEntries = await config.backend.list({});

        for (const meta of backendEntries) {
          const filePath = this.idToPath(meta.id, config);

          if (filePath.startsWith(prefix) && !this.deleted.has(filePath)) {
            const relativePath = filePath.slice(prefix.length);
            const parts = relativePath.split('/');
            const name = parts[0]!;
            const isDir = parts.length > 1;

            if (!entries.has(name)) {
              entries.set(name, {
                name,
                path: prefix + name + (isDir ? '/' : ''),
                type: isDir ? 'directory' : 'file',
                modified: meta.updated,
              });
            }
          }
        }
      }
    }

    // Merge parent entries (for forked instances)
    if (this._parent) {
      try {
        const parentEntries = await this._parent.list(normalPath);
        for (const entry of parentEntries) {
          if (!entries.has(entry.name) && !this.deleted.has(entry.path)) {
            entries.set(entry.name, entry);
          }
        }
      } catch {
        // Parent may not have this directory — that's fine
      }
    }

    return Array.from(entries.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Change current working directory
   */
  cd(path: string): void {
    this._cwd = this.normalizePath(path);
  }

  /**
   * Flush dirty files to persistent storage
   */
  async flush(): Promise<void> {
    while (this.dirty.size > 0) {
      await this.flushCurrent();
    }
  }

  /**
   * Flush only the files that were dirty at call time.
   * New writes that happen while this flush is running remain dirty for a
   * later flush cycle.
   *
   * Writes are batched per backend and issued in parallel via `writeAll`
   * where available, falling back to parallel `Promise.all` of individual
   * `write` calls otherwise. Deletes are also parallelized.
   */
  async flushCurrent(): Promise<void> {
    const flushStartMs = Date.now();
    const paths = [...this.dirty].sort();
    if (paths.length === 0) return;
    const signature = paths.join('|');
    const existingFlush = this.flushesInFlight.get(signature);
    if (existingFlush) {
      this.duplicateFlushCount += 1;
      this.logger?.warn('overlayFs duplicate flushCurrent signature', {
        signature,
        duplicateCount: this.duplicateFlushCount,
      });
      await existingFlush;
      return;
    }

    const flushPromise = this.flushCurrentSignature(paths, flushStartMs);
    this.flushesInFlight.set(signature, flushPromise);
    try {
      await flushPromise;
    } finally {
      this.flushesInFlight.delete(signature);
    }
  }

  private async flushCurrentSignature(
    paths: string[],
    flushStartMs: number,
  ): Promise<void> {
    // Group dirty paths by backend
    const byBackend = new Map<
      ContextPersistence,
      Array<{ path: string; id: string }>
    >();

    for (const path of paths) {
      const config = this.getPersistentConfig(path);
      if (!config) {
        // Not a persistent path — remove from dirty silently
        this.dirty.delete(path);
        continue;
      }
      const id = this.pathToId(path, config);
      const existing = byBackend.get(config.backend);
      if (existing) {
        existing.push({ path, id });
      } else {
        byBackend.set(config.backend, [{ path, id }]);
      }
    }

    const backendSummaries = Array.from(byBackend.entries()).map(
      ([backend, items]) => ({
        backend: backend.constructor?.name ?? 'backend',
        count: items.length,
      }),
    );
    this.logger?.debug('overlayFs flushCurrent start', {
      dirtyCount: paths.length,
      backendCount: byBackend.size,
      paths,
      backends: backendSummaries,
    });

    // Flush each backend in parallel
    await Promise.all(
      Array.from(byBackend.entries()).map(([backend, items]) =>
        this.flushBackend(backend, items),
      ),
    );

    this.logger?.debug('overlayFs flushCurrent done', {
      dirtyCount: paths.length,
      remainingDirty: this.dirty.size,
      totalMs: Date.now() - flushStartMs,
    });
  }

  /**
   * Flush a set of dirty paths against a single backend.
   * Uses writeAll (batch) when available, otherwise parallel writes.
   */
  private async flushBackend(
    backend: ContextPersistence,
    items: Array<{ path: string; id: string }>,
  ): Promise<void> {
    const backendStartMs = Date.now();
    // Separate deletes from writes
    const toDelete = items.filter((item) => this.deleted.has(item.path));
    const toWrite = items.filter((item) => !this.deleted.has(item.path));

    // Build write contexts
    const parseStartMs = Date.now();
    const writeContexts = toWrite
      .map((item) => {
        const content = this.memory.get(item.path);
        if (content == null) return null;
        const { meta, content: body } = parseContextFile(content);
        const fullMeta = completeContextMeta(meta);
        fullMeta.id = item.id;
        return {
          item,
          ctx: { id: item.id, meta: fullMeta, content: body },
          raw: content,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const parseMs = Date.now() - parseStartMs;

    // Parallel deletes
    let deleteMs = 0;
    if (toDelete.length > 0) {
      const deleteStartMs = Date.now();
      await Promise.all(toDelete.map((item) => backend.remove(item.id)));
      deleteMs = Date.now() - deleteStartMs;
      for (const item of toDelete) {
        this.dirty.delete(item.path);
      }
    }

    // Batch writes via writeAll if supported, else parallel individual writes
    let writeMs = 0;
    if (writeContexts.length > 0) {
      const writeStartMs = Date.now();
      if (typeof backend.writeAll === 'function') {
        await backend.writeAll(writeContexts.map((x) => x.ctx));
      } else {
        await Promise.all(writeContexts.map((x) => backend.write(x.ctx)));
      }
      writeMs = Date.now() - writeStartMs;
      for (const { item, raw } of writeContexts) {
        this.dirty.delete(item.path);
        // Record persisted hash to enable no-op detection on next write
        this.persistedHash.set(item.path, raw);
      }
    }

    this.logger?.debug('overlayFs flushBackend', {
      backend: backend.constructor?.name ?? 'backend',
      items: items.length,
      writes: writeContexts.length,
      deletes: toDelete.length,
      parseMs,
      deleteMs,
      writeMs,
      totalMs: Date.now() - backendStartMs,
      writePaths: writeContexts.map((entry) => entry.item.path),
      deletePaths: toDelete.map((entry) => entry.path),
    });
  }

  /**
   * Get all files in memory (for debugging/testing)
   */
  getSnapshot(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [path, content] of this.memory) {
      if (!this.deleted.has(path)) {
        result[path] = content;
      }
    }
    return result;
  }

  /**
   * Check if there are unsaved changes
   */
  isDirty(): boolean {
    return this.dirty.size > 0;
  }

  /**
   * Get list of dirty paths
   */
  getDirtyPaths(): string[] {
    return Array.from(this.dirty);
  }

  /**
   * Create a forked copy of this OverlayFs for preview isolation.
   * The fork gets a shallow copy of in-memory files and deleted set.
   * Writes to the fork do not affect the original. The fork has no
   * persistent backends — it's purely in-memory.
   * See command-computer-spec §11.
   */
  fork(): OverlayFs {
    const forked = new OverlayFs();
    // Copy in-memory files (local writes override parent on read)
    for (const [path, content] of this.memory) {
      forked.memory.set(path, content);
    }
    // Copy deleted set (hides paths from parent reads)
    for (const path of this.deleted) {
      forked.deleted.add(path);
    }
    // Copy cwd
    forked._cwd = this._cwd;
    // Set parent for read-through — when the fork doesn't have a file
    // in its own memory, it falls through to the parent (which may have
    // persistent backends). Writes never propagate to the parent.
    forked._parent = this;
    return forked;
  }
}

/**
 * Create an overlay filesystem
 */
export function createOverlayFs(config: OverlayFsConfig = {}): OverlayFs {
  return new OverlayFs(config);
}
