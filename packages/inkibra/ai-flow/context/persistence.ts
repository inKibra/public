/**
 * Context Persistence
 *
 * File-based persistence adapter for storing context files with YAML frontmatter.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  completeContextMeta,
  contextToFilename,
  filenameToContext,
  parseContextFile,
  serializeContextFile,
} from './frontmatter';
import type {
  ContextFilter,
  ContextMeta,
  ContextPersistence,
  ContextSearchResult,
} from './types';

/**
 * Configuration for file-based persistence
 */
export type FilePersistenceConfig = {
  /** Base directory where context files are stored */
  baseDir: string;
};

/**
 * Creates a file-based context persistence adapter
 */
export function createFilePersistence(
  config: FilePersistenceConfig,
): ContextPersistence {
  const { baseDir } = config;

  /**
   * Ensure a directory exists
   */
  async function ensureDir(dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
    } catch (e) {
      // Ignore errors if directory already exists
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
    }
  }

  /**
   * Get the full file path for a context
   */
  function getFilePath(id: string): string {
    return join(baseDir, contextToFilename(id));
  }

  function normalizeId(id: string): string {
    return id.replace(/^\/+/, '');
  }

  function resolveIdCandidates(id: string): Set<string> {
    const normalized = normalizeId(id);
    if (!normalized) {
      return new Set();
    }

    const candidates = new Set<string>();
    candidates.add(normalized);
    candidates.add(contextToFilename(normalized));

    if (normalized.endsWith('.md')) {
      candidates.add(normalized.slice(0, -3));
    }

    return candidates;
  }

  /**
   * Recursively list all files in a directory
   */
  async function listFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          const subFiles = await listFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (e) {
      // Directory might not exist yet
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }

    return files;
  }

  /**
   * Load metadata from a file without loading full content
   */
  async function loadMeta(filePath: string): Promise<ContextMeta | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const { meta } = parseContextFile(content);

      // Get info from filename if not in frontmatter
      const relativePath = normalizeId(filePath.replace(baseDir + '/', ''));
      const fileInfo = filenameToContext(relativePath);
      const fileId = fileInfo?.id || relativePath;

      if (!fileId) {
        return null;
      }

      return completeContextMeta({
        ...meta,
        id: meta.id || fileId,
        tags: meta.tags || [],
      });
    } catch {
      return null;
    }
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

  return {
    async load(
      id: string,
    ): Promise<{ meta: ContextMeta; content: string } | null> {
      const idCandidates = resolveIdCandidates(id);
      if (idCandidates.size === 0) {
        return null;
      }

      const files = await listFiles(baseDir);

      for (const filePath of files) {
        const relativePath = normalizeId(filePath.replace(baseDir + '/', ''));
        const fileInfo = filenameToContext(relativePath);
        const fileId = fileInfo?.id || relativePath;

        if (!idCandidates.has(fileId)) {
          continue;
        }

        try {
          const fileContent = await readFile(filePath, 'utf-8');
          const { meta, content } = parseContextFile(fileContent);

          return {
            meta: completeContextMeta({
              ...meta,
              id: meta.id || fileId,
              tags: meta.tags || [],
            }),
            content,
          };
        } catch {
          return null;
        }
      }

      return null;
    },

    async list(filter?: ContextFilter): Promise<ContextMeta[]> {
      const files = await listFiles(baseDir);
      const results: ContextMeta[] = [];

      for (const filePath of files) {
        const meta = await loadMeta(filePath);
        if (!meta) continue;

        if (!shouldIncludeByTags(meta, filter)) {
          continue;
        }

        results.push(meta);
      }

      // Sort results
      const orderBy = filter?.orderBy || 'updated';
      const order = filter?.order || 'desc';

      results.sort((a, b) => {
        const aVal = String(a[orderBy] || '');
        const bVal = String(b[orderBy] || '');
        return order === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      });

      // Apply limit
      if (filter?.limit && filter.limit > 0) {
        return results.slice(0, filter.limit);
      }

      return results;
    },

    async write(ctx: {
      id: string;
      meta: ContextMeta;
      content: string;
    }): Promise<void> {
      const filePath = getFilePath(ctx.id);

      // Ensure directory exists
      await ensureDir(dirname(filePath));

      // Update metadata
      const meta = completeContextMeta({
        ...ctx.meta,
        id: ctx.meta.id || normalizeId(ctx.id),
        tags: ctx.meta.tags || [],
      });
      meta.updated = new Date().toISOString();

      // Serialize and write
      const fileContent = serializeContextFile(meta, ctx.content);
      await writeFile(filePath, fileContent, 'utf-8');
    },

    async remove(id: string): Promise<void> {
      const idCandidates = resolveIdCandidates(id);
      if (idCandidates.size === 0) {
        return;
      }

      const files = await listFiles(baseDir);

      for (const filePath of files) {
        const relativePath = normalizeId(filePath.replace(baseDir + '/', ''));
        const fileInfo = filenameToContext(relativePath);
        const fileId = fileInfo?.id || relativePath;

        if (idCandidates.has(fileId)) {
          await unlink(filePath);
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
      const files = await listFiles(baseDir);
      const results: ContextMeta[] = [];
      const queryLower = query.toLowerCase();

      for (const filePath of files) {
        try {
          const relativePath = normalizeId(filePath.replace(baseDir + '/', ''));
          const fileInfo = filenameToContext(relativePath);
          const fileId = fileInfo?.id || relativePath;
          if (!fileId) continue;

          const fileContent = await readFile(filePath, 'utf-8');
          const { meta, content } = parseContextFile(fileContent);

          const fullMeta = completeContextMeta({
            ...meta,
            id: meta.id || fileId,
            tags: meta.tags || [],
          });

          if (!shouldIncludeByTags(fullMeta, filter)) {
            continue;
          }

          const contentLower = content.toLowerCase();
          const tagsLower = fullMeta.tags.join(' ').toLowerCase();
          const idLower = fullMeta.id.toLowerCase();

          if (
            contentLower.includes(queryLower) ||
            tagsLower.includes(queryLower) ||
            idLower.includes(queryLower)
          ) {
            results.push(fullMeta);
          }
        } catch {
          // Skip files that can't be read
        }
      }

      // Sort by updated (most recent first)
      results.sort((a, b) => b.updated.localeCompare(a.updated));

      const total = results.length;

      // Apply limit
      if (filter?.limit && filter.limit > 0) {
        return { results: results.slice(0, filter.limit), total };
      }

      return { results, total };
    },
  };
}
