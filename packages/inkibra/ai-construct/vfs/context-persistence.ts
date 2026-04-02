import {
  type ContextFilter,
  type ContextManager,
  type ContextMeta,
  type ContextPersistence,
  type ContextSearchResult,
  completeContextMeta,
  contextToFilename,
  createContextManager,
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import {
  type CollectionSchema,
  type Driver,
  defineCollection,
  type EnsureCollectionOptions,
  type TypedObjectBase,
} from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';

export const CONTEXT_ROOT = '/agent/home';

function normalizeDirPath(path: string): string {
  if (path === '/') return '/';
  const normalized = path.replace(/\/+$/, '');
  return normalized || '/';
}

/** Top-level v2 paths that are NOT under CONTEXT_ROOT. */
const NON_CONTEXT_PREFIXES = [
  '/runtime/',
  '/logs/',
  '/developer/',
  '/system/',
  '/tmp/',
  '/agent/scripts/',
  '/agent/packages/',
  '/agent/commands/',
  '/agent/intents/',
] as const;

function isNonContextPath(path: string): boolean {
  return NON_CONTEXT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function contextPathToId(path: string): string {
  const normalized = normalizeDirPath(path);
  // Paths outside CONTEXT_ROOT use the full path as their ID
  if (isNonContextPath(normalized)) {
    return normalized;
  }
  if (normalized.startsWith(`${CONTEXT_ROOT}/`)) {
    return normalized.slice(CONTEXT_ROOT.length + 1);
  }
  if (normalized === CONTEXT_ROOT) {
    return '';
  }
  return normalized.replace(/^\/+/, '');
}

export function contextIdToPath(id: string): string {
  // If ID starts with /, it's already an absolute path (non-context file)
  if (id.startsWith('/')) {
    return id;
  }
  const normalized = contextPathToId(id);
  if (normalized.startsWith('/')) {
    return normalized;
  }
  return normalized ? `${CONTEXT_ROOT}/${normalized}` : CONTEXT_ROOT;
}

function resolveIdCandidates(id: string): string[] {
  const normalized = contextPathToId(id);
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(normalized);
  candidates.add(contextToFilename(normalized));

  if (normalized.endsWith('.md')) {
    candidates.add(normalized.slice(0, -3));
  }

  return Array.from(candidates);
}

async function listContextFilePaths(vfs: OverlayFs): Promise<string[]> {
  const queue = [CONTEXT_ROOT];
  const visited = new Set<string>();
  const results: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }
    const current = normalizeDirPath(next);
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    let entries: Awaited<ReturnType<OverlayFs['list']>>;
    try {
      entries = await vfs.list(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.type === 'file') {
        results.push(entry.path);
      } else {
        queue.push(entry.path);
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function shouldIncludeByTags(
  meta: ContextMeta,
  filter?: ContextFilter,
): boolean {
  if (!filter?.tags || filter.tags.length === 0) {
    return true;
  }

  return filter.tags.every((tag) => meta.tags.includes(tag));
}

function normalizeMeta(
  meta: Partial<ContextMeta>,
  fallbackId: string,
): ContextMeta {
  const metaId =
    typeof meta.id === 'string' ? contextPathToId(meta.id) : fallbackId;
  const tags = Array.isArray(meta.tags) ? meta.tags : [];

  return completeContextMeta({
    ...meta,
    id: metaId || fallbackId,
    tags,
  });
}

async function loadByPath(
  vfs: OverlayFs,
  path: string,
): Promise<{ meta: ContextMeta; content: string } | null> {
  try {
    const text = await vfs.read(path);
    const parsed = parseContextFile(text);
    const fallbackId = contextPathToId(path);
    return {
      meta: normalizeMeta(parsed.meta, fallbackId),
      content: parsed.content,
    };
  } catch {
    return null;
  }
}

export function createVfsContextPersistence(
  vfs: OverlayFs,
): ContextPersistence {
  return {
    async load(
      id: string,
    ): Promise<{ meta: ContextMeta; content: string } | null> {
      const candidates = resolveIdCandidates(id);
      for (const candidate of candidates) {
        const loaded = await loadByPath(vfs, contextIdToPath(candidate));
        if (loaded) {
          return loaded;
        }
      }

      return null;
    },

    async list(filter?: ContextFilter): Promise<ContextMeta[]> {
      const paths = await listContextFilePaths(vfs);
      const metas: ContextMeta[] = [];

      for (const path of paths) {
        const loaded = await loadByPath(vfs, path);
        if (!loaded) {
          continue;
        }

        if (!shouldIncludeByTags(loaded.meta, filter)) {
          continue;
        }

        metas.push(loaded.meta);
      }

      const orderBy = filter?.orderBy || 'updated';
      const order = filter?.order || 'desc';

      metas.sort((a, b) => {
        const left = String(a[orderBy] || '');
        const right = String(b[orderBy] || '');
        return order === 'asc'
          ? left.localeCompare(right)
          : right.localeCompare(left);
      });

      if (filter?.limit && filter.limit > 0) {
        return metas.slice(0, filter.limit);
      }

      return metas;
    },

    async write(ctx: {
      id: string;
      meta: ContextMeta;
      content: string;
    }): Promise<void> {
      const id = contextPathToId(ctx.id);
      const fileId = contextToFilename(id);
      const path = contextIdToPath(fileId);
      const meta = normalizeMeta(ctx.meta, id || fileId);
      meta.updated = new Date().toISOString();

      const text = serializeContextFile(meta, ctx.content);
      await vfs.write(path, text);
    },

    async remove(id: string): Promise<void> {
      const candidates = resolveIdCandidates(id);
      for (const candidate of candidates) {
        const path = contextIdToPath(candidate);
        if (await vfs.exists(path)) {
          await vfs.delete(path);
          return;
        }
      }
    },

    async writeAll(
      contexts: Array<{ id: string; meta: ContextMeta; content: string }>,
    ): Promise<void> {
      await Promise.all(contexts.map((ctx) => this.write(ctx)));
    },

    async search(
      query: string,
      filter?: ContextFilter,
    ): Promise<ContextSearchResult> {
      const queryLower = query.toLowerCase();
      const paths = await listContextFilePaths(vfs);
      const metas: ContextMeta[] = [];

      for (const path of paths) {
        const loaded = await loadByPath(vfs, path);
        if (!loaded) {
          continue;
        }

        if (!shouldIncludeByTags(loaded.meta, filter)) {
          continue;
        }

        const haystack = [
          loaded.meta.id,
          loaded.meta.tags.join(' '),
          loaded.content,
        ]
          .join('\n')
          .toLowerCase();

        if (haystack.includes(queryLower)) {
          metas.push(loaded.meta);
        }
      }

      metas.sort((a, b) => b.updated.localeCompare(a.updated));

      const total = metas.length;
      if (filter?.limit && filter.limit > 0) {
        return { results: metas.slice(0, filter.limit), total };
      }

      return { results: metas, total };
    },
  };
}

export function createVfsContextManager(vfs: OverlayFs): ContextManager {
  return createContextManager({
    persistence: createVfsContextPersistence(vfs),
  });
}

export const DEFAULT_DAL_COLLECTION = 'construct_vfs';
const VFS_NODE_TYPE = 'VFS_NODE';

type VfsNodeDocument = TypedObjectBase & {
  type: typeof VFS_NODE_TYPE;
  constructId: string;
  path: string;
  parentPath: string;
  name: string;
  kind: 'file' | 'directory';
  meta: ContextMeta;
  content: string;
  sizeBytes: number;
};

export const constructVfsCollectionSchema: CollectionSchema = {
  name: DEFAULT_DAL_COLLECTION,
  dals: [
    {
      type: VFS_NODE_TYPE,
      valueIndexes: ['constructId', 'path', 'parentPath', 'name', 'kind'],
      partitions: [
        {
          name: 'construct_partition',
          valueField: 'constructId',
        },
      ],
    },
  ],
};

type VfsNodeCollectionModel = Pick<
  VfsNodeDocument,
  'id' | 'type' | 'constructId' | 'path' | 'parentPath' | 'name' | 'kind'
> & { version: number; created: string; modified: string };

export const constructVfsRuntimeCollection = defineCollection(
  DEFAULT_DAL_COLLECTION,
)
  .addPartition('construct_partition')
  .addModel<
    typeof VFS_NODE_TYPE,
    VfsNodeCollectionModel,
    readonly ['constructId', 'path', 'parentPath', 'name', 'kind']
  >(VFS_NODE_TYPE, {
    version: 1,
    valueIndexes: [
      'constructId',
      'path',
      'parentPath',
      'name',
      'kind',
    ] as const,
    partitions: { construct_partition: 'constructId' },
    discriminator: (data): data is VfsNodeCollectionModel =>
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: unknown }).type === VFS_NODE_TYPE,
  })
  .build();

export const constructVfsRuntimeTable = constructVfsRuntimeCollection.table;

export type DalPersistenceOptions = {
  driver: Driver;
  logger: Logger;
  constructId: string;
  collection?: string;
  ensureCollectionOptions?: EnsureCollectionOptions;
};

/**
 * Load all VFS documents for a construct and build a mount map for OverlayFs.
 * Uses the persistence's preloadAll() to share the single partition query
 * with all subsequent list/listFs/load calls.
 */
export async function loadDalVfsSnapshot(
  persistence: DalContextPersistence,
): Promise<Record<string, string>> {
  const docs = await persistence.preloadAll();

  const mount: Record<string, string> = {};
  for (const doc of docs) {
    if (doc.kind !== 'file') {
      continue;
    }

    // In v2 layout, DAL stores files at their actual VFS paths
    const overlayPath: string | null = doc.path;

    if (!overlayPath) {
      continue;
    }

    try {
      mount[overlayPath] = serializeContextFile(doc.meta, doc.content);
    } catch {
      // gray-matter.stringify parses existing frontmatter in doc.content before
      // serializing, which can throw on raw log files (e.g. "[timestamp] user …").
      // Fall back to storing the raw content so the VFS snapshot doesn't crash.
      mount[overlayPath] = doc.content;
    }
  }

  return mount;
}

function normalizeFsPath(path: string): string {
  if (path === '/') {
    return '/';
  }

  const trimmed = path.replace(/\/+/g, '/').replace(/\/+$/, '');
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }

  return trimmed || '/';
}

function getParentPath(path: string): string {
  const normalized = normalizeFsPath(path);
  if (normalized === '/') {
    return '/';
  }

  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) {
    return '/';
  }

  return normalized.slice(0, idx);
}

function getPathName(path: string): string {
  const normalized = normalizeFsPath(path);
  if (normalized === '/') {
    return '/';
  }

  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function documentIdForPath(constructId: string, path: string): string {
  return `vfs:${constructId}:${encodeURIComponent(normalizeFsPath(path))}`;
}

function toFsEntry(doc: VfsNodeDocument): {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
} {
  return {
    name: doc.name,
    path: doc.path,
    type: doc.kind,
    size: doc.kind === 'file' ? doc.sizeBytes : undefined,
    modified: doc.modified,
  };
}

function inferFsEntriesFromDocs(
  docs: VfsNodeDocument[],
  path: string,
): Array<ReturnType<typeof toFsEntry>> {
  const normalized = normalizeFsPath(path);
  const prefix = normalized === '/' ? '/' : `${normalized}/`;
  const dedup = new Map<string, ReturnType<typeof toFsEntry>>();

  for (const doc of docs) {
    const docPath = normalizeFsPath(doc.path);
    if (docPath === normalized || !docPath.startsWith(prefix)) {
      continue;
    }

    const relative = docPath.slice(prefix.length);
    if (!relative) {
      continue;
    }

    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    const name = parts[0]!;
    const childPath = normalized === '/' ? `/${name}` : `${normalized}/${name}`;

    if (parts.length === 1 && doc.kind === 'file') {
      dedup.set(childPath, toFsEntry({ ...doc, path: childPath, name }));
      continue;
    }

    const existing = dedup.get(childPath);
    if (!existing || existing.type !== 'file') {
      dedup.set(childPath, {
        name,
        path: childPath,
        type: 'directory',
        modified: doc.modified,
      });
    }
  }

  return Array.from(dedup.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export type DalContextPersistence = ContextPersistence & {
  /**
   * Eagerly load all VFS documents for this construct in a single partition query.
   * Caches the result so all subsequent list/listFs/load calls are pure in-memory operations.
   * Returns the raw documents for callers that need them (e.g. building a mount map).
   */
  preloadAll(): Promise<VfsNodeDocument[]>;
};

export function createDalContextPersistence(
  options: DalPersistenceOptions,
): DalContextPersistence {
  const collection = options.collection ?? DEFAULT_DAL_COLLECTION;
  const logger = options.logger.child({ component: 'dal-context-persistence' });

  let initialized = false;
  const ensureInitialized = async () => {
    if (initialized) {
      return;
    }

    await options.driver.ensureCollection(
      logger,
      {
        ...constructVfsCollectionSchema,
        name: collection,
      },
      options.ensureCollectionOptions ?? { createIfNotExists: true },
    );
    initialized = true;
  };

  // --- Partition cache: populated by preloadAll(), used by listAllDocs/listFs/load ---
  let _cachedDocs: VfsNodeDocument[] | null = null;
  let _cachedDocsByPath: Map<string, VfsNodeDocument> | null = null;

  const rebuildPathIndex = () => {
    if (_cachedDocs) {
      _cachedDocsByPath = new Map(_cachedDocs.map((d) => [d.path, d]));
    } else {
      _cachedDocsByPath = null;
    }
  };

  const preloadAll = async (): Promise<VfsNodeDocument[]> => {
    if (_cachedDocs) return _cachedDocs;
    await ensureInitialized();
    const result = await options.driver.findByPartition<VfsNodeDocument>(
      logger,
      collection,
      'construct_partition',
      options.constructId,
      [VFS_NODE_TYPE],
      {
        orderBy: {
          field: 'modified',
          direction: 'DESC',
        },
      },
    );
    if (result.isErr()) {
      throw result.error;
    }
    _cachedDocs = result.value.value.filter(
      (doc) => doc.type === VFS_NODE_TYPE,
    );
    rebuildPathIndex();
    return _cachedDocs;
  };

  const listAllDocs = async (): Promise<VfsNodeDocument[]> => {
    // If cache is populated (via preloadAll), return it directly — no DB query
    if (_cachedDocs) return _cachedDocs;
    await ensureInitialized();
    const result = await options.driver.findByPartition<VfsNodeDocument>(
      logger,
      collection,
      'construct_partition',
      options.constructId,
      [VFS_NODE_TYPE],
      {
        orderBy: {
          field: 'modified',
          direction: 'DESC',
        },
      },
    );
    if (result.isErr()) {
      throw result.error;
    }

    const docs = result.value.value.filter((doc) => doc.type === VFS_NODE_TYPE);
    // Cache the result so subsequent calls are free
    _cachedDocs = docs;
    rebuildPathIndex();
    return docs;
  };

  const persistence: DalContextPersistence = {
    preloadAll,

    async load(id) {
      // If cache is populated, look up by path in memory
      if (_cachedDocsByPath) {
        const candidates = resolveIdCandidates(id);
        for (const candidate of candidates) {
          const path = contextIdToPath(candidate);
          const normalizedPath = normalizeFsPath(path);
          const doc = _cachedDocsByPath.get(normalizedPath);
          if (doc && doc.kind === 'file') {
            return {
              meta: normalizeMeta(doc.meta, contextPathToId(doc.path)),
              content: doc.content,
            };
          }
        }
        return null;
      }

      // Fallback to DB point lookups
      await ensureInitialized();
      const candidates = resolveIdCandidates(id);
      for (const candidate of candidates) {
        const path = contextIdToPath(candidate);
        const docId = documentIdForPath(options.constructId, path);
        const result = await options.driver.get<VfsNodeDocument>(
          logger,
          collection,
          docId,
        );
        if (result.isErr()) {
          throw result.error;
        }

        const value = result.value.value?.value;
        if (!value || value.type !== VFS_NODE_TYPE || value.kind !== 'file') {
          continue;
        }

        return {
          meta: normalizeMeta(value.meta, contextPathToId(value.path)),
          content: value.content,
        };
      }

      return null;
    },

    async list(filter) {
      const docs = (await listAllDocs()).filter((doc) => doc.kind === 'file');

      const metas: ContextMeta[] = [];
      for (const doc of docs) {
        const meta = normalizeMeta(doc.meta, contextPathToId(doc.path));
        if (!shouldIncludeByTags(meta, filter)) {
          continue;
        }
        metas.push(meta);
      }

      const orderBy = filter?.orderBy || 'updated';
      const order = filter?.order || 'desc';
      metas.sort((a, b) => {
        const left = String(a[orderBy] || '');
        const right = String(b[orderBy] || '');
        return order === 'asc'
          ? left.localeCompare(right)
          : right.localeCompare(left);
      });

      if (filter?.limit && filter.limit > 0) {
        return metas.slice(0, filter.limit);
      }

      return metas;
    },

    async write(ctx) {
      const writeStartMs = Date.now();
      await ensureInitialized();

      const id = contextPathToId(ctx.id);
      const fileId = contextToFilename(id);
      const path = contextIdToPath(fileId);
      const normalizedPath = normalizeFsPath(path);
      const now = new Date().toISOString();

      const serializeStartMs = Date.now();
      const text = serializeContextFile(
        normalizeMeta(ctx.meta, id || fileId),
        ctx.content,
      );
      const sizeBytes = new TextEncoder().encode(text).length;
      const serializeMs = Date.now() - serializeStartMs;
      const document: VfsNodeDocument = {
        id: documentIdForPath(options.constructId, normalizedPath),
        type: VFS_NODE_TYPE,
        version: 1,
        created: now,
        modified: now,
        constructId: options.constructId,
        path: normalizedPath,
        parentPath: getParentPath(normalizedPath),
        name: getPathName(normalizedPath),
        kind: 'file',
        meta: normalizeMeta(ctx.meta, id || fileId),
        content: ctx.content,
        sizeBytes,
      };

      const upsertStartMs = Date.now();
      const result = await options.driver.upsert<VfsNodeDocument>(
        logger,
        collection,
        document,
      );
      const upsertMs = Date.now() - upsertStartMs;
      if (result.isErr()) {
        throw result.error;
      }

      // Update cache if populated
      if (_cachedDocs) {
        const idx = _cachedDocs.findIndex((d) => d.path === normalizedPath);
        if (idx >= 0) {
          _cachedDocs[idx] = document;
        } else {
          _cachedDocs.push(document);
        }
        rebuildPathIndex();
      }

      logger.debug('vfs persistence write completed', {
        path: normalizedPath,
        sizeBytes,
        ensureDirsMs: 0,
        serializeMs,
        upsertMs,
        totalMs: Date.now() - writeStartMs,
      });
    },

    async remove(id) {
      await ensureInitialized();
      const candidates = resolveIdCandidates(id);
      for (const candidate of candidates) {
        const path = contextIdToPath(candidate);
        const docId = documentIdForPath(options.constructId, path);
        const result = await options.driver.remove(logger, collection, docId);
        if (!result.isErr()) {
          // Update cache if populated
          if (_cachedDocs) {
            const normalizedPath = normalizeFsPath(path);
            _cachedDocs = _cachedDocs.filter((d) => d.path !== normalizedPath);
            rebuildPathIndex();
          }
          return;
        }
      }
    },

    async writeAll(contexts) {
      const startMs = Date.now();
      logger.debug('vfs persistence writeAll started', {
        count: contexts.length,
      });

      if (contexts.length === 0) return;

      await ensureInitialized();
      const now = new Date().toISOString();

      const documents: VfsNodeDocument[] = contexts.map((ctx) => {
        const id = contextPathToId(ctx.id);
        const fileId = contextToFilename(id);
        const path = contextIdToPath(fileId);
        const normalizedPath = normalizeFsPath(path);
        const text = serializeContextFile(
          normalizeMeta(ctx.meta, id || fileId),
          ctx.content,
        );
        const sizeBytes = new TextEncoder().encode(text).length;
        return {
          id: documentIdForPath(options.constructId, normalizedPath),
          type: VFS_NODE_TYPE,
          version: 1,
          created: now,
          modified: now,
          constructId: options.constructId,
          path: normalizedPath,
          parentPath: getParentPath(normalizedPath),
          name: getPathName(normalizedPath),
          kind: 'file' as const,
          meta: normalizeMeta(ctx.meta, id || fileId),
          content: ctx.content,
          sizeBytes,
        };
      });

      // Log per-document sizes for diagnostics
      const docSizes = documents.map((d) => `${d.path}:${d.sizeBytes}b`);
      logger.debug('vfs persistence writeAll per-document sizes', {
        count: contexts.length,
        sizes: docSizes,
      });

      const upsertStartMs = Date.now();
      const result = await options.driver.upsertMany<VfsNodeDocument>(
        logger,
        collection,
        documents,
      );
      const upsertMs = Date.now() - upsertStartMs;

      if (result.isErr()) {
        throw result.error;
      }

      // If the batch was slow (>5s), re-run as individual upserts to identify the slow row
      if (upsertMs > 5000 && documents.length > 1) {
        logger.debug('vfs persistence.writeAll slow batch upsert', {
          batchUpsertMs: upsertMs,
          count: documents.length,
          isSlowBatch: true,
        });
        for (const doc of documents) {
          const rowStart = Date.now();
          await options.driver.upsert<VfsNodeDocument>(logger, collection, doc);
          const rowMs = Date.now() - rowStart;
          logger.debug('vfs persistence.writeAll per-row upsert completed', {
            path: doc.path,
            sizeBytes: doc.sizeBytes,
            upsertMs: rowMs,
          });
        }
      }

      // Update cache for all written documents
      if (_cachedDocs) {
        for (const doc of documents) {
          const idx = _cachedDocs.findIndex((d) => d.path === doc.path);
          if (idx >= 0) {
            _cachedDocs[idx] = doc;
          } else {
            _cachedDocs.push(doc);
          }
        }
        rebuildPathIndex();
      }

      logger.debug('vfs persistence.writeAll completed', {
        count: contexts.length,
        totalMs: Date.now() - startMs,
      });
    },

    async search(query, filter) {
      const queryLower = query.toLowerCase();
      const docs = (await listAllDocs()).filter((doc) => doc.kind === 'file');
      const metas: ContextMeta[] = [];

      for (const doc of docs) {
        const meta = normalizeMeta(doc.meta, contextPathToId(doc.path));
        if (!shouldIncludeByTags(meta, filter)) {
          continue;
        }

        const haystack = [meta.id, meta.tags.join(' '), doc.content]
          .join('\n')
          .toLowerCase();

        if (haystack.includes(queryLower)) {
          metas.push(meta);
        }
      }

      metas.sort((a, b) => b.updated.localeCompare(a.updated));
      const total = metas.length;
      if (filter?.limit && filter.limit > 0) {
        return { results: metas.slice(0, filter.limit), total };
      }

      return { results: metas, total };
    },

    async listFs(path) {
      const normalized = normalizeFsPath(path);
      const docs = await listAllDocs();
      return inferFsEntriesFromDocs(docs, normalized);
    },
  };

  return persistence;
}

export function createDalContextManager(
  options: DalPersistenceOptions,
): ContextManager {
  return createContextManager({
    persistence: createDalContextPersistence(options),
  });
}
