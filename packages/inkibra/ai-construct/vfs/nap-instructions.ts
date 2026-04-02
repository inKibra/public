import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';
import {
  inferPinnedKind,
  type PinnedEntryKind,
  type PinnedEntryMode,
  type PinnedEntryScope,
  type PinnedEntrySource,
  upsertPinnedEntry,
} from './pinned';

type QueueStatus = 'pending' | 'consumed';

export type NextNapPinEntry = {
  id: string;
  path: string;
  kind: PinnedEntryKind;
  mode: PinnedEntryMode;
  /** Visibility scope for the pin. Defaults to '*' (global). */
  scope: PinnedEntryScope;
  source: PinnedEntrySource;
  reason?: string;
  createdAt: string;
  status?: QueueStatus;
};

export type NextNapImprintEntry = {
  id: string;
  text: string;
  createdAt: string;
  status?: QueueStatus;
};

type QueueMeta<TEntry> = {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  queue: TEntry[];
};

function createEmptyQueueMeta<TEntry>(
  now: string,
  id: string,
): QueueMeta<TEntry> {
  return {
    id,
    tags: ['nap', 'queue'],
    created: now,
    updated: now,
    queue: [],
  };
}

function normalizeQueueMeta<TEntry>(
  parsedMeta: Record<string, unknown>,
  now: string,
  fallbackId: string,
  queue: TEntry[],
): QueueMeta<TEntry> {
  return {
    id: typeof parsedMeta.id === 'string' ? parsedMeta.id : fallbackId,
    tags: Array.isArray(parsedMeta.tags)
      ? (parsedMeta.tags as string[])
      : ['nap', 'queue'],
    created: typeof parsedMeta.created === 'string' ? parsedMeta.created : now,
    updated: now,
    queue,
  };
}

async function loadQueueEntries<TEntry>(
  vfs: OverlayFs,
  path: string,
): Promise<TEntry[]> {
  try {
    const content = await vfs.read(path);
    const parsed = parseContextFile(content);
    return Array.isArray(parsed.meta.queue)
      ? (parsed.meta.queue as TEntry[])
      : [];
  } catch {
    return [];
  }
}

async function appendQueueEntry<TEntry>(
  vfs: OverlayFs,
  path: string,
  fallbackId: string,
  entry: TEntry,
): Promise<void> {
  const now = new Date().toISOString();

  let existing = '';
  try {
    existing = await vfs.read(path);
  } catch {
    existing = serializeContextFile(createEmptyQueueMeta(now, fallbackId), '');
  }

  const parsed = parseContextFile(existing);
  const queue = Array.isArray(parsed.meta.queue) ? parsed.meta.queue : [];
  const nextQueue = structuredClone([...queue, entry]) as TEntry[];
  const nextContent = serializeContextFile(
    normalizeQueueMeta(parsed.meta, now, fallbackId, nextQueue),
    parsed.content,
  );
  await vfs.write(path, nextContent);
}

async function consumeQueueEntries<
  TEntry extends { id: string; status?: QueueStatus },
>(
  vfs: OverlayFs,
  consumedIds: string[],
  path: string,
  fallbackId: string,
): Promise<void> {
  const now = new Date().toISOString();

  let existing = '';
  try {
    existing = await vfs.read(path);
  } catch {
    const initial = serializeContextFile(
      createEmptyQueueMeta(now, fallbackId),
      '',
    );
    await vfs.write(path, initial);
    existing = initial;
  }

  const parsed = parseContextFile(existing);
  const queue = Array.isArray(parsed.meta.queue)
    ? (parsed.meta.queue as TEntry[])
    : [];

  const nextQueue = queue.map((entry) =>
    consumedIds.includes(entry.id)
      ? {
          ...entry,
          status: 'consumed' as const,
        }
      : entry,
  );

  const nextContent = serializeContextFile(
    normalizeQueueMeta(parsed.meta, now, fallbackId, nextQueue),
    parsed.content,
  );
  await vfs.write(path, nextContent);
}

export async function enqueueNextNapPin(
  vfs: OverlayFs,
  input: {
    path: string;
    kind?: PinnedEntryKind;
    mode?: PinnedEntryMode;
    scope?: PinnedEntryScope;
    source?: PinnedEntrySource;
    reason?: string;
    id?: string;
  },
  napPinQueuePath: string = VFS_PATHS.queue.napPinQueue,
): Promise<NextNapPinEntry> {
  const now = new Date().toISOString();
  const entry: NextNapPinEntry = {
    id: input.id ?? `next-nap-pin:${crypto.randomUUID()}`,
    path: input.path,
    kind: input.kind ?? inferPinnedKind(input.path),
    mode: input.mode ?? 'full',
    scope: input.scope ?? '*',
    source: input.source ?? 'queue',
    ...(input.reason != null ? { reason: input.reason } : {}),
    createdAt: now,
    status: 'pending',
  };

  await appendQueueEntry(vfs, napPinQueuePath, 'nap-pin-queue', entry);
  return entry;
}

export async function loadPendingNextNapPins(
  vfs: OverlayFs,
  napPinQueuePath: string = VFS_PATHS.queue.napPinQueue,
): Promise<NextNapPinEntry[]> {
  const queue = await loadQueueEntries<NextNapPinEntry>(vfs, napPinQueuePath);
  return queue.filter((entry) => entry.status !== 'consumed');
}

export async function consumeNextNapPins(
  vfs: OverlayFs,
  consumedIds: string[],
  napPinQueuePath: string = VFS_PATHS.queue.napPinQueue,
): Promise<void> {
  await consumeQueueEntries<NextNapPinEntry>(
    vfs,
    consumedIds,
    napPinQueuePath,
    'nap-pin-queue',
  );
}

/**
 * Apply pending next-nap pin entries by upserting each into the pinned state.
 * Deduplication by (path, scope) is handled by upsertPinnedEntry.
 */
export async function applyNextNapPins(
  vfs: OverlayFs,
  entries: NextNapPinEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  for (const entry of entries) {
    try {
      await upsertPinnedEntry(vfs, {
        path: entry.path,
        kind: entry.kind,
        mode: entry.mode,
        scope: entry.scope,
        source: entry.source,
        ...(entry.reason != null ? { reason: entry.reason } : {}),
        created_at: entry.createdAt,
      });
    } catch {
      // skip entries that fail to upsert (e.g. vfs write errors)
    }
  }
}

export async function enqueueNextNapImprint(
  vfs: OverlayFs,
  input: {
    text: string;
    id?: string;
  },
  imprintQueuePath: string = VFS_PATHS.queue.nextNapImprintQueue,
): Promise<NextNapImprintEntry> {
  const now = new Date().toISOString();
  const entry: NextNapImprintEntry = {
    id: input.id ?? `next-nap-imprint:${crypto.randomUUID()}`,
    text: input.text,
    createdAt: now,
    status: 'pending',
  };

  await appendQueueEntry(
    vfs,
    imprintQueuePath,
    'next-nap-imprint-queue',
    entry,
  );
  return entry;
}

export async function loadPendingNextNapImprints(
  vfs: OverlayFs,
  imprintQueuePath: string = VFS_PATHS.queue.nextNapImprintQueue,
): Promise<NextNapImprintEntry[]> {
  const queue = await loadQueueEntries<NextNapImprintEntry>(
    vfs,
    imprintQueuePath,
  );
  return queue.filter((entry) => entry.status !== 'consumed');
}

export async function consumeNextNapImprints(
  vfs: OverlayFs,
  consumedIds: string[],
  imprintQueuePath: string = VFS_PATHS.queue.nextNapImprintQueue,
): Promise<void> {
  await consumeQueueEntries<NextNapImprintEntry>(
    vfs,
    consumedIds,
    imprintQueuePath,
    'next-nap-imprint-queue',
  );
}
