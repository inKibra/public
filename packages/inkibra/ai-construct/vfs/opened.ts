/**
 * Opened Files State
 *
 * Tracks which files/directories are currently kept open in context.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import {
  estimateTokensFromBytes,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';

/**
 * Entry in the opened files state.
 */
export type OpenedFileEntry = {
  path: string;
  type: 'file' | 'directory';
  mode?: 'full' | 'frontmatter';
  /** Pin scope: 'nap', '*' (global), a lane name, or undefined (not pinned) */
  pin?: string;
  /** Who pinned this entry (system opening policy vs AI context pin command). */
  pin_source?: 'system' | 'ai';
  /** Why this entry was pinned (AI-provided reason). */
  pin_reason?: string;
  /** Original pin path/pattern that produced this entry (e.g. /agent/home/*). */
  pin_path?: string;
  opened_at: string;
  last_accessed_at?: string;
  opened_by?: string;
  size_bytes: number;
  size_tokens?: number;
  score?: number;
  ttl_ms?: number;
  expires_at?: string;
};

/**
 * Opened files state.
 */
export type OpenedFilesState = {
  updated: string;
  context_bytes: number;
  context_tokens: number;
  files: OpenedFileEntry[];
  ai_pins?: AIPinRule[];
  recently_closed?: Array<{
    path: string;
    type: 'file' | 'directory';
    closed_at: string;
    size_bytes: number;
    size_tokens?: number;
    /** Frontmatter snapshot captured at close time */
    frontmatter?: Record<string, unknown>;
  }>;
};

export type AIPinRule = {
  path: string;
  phase: 'awake' | 'nap' | 'both';
  mode?: 'full' | 'frontmatter';
  reason: string;
  created_at: string;
  updated: string;
};

export const DEFAULT_HANDLE_SCORE = 1;
export const MIN_HANDLE_SCORE = 0;
export const MAX_HANDLE_SCORE = 3;
export const DEFAULT_HANDLE_TTL_MS = 12 * 60 * 60 * 1000;

export type HandleScoreUpdate = {
  path: string;
  delta: number;
  ttl_ms?: number;
};

function safeDateMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      cleaned[key] = entry;
    }
  }
  return cleaned as T;
}

function normalizeOpenedEntry(entry: OpenedFileEntry): OpenedFileEntry {
  const nowMs = Date.now();
  const openedAtMs = safeDateMs(entry.opened_at, nowMs);
  const lastAccessedMs = safeDateMs(entry.last_accessed_at, openedAtMs);
  const score =
    typeof entry.score === 'number' ? entry.score : DEFAULT_HANDLE_SCORE;
  const ttlMs = typeof entry.ttl_ms === 'number' ? entry.ttl_ms : undefined;
  const expiresAt =
    entry.expires_at ??
    (ttlMs ? new Date(lastAccessedMs + ttlMs).toISOString() : undefined);

  return {
    ...entry,
    opened_at: new Date(openedAtMs).toISOString(),
    last_accessed_at: new Date(lastAccessedMs).toISOString(),
    score,
    ttl_ms: ttlMs,
    expires_at: expiresAt,
  } as OpenedFileEntry;
}

function normalizeOpenedState(state: OpenedFilesState): OpenedFilesState {
  return {
    ...state,
    files: state.files.map((entry) =>
      stripUndefined(normalizeOpenedEntry(entry)),
    ),
  };
}

/**
 * Load opened files state from VFS.
 */
export async function loadOpenedState(
  vfs: OverlayFs,
): Promise<OpenedFilesState> {
  let loaded: ReturnType<typeof parseContextFile> | null = null;
  try {
    loaded = parseContextFile(await vfs.read(VFS_PATHS.handles.opened));
  } catch {
    loaded = null;
  }

  if (!loaded) {
    return normalizeOpenedState({
      updated: new Date().toISOString(),
      context_bytes: 0,
      context_tokens: 0,
      files: [],
      ai_pins: [],
      recently_closed: [],
    });
  }

  const files = (loaded.meta.files as OpenedFileEntry[]) || [];
  const normalized = normalizeOpenedState({
    updated: (loaded.meta.updated as string) || new Date().toISOString(),
    context_bytes: (loaded.meta.context_bytes as number) || 0,
    context_tokens: (loaded.meta.context_tokens as number) || 0,
    files,
    ai_pins: (loaded.meta.ai_pins as AIPinRule[]) || [],
    recently_closed:
      (loaded.meta.recently_closed as OpenedFilesState['recently_closed']) ||
      [],
  });
  if (!normalized.context_tokens) {
    normalized.context_tokens = files.reduce(
      (sum, entry) =>
        sum +
        (typeof entry.size_tokens === 'number'
          ? entry.size_tokens
          : estimateTokensFromBytes(entry.size_bytes)),
      0,
    );
  }
  return normalized;
}

/**
 * Save opened files state to VFS.
 */
export async function saveOpenedState(
  vfs: OverlayFs,
  state: OpenedFilesState,
): Promise<void> {
  const normalized = normalizeOpenedState(state);
  let existingMeta: Record<string, unknown> = {};
  let existingContent = '';
  try {
    const parsed = parseContextFile(await vfs.read(VFS_PATHS.handles.opened));
    existingMeta = parsed.meta;
    existingContent = parsed.content;
  } catch {
    // no existing state yet
  }

  await vfs.write(
    VFS_PATHS.handles.opened,
    serializeContextFile(
      {
        ...existingMeta,
        id:
          typeof existingMeta.id === 'string'
            ? existingMeta.id
            : 'opened-files',
        tags: Array.isArray(existingMeta.tags)
          ? (existingMeta.tags as string[])
          : [],
        created:
          typeof existingMeta.created === 'string'
            ? existingMeta.created
            : new Date().toISOString(),
        updated: new Date().toISOString(),
        context_bytes: normalized.context_bytes,
        context_tokens: normalized.context_tokens,
        files: normalized.files,
        ai_pins: normalized.ai_pins ?? [],
        recently_closed: normalized.recently_closed ?? [],
      },
      existingContent,
    ),
  );
}

/**
 * Infer pin entry kind from path pattern.
 * - /foo/bar.md => file
 * - /foo/bar/   => directory (shallow view)
 * - /foo/bar/*  => glob (shallow expansion)
 * - /foo/bar/** => glob_recursive (recursive expansion)
 */
export function inferPinKind(
  path: string,
): 'file' | 'directory' | 'glob' | 'glob_recursive' {
  if (path.endsWith('/**')) return 'glob_recursive';
  if (path.endsWith('/*')) return 'glob';
  if (path.endsWith('/')) return 'directory';
  return 'file';
}

export async function ensureBootstrapOpenFile(
  vfs: OverlayFs,
  openedBy = 'system',
): Promise<OpenedFilesState> {
  const state = await loadOpenedState(vfs);
  const now = new Date().toISOString();

  if (state.files.some((file) => file.path === VFS_PATHS.core.bootstrap)) {
    return state;
  }

  try {
    const content = await vfs.read(VFS_PATHS.core.bootstrap);
    const sizeBytes = new TextEncoder().encode(content).length;
    state.files.push({
      path: VFS_PATHS.core.bootstrap,
      type: 'file',
      opened_at: now,
      last_accessed_at: now,
      opened_by: openedBy,
      size_bytes: sizeBytes,
      score: MAX_HANDLE_SCORE,
    });
  } catch {
    return state;
  }

  state.context_bytes = state.files.reduce((sum, f) => sum + f.size_bytes, 0);
  state.updated = now;
  await saveOpenedState(vfs, state);
  return state;
}

export async function applyHandleScoreUpdates(
  vfs: OverlayFs,
  updates: HandleScoreUpdate[],
): Promise<OpenedFilesState> {
  if (updates.length === 0) {
    return loadOpenedState(vfs);
  }

  const state = await loadOpenedState(vfs);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const update of updates) {
    const entry = state.files.find((file) => file.path === update.path);
    if (!entry) continue;

    const normalized = normalizeOpenedEntry(entry);
    const baseScore =
      typeof normalized.score === 'number'
        ? normalized.score
        : DEFAULT_HANDLE_SCORE;
    const nextScore = Math.min(
      MAX_HANDLE_SCORE,
      Math.max(MIN_HANDLE_SCORE, baseScore + update.delta),
    );

    entry.score = nextScore;

    if (update.delta > 0) {
      entry.last_accessed_at = nowIso;
      if (update.ttl_ms !== undefined) {
        entry.ttl_ms = update.ttl_ms;
      }
      if (entry.ttl_ms) {
        entry.expires_at = new Date(nowMs + entry.ttl_ms).toISOString();
      }
    }
  }

  state.updated = nowIso;
  await saveOpenedState(vfs, state);
  return state;
}
