import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import type { ConstructOp } from '../runtime/ops';
import { VFS_PATHS } from './layout';

type QueueStatus = 'pending' | 'consumed';

export type DeferredExecutionLane = 'nap-lane';

export type DeferredParentResolutionTerminalStatus =
  | 'applied'
  | 'failed_permanent'
  | 'failed_not_open';

export type DeferredParentResolutionStatus =
  | 'pending'
  | DeferredParentResolutionTerminalStatus;

export type DeferredParentResolutionRecord = {
  parentOpId: string;
  childOpId: string;
  lane: DeferredExecutionLane;
  status: DeferredParentResolutionStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type DeferredParentResolutionOutcome = {
  parentOpId: string;
  childOpId: string;
  lifecycle: DeferredParentResolutionTerminalStatus;
  resolvedAt?: string;
};

export type DeferredParentResolutionByOpId = Record<
  string,
  DeferredParentResolutionRecord
>;

type QueueMeta = {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  queue: DeferredPerceptionQueueEntry[];
  parentResolutionByOpId: DeferredParentResolutionByOpId;
};

export type DeferredPerceptionQueueEntry = {
  id: string;
  parentOpId: string;
  childOpId: string;
  lane: DeferredExecutionLane;
  op: ConstructOp;
  createdAt: string;
  status?: QueueStatus;
};

export type DeferredPerceptionEnqueueRequest = {
  parentOpId: string;
  childOpId: string;
  lane: DeferredExecutionLane;
  op: ConstructOp;
};

export type EnqueueDeferredPerceptionResult = {
  acceptedChildOpIds: string[];
  enqueuedCount: number;
  dedupedCount: number;
};

const QUEUE_META_ID = 'deferred-perception-queue';

function createEmptyQueueMeta(now: string): QueueMeta {
  return {
    id: QUEUE_META_ID,
    tags: ['runtime', 'queue'],
    created: now,
    updated: now,
    queue: [],
    parentResolutionByOpId: {},
  };
}

function normalizeQueueMeta(
  parsedMeta: Record<string, unknown>,
  now: string,
  queue: DeferredPerceptionQueueEntry[],
  parentResolutionByOpId: DeferredParentResolutionByOpId,
): QueueMeta {
  return {
    id: typeof parsedMeta.id === 'string' ? parsedMeta.id : QUEUE_META_ID,
    tags: Array.isArray(parsedMeta.tags)
      ? (parsedMeta.tags as string[])
      : ['runtime', 'queue'],
    created: typeof parsedMeta.created === 'string' ? parsedMeta.created : now,
    updated: now,
    queue,
    parentResolutionByOpId,
  };
}

function isConstructOp(value: unknown): value is ConstructOp {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.opId === 'string' &&
    typeof record.kind === 'string' &&
    typeof record.createdAt === 'string'
  );
}

function isDeferredEntry(
  value: unknown,
): value is DeferredPerceptionQueueEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.createdAt === 'string' &&
    isConstructOp(record.op)
  );
}

function normalizeDeferredEntry(
  entry: DeferredPerceptionQueueEntry,
): DeferredPerceptionQueueEntry {
  const childOpId =
    typeof entry.childOpId === 'string' && entry.childOpId.length > 0
      ? entry.childOpId
      : entry.op.opId;
  const parentOpId =
    typeof entry.parentOpId === 'string' && entry.parentOpId.length > 0
      ? entry.parentOpId
      : childOpId;

  return {
    ...entry,
    id:
      typeof entry.id === 'string' && entry.id.length > 0
        ? entry.id
        : childOpId,
    parentOpId,
    childOpId,
    lane: entry.lane === 'nap-lane' ? 'nap-lane' : 'nap-lane',
  };
}

function normalizeParentResolutionRecord(
  parentOpId: string,
  value: unknown,
  now: string,
): DeferredParentResolutionRecord {
  const record =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};

  const childOpId =
    typeof record.childOpId === 'string' && record.childOpId.length > 0
      ? record.childOpId
      : parentOpId;
  const status =
    record.status === 'pending' ||
    record.status === 'applied' ||
    record.status === 'failed_permanent' ||
    record.status === 'failed_not_open'
      ? record.status
      : 'pending';
  const createdAt =
    typeof record.createdAt === 'string' && record.createdAt.length > 0
      ? record.createdAt
      : now;
  const updatedAt =
    typeof record.updatedAt === 'string' && record.updatedAt.length > 0
      ? record.updatedAt
      : createdAt;
  const resolvedAt =
    typeof record.resolvedAt === 'string' && record.resolvedAt.length > 0
      ? record.resolvedAt
      : undefined;

  const normalized: DeferredParentResolutionRecord = {
    parentOpId,
    childOpId,
    lane: 'nap-lane',
    status,
    createdAt,
    updatedAt,
  };

  if (resolvedAt) {
    normalized.resolvedAt = resolvedAt;
  }

  return normalized;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined);
  }

  if (typeof value === 'object' && value !== null) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const sanitized = stripUndefinedDeep(entry);
      if (sanitized !== undefined) {
        next[key] = sanitized;
      }
    }
    return next;
  }

  return value === undefined ? undefined : value;
}

function serializeQueueMeta(meta: QueueMeta, content: string): string {
  return serializeContextFile(
    stripUndefinedDeep(meta) as Parameters<typeof serializeContextFile>[0],
    content,
  );
}

function normalizeParentResolutionByOpId(
  value: unknown,
  now: string,
): DeferredParentResolutionByOpId {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const normalized: DeferredParentResolutionByOpId = {};
  for (const [parentOpId, parentResolution] of Object.entries(record)) {
    if (typeof parentOpId !== 'string' || parentOpId.length === 0) {
      continue;
    }

    normalized[parentOpId] = normalizeParentResolutionRecord(
      parentOpId,
      parentResolution,
      now,
    );
  }

  return normalized;
}

function ensurePendingParentResolutionRecord(
  parentResolutionByOpId: DeferredParentResolutionByOpId,
  input: {
    parentOpId: string;
    childOpId: string;
    lane: DeferredExecutionLane;
    now: string;
  },
): void {
  if (parentResolutionByOpId[input.parentOpId]) {
    return;
  }

  parentResolutionByOpId[input.parentOpId] = {
    parentOpId: input.parentOpId,
    childOpId: input.childOpId,
    lane: input.lane,
    status: 'pending',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function ensureParentResolutionForKnownChild(
  parentResolutionByOpId: DeferredParentResolutionByOpId,
  input: {
    parentOpId: string;
    childOpId: string;
    lane: DeferredExecutionLane;
    knownChildEntry?: DeferredPerceptionQueueEntry;
    now: string;
  },
): void {
  if (parentResolutionByOpId[input.parentOpId]) {
    return;
  }

  if (input.knownChildEntry?.status === 'consumed') {
    parentResolutionByOpId[input.parentOpId] = {
      parentOpId: input.parentOpId,
      childOpId: input.childOpId,
      lane: input.lane,
      status: 'applied',
      createdAt: input.now,
      updatedAt: input.now,
      resolvedAt: input.now,
    };
    return;
  }

  parentResolutionByOpId[input.parentOpId] = {
    parentOpId: input.parentOpId,
    childOpId: input.childOpId,
    lane: input.lane,
    status: 'pending',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

async function readQueueFile(
  vfs: OverlayFs,
  path: string,
): Promise<{ meta: Record<string, unknown>; content: string }> {
  try {
    const content = await vfs.read(path);
    const parsed = parseContextFile(content);
    return {
      meta: parsed.meta,
      content: parsed.content,
    };
  } catch {
    return {
      meta: createEmptyQueueMeta(new Date().toISOString()),
      content:
        '# DEFERRED_PERCEPTION_QUEUE\n\nRuntime-managed queue for perception-lane ops deferred while nap/hypno command phases are active.\n',
    };
  }
}

export async function loadPendingDeferredPerceptionQueueEntries(
  vfs: OverlayFs,
  queuePath: string = VFS_PATHS.queue.deferredPerceptionQueue,
): Promise<DeferredPerceptionQueueEntry[]> {
  const { meta } = await readQueueFile(vfs, queuePath);
  const queueRaw = Array.isArray(meta.queue) ? meta.queue : [];
  return queueRaw
    .filter(isDeferredEntry)
    .map(normalizeDeferredEntry)
    .filter((entry) => entry.status !== 'consumed');
}

export async function loadDeferredParentResolutionRecords(
  vfs: OverlayFs,
  queuePath: string = VFS_PATHS.queue.deferredPerceptionQueue,
): Promise<DeferredParentResolutionByOpId> {
  const { meta } = await readQueueFile(vfs, queuePath);
  const now = new Date().toISOString();
  return normalizeParentResolutionByOpId(meta.parentResolutionByOpId, now);
}

export async function enqueueDeferredPerceptionOps(
  vfs: OverlayFs,
  requests: DeferredPerceptionEnqueueRequest[],
  queuePath: string = VFS_PATHS.queue.deferredPerceptionQueue,
): Promise<EnqueueDeferredPerceptionResult> {
  if (requests.length === 0) {
    return {
      acceptedChildOpIds: [],
      enqueuedCount: 0,
      dedupedCount: 0,
    };
  }

  const { meta, content } = await readQueueFile(vfs, queuePath);
  const queueRaw = Array.isArray(meta.queue) ? meta.queue : [];
  const queue = queueRaw.filter(isDeferredEntry).map(normalizeDeferredEntry);
  const now = new Date().toISOString();
  const parentResolutionByOpId = normalizeParentResolutionByOpId(
    meta.parentResolutionByOpId,
    now,
  );
  const knownChildOpIds = new Set(queue.map((entry) => entry.childOpId));
  const knownChildEntryByOpId = new Map(
    queue.map((entry) => [entry.childOpId, entry] as const),
  );

  const nextQueue = [...queue];
  const acceptedChildOpIds: string[] = [];
  let enqueuedCount = 0;
  let dedupedCount = 0;

  for (const request of requests) {
    if (knownChildOpIds.has(request.childOpId)) {
      acceptedChildOpIds.push(request.childOpId);
      dedupedCount += 1;
      ensureParentResolutionForKnownChild(parentResolutionByOpId, {
        parentOpId: request.parentOpId,
        childOpId: request.childOpId,
        lane: request.lane,
        knownChildEntry: knownChildEntryByOpId.get(request.childOpId),
        now,
      });
      continue;
    }

    nextQueue.push({
      id: request.childOpId,
      parentOpId: request.parentOpId,
      childOpId: request.childOpId,
      lane: request.lane,
      op: request.op,
      createdAt: now,
      status: 'pending',
    });
    acceptedChildOpIds.push(request.childOpId);
    knownChildOpIds.add(request.childOpId);
    knownChildEntryByOpId.set(request.childOpId, {
      id: request.childOpId,
      parentOpId: request.parentOpId,
      childOpId: request.childOpId,
      lane: request.lane,
      op: request.op,
      createdAt: now,
      status: 'pending',
    });
    ensurePendingParentResolutionRecord(parentResolutionByOpId, {
      parentOpId: request.parentOpId,
      childOpId: request.childOpId,
      lane: request.lane,
      now,
    });
    enqueuedCount += 1;
  }

  const nextContent = serializeQueueMeta(
    normalizeQueueMeta(meta, now, nextQueue, parentResolutionByOpId),
    content,
  );
  await vfs.write(queuePath, nextContent);

  return {
    acceptedChildOpIds,
    enqueuedCount,
    dedupedCount,
  };
}

export async function consumeDeferredPerceptionQueueEntries(
  vfs: OverlayFs,
  consumedIds: string[],
  queuePath: string = VFS_PATHS.queue.deferredPerceptionQueue,
): Promise<void> {
  if (consumedIds.length === 0) {
    return;
  }

  const consumed = new Set(consumedIds);
  const { meta, content } = await readQueueFile(vfs, queuePath);
  const queueRaw = Array.isArray(meta.queue) ? meta.queue : [];
  const queue = queueRaw.filter(isDeferredEntry).map(normalizeDeferredEntry);
  const now = new Date().toISOString();
  const parentResolutionByOpId = normalizeParentResolutionByOpId(
    meta.parentResolutionByOpId,
    now,
  );

  const nextQueue = queue.map((entry) => {
    if (!consumed.has(entry.id)) {
      return entry;
    }

    return {
      ...entry,
      status: 'consumed' as const,
    };
  });

  const nextContent = serializeQueueMeta(
    normalizeQueueMeta(meta, now, nextQueue, parentResolutionByOpId),
    content,
  );
  await vfs.write(queuePath, nextContent);
}

export async function recordDeferredParentResolutionOutcomes(
  vfs: OverlayFs,
  outcomes: DeferredParentResolutionOutcome[],
  queuePath: string = VFS_PATHS.queue.deferredPerceptionQueue,
): Promise<void> {
  if (outcomes.length === 0) {
    return;
  }

  const { meta, content } = await readQueueFile(vfs, queuePath);
  const queueRaw = Array.isArray(meta.queue) ? meta.queue : [];
  const queue = queueRaw.filter(isDeferredEntry).map(normalizeDeferredEntry);
  const now = new Date().toISOString();
  const parentResolutionByOpId = normalizeParentResolutionByOpId(
    meta.parentResolutionByOpId,
    now,
  );

  for (const outcome of outcomes) {
    const resolvedAt = outcome.resolvedAt ?? now;
    const existing = parentResolutionByOpId[outcome.parentOpId];

    if (!existing) {
      parentResolutionByOpId[outcome.parentOpId] = {
        parentOpId: outcome.parentOpId,
        childOpId: outcome.childOpId,
        lane: 'nap-lane',
        status: outcome.lifecycle,
        createdAt: resolvedAt,
        updatedAt: resolvedAt,
        resolvedAt,
      };
      continue;
    }

    if (existing.childOpId !== outcome.childOpId) {
      continue;
    }

    if (
      existing.status === outcome.lifecycle &&
      typeof existing.resolvedAt === 'string' &&
      existing.resolvedAt.length > 0
    ) {
      continue;
    }

    if (
      existing.status !== 'pending' &&
      existing.status !== outcome.lifecycle
    ) {
      continue;
    }

    parentResolutionByOpId[outcome.parentOpId] = {
      ...existing,
      status: outcome.lifecycle,
      updatedAt: resolvedAt,
      resolvedAt,
    };
  }

  const nextContent = serializeQueueMeta(
    normalizeQueueMeta(meta, now, queue, parentResolutionByOpId),
    content,
  );
  await vfs.write(queuePath, nextContent);
}
