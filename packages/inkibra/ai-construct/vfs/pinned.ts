/**
 * Pinned Runtime State
 *
 * Scope-aware pinned context entries backed by /runtime/handles/pinned.md.
 * Runtime pins supplement CONTEXT.yaml static pins — they do not replace them.
 *
 * Each pin has a `scope` that determines when it is visible:
 *   - '*'           → global — visible in all impulse lanes and nap
 *   - 'nap'         → visible only during nap stage
 *   - '<lane-name>' → visible only in that impulse lane (e.g. 'conversation')
 *
 * Deduplication key: (path, scope).
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import { parseContextFile, serializeContextFile } from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';

export type PinnedEntryKind = 'file' | 'directory' | 'glob' | 'glob_recursive';
export type PinnedEntryMode = 'full' | 'frontmatter';
export type PinnedEntrySource = 'system' | 'ai' | 'queue';

/**
 * Scope determines when a pin is visible.
 *   - '*'           → global (all impulse lanes + nap)
 *   - 'nap'         → nap stage only
 *   - '<lane-name>' → that specific impulse lane only
 */
export type PinnedEntryScope = '*' | 'nap' | (string & {});

export type PinnedEntry = {
  path: string;
  kind: PinnedEntryKind;
  mode: PinnedEntryMode;
  /** Visibility scope. '*' = global, 'nap' = nap only, or a lane name. */
  scope: PinnedEntryScope;
  source: PinnedEntrySource;
  reason?: string;
  created_at: string;
  updated: string;
};

type PinnedState = {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  pins: PinnedEntry[];
};

const PINNED_FALLBACK_ID = 'runtime-pinned';
const PINNED_TAGS = ['runtime', 'handles'];

function createEmptyPinnedState(now: string): PinnedState {
  return {
    id: PINNED_FALLBACK_ID,
    tags: PINNED_TAGS,
    created: now,
    updated: now,
    pins: [],
  };
}

function normalizePinnedStateMeta(
  parsedMeta: Record<string, unknown>,
  now: string,
  pins: PinnedEntry[],
): PinnedState {
  return {
    id: typeof parsedMeta.id === 'string' ? parsedMeta.id : PINNED_FALLBACK_ID,
    tags: Array.isArray(parsedMeta.tags)
      ? (parsedMeta.tags as string[])
      : PINNED_TAGS,
    created: typeof parsedMeta.created === 'string' ? parsedMeta.created : now,
    updated: now,
    pins,
  };
}

/**
 * Infer pin entry kind from path pattern.
 * - /foo/bar.md      => file
 * - /foo/bar/        => directory (shallow view)
 * - /foo/bar/*       => glob (shallow expansion)
 * - /foo/bar/**      => glob_recursive (recursive expansion)
 */
export function inferPinnedKind(path: string): PinnedEntryKind {
  if (path.endsWith('/**')) return 'glob_recursive';
  if (path.endsWith('/*')) return 'glob';
  if (path.endsWith('/')) return 'directory';
  return 'file';
}

/** Load all pinned entries from the state file. Returns [] on missing/corrupt file. */
export async function loadPinnedState(
  vfs: OverlayFs,
  path: string = VFS_PATHS.handles.pinned,
): Promise<PinnedEntry[]> {
  try {
    const content = await vfs.read(path);
    const parsed = parseContextFile(content);
    return Array.isArray(parsed.meta.pins)
      ? (parsed.meta.pins as PinnedEntry[])
      : [];
  } catch {
    return [];
  }
}

/** Persist the full pins array to the state file. */
export async function savePinnedState(
  vfs: OverlayFs,
  pins: PinnedEntry[],
  path: string = VFS_PATHS.handles.pinned,
): Promise<void> {
  const now = new Date().toISOString();
  let existingMeta: Record<string, unknown> = {};
  let existingContent = '';
  try {
    const parsed = parseContextFile(await vfs.read(path));
    existingMeta = parsed.meta;
    existingContent = parsed.content;
  } catch {
    // no existing file — start from empty
    existingMeta = createEmptyPinnedState(now);
  }

  const state = normalizePinnedStateMeta(existingMeta, now, pins);
  const normalizedPins = state.pins.map((pin) => {
    const anyPin = pin as unknown as Record<string, unknown>;
    const updated =
      typeof anyPin.updated === 'string' && anyPin.updated.length > 0
        ? (anyPin.updated as string)
        : now;
    const normalized: PinnedEntry = {
      path: String(anyPin.path ?? ''),
      kind: anyPin.kind as PinnedEntryKind,
      mode: anyPin.mode as PinnedEntryMode,
      scope: anyPin.scope as PinnedEntryScope,
      source: anyPin.source as PinnedEntrySource,
      ...(typeof anyPin.reason === 'string' ? { reason: anyPin.reason } : {}),
      created_at:
        typeof anyPin.created_at === 'string' &&
        (anyPin.created_at as string).length > 0
          ? (anyPin.created_at as string)
          : now,
      updated,
    };
    return normalized;
  });
  await vfs.write(
    path,
    serializeContextFile(
      {
        ...existingMeta,
        ...state,
        updated: state.updated,
        pins: normalizedPins,
      },
      existingContent,
    ),
  );
}

/**
 * Filter pinned entries visible for a given stage and optional lane.
 *
 * A pin matches when:
 *   - scope === '*'           → always matches (global)
 *   - scope === 'nap'         → matches only the global nap/commit stage
 *   - scope === '<lane-name>' → matches when lane argument equals scope.
 *                                This covers awake lane stages plus any lane-specific nap work.
 */
export function queryPinnedEntries(
  pins: PinnedEntry[],
  stage: string,
  lane?: string,
): PinnedEntry[] {
  return pins.filter((pin) => {
    if (pin.scope === '*') return true;
    if (pin.scope === 'nap') return stage === 'nap/commit';
    // Lane-scoped pin: visible whenever the lane matches
    return !!lane && pin.scope === lane;
  });
}

/**
 * Upsert a pinned entry by dedup key (path, scope).
 * If a matching entry exists it is updated in place; otherwise the entry is appended.
 */
export async function upsertPinnedEntry(
  vfs: OverlayFs,
  entry: Omit<PinnedEntry, 'created_at' | 'updated'> & {
    created_at?: string;
  },
  path: string = VFS_PATHS.handles.pinned,
): Promise<void> {
  const now = new Date().toISOString();
  const pins = await loadPinnedState(vfs, path);

  const idx = pins.findIndex(
    (p) => p.path === entry.path && p.scope === entry.scope,
  );

  const normalized: PinnedEntry = {
    ...entry,
    created_at:
      idx >= 0 ? (pins[idx]?.created_at ?? now) : (entry.created_at ?? now),
    updated: now,
  };

  if (idx >= 0) {
    pins[idx] = normalized;
  } else {
    pins.push(normalized);
  }

  await savePinnedState(vfs, pins, path);
}

/**
 * Remove a pinned entry by dedup key (path, scope).
 * No-ops if no matching entry exists.
 */
export async function removePinnedEntry(
  vfs: OverlayFs,
  key: Pick<PinnedEntry, 'path' | 'scope'>,
  path: string = VFS_PATHS.handles.pinned,
): Promise<void> {
  const pins = await loadPinnedState(vfs, path);
  const filtered = pins.filter(
    (p) => !(p.path === key.path && p.scope === key.scope),
  );
  // Only write if something was removed (avoid unnecessary writes)
  if (filtered.length !== pins.length) {
    await savePinnedState(vfs, filtered, path);
  }
}
