import { splitConstructResponseMessages } from '../construct/message-splitting';

export type ConstructLiveResponseDecisionStatus =
  | 'scheduled'
  | 'running'
  | 'decided'
  | 'delivered'
  | 'dropped'
  | 'cleared'
  | 'executing'
  | 'error';

export type ConstructLiveResponseDecision = {
  id: string;
  responseId: string;
  stage: 'response/decide' | 'scheduler/decide';
  text: string;
  status:
    | 'scheduled'
    | 'running'
    | 'decided'
    | 'delivered'
    | 'dropped'
    | 'cleared';
  scheduledBy?: string;
  decision?: 'respond' | 'wait' | 'drop';
  reason?: string;
  state: 'live' | 'cooldown';
  createdAt: string;
  updatedAt: string;
};

export type ConstructLiveResponseAttempt = {
  id: string;
  responseId: string;
  attemptNumber: number;
  status: ConstructLiveResponseDecisionStatus;
  createdAt: string;
  updatedAt: string;
  /** Scheduler decision reasoning text (from scheduler/decide stage) */
  schedulerDecisionText: string;
  /** Thinking deltas from response/generate stage */
  generateThinking: string;
  /** Generated plain-text draft */
  draftText: string;
  /** Evaluation result from response/evalDraft (repeat + tone + coverage) */
  evalDraftText: string;
  decision?: 'respond' | 'wait' | 'drop';
  reason?: string;
};

export type ConstructLiveResponseHistory = {
  responseId: string;
  scheduledBy?: string;
  intent?: string;
  urgency?: string;
  waitForIdleTargets?: Array<{ kind: string; name: string }>;
  status: ConstructLiveResponseDecisionStatus;
  createdAt: string;
  updatedAt: string;
  attempts: ConstructLiveResponseAttempt[];
};

export type ParsedConstructDraftMessage = {
  id: string;
  text: string;
  label?: string;
};

const TERMINAL_LIVE_RESPONSE_STATUSES =
  new Set<ConstructLiveResponseDecisionStatus>([
    'delivered',
    'dropped',
    'cleared',
    'error',
  ]);

export function isVisibleConstructLiveResponseHistory(
  history: ConstructLiveResponseHistory,
): boolean {
  return !TERMINAL_LIVE_RESPONSE_STATUSES.has(history.status);
}

export function pruneConstructLiveResponseHistories(
  histories: Record<string, ConstructLiveResponseHistory>,
): Record<string, ConstructLiveResponseHistory> {
  const keepIds = Object.values(histories)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt || right.createdAt) -
        Date.parse(left.updatedAt || left.createdAt),
    )
    .slice(0, 8)
    .map((entry) => entry.responseId);

  return Object.fromEntries(
    Object.entries(histories).filter(([responseId]) =>
      keepIds.includes(responseId),
    ),
  );
}

export function buildConstructLiveResponseHistory(
  existing: ConstructLiveResponseHistory | undefined,
  responseId: string,
  eventTs: string,
  patch?: Partial<ConstructLiveResponseHistory>,
): ConstructLiveResponseHistory {
  return {
    responseId,
    status: patch?.status ?? existing?.status ?? 'scheduled',
    scheduledBy: patch?.scheduledBy ?? existing?.scheduledBy,
    intent: patch?.intent ?? existing?.intent,
    urgency: patch?.urgency ?? existing?.urgency,
    waitForIdleTargets:
      patch?.waitForIdleTargets ?? existing?.waitForIdleTargets,
    createdAt: existing?.createdAt ?? eventTs,
    updatedAt: patch?.updatedAt ?? eventTs,
    attempts: patch?.attempts ?? existing?.attempts ?? [],
  };
}

export function upsertConstructLiveResponseAttempt(
  history: ConstructLiveResponseHistory,
  eventTs: string,
  patch?: Partial<ConstructLiveResponseAttempt>,
): ConstructLiveResponseHistory {
  const lastAttempt = history.attempts[history.attempts.length - 1];
  const shouldCreateNewAttempt =
    !lastAttempt || TERMINAL_LIVE_RESPONSE_STATUSES.has(lastAttempt.status);

  const nextAttempt = shouldCreateNewAttempt
    ? {
        id: `${history.responseId}:attempt:${history.attempts.length + 1}`,
        responseId: history.responseId,
        attemptNumber: history.attempts.length + 1,
        status: patch?.status ?? 'running',
        createdAt: eventTs,
        updatedAt: eventTs,
        schedulerDecisionText: patch?.schedulerDecisionText ?? '',
        generateThinking: patch?.generateThinking ?? '',
        draftText: patch?.draftText ?? '',
        evalDraftText: patch?.evalDraftText ?? '',
        decision: patch?.decision,
        reason: patch?.reason,
      }
    : {
        ...lastAttempt,
        ...patch,
        updatedAt: eventTs,
      };

  return {
    ...history,
    status: patch?.status ?? history.status,
    updatedAt: eventTs,
    attempts: shouldCreateNewAttempt
      ? [...history.attempts, nextAttempt]
      : [...history.attempts.slice(0, -1), nextAttempt],
  };
}

export function shouldStartNewConstructLiveResponseAttempt(
  history: ConstructLiveResponseHistory | undefined,
): boolean {
  const latestAttempt = getLatestConstructLiveResponseAttempt(history);
  if (!latestAttempt) {
    return false;
  }

  if (TERMINAL_LIVE_RESPONSE_STATUSES.has(latestAttempt.status)) {
    return true;
  }

  // Start new attempt when eval has run and draft exists (regen cycle)
  return (
    latestAttempt.draftText.trim().length > 0 &&
    latestAttempt.evalDraftText.trim().length > 0
  );
}

export function startNewConstructLiveResponseAttempt(
  history: ConstructLiveResponseHistory,
  eventTs: string,
  patch?: Partial<ConstructLiveResponseAttempt>,
): ConstructLiveResponseHistory {
  const nextAttempt: ConstructLiveResponseAttempt = {
    id: `${history.responseId}:attempt:${history.attempts.length + 1}`,
    responseId: history.responseId,
    attemptNumber: history.attempts.length + 1,
    status: patch?.status ?? 'running',
    createdAt: eventTs,
    updatedAt: eventTs,
    schedulerDecisionText: patch?.schedulerDecisionText ?? '',
    generateThinking: patch?.generateThinking ?? '',
    draftText: patch?.draftText ?? '',
    evalDraftText: patch?.evalDraftText ?? '',
    decision: patch?.decision,
    reason: patch?.reason,
  };

  return {
    ...history,
    status: patch?.status ?? history.status,
    updatedAt: eventTs,
    attempts: [...history.attempts, nextAttempt],
  };
}

export function getLatestConstructLiveResponseAttempt(
  history: ConstructLiveResponseHistory | undefined,
): ConstructLiveResponseAttempt | undefined {
  return history?.attempts[history.attempts.length - 1];
}

export function parseConstructDraftMessages(
  content: string | undefined,
): ParsedConstructDraftMessage[] {
  const raw = content?.trim();
  if (!raw) {
    return [];
  }

  const normalizedBlocks = splitConstructResponseMessages(raw, 10);

  const messages: ParsedConstructDraftMessage[] = [];

  for (const [index, block] of normalizedBlocks.entries()) {
    const text = block.replace(/^MESSAGE\s+\d+:\s*/i, '').trim();
    if (!text) {
      continue;
    }
    messages.push({
      id: `message:${index}`,
      label: undefined,
      text,
    });
  }

  return messages;
}

export function sortConstructViewsByStartedAtDesc<
  T extends { startedAt: string },
>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
}
