import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { decodeCursor } from '@inkibra/streams';
import {
  getSourceFactPhaseRank,
  type SourceFactClearReason,
  type SourceFactJournal,
  type SourceFactLifecyclePhase,
  type SourceFactLifecycleReceipt,
  type SourceFactType,
} from '../source-facts';
import { getOrRotateDiagLog, VFS_PATHS } from './layout';

export type SourceFactRecord = {
  factId: string;
  factType: SourceFactType;
  traceId?: string;
  previewText?: string;
  journal?: SourceFactJournal;
  queueRef?: string;
  queuedAt?: string;
  reflectedAt?: string;
  spawnedAt?: string;
  clearedAt?: string;
  deliveredAt?: string;
  clearReason?: SourceFactClearReason;
  responseIds?: string[];
  impulseIds?: string[];
  lastPhase: SourceFactLifecyclePhase;
  updatedAt: string;
};

type SourceFactState = {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  factsById: Record<string, SourceFactRecord>;
};

const STATE_ID = 'source-facts';
const receiptWriteQueueByVfs = new WeakMap<OverlayFs, Promise<unknown>>();

export async function loadSourceFactState(
  vfs: OverlayFs,
): Promise<Record<string, SourceFactRecord>> {
  try {
    const parsed = parseContextFile(
      await vfs.read(VFS_PATHS.state.sourceFacts),
    );
    const facts = parsed.meta.factsById;
    if (typeof facts !== 'object' || facts === null) {
      return {};
    }

    const normalized: Record<string, SourceFactRecord> = {};
    for (const [factId, value] of Object.entries(
      facts as Record<string, unknown>,
    )) {
      const record = normalizeRecord(factId, value);
      if (record) {
        normalized[factId] = record;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

export async function recordSourceFactReceipt(
  vfs: OverlayFs,
  receipt: SourceFactLifecycleReceipt,
  committedCursor?: string,
): Promise<SourceFactRecord> {
  return withReceiptWriteLock(vfs, async () => {
    const now = receipt.timestamp;
    const factsById = mergeSourceFactReceipts(await loadSourceFactState(vfs), [
      receipt,
    ]);
    const next = factsById[receipt.factId]!;
    await saveState(
      vfs,
      {
        id: STATE_ID,
        tags: ['runtime', 'source-facts'],
        created: now,
        updated: now,
        factsById,
      },
      committedCursor,
    );
    return next;
  });
}

export function mergeSourceFactReceipts(
  factsById: Record<string, SourceFactRecord>,
  receipts: Iterable<SourceFactLifecycleReceipt>,
): Record<string, SourceFactRecord> {
  const nextFactsById = { ...factsById };

  for (const receipt of receipts) {
    nextFactsById[receipt.factId] = applyReceipt(
      nextFactsById[receipt.factId],
      receipt,
    );
  }

  return nextFactsById;
}

function applyReceipt(
  existing: SourceFactRecord | undefined,
  receipt: SourceFactLifecycleReceipt,
): SourceFactRecord {
  const record: SourceFactRecord = {
    factId: receipt.factId,
    factType: existing?.factType ?? receipt.factType,
    traceId: receipt.traceId ?? existing?.traceId,
    previewText: existing?.previewText ?? receipt.previewText,
    journal: receipt.journal ?? existing?.journal,
    queueRef: existing?.queueRef,
    queuedAt: existing?.queuedAt,
    reflectedAt: existing?.reflectedAt,
    spawnedAt: existing?.spawnedAt,
    clearedAt: existing?.clearedAt,
    deliveredAt: existing?.deliveredAt,
    clearReason: existing?.clearReason,
    responseIds: existing?.responseIds ? [...existing.responseIds] : undefined,
    impulseIds: existing?.impulseIds ? [...existing.impulseIds] : undefined,
    lastPhase: existing?.lastPhase ?? receipt.phase,
    updatedAt: receipt.timestamp,
  };

  if (receipt.phase === 'queued' && !record.queuedAt) {
    record.queuedAt = receipt.timestamp;
  }
  if (receipt.queueRef && !record.queueRef) {
    record.queueRef = receipt.queueRef;
  }
  if (receipt.phase === 'reflected' && !record.reflectedAt) {
    record.reflectedAt = receipt.timestamp;
  }
  if (receipt.phase === 'spawned' && !record.spawnedAt) {
    record.spawnedAt = receipt.timestamp;
  }
  if (receipt.phase === 'cleared' && !record.clearedAt) {
    record.clearedAt = receipt.timestamp;
  }
  if (receipt.phase === 'delivered' && !record.deliveredAt) {
    record.deliveredAt = receipt.timestamp;
  }
  if (receipt.clearReason) {
    record.clearReason = receipt.clearReason;
  }
  if (receipt.impulseId) {
    record.impulseIds = unionString(record.impulseIds, receipt.impulseId);
  }
  if (receipt.responseId) {
    record.responseIds = unionString(record.responseIds, receipt.responseId);
  }
  if (
    getSourceFactPhaseRank(receipt.phase) >
    getSourceFactPhaseRank(record.lastPhase)
  ) {
    record.lastPhase = receipt.phase;
  }

  return stripUndefinedDeep(record) as SourceFactRecord;
}

function normalizeRecord(
  factId: string,
  value: unknown,
): SourceFactRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const factType = record.factType;
  const lastPhase = record.lastPhase;
  if (typeof factType !== 'string' || typeof lastPhase !== 'string') {
    return null;
  }

  return stripUndefinedDeep({
    factId,
    factType,
    traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
    previewText:
      typeof record.previewText === 'string' ? record.previewText : undefined,
    journal: typeof record.journal === 'string' ? record.journal : undefined,
    queueRef: typeof record.queueRef === 'string' ? record.queueRef : undefined,
    queuedAt: typeof record.queuedAt === 'string' ? record.queuedAt : undefined,
    reflectedAt:
      typeof record.reflectedAt === 'string' ? record.reflectedAt : undefined,
    spawnedAt:
      typeof record.spawnedAt === 'string' ? record.spawnedAt : undefined,
    clearedAt:
      typeof record.clearedAt === 'string' ? record.clearedAt : undefined,
    deliveredAt:
      typeof record.deliveredAt === 'string' ? record.deliveredAt : undefined,
    clearReason:
      typeof record.clearReason === 'string' ? record.clearReason : undefined,
    responseIds: Array.isArray(record.responseIds)
      ? (record.responseIds as string[])
      : undefined,
    impulseIds: Array.isArray(record.impulseIds)
      ? (record.impulseIds as string[])
      : undefined,
    lastPhase: lastPhase as SourceFactLifecyclePhase,
    updatedAt:
      typeof record.updatedAt === 'string'
        ? record.updatedAt
        : new Date().toISOString(),
  }) as SourceFactRecord;
}

const TERMINAL_SOURCE_FACT_PHASES: Set<SourceFactLifecyclePhase> = new Set([
  'cleared',
  'delivered',
]);

/**
 * Check if a source fact's queueRef is at or before the committed cursor.
 * Records past the frontier are durable and safe to prune from active state.
 */
function isFactPastFrontier(
  record: SourceFactRecord,
  committedCursor: string | undefined,
): boolean {
  if (!committedCursor || !record.queueRef) return false;
  const factCursor = decodeCursor(record.queueRef);
  const frontier = decodeCursor(committedCursor);
  if (!factCursor || !frontier) return false;
  return factCursor.seq <= frontier.seq;
}

async function saveState(
  vfs: OverlayFs,
  state: SourceFactState,
  committedCursor?: string,
): Promise<void> {
  let content = '';
  let existingMeta: Record<string, unknown> = {};
  try {
    const parsed = parseContextFile(
      await vfs.read(VFS_PATHS.state.sourceFacts),
    );
    content = parsed.content;
    existingMeta = parsed.meta;
  } catch {
    // ignore missing state file
  }

  // Separate active from pruneable records.
  // Prune if: terminal phase, past the durable frontier, or stale (>1hr without queueRef).
  const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  const activeFacts: Record<string, SourceFactRecord> = {};
  const terminalFacts: SourceFactRecord[] = [];
  for (const [factId, record] of Object.entries(state.factsById)) {
    const isTerminal = TERMINAL_SOURCE_FACT_PHASES.has(record.lastPhase);
    const isPastFrontier = isFactPastFrontier(record, committedCursor);
    const isStale =
      !record.queueRef &&
      record.updatedAt &&
      now - new Date(record.updatedAt).getTime() > STALE_THRESHOLD_MS;
    if (isTerminal || isPastFrontier || isStale) {
      terminalFacts.push(record);
    } else {
      activeFacts[factId] = record;
    }
  }

  // Append terminal records to hourly diag log
  if (terminalFacts.length > 0) {
    const logPath = await getOrRotateDiagLog(
      vfs,
      VFS_PATHS.diag.sourceFactLogs,
    );
    let existing = '';
    try {
      existing = await vfs.read(logPath);
    } catch {
      // file doesn't exist yet
    }
    const lines = terminalFacts.map((r) => JSON.stringify(r)).join('\n');
    await vfs.write(logPath, existing ? `${existing}\n${lines}` : lines);
  }

  // Only persist active (non-terminal) records in state file
  await vfs.write(
    VFS_PATHS.state.sourceFacts,
    serializeContextFile(
      stripUndefinedDeep({
        ...existingMeta,
        id: typeof existingMeta.id === 'string' ? existingMeta.id : state.id,
        tags: Array.isArray(existingMeta.tags) ? existingMeta.tags : state.tags,
        created:
          typeof existingMeta.created === 'string'
            ? existingMeta.created
            : state.created,
        updated: state.updated,
        factsById: activeFacts,
      }) as Parameters<typeof serializeContextFile>[0],
      content,
    ),
  );
}

async function withReceiptWriteLock<T>(
  vfs: OverlayFs,
  work: () => Promise<T>,
): Promise<T> {
  const previous = receiptWriteQueueByVfs.get(vfs) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  receiptWriteQueueByVfs.set(
    vfs,
    next.catch(() => {}),
  );
  return next;
}

function unionString(existing: string[] | undefined, value: string): string[] {
  if (existing?.includes(value)) {
    return existing;
  }
  return [...(existing ?? []), value];
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
      const normalized = stripUndefinedDeep(entry);
      if (normalized !== undefined) {
        next[key] = normalized;
      }
    }
    return next;
  }

  return value === undefined ? undefined : value;
}
