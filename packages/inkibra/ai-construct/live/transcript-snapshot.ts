import { decodeCursor } from '@inkibra/streams';
import type { Construct } from '../construct/construct';
import type { ResponseLifecycleRecord } from '../vfs/response-lifecycle-state';
import type { SourceFactRecord } from '../vfs/source-fact-state';
import {
  parseTranscriptLog,
  readDerivedTranscriptEntries,
} from '../vfs/transcript';
import { parseConstructDraftMessages } from './selectors';
import type {
  ConstructDeliveryState,
  ConstructIngressFrontier,
  ConstructQueuedMailboxPreviewEntry,
  ConstructSnapshotTranscriptMessage,
} from './snapshot-types';

type RawTranscriptEntry = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  lane?: string;
  factId?: string;
  impulseId?: string;
  responseId?: string;
};

type IdentifiedTranscriptEntry = RawTranscriptEntry & {
  factId?: string;
  queuedAt?: string;
  reflectedAt?: string;
  queueRef?: string;
};

async function safeListVfsPath(
  construct: Construct,
  path: string,
): Promise<Awaited<ReturnType<ReturnType<Construct['getVfs']>['list']>>> {
  try {
    return await construct.getVfs().list(path);
  } catch {
    return [];
  }
}

export async function listRecentConstructLogPaths(
  construct: Construct,
  baseDir: string,
  limit: number,
): Promise<string[]> {
  if (limit <= 0) {
    return [];
  }

  const recentPaths: string[] = [];
  const pushPath = (path: string) => {
    if (recentPaths.length >= limit) {
      return;
    }
    recentPaths.push(path);
  };

  const rootEntries = await safeListVfsPath(construct, baseDir);

  const directFiles = rootEntries
    .filter((entry) => entry.type === 'file' && entry.path.endsWith('.log'))
    .sort((left, right) => right.path.localeCompare(left.path));
  for (const entry of directFiles) {
    pushPath(entry.path);
  }

  const yearDirs = rootEntries
    .filter((entry) => entry.type === 'directory')
    .sort((left, right) => right.path.localeCompare(left.path));

  for (const yearDir of yearDirs) {
    if (recentPaths.length >= limit) {
      break;
    }

    const weekDirs = (await safeListVfsPath(construct, yearDir.path))
      .filter((entry) => entry.type === 'directory')
      .sort((left, right) => right.path.localeCompare(left.path));

    for (const weekDir of weekDirs) {
      if (recentPaths.length >= limit) {
        break;
      }

      const files = (await safeListVfsPath(construct, weekDir.path))
        .filter((entry) => entry.type === 'file' && entry.path.endsWith('.log'))
        .sort((left, right) => right.path.localeCompare(left.path));

      for (const file of files) {
        pushPath(file.path);
      }
    }
  }

  return recentPaths;
}

export function parseConstructTranscriptEntries(
  rawContent: string,
): RawTranscriptEntry[] {
  return parseTranscriptLog(rawContent).map((entry) => ({
    role: entry.role === 'construct' ? 'assistant' : entry.role,
    content: entry.content,
    createdAt: entry.timestamp.toISOString(),
    lane: entry.lane,
    factId: entry.factId,
    impulseId: entry.impulseId,
    responseId: entry.responseId,
  }));
}

function sortTranscriptUserFacts(
  left: SourceFactRecord,
  right: SourceFactRecord,
): number {
  const leftTime = Date.parse(
    left.queuedAt ?? left.reflectedAt ?? left.updatedAt,
  );
  const rightTime = Date.parse(
    right.queuedAt ?? right.reflectedAt ?? right.updatedAt,
  );
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return left.factId.localeCompare(right.factId);
  }
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.factId.localeCompare(right.factId);
}

export function mergeQueuedMailboxPreviewIntoSourceFacts(
  sourceFacts: Record<string, SourceFactRecord>,
  preview: ConstructQueuedMailboxPreviewEntry[] | undefined,
): Record<string, SourceFactRecord> {
  if (!preview || preview.length === 0) {
    return sourceFacts;
  }

  const merged = { ...sourceFacts };
  for (const entry of preview) {
    if (merged[entry.factId]) {
      continue;
    }
    merged[entry.factId] = {
      factId: entry.factId,
      factType: 'user_message',
      lastPhase: 'queued',
      updatedAt: entry.queuedAt,
      queuedAt: entry.queuedAt,
      queueRef: entry.queueRef,
      previewText: entry.previewText,
    };
  }
  return merged;
}

export function attachConstructTranscriptIdentity(
  transcriptEntries: RawTranscriptEntry[],
  sourceFacts: Record<string, SourceFactRecord>,
): IdentifiedTranscriptEntry[] {
  const transcript: IdentifiedTranscriptEntry[] = transcriptEntries.map(
    (entry) => ({
      ...entry,
    }),
  );
  const reflectedUserFacts = Object.values(sourceFacts)
    .filter(
      (fact) =>
        fact.factType === 'user_message' &&
        fact.journal === 'lane-log' &&
        typeof fact.reflectedAt === 'string',
    )
    .sort(sortTranscriptUserFacts);

  const unmatchedFactIndexes = new Set(
    reflectedUserFacts.map((_, index) => index),
  );

  const normalized = (value: string | undefined): string =>
    typeof value === 'string' ? value.trim() : '';

  const takeMatchingFact = (entry: {
    content: string;
    createdAt: string;
  }): SourceFactRecord | undefined => {
    const entryContent = normalized(entry.content);
    const entryAtMs = Date.parse(entry.createdAt);

    const exactMatches = [...unmatchedFactIndexes]
      .map((index) => ({ index, fact: reflectedUserFacts[index]! }))
      .filter(({ fact }) => normalized(fact.previewText) === entryContent)
      .sort((left, right) => sortTranscriptUserFacts(left.fact, right.fact));

    if (exactMatches.length > 0) {
      const best = exactMatches.at(-1)!;
      unmatchedFactIndexes.delete(best.index);
      return best.fact;
    }

    const fallbackMatches = [...unmatchedFactIndexes]
      .map((index) => ({ index, fact: reflectedUserFacts[index]! }))
      .filter(({ fact }) => {
        const factAtMs = Date.parse(
          fact.queuedAt ?? fact.reflectedAt ?? fact.updatedAt,
        );
        if (!Number.isFinite(entryAtMs) || !Number.isFinite(factAtMs)) {
          return true;
        }
        return Math.abs(entryAtMs - factAtMs) <= 5 * 60_000;
      })
      .sort((left, right) => sortTranscriptUserFacts(left.fact, right.fact));

    if (fallbackMatches.length > 0) {
      const best = fallbackMatches.at(-1)!;
      unmatchedFactIndexes.delete(best.index);
      return best.fact;
    }

    return undefined;
  };

  for (
    let transcriptIndex = transcript.length - 1;
    transcriptIndex >= 0;
    transcriptIndex -= 1
  ) {
    const entry = transcript[transcriptIndex];
    if (!entry || entry.role !== 'user') {
      continue;
    }
    const fact = takeMatchingFact(entry);
    if (!fact) {
      continue;
    }
    transcript[transcriptIndex] = {
      ...entry,
      factId: fact.factId,
      queuedAt: fact.queuedAt,
      reflectedAt: fact.reflectedAt,
      queueRef: fact.queueRef,
      createdAt: fact.queuedAt ?? entry.createdAt,
    };
  }

  const presentFactIds = new Set(
    transcript
      .map((entry) => entry.factId)
      .filter((factId): factId is string => typeof factId === 'string'),
  );

  const queuedOnlyUserFacts = Object.values(sourceFacts)
    .filter(
      (fact) =>
        fact.factType === 'user_message' &&
        typeof fact.reflectedAt !== 'string' &&
        typeof fact.previewText === 'string' &&
        fact.previewText.trim().length > 0 &&
        !presentFactIds.has(fact.factId),
    )
    .sort(sortTranscriptUserFacts);

  for (const fact of queuedOnlyUserFacts) {
    transcript.push({
      role: 'user',
      content: fact.previewText!,
      createdAt: fact.queuedAt ?? fact.updatedAt,
      factId: fact.factId,
      queuedAt: fact.queuedAt,
      reflectedAt: fact.reflectedAt,
      queueRef: fact.queueRef,
    });
  }

  return transcript;
}

export function sortConstructSnapshotTranscript(
  transcript: IdentifiedTranscriptEntry[],
): IdentifiedTranscriptEntry[] {
  return transcript
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftAt = Date.parse(left.entry.queuedAt ?? left.entry.createdAt);
      const rightAt = Date.parse(right.entry.queuedAt ?? right.entry.createdAt);
      if (
        Number.isFinite(leftAt) &&
        Number.isFinite(rightAt) &&
        leftAt !== rightAt
      ) {
        return leftAt - rightAt;
      }
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function deriveConstructTranscriptDeliveryState(args: {
  queuedAt?: string;
  reflectedAt?: string;
  queueRef?: string;
  frontier?: ConstructIngressFrontier;
}): ConstructDeliveryState | undefined {
  const { queuedAt, reflectedAt, queueRef, frontier } = args;
  if (!queuedAt && !reflectedAt) {
    return undefined;
  }

  const committedCursor = frontier?.committedCursor;
  if (queueRef && committedCursor) {
    const queued = decodeCursor(queueRef);
    const committed = decodeCursor(committedCursor);
    if (queued && committed && committed.seq >= queued.seq) {
      return 'durable';
    }
  }

  if (reflectedAt) {
    return 'seen';
  }

  return 'sent';
}

export async function buildConstructSnapshotTranscript(args: {
  construct: Construct;
  sourceFacts: Record<string, SourceFactRecord>;
  responseLifecycleById?: Record<string, ResponseLifecycleRecord>;
  mailboxPreview?: ConstructQueuedMailboxPreviewEntry[];
  frontier?: ConstructIngressFrontier;
  transcriptLimit?: number;
  transcriptLogWindow?: number;
}): Promise<ConstructSnapshotTranscriptMessage[]> {
  const sourceFacts = mergeQueuedMailboxPreviewIntoSourceFacts(
    args.sourceFacts,
    args.mailboxPreview,
  );

  const transcriptEntries: RawTranscriptEntry[] = (
    await readDerivedTranscriptEntries(args.construct.getVfs())
  ).map((entry) => ({
    role: entry.role === 'construct' ? 'assistant' : entry.role,
    content: entry.content,
    createdAt: entry.timestamp.toISOString(),
    lane: entry.lane,
    factId: entry.factId,
    impulseId: entry.impulseId,
    responseId: entry.responseId,
  }));

  const transcriptEntriesWithIdentity = sortConstructSnapshotTranscript(
    attachConstructTranscriptIdentity(transcriptEntries, sourceFacts),
  );

  const transcript: ConstructSnapshotTranscriptMessage[] =
    transcriptEntriesWithIdentity
      .slice(-(args.transcriptLimit ?? 60))
      .map((entry, index) => ({
        id:
          entry.responseId ??
          entry.factId ??
          `${entry.lane ?? 'conversation'}:${entry.createdAt}:${index}`,
        factId: entry.factId,
        role: entry.role,
        content: entry.content,
        createdAt: entry.createdAt,
        queuedAt: entry.queuedAt,
        reflectedAt: entry.reflectedAt,
        queueRef: entry.queueRef,
        deliveryState:
          entry.role === 'user'
            ? deriveConstructTranscriptDeliveryState({
                queuedAt: entry.queuedAt,
                reflectedAt: entry.reflectedAt,
                queueRef: entry.queueRef,
                frontier: args.frontier,
              })
            : undefined,
        kind: (entry.role === 'system' ? 'decision' : 'chat') as
          | 'decision'
          | 'chat',
        lane: entry.lane,
      }));

  return appendAwaitingDurableResponseDrafts({
    transcript,
    sourceFacts,
    frontier: args.frontier,
    responseLifecycleById: args.responseLifecycleById,
  }).slice(-(args.transcriptLimit ?? 60));
}

export function appendAwaitingDurableResponseDrafts(args: {
  transcript: ConstructSnapshotTranscriptMessage[];
  sourceFacts: Record<string, SourceFactRecord>;
  frontier?: ConstructIngressFrontier;
  responseLifecycleById?: Record<string, ResponseLifecycleRecord>;
}): ConstructSnapshotTranscriptMessage[] {
  if (!args.responseLifecycleById) {
    return args.transcript;
  }

  const appended = [...args.transcript];
  const deliveredResponses = Object.values(args.responseLifecycleById)
    .filter(
      (record) =>
        record.lastPhase === 'delivered' &&
        typeof record.sourceFactId === 'string' &&
        typeof record.draftText === 'string' &&
        record.draftText.trim().length > 0,
    )
    .sort(
      (left, right) =>
        Date.parse(left.deliveredAt ?? left.updatedAt) -
        Date.parse(right.deliveredAt ?? right.updatedAt),
    );

  for (const record of deliveredResponses) {
    const sourceFact =
      record.sourceFactId && args.sourceFacts[record.sourceFactId]
        ? args.sourceFacts[record.sourceFactId]
        : undefined;
    if (!sourceFact) {
      continue;
    }

    const deliveryState = deriveConstructTranscriptDeliveryState({
      queuedAt: sourceFact.queuedAt,
      reflectedAt: sourceFact.reflectedAt,
      queueRef: sourceFact.queueRef,
      frontier: args.frontier,
    });
    if (deliveryState === 'durable') {
      continue;
    }

    const draftMessages = parseConstructDraftMessages(record.draftText);
    if (draftMessages.length === 0) {
      continue;
    }

    const anchorAt =
      record.deliveredAt ?? sourceFact.deliveredAt ?? sourceFact.updatedAt;
    const anchorMs = Date.parse(anchorAt);
    const matchAnchorMs = Date.parse(
      sourceFact.spawnedAt ?? sourceFact.reflectedAt ?? sourceFact.updatedAt,
    );

    for (const [index, message] of draftMessages.entries()) {
      const createdAt = Number.isFinite(anchorMs)
        ? new Date(anchorMs + index).toISOString()
        : anchorAt;
      if (
        hasMatchingAssistantTranscriptMessage(appended, {
          text: message.text,
          anchorMs: Number.isFinite(matchAnchorMs) ? matchAnchorMs : anchorMs,
        })
      ) {
        continue;
      }

      appended.push({
        id: `${record.responseId}:snapshot-delivered:${index + 1}`,
        role: 'assistant',
        content: message.text,
        createdAt,
        deliveryState: 'seen',
        kind: 'chat',
      });
    }
  }

  return appended.sort((left, right) => {
    const leftAt = Date.parse(left.queuedAt ?? left.createdAt);
    const rightAt = Date.parse(right.queuedAt ?? right.createdAt);
    if (
      Number.isFinite(leftAt) &&
      Number.isFinite(rightAt) &&
      leftAt !== rightAt
    ) {
      return leftAt - rightAt;
    }
    return left.id.localeCompare(right.id);
  });
}

function hasMatchingAssistantTranscriptMessage(
  transcript: ConstructSnapshotTranscriptMessage[],
  args: { text: string; anchorMs: number },
): boolean {
  return transcript.some((entry) => {
    if (
      entry.role !== 'assistant' ||
      entry.content.trim() !== args.text.trim()
    ) {
      return false;
    }
    if (!Number.isFinite(args.anchorMs)) {
      return true;
    }
    const createdAtMs = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAtMs)) {
      return false;
    }
    return Math.abs(createdAtMs - args.anchorMs) <= 60_000;
  });
}
