/**
 * Generic construct studio context management.
 *
 * Provides functions for reading/writing studio state and listing context
 * files from a construct's VFS. These are app-agnostic and work with any
 * construct, regardless of the product-specific entity layered on top.
 */

import {
  type ContextMeta,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import type { Construct } from '../construct/construct';
import type {
  ConstructSnapshotNode,
  ConstructStudioContextFile,
} from '../lab/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STUDIO_STATE_PATH = '/runtime/state/studio-workspace.md';
/** Directories excluded from studio file tree traversal (ephemeral runtime internals). */
const EXCLUDED_STUDIO_DIRS = [
  '/runtime/diag/',
  '/runtime/queue/',
  '/runtime/state/',
  '/tmp/',
] as const;

// ---------------------------------------------------------------------------
// Studio state
// ---------------------------------------------------------------------------

export type StudioState = {
  activeContextFilePath?: string;
  lastSavedAt?: string;
};

function extractStudioState(content: string): StudioState {
  const parsed = parseContextFile(content);
  return {
    activeContextFilePath:
      typeof parsed.meta.active_context_file_path === 'string'
        ? parsed.meta.active_context_file_path
        : undefined,
    lastSavedAt:
      typeof parsed.meta.last_saved_at === 'string'
        ? parsed.meta.last_saved_at
        : undefined,
  };
}

export async function readStudioState(
  construct: Construct,
): Promise<StudioState> {
  const vfs = construct.getVfs();
  try {
    const content = await vfs.read(STUDIO_STATE_PATH);
    return extractStudioState(content);
  } catch {
    return {};
  }
}

export async function writeStudioState(
  construct: Construct,
  patch: StudioState,
): Promise<void> {
  const current = await readStudioState(construct);
  const now = new Date().toISOString();
  const meta: ContextMeta = {
    id: STUDIO_STATE_PATH,
    tags: ['studio', 'workspace'],
    created: now,
    updated: now,
    active_context_file_path:
      patch.activeContextFilePath ?? current.activeContextFilePath,
    last_saved_at: patch.lastSavedAt ?? current.lastSavedAt ?? now,
  };

  await construct
    .getVfs()
    .write(
      STUDIO_STATE_PATH,
      serializeContextFile(meta, 'Studio workspace state'),
    );
}

// ---------------------------------------------------------------------------
// Context file helpers
// ---------------------------------------------------------------------------

export function getFallbackContextFileTitle(path: string): string {
  const segment = path.split('/').pop();
  if (!segment) {
    return 'Context File';
  }
  return segment;
}

function cloneForYamlDisplay(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneForYamlDisplay(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        cloneForYamlDisplay(entry),
      ]),
    );
  }
  return value;
}

function formatStudioContextContent(path: string, content: string): string {
  if (path.split('/').pop() !== 'CONTEXT.yaml') {
    return content;
  }
  try {
    const parsed = Bun.YAML.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return content;
    }
    return Bun.YAML.stringify(cloneForYamlDisplay(parsed), null, 2).trimEnd();
  } catch {
    return content;
  }
}

function shouldIncludeStudioContextPath(path: string): boolean {
  // Exclude ephemeral runtime directories.
  if (EXCLUDED_STUDIO_DIRS.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  return true;
}

function shouldTraverseStudioContextDir(path: string): boolean {
  if (path === '/') return true;
  if (
    EXCLUDED_STUDIO_DIRS.some(
      (prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix),
    )
  ) {
    return false;
  }
  return true;
}

async function safeListContextPath(
  construct: Construct,
  path: string,
): Promise<Awaited<ReturnType<ReturnType<Construct['getVfs']>['list']>>> {
  try {
    return await construct.getVfs().list(path);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// List context files
// ---------------------------------------------------------------------------

/**
 * Lists all context files from the construct's live VFS.
 * Traverses `/context/` excluding `/context/logs/` and `/context/state/`.
 * Parses frontmatter to extract metadata.
 * Returns files sorted by modifiedAt descending.
 */
export async function listStudioContextFiles(
  construct: Construct,
): Promise<ConstructStudioContextFile[]> {
  const vfs = construct.getVfs();
  const queue = ['/'];
  const visited = new Set<string>();
  const candidateFilePaths: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next) || !shouldTraverseStudioContextDir(next)) {
      continue;
    }
    visited.add(next);

    const entries = await safeListContextPath(construct, next);
    for (const entry of entries) {
      if (entry.type === 'directory') {
        if (shouldTraverseStudioContextDir(entry.path)) {
          queue.push(entry.path);
        }
        continue;
      }

      if (shouldIncludeStudioContextPath(entry.path)) {
        candidateFilePaths.push(entry.path);
      }
    }
  }

  const loadedFiles = await Promise.all(
    candidateFilePaths.map(
      async (path): Promise<ConstructStudioContextFile | undefined> => {
        try {
          const raw = await vfs.read(path);
          const parsed = parseContextFile(raw);
          const sizeBytes = new TextEncoder().encode(parsed.content).length;
          const summary =
            typeof parsed.meta.summary === 'string'
              ? parsed.meta.summary
              : undefined;

          return {
            path,
            title:
              typeof parsed.meta.title === 'string'
                ? parsed.meta.title
                : getFallbackContextFileTitle(path),
            content: formatStudioContextContent(path, parsed.content),
            sizeBytes,
            modifiedAt:
              typeof parsed.meta.updated === 'string'
                ? parsed.meta.updated
                : new Date().toISOString(),
            frontmatter: parsed.meta,
            ...(summary !== undefined ? { summary } : {}),
          };
        } catch {
          return undefined;
        }
      },
    ),
  );

  const files = loadedFiles.filter(
    (file): file is ConstructStudioContextFile => file !== undefined,
  );

  files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return files;
}

/**
 * Lists context files from pre-loaded snapshot nodes.
 * Same filtering/parsing as listStudioContextFiles but from static data.
 */
export function listStudioContextFilesFromSnapshotNodes(
  nodes: ConstructSnapshotNode[],
): ConstructStudioContextFile[] {
  const files: ConstructStudioContextFile[] = [];

  for (const node of nodes) {
    if (node.kind !== 'file' || !shouldIncludeStudioContextPath(node.path)) {
      continue;
    }

    try {
      // DAL snapshot nodes store meta separately from content (body-only).
      // Prefer node.meta when available; fall back to parsing frontmatter.
      const parsed = node.meta
        ? { meta: node.meta as Record<string, unknown>, content: node.content }
        : parseContextFile(node.content);
      const sizeBytes = new TextEncoder().encode(parsed.content).length;
      const summary =
        typeof parsed.meta.summary === 'string'
          ? parsed.meta.summary
          : undefined;

      // Pin status is not available for snapshot nodes (no VFS policy access).
      // pinnedSource / pinnedPhase are omitted; consumers should use live VFS
      // listStudioContextFiles when accurate pin status is needed.

      files.push({
        path: node.path,
        title:
          typeof parsed.meta.title === 'string'
            ? parsed.meta.title
            : getFallbackContextFileTitle(node.path),
        content: formatStudioContextContent(node.path, parsed.content),
        sizeBytes,
        modifiedAt:
          typeof parsed.meta.updated === 'string'
            ? parsed.meta.updated
            : node.modified,
        frontmatter: parsed.meta,
        ...(summary !== undefined ? { summary } : {}),
      });
    } catch {
      // Skip unreadable files.
    }
  }

  files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return files;
}
