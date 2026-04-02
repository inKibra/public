import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import type { ImpulseUrgency, WaitForIdleTarget } from '../impulse/types';
import {
  getResponseLifecyclePhaseRank,
  type ResponseLifecycleDropReason,
  type ResponseLifecyclePhase,
  type ResponseLifecycleReceipt,
} from '../response-lifecycle';
import type { SourceFactType } from '../source-facts';
import { getOrRotateDiagLog, VFS_PATHS } from './layout';

export type ResponseLifecycleRecord = {
  responseId: string;
  scheduledBy?: string;
  sourceFactId?: string;
  sourceFactType?: SourceFactType;
  traceId?: string;
  intent?: string;
  urgency?: ImpulseUrgency;
  waitForIdleTargets?: WaitForIdleTarget[];
  scheduledAt?: string;
  selectedAt?: string;
  executingAt?: string;
  deliveredAt?: string;
  droppedAt?: string;
  clearedAt?: string;
  clearedByResponseId?: string;
  dropReason?: ResponseLifecycleDropReason;
  draftText?: string;
  lastPhase: ResponseLifecyclePhase;
  updatedAt: string;
};

type ResponseLifecycleState = {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  responsesById: Record<string, ResponseLifecycleRecord>;
};

const STATE_ID = 'response-lifecycle';
const receiptWriteQueueByVfs = new WeakMap<OverlayFs, Promise<unknown>>();

export async function loadResponseLifecycleState(
  vfs: OverlayFs,
): Promise<Record<string, ResponseLifecycleRecord>> {
  try {
    const parsed = parseContextFile(
      await vfs.read(VFS_PATHS.state.responseLifecycle),
    );
    const responses = parsed.meta.responsesById;
    if (typeof responses !== 'object' || responses === null) {
      return {};
    }

    const normalized: Record<string, ResponseLifecycleRecord> = {};
    for (const [responseId, value] of Object.entries(
      responses as Record<string, unknown>,
    )) {
      const record = normalizeRecord(responseId, value);
      if (record) {
        normalized[responseId] = record;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

export async function recordResponseLifecycleReceipt(
  vfs: OverlayFs,
  receipt: ResponseLifecycleReceipt,
): Promise<ResponseLifecycleRecord> {
  return withReceiptWriteLock(vfs, async () => {
    const now = receipt.timestamp;
    const responsesById = mergeResponseLifecycleReceipts(
      await loadResponseLifecycleState(vfs),
      [receipt],
    );
    const next = responsesById[receipt.responseId]!;
    await saveState(vfs, {
      id: STATE_ID,
      tags: ['runtime', 'response-lifecycle'],
      created: now,
      updated: now,
      responsesById,
    });
    return next;
  });
}

export function mergeResponseLifecycleReceipts(
  responsesById: Record<string, ResponseLifecycleRecord>,
  receipts: Iterable<ResponseLifecycleReceipt>,
): Record<string, ResponseLifecycleRecord> {
  const nextResponsesById = { ...responsesById };

  for (const receipt of receipts) {
    nextResponsesById[receipt.responseId] = applyReceipt(
      nextResponsesById[receipt.responseId],
      receipt,
    );
  }

  return nextResponsesById;
}

function applyReceipt(
  existing: ResponseLifecycleRecord | undefined,
  receipt: ResponseLifecycleReceipt,
): ResponseLifecycleRecord {
  const record: ResponseLifecycleRecord = {
    responseId: receipt.responseId,
    scheduledBy: receipt.scheduledBy ?? existing?.scheduledBy,
    sourceFactId: receipt.sourceFactId ?? existing?.sourceFactId,
    sourceFactType: receipt.sourceFactType ?? existing?.sourceFactType,
    traceId: receipt.traceId ?? existing?.traceId,
    intent: receipt.intent ?? existing?.intent,
    urgency: receipt.urgency ?? existing?.urgency,
    waitForIdleTargets:
      receipt.waitForIdleTargets ?? existing?.waitForIdleTargets,
    scheduledAt: existing?.scheduledAt,
    selectedAt: existing?.selectedAt,
    executingAt: existing?.executingAt,
    deliveredAt: existing?.deliveredAt,
    droppedAt: existing?.droppedAt,
    clearedAt: existing?.clearedAt,
    clearedByResponseId:
      receipt.clearedByResponseId ?? existing?.clearedByResponseId,
    dropReason: receipt.dropReason ?? existing?.dropReason,
    draftText: receipt.draftText ?? existing?.draftText,
    lastPhase: existing?.lastPhase ?? receipt.phase,
    updatedAt: receipt.timestamp,
  };

  if (receipt.phase === 'scheduled' && !record.scheduledAt) {
    record.scheduledAt = receipt.timestamp;
  }
  if (receipt.phase === 'selected' && !record.selectedAt) {
    record.selectedAt = receipt.timestamp;
  }
  if (receipt.phase === 'executing' && !record.executingAt) {
    record.executingAt = receipt.timestamp;
  }
  if (receipt.phase === 'delivered' && !record.deliveredAt) {
    record.deliveredAt = receipt.timestamp;
  }
  if (receipt.phase === 'dropped' && !record.droppedAt) {
    record.droppedAt = receipt.timestamp;
  }
  if (receipt.phase === 'cleared' && !record.clearedAt) {
    record.clearedAt = receipt.timestamp;
  }
  if (
    getResponseLifecyclePhaseRank(receipt.phase) >
    getResponseLifecyclePhaseRank(record.lastPhase)
  ) {
    record.lastPhase = receipt.phase;
  }

  return stripUndefinedDeep(record) as ResponseLifecycleRecord;
}

function normalizeRecord(
  responseId: string,
  value: unknown,
): ResponseLifecycleRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const lastPhase = record.lastPhase;
  if (typeof lastPhase !== 'string') {
    return null;
  }

  return stripUndefinedDeep({
    responseId,
    scheduledBy:
      typeof record.scheduledBy === 'string' ? record.scheduledBy : undefined,
    sourceFactId:
      typeof record.sourceFactId === 'string' ? record.sourceFactId : undefined,
    sourceFactType:
      typeof record.sourceFactType === 'string'
        ? record.sourceFactType
        : undefined,
    traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
    intent: typeof record.intent === 'string' ? record.intent : undefined,
    urgency:
      record.urgency === 'none' ||
      record.urgency === 'defer' ||
      record.urgency === 'low' ||
      record.urgency === 'normal' ||
      record.urgency === 'urgent' ||
      record.urgency === 'now'
        ? (record.urgency as ImpulseUrgency)
        : undefined,
    waitForIdleTargets: Array.isArray(record.waitForIdleTargets)
      ? (record.waitForIdleTargets as WaitForIdleTarget[])
      : undefined,
    scheduledAt:
      typeof record.scheduledAt === 'string' ? record.scheduledAt : undefined,
    selectedAt:
      typeof record.selectedAt === 'string' ? record.selectedAt : undefined,
    executingAt:
      typeof record.executingAt === 'string' ? record.executingAt : undefined,
    deliveredAt:
      typeof record.deliveredAt === 'string' ? record.deliveredAt : undefined,
    droppedAt:
      typeof record.droppedAt === 'string' ? record.droppedAt : undefined,
    clearedAt:
      typeof record.clearedAt === 'string' ? record.clearedAt : undefined,
    clearedByResponseId:
      typeof record.clearedByResponseId === 'string'
        ? record.clearedByResponseId
        : undefined,
    dropReason:
      typeof record.dropReason === 'string' ? record.dropReason : undefined,
    draftText:
      typeof record.draftText === 'string' ? record.draftText : undefined,
    lastPhase: lastPhase as ResponseLifecyclePhase,
    updatedAt:
      typeof record.updatedAt === 'string'
        ? record.updatedAt
        : new Date().toISOString(),
  }) as ResponseLifecycleRecord;
}

const TERMINAL_RESPONSE_PHASES: Set<ResponseLifecyclePhase> = new Set([
  'cleared',
  'delivered',
  'dropped',
]);

async function saveState(
  vfs: OverlayFs,
  state: ResponseLifecycleState,
): Promise<void> {
  let content = '';
  let existingMeta: Record<string, unknown> = {};
  try {
    const parsed = parseContextFile(
      await vfs.read(VFS_PATHS.state.responseLifecycle),
    );
    content = parsed.content;
    existingMeta = parsed.meta;
  } catch {
    // ignore missing state file
  }

  // Separate active from pruneable records.
  // Prune if: terminal phase OR stale (>1hr old).
  const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  const activeResponses: Record<string, ResponseLifecycleRecord> = {};
  const terminalResponses: ResponseLifecycleRecord[] = [];
  for (const [responseId, record] of Object.entries(state.responsesById)) {
    const isTerminal = TERMINAL_RESPONSE_PHASES.has(record.lastPhase);
    const isStale =
      record.updatedAt &&
      now - new Date(record.updatedAt).getTime() > STALE_THRESHOLD_MS;
    if (isTerminal || isStale) {
      terminalResponses.push(record);
    } else {
      activeResponses[responseId] = record;
    }
  }

  // Append terminal records to hourly diag log
  if (terminalResponses.length > 0) {
    const logPath = await getOrRotateDiagLog(
      vfs,
      VFS_PATHS.diag.responseLifecycleLogs,
    );
    let existing = '';
    try {
      existing = await vfs.read(logPath);
    } catch {
      // file doesn't exist yet
    }
    const lines = terminalResponses.map((r) => JSON.stringify(r)).join('\n');
    await vfs.write(logPath, existing ? `${existing}\n${lines}` : lines);
  }

  // Only persist active (non-terminal) records in state file
  await vfs.write(
    VFS_PATHS.state.responseLifecycle,
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
        responsesById: activeResponses,
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

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefinedDeep(entry)]),
    ) as T;
  }
  return value;
}
