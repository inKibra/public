import type { ConstructRuntimeState } from '../construct/types';
import type {
  SourceFactClearReason,
  SourceFactJournal,
  SourceFactLifecyclePhase,
  SourceFactLifecycleReceipt,
  SourceFactType,
} from '../source-facts';
import {
  type ConstructLiveResponseHistory,
  getLatestConstructLiveResponseAttempt,
  parseConstructDraftMessages,
} from './selectors';

export type ConstructLiveSourceFactView = {
  factId: string;
  factType: SourceFactType;
  lastPhase: SourceFactLifecyclePhase;
  updatedAt: string;
  previewText?: string;
  traceId?: string;
  journal?: SourceFactJournal;
  queueRef?: string;
  queuedAt?: string;
  reflectedAt?: string;
  spawnedAt?: string;
  clearedAt?: string;
  deliveredAt?: string;
  clearReason?: SourceFactClearReason;
  responseIds: string[];
  impulseIds: string[];
};

export type ConstructTranscriptEntry<
  TRole extends string = string,
  TKind extends string = string,
> = {
  id: string;
  factId?: string;
  role: TRole;
  content: string;
  createdAt: string;
  queuedAt?: string;
  reflectedAt?: string;
  queueRef?: string;
  deliveryState?: string;
  kind: TKind;
  lane?: string;
};

export type ConstructPendingChatMessage = {
  id: string;
  factId?: string;
  message: string;
  createdAt: string;
  queuedAt?: string;
  reflectedAt?: string;
};

export type ConstructRuntimeImpulseView = {
  id: string;
  pool: string;
  profile: string;
  status: 'queued' | 'running' | 'completed' | 'error';
  summary: string;
  startedAt: string;
};

export type ConstructLiveImpulseView = ConstructRuntimeImpulseView & {
  updatedAt: string;
  thinking?: string;
};

export type ConstructLiveResponseStatus = {
  status: 'scheduled' | 'executing';
  scheduledBy?: string;
  updatedAt: string;
};

export type ConstructRuntimeResidencyView = {
  awake: boolean;
  status?: 'starting' | 'active' | 'idle' | 'closing' | 'evicting' | 'dead';
  lastActiveAt?: string;
};

export type ConstructRuntimeSnapshotView = {
  runtimeState: ConstructRuntimeState;
  residency: ConstructRuntimeResidencyView;
  impulses: ConstructRuntimeImpulseView[];
  sourceFacts: ConstructLiveSourceFactView[];
};

export type ConstructRuntimeLiveOverlay = {
  hasLiveRuntimeEvents: boolean;
  liveImpulsesById: Record<string, ConstructLiveImpulseView>;
  liveResponseStatusById: Record<string, ConstructLiveResponseStatus>;
  liveSourceFactsById: Record<string, ConstructLiveSourceFactView>;
  lastRuntimeActivityAt?: string;
  commandInFlight: boolean;
};

const SOURCE_FACT_PHASE_ORDER: Record<SourceFactLifecyclePhase, number> = {
  queued: 0,
  reflected: 1,
  spawned: 2,
  cleared: 3,
  delivered: 4,
};

const LIVE_ONLY_RUNNING_IMPULSE_MS = 5_000;
const IMPULSE_COOLDOWN_MS = 5_000;
const RUNTIME_ACTIVITY_AWAKE_MS = 60_000;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function parseIsoTimestamp(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function pickLaterIso(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return parseIsoTimestamp(right) >= parseIsoTimestamp(left) ? right : left;
}

function pickEarlierIso(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return parseIsoTimestamp(right) <= parseIsoTimestamp(left) ? right : left;
}

function pickLastPhase(
  current: SourceFactLifecyclePhase | undefined,
  incoming: SourceFactLifecyclePhase,
): SourceFactLifecyclePhase {
  if (!current) {
    return incoming;
  }
  return SOURCE_FACT_PHASE_ORDER[incoming] >= SOURCE_FACT_PHASE_ORDER[current]
    ? incoming
    : current;
}

function sortByStartedAtDesc<T extends { startedAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
}

export function hasRecentConstructRuntimeActivity(
  lastRuntimeActivityAt?: string,
): boolean {
  if (!lastRuntimeActivityAt) {
    return false;
  }

  const activityMs = Date.parse(lastRuntimeActivityAt);
  if (!Number.isFinite(activityMs)) {
    return false;
  }

  return Date.now() - activityMs < RUNTIME_ACTIVITY_AWAKE_MS;
}

export function mergeConstructSourceFactView(
  base: ConstructLiveSourceFactView | undefined,
  patch: ConstructLiveSourceFactView,
): ConstructLiveSourceFactView {
  return {
    factId: patch.factId,
    factType: patch.factType,
    lastPhase: pickLastPhase(base?.lastPhase, patch.lastPhase),
    updatedAt:
      pickLaterIso(base?.updatedAt, patch.updatedAt) ?? patch.updatedAt,
    previewText: patch.previewText ?? base?.previewText,
    traceId: patch.traceId ?? base?.traceId,
    journal: patch.journal ?? base?.journal,
    queueRef: patch.queueRef ?? base?.queueRef,
    queuedAt: pickEarlierIso(base?.queuedAt, patch.queuedAt),
    reflectedAt: pickEarlierIso(base?.reflectedAt, patch.reflectedAt),
    spawnedAt: pickEarlierIso(base?.spawnedAt, patch.spawnedAt),
    clearedAt: pickEarlierIso(base?.clearedAt, patch.clearedAt),
    deliveredAt: pickEarlierIso(base?.deliveredAt, patch.deliveredAt),
    clearReason: patch.clearReason ?? base?.clearReason,
    responseIds: uniqueStrings([
      ...(base?.responseIds ?? []),
      ...patch.responseIds,
    ]),
    impulseIds: uniqueStrings([
      ...(base?.impulseIds ?? []),
      ...patch.impulseIds,
    ]),
  };
}

export function applyConstructSourceFactLifecycleReceipt(
  current: ConstructLiveSourceFactView | undefined,
  receipt: SourceFactLifecycleReceipt,
): ConstructLiveSourceFactView {
  const patch: ConstructLiveSourceFactView = {
    factId: receipt.factId,
    factType: receipt.factType,
    lastPhase: receipt.phase,
    updatedAt: receipt.timestamp,
    previewText: receipt.previewText,
    traceId: receipt.traceId,
    journal: receipt.journal,
    queueRef: receipt.queueRef,
    queuedAt: receipt.phase === 'queued' ? receipt.timestamp : undefined,
    reflectedAt: receipt.phase === 'reflected' ? receipt.timestamp : undefined,
    spawnedAt: receipt.phase === 'spawned' ? receipt.timestamp : undefined,
    clearedAt: receipt.phase === 'cleared' ? receipt.timestamp : undefined,
    deliveredAt: receipt.phase === 'delivered' ? receipt.timestamp : undefined,
    clearReason: receipt.clearReason,
    responseIds: receipt.responseId ? [receipt.responseId] : [],
    impulseIds: receipt.impulseId ? [receipt.impulseId] : [],
  };

  return mergeConstructSourceFactView(current, patch);
}

export function sortConstructSourceFacts(
  left: ConstructLiveSourceFactView,
  right: ConstructLiveSourceFactView,
): number {
  const updatedDelta =
    parseIsoTimestamp(right.updatedAt) - parseIsoTimestamp(left.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  const phaseDelta =
    SOURCE_FACT_PHASE_ORDER[right.lastPhase] -
    SOURCE_FACT_PHASE_ORDER[left.lastPhase];
  if (phaseDelta !== 0) {
    return phaseDelta;
  }

  return right.factId.localeCompare(left.factId);
}

export function mergeConstructSourceFacts(
  snapshotSourceFacts: ConstructLiveSourceFactView[],
  liveSourceFactsById: Record<string, ConstructLiveSourceFactView>,
): ConstructLiveSourceFactView[] {
  const mergedById: Record<string, ConstructLiveSourceFactView> = {};

  for (const fact of snapshotSourceFacts) {
    mergedById[fact.factId] = fact;
  }

  for (const fact of Object.values(liveSourceFactsById)) {
    mergedById[fact.factId] = mergeConstructSourceFactView(
      mergedById[fact.factId],
      fact,
    );
  }

  return Object.values(mergedById).sort(sortConstructSourceFacts);
}

export function transcriptHasPendingChat<
  TEntry extends ConstructTranscriptEntry,
  TPending extends ConstructPendingChatMessage,
>(transcript: TEntry[], pending: TPending): boolean {
  if (pending.factId) {
    return transcript.some((entry) => entry.factId === pending.factId);
  }

  const pendingAtMs = Date.parse(pending.queuedAt ?? pending.createdAt);
  return transcript.some((entry) => {
    if (entry.role !== 'user' || entry.content !== pending.message) {
      return false;
    }
    const entryAtMs = Date.parse(entry.queuedAt ?? entry.createdAt);
    if (!Number.isFinite(pendingAtMs) || !Number.isFinite(entryAtMs)) {
      return true;
    }
    return entryAtMs >= pendingAtMs - 5_000;
  });
}

export function sortConstructTranscript<
  TEntry extends ConstructTranscriptEntry,
>(transcript: TEntry[]): TEntry[] {
  return transcript
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftAt = Date.parse(left.entry.queuedAt ?? left.entry.createdAt);
      const rightAt = Date.parse(right.entry.queuedAt ?? right.entry.createdAt);
      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

function deduplicateTranscript<TEntry extends ConstructTranscriptEntry>(
  transcript: TEntry[],
): TEntry[] {
  const seenContent = new Set<string>();
  const seenIds = new Set<string>();
  return transcript.filter((entry) => {
    // Content-based dedup: same role + same content = duplicate
    const contentKey = `${entry.role}:${entry.content}`;
    if (seenContent.has(contentKey)) return false;
    seenContent.add(contentKey);

    // Exact ID dedup
    if (seenIds.has(entry.id)) return false;
    seenIds.add(entry.id);

    return true;
  });
}

export function applyConstructSourceFactsToTranscript<
  TEntry extends ConstructTranscriptEntry,
>(
  transcript: TEntry[],
  sourceFactsById: Record<string, ConstructLiveSourceFactView>,
): TEntry[] {
  if (Object.keys(sourceFactsById).length === 0) {
    return transcript;
  }

  return transcript.map((entry) => {
    if (!entry.factId) {
      return entry;
    }

    const liveFact = sourceFactsById[entry.factId];
    if (!liveFact) {
      return entry;
    }

    return {
      ...entry,
      queueRef: liveFact.queueRef ?? entry.queueRef,
      queuedAt: liveFact.queuedAt ?? entry.queuedAt,
      reflectedAt: liveFact.reflectedAt ?? entry.reflectedAt,
      createdAt: liveFact.queuedAt ?? entry.queuedAt ?? entry.createdAt,
    };
  });
}

export function appendConstructPreviewSourceFactsToTranscript<
  TEntry extends ConstructTranscriptEntry,
>(
  transcript: TEntry[],
  sourceFactsById: Record<string, ConstructLiveSourceFactView>,
): TEntry[] {
  const presentFactIds = new Set(
    transcript
      .map((entry) => entry.factId)
      .filter((factId): factId is string => typeof factId === 'string'),
  );

  const previewEntries = Object.values(sourceFactsById)
    .filter(
      (fact) =>
        fact.factType === 'user_message' &&
        typeof fact.previewText === 'string' &&
        fact.previewText.trim().length > 0 &&
        !presentFactIds.has(fact.factId),
    )
    .map(
      (fact) =>
        ({
          id: fact.factId,
          factId: fact.factId,
          role: 'user',
          content: fact.previewText!,
          createdAt: fact.queuedAt ?? fact.updatedAt,
          queuedAt: fact.queuedAt,
          reflectedAt: fact.reflectedAt,
          queueRef: fact.queueRef,
          kind: 'chat',
        }) as TEntry,
    );

  return [...transcript, ...previewEntries];
}

export function buildConstructTranscriptForView<
  TEntry extends ConstructTranscriptEntry,
  TPending extends ConstructPendingChatMessage,
>(args: {
  transcript: TEntry[];
  pendingChatMessages: TPending[];
  sourceFactsById: Record<string, ConstructLiveSourceFactView>;
  liveResponseHistories?: Record<string, ConstructLiveResponseHistory>;
  liveTranscriptEntries?: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
    factId?: string;
    kind: 'chat' | 'decision' | 'tool' | 'hypno-review';
    lane?: string;
  }>;
}): TEntry[] {
  const transcript = [...args.transcript];
  for (const pending of args.pendingChatMessages) {
    if (transcriptHasPendingChat(transcript, pending)) {
      continue;
    }
    transcript.push({
      id: pending.factId ?? pending.id,
      factId: pending.factId,
      role: 'user',
      content: pending.message,
      createdAt: pending.queuedAt ?? pending.createdAt,
      queuedAt: pending.queuedAt,
      reflectedAt: pending.reflectedAt,
      kind: 'chat',
    } as TEntry);
  }

  // Merge live transcript entries from SSE stream (transcript:entry events)
  if (args.liveTranscriptEntries) {
    const existingIds = new Set(transcript.map((t) => t.id));
    for (const entry of args.liveTranscriptEntries) {
      if (existingIds.has(entry.id)) continue;
      // Also deduplicate by content+role+createdAt to avoid double-showing
      const isDuplicate = transcript.some(
        (t) =>
          t.role === entry.role &&
          t.content === entry.content &&
          t.createdAt === entry.createdAt,
      );
      if (isDuplicate) continue;
      transcript.push({
        id: entry.id,
        factId: entry.factId,
        role: entry.role,
        content: entry.content,
        createdAt: entry.createdAt,
        kind: entry.kind,
        lane: entry.lane,
      } as TEntry);
    }
  }

  const transcriptWithLiveSourceFacts = applyConstructSourceFactsToTranscript(
    transcript,
    args.sourceFactsById,
  );
  const transcriptWithPreviewFacts =
    appendConstructPreviewSourceFactsToTranscript(
      transcriptWithLiveSourceFacts,
      args.sourceFactsById,
    );

  const transcriptWithDeliveredLiveResponses =
    appendDeliveredLiveResponsesToTranscript(
      transcriptWithPreviewFacts,
      args.liveResponseHistories,
    );

  return deduplicateTranscript(
    sortConstructTranscript(transcriptWithDeliveredLiveResponses),
  );
}

export function appendDeliveredLiveResponsesToTranscript<
  TEntry extends ConstructTranscriptEntry,
>(
  transcript: TEntry[],
  liveResponseHistoriesById:
    | Record<string, ConstructLiveResponseHistory>
    | undefined,
): TEntry[] {
  if (!liveResponseHistoriesById) {
    return transcript;
  }

  const existingConstructMessages = new Set(
    transcript
      .filter(
        (entry) => entry.role === 'construct' || entry.role === 'assistant',
      )
      .map((entry) => `${entry.content}`),
  );

  const appended: TEntry[] = [];
  for (const history of Object.values(liveResponseHistoriesById)) {
    if (history.status !== 'delivered') {
      continue;
    }

    const latestAttempt = getLatestConstructLiveResponseAttempt(history);
    const draftMessages = parseConstructDraftMessages(latestAttempt?.draftText);
    if (draftMessages.length === 0) {
      continue;
    }

    const baseMs = Date.parse(latestAttempt?.updatedAt ?? history.updatedAt);
    for (const [index, message] of draftMessages.entries()) {
      const createdAt = Number.isFinite(baseMs)
        ? new Date(baseMs + index).toISOString()
        : (latestAttempt?.updatedAt ?? history.updatedAt);
      const key = `${message.text}@@${createdAt}`;
      if (existingConstructMessages.has(key)) {
        continue;
      }
      existingConstructMessages.add(key);
      appended.push({
        id: `${history.responseId}:delivered:${index + 1}`,
        role: 'assistant',
        content: message.text,
        createdAt,
        kind: 'chat',
      } as TEntry);
    }
  }

  return appended.length > 0 ? [...transcript, ...appended] : transcript;
}

export function mergeConstructRuntimeSnapshot(
  snapshot: ConstructRuntimeSnapshotView,
  overlay: ConstructRuntimeLiveOverlay,
): ConstructRuntimeSnapshotView {
  if (!overlay.hasLiveRuntimeEvents) {
    return snapshot;
  }

  const snapshotImpulseIds = new Set(
    snapshot.impulses.map((impulse) => impulse.id),
  );
  const nowMs = Date.now();
  const recentlyActive =
    hasRecentConstructRuntimeActivity(overlay.lastRuntimeActivityAt) ||
    hasRecentConstructRuntimeActivity(snapshot.residency.lastActiveAt);
  const trustLiveOnlyRunningImpulses =
    snapshot.runtimeState.activeImpulses > 0 ||
    snapshot.residency.awake ||
    overlay.commandInFlight ||
    recentlyActive;
  const liveImpulses = Object.values(overlay.liveImpulsesById)
    .filter((impulse) => {
      if (snapshotImpulseIds.has(impulse.id)) {
        return true;
      }
      const updatedAtMs = Date.parse(impulse.updatedAt);
      if (!Number.isFinite(updatedAtMs)) {
        return impulse.status !== 'running';
      }
      if (impulse.status !== 'running') {
        return nowMs - updatedAtMs <= IMPULSE_COOLDOWN_MS;
      }
      if (!trustLiveOnlyRunningImpulses) {
        return false;
      }
      return nowMs - updatedAtMs <= LIVE_ONLY_RUNNING_IMPULSE_MS;
    })
    .map(({ thinking: _thinking, updatedAt: _updatedAt, ...rest }) => rest);
  const mergedImpulses = sortByStartedAtDesc([
    ...(liveImpulses as ConstructRuntimeImpulseView[]),
    ...snapshot.impulses.filter(
      (impulse) => !overlay.liveImpulsesById[impulse.id],
    ),
  ]).slice(0, 12);

  const responseStatuses = Object.values(overlay.liveResponseStatusById);
  const activeImpulses = mergedImpulses.filter(
    (impulse) => impulse.status === 'running',
  ).length;
  const scheduledResponses = responseStatuses.filter(
    (item) => item.status === 'scheduled',
  ).length;
  const activeResponses = responseStatuses.filter(
    (item) => item.status === 'executing',
  ).length;
  return {
    ...snapshot,
    impulses: mergedImpulses,
    sourceFacts: mergeConstructSourceFacts(
      snapshot.sourceFacts,
      overlay.liveSourceFactsById,
    ),
    runtimeState: {
      ...snapshot.runtimeState,
      activeImpulses,
      scheduledResponses,
      activeResponses,
      schedulerPolling:
        snapshot.runtimeState.schedulerPolling || activeResponses > 0,
      schedulerBusy:
        snapshot.runtimeState.schedulerBusy ||
        activeImpulses > 0 ||
        scheduledResponses > 0 ||
        activeResponses > 0,
    },
    residency: {
      ...snapshot.residency,
      awake:
        snapshot.residency.awake ||
        activeImpulses > 0 ||
        scheduledResponses > 0 ||
        activeResponses > 0 ||
        overlay.commandInFlight ||
        recentlyActive,
      status:
        activeImpulses > 0 ||
        scheduledResponses > 0 ||
        activeResponses > 0 ||
        overlay.commandInFlight ||
        recentlyActive
          ? 'active'
          : snapshot.residency.status,
      lastActiveAt:
        overlay.lastRuntimeActivityAt ?? snapshot.residency.lastActiveAt,
    },
  };
}
