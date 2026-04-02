import { createUtil } from '@inkibra/fsm-utils';
import { decodeCursor } from '@inkibra/streams';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
import type { ConstructEvent, ResponseThinkingStage } from '../construct/types';
import type {
  SourceFactClearReason,
  SourceFactJournal,
  SourceFactLifecyclePhase,
  SourceFactType,
} from '../source-facts';
import {
  getConstructLiveDebugFactId,
  hasConstructLiveDebugTarget,
  isConstructLiveDebugFact,
  logConstructLiveDebug,
} from './debug';
import {
  deriveDeliveryStateFromFrontier,
  deriveTranscriptEntryDeliveryStatus,
  pickStrongerDeliveryState,
  prunePendingAfterSnapshotTakeover,
} from './delivery-state';
import {
  type ConstructLiveEventState,
  createConstructLiveEventState,
  reduceConstructEvent,
  reduceResponseDelta,
  reduceResponseThinkingDelta,
} from './event-reducer';
import {
  buildConstructInFlightItems,
  type ConstructInFlightItem,
} from './in-flight';
import {
  applyConstructSourceFactLifecycleReceipt,
  buildConstructTranscriptForView,
  type ConstructPendingChatMessage,
  type ConstructRuntimeSnapshotView,
  mergeConstructRuntimeSnapshot,
} from './projection';
import type {
  ConstructIngressLifecycleView,
  ConstructLiveDecisionEntry,
} from './runtime-state';
import {
  type ConstructLiveResponseHistory,
  isVisibleConstructLiveResponseHistory,
} from './selectors';
import type {
  ConstructIngressFrontier,
  ConstructSnapshot,
} from './snapshot-types';

export type ConstructRuntimeScheduledResponseView = {
  id: string;
  scheduledBy: string;
  intent: string;
  urgency: import('../impulse/types').ImpulseUrgency;
  waitForIdleTargets?: Array<{ kind: 'pool' | 'profile'; name: string }>;
  scheduledAt: string;
};

export type ConstructRuntimeDecisionView = {
  id: string;
  stage: string;
  intent: string;
  rationale: string;
  createdAt: string;
};

export type ConstructRuntimeToolEventView = {
  id: string;
  tool: string;
  command: string;
  output: string;
  createdAt: string;
};

export type ConstructRuntimeFullSnapshotView = ConstructRuntimeSnapshotView & {
  scheduledResponses: ConstructRuntimeScheduledResponseView[];
  decisions: ConstructRuntimeDecisionView[];
  toolLog: ConstructRuntimeToolEventView[];
};

export type ConstructViewSnapshot = {
  cursor?: string;
  constructSnapshot: ConstructSnapshot;
  runtimeSnapshot: ConstructRuntimeFullSnapshotView;
};

function getSnapshotFrontier(
  snapshot: ConstructSnapshot,
): ConstructIngressFrontier {
  return snapshot.frontier ?? {};
}

export type ConstructViewIngressIssue = {
  level: 'warning' | 'error';
  message: string;
  ref?: string;
  ts: string;
};

export type ConstructViewState = {
  cursor?: string;
  constructSnapshot: ConstructSnapshot;
  runtimeSnapshot: ConstructRuntimeFullSnapshotView;
  frontier: ConstructIngressFrontier;
  pendingChatMessages: ConstructPendingChatMessage[];
  live: ConstructLiveEventState;
  ingressByRef: Record<string, ConstructIngressLifecycleView>;
  latestIngressIssue?: ConstructViewIngressIssue;
};

export type ConstructViewProjection = {
  cursor?: string;
  constructSnapshot: ConstructSnapshot;
  runtimeSnapshot: ConstructRuntimeFullSnapshotView;
  liveResponseHistories: ConstructLiveResponseHistory[];
  liveDecisionEntries: ConstructLiveDecisionEntry[];
  inFlightItems: ConstructInFlightItem[];
  scheduledResponsesForView: ConstructRuntimeScheduledResponseView[];
  liveImpulseThinkingById: Record<string, string>;
  commandInFlight: boolean;
  defaultSelectedResponseId?: string;
  ingressIssue?: ConstructViewIngressIssue;
};

export type ConstructViewSourceFactLifecycleEvent = {
  constructId: string;
  factId: string;
  factType: SourceFactType;
  phase: SourceFactLifecyclePhase;
  ts: string;
  previewText?: string;
  traceId?: string;
  journal?: SourceFactJournal;
  queueRef?: string;
  impulseId?: string;
  responseId?: string;
  clearReason?: SourceFactClearReason;
};

function isConstructViewState(value: unknown): value is ConstructViewState {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'constructSnapshot' in value &&
      'runtimeSnapshot' in value &&
      'live' in value,
  );
}

function sortResponseHistories(
  historiesById: Record<string, ConstructLiveResponseHistory>,
): ConstructLiveResponseHistory[] {
  return Object.values(historiesById)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt || right.createdAt) -
        Date.parse(left.updatedAt || left.createdAt),
    )
    .filter(isVisibleConstructLiveResponseHistory);
}

function buildScheduledResponsesForView(
  runtimeSnapshot: ConstructRuntimeFullSnapshotView,
  liveResponseHistories: Record<string, ConstructLiveResponseHistory>,
): ConstructRuntimeScheduledResponseView[] {
  const byId = new Map(
    runtimeSnapshot.scheduledResponses.map((response) => [
      response.id,
      response,
    ]),
  );

  for (const history of Object.values(liveResponseHistories)) {
    if (
      history.status === 'scheduled' ||
      history.status === 'running' ||
      history.status === 'decided'
    ) {
      byId.set(history.responseId, {
        id: history.responseId,
        scheduledBy: history.scheduledBy ?? 'unknown',
        intent: history.intent ?? 'response',
        urgency:
          history.urgency === 'none' ||
          history.urgency === 'defer' ||
          history.urgency === 'low' ||
          history.urgency === 'normal' ||
          history.urgency === 'urgent' ||
          history.urgency === 'now'
            ? history.urgency
            : 'normal',
        waitForIdleTargets:
          history.waitForIdleTargets as ConstructRuntimeScheduledResponseView['waitForIdleTargets'],
        scheduledAt: history.createdAt,
      });
    }

    if (
      history.status === 'delivered' ||
      history.status === 'dropped' ||
      history.status === 'cleared' ||
      history.status === 'error'
    ) {
      byId.delete(history.responseId);
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(right.scheduledAt) - Date.parse(left.scheduledAt),
  );
}

function buildIngressQueueRefsByOpId(
  ingressByRef: Record<string, ConstructIngressLifecycleView>,
): Record<string, string> {
  const entries = Object.values(ingressByRef)
    .filter((entry) => entry.opId && entry.ref)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''),
    );

  const byOpId: Record<string, string> = {};
  for (const entry of entries) {
    if (!byOpId[entry.opId]) {
      byOpId[entry.opId] = entry.ref;
    }
  }

  return byOpId;
}

function pickNewerCursor(
  current: string | undefined,
  incoming: string | undefined,
): string | undefined {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }

  const currentDecoded = decodeCursor(current);
  const incomingDecoded = decodeCursor(incoming);
  if (!currentDecoded || !incomingDecoded) {
    return incoming;
  }
  if (currentDecoded.streamKey !== incomingDecoded.streamKey) {
    return incoming;
  }

  return incomingDecoded.seq >= currentDecoded.seq ? incoming : current;
}

function computeConstructViewProjection(
  state: Readonly<ConstructViewState>,
): ConstructViewProjection {
  const runtimeSnapshot = mergeConstructRuntimeSnapshot(state.runtimeSnapshot, {
    hasLiveRuntimeEvents: state.live.hasLiveRuntimeEvents,
    liveImpulsesById: state.live.liveImpulsesById,
    liveResponseStatusById: state.live.liveResponseStatusById,
    liveSourceFactsById: state.live.liveSourceFactsById,
    lastRuntimeActivityAt: state.live.lastRuntimeActivityAt,
    commandInFlight: state.live.commandInFlight,
  }) as ConstructRuntimeFullSnapshotView;

  const sourceFactsById = Object.fromEntries(
    runtimeSnapshot.sourceFacts.map((fact) => [fact.factId, fact]),
  );
  const ingressQueueRefsByOpId = buildIngressQueueRefsByOpId(
    state.ingressByRef,
  );
  const transcript = buildConstructTranscriptForView({
    transcript: [...state.constructSnapshot.transcript],
    pendingChatMessages: [...state.pendingChatMessages],
    sourceFactsById,
    liveResponseHistories: state.live.liveResponseHistoriesById,
    liveTranscriptEntries: state.live.liveTranscriptEntries,
  }).map((entry) => {
    if (entry.role !== 'user') {
      return entry;
    }

    const sourceFact = entry.factId ? sourceFactsById[entry.factId] : undefined;
    const queuedAt = entry.queuedAt ?? sourceFact?.queuedAt;
    const reflectedAt = entry.reflectedAt ?? sourceFact?.reflectedAt;
    const queueRef =
      entry.queueRef ??
      sourceFact?.queueRef ??
      (entry.factId ? ingressQueueRefsByOpId[entry.factId] : undefined);

    return {
      ...entry,
      queuedAt,
      reflectedAt,
      queueRef,
      deliveryState: pickStrongerDeliveryState(
        entry.deliveryState,
        deriveTranscriptEntryDeliveryStatus({
          deliveryState: entry.deliveryState,
          queuedAt,
          reflectedAt,
        }),
        deriveDeliveryStateFromFrontier({
          queuedAt,
          reflectedAt,
          queueRef,
          frontier: state.frontier,
        }),
      ),
    };
  });

  const liveResponseHistories = sortResponseHistories(
    state.live.liveResponseHistoriesById,
  );
  const scheduledResponsesForView = buildScheduledResponsesForView(
    runtimeSnapshot,
    state.live.liveResponseHistoriesById,
  );
  const inFlightItems = buildConstructInFlightItems({
    transcript,
    pendingChatMessages: [...state.pendingChatMessages],
    sourceFacts: [...runtimeSnapshot.sourceFacts],
    frontier: state.frontier,
    runtimeImpulses: [...runtimeSnapshot.impulses],
    liveImpulsesById: state.live.liveImpulsesById,
    scheduledResponses: scheduledResponsesForView,
    liveDecisionEntries: state.live.liveDecisionEntries,
    liveResponseHistories,
    liveImpulseThinkingById: state.live.liveImpulseThinkingById,
  });

  const debugFactId = getConstructLiveDebugFactId();
  if (debugFactId) {
    const transcriptRow = transcript.find(
      (entry) => entry.factId === debugFactId,
    );
    const sourceFact = sourceFactsById[debugFactId];
    const inFlightItem = inFlightItems.find(
      (item) => item.factId === debugFactId,
    );
    const ingressQueueRef = ingressQueueRefsByOpId[debugFactId];
    if (transcriptRow || sourceFact || inFlightItem || ingressQueueRef) {
      logConstructLiveDebug('projection', {
        cursor: state.cursor,
        frontier: state.frontier,
        ingressQueueRef,
        transcriptRow,
        sourceFact,
        inFlightItem,
      });
    }
  }

  // Merge live hypno state — use live if newer than the snapshot
  const snapshotHypno = state.constructSnapshot.hypno;
  const liveHypno = state.live.liveHypno;
  const hypno =
    liveHypno &&
    Date.parse(liveHypno.updatedAt) >= Date.parse(snapshotHypno.updatedAt)
      ? { ...snapshotHypno, ...liveHypno }
      : snapshotHypno;

  // Append live nap tool log entries (accumulated since last snapshot refresh)
  const toolLog =
    state.live.liveNapToolLogEntries.length > 0
      ? [
          ...state.constructSnapshot.toolLog,
          ...state.live.liveNapToolLogEntries,
        ]
      : state.constructSnapshot.toolLog;

  return {
    cursor: state.cursor,
    constructSnapshot: {
      ...state.constructSnapshot,
      runtimeState: runtimeSnapshot.runtimeState,
      transcript,
      hypno,
      toolLog,
    },
    runtimeSnapshot,
    liveResponseHistories,
    liveDecisionEntries: state.live.liveDecisionEntries,
    inFlightItems,
    scheduledResponsesForView,
    liveImpulseThinkingById: state.live.liveImpulseThinkingById,
    commandInFlight: state.live.commandInFlight,
    defaultSelectedResponseId: state.live.defaultSelectedResponseId,
    ingressIssue: state.latestIngressIssue,
  };
}

export const constructViewUtil = createUtil<
  ConstructViewState,
  ConstructViewSnapshot,
  never,
  Error,
  {}
>({
  options: {},
  is: isConstructViewState,
  validate: (_prev, _next) => ok(true as const),
  fromCreateData: (data) =>
    ok({
      cursor: data.cursor,
      constructSnapshot: data.constructSnapshot,
      runtimeSnapshot: data.runtimeSnapshot,
      frontier: getSnapshotFrontier(data.constructSnapshot),
      pendingChatMessages: [],
      live: createConstructLiveEventState(),
      ingressByRef: {},
      latestIngressIssue: undefined,
    }),
});

const replaceSnapshotInstruction =
  constructViewUtil.makeInstructionHandler<ConstructViewSnapshot>(
    'replaceSnapshot',
    (state, snapshot) =>
      ok({
        ...state,
        cursor: snapshot.cursor ?? state.cursor,
        constructSnapshot: snapshot.constructSnapshot,
        runtimeSnapshot: snapshot.runtimeSnapshot,
        frontier: getSnapshotFrontier(snapshot.constructSnapshot),
        pendingChatMessages: prunePendingAfterSnapshotTakeover(
          state.pendingChatMessages,
          snapshot.constructSnapshot.transcript,
        ),
      }),
  );

const replaceConstructSnapshotInstruction =
  constructViewUtil.makeInstructionHandler<{
    constructSnapshot: ConstructSnapshot;
  }>('replaceConstructSnapshot', (state, params) =>
    ok({
      ...state,
      constructSnapshot: params.constructSnapshot,
      frontier: getSnapshotFrontier(params.constructSnapshot),
      pendingChatMessages: prunePendingAfterSnapshotTakeover(
        state.pendingChatMessages,
        params.constructSnapshot.transcript,
      ),
      // Clear live nap/hypno state — the incoming snapshot is now authoritative.
      // liveHypno: cleared so the snapshot's hypno field takes effect cleanly.
      // liveNapToolLogEntries: cleared so the snapshot's toolLog is not duplicated.
      live: {
        ...state.live,
        liveHypno: undefined,
        liveNapToolLogEntries: [],
      },
    }),
  );

const replaceRuntimeSnapshotInstruction =
  constructViewUtil.makeInstructionHandler<{
    runtimeSnapshot: ConstructRuntimeFullSnapshotView;
  }>('replaceRuntimeSnapshot', (state, params) =>
    ok({
      ...state,
      runtimeSnapshot: params.runtimeSnapshot,
    }),
  );

const enqueuePendingChatInstruction = constructViewUtil.makeInstructionHandler<{
  pendingChatMessage: ConstructPendingChatMessage;
}>('enqueuePendingChat', (state, params) =>
  ok({
    ...state,
    pendingChatMessages: [
      ...state.pendingChatMessages,
      params.pendingChatMessage,
    ],
  }),
);

const reconcilePendingChatInstruction =
  constructViewUtil.makeInstructionHandler<{
    pendingId: string;
    patch: Partial<ConstructPendingChatMessage>;
  }>('reconcilePendingChat', (state, params) =>
    ok({
      ...state,
      pendingChatMessages: state.pendingChatMessages.map((pending) =>
        pending.id === params.pendingId
          ? { ...pending, ...params.patch }
          : pending,
      ),
    }),
  );

const dropPendingChatInstruction = constructViewUtil.makeInstructionHandler<{
  pendingId: string;
}>('dropPendingChat', (state, params) =>
  ok({
    ...state,
    pendingChatMessages: state.pendingChatMessages.filter(
      (pending) => pending.id !== params.pendingId,
    ),
  }),
);

const observeCursorInstruction = constructViewUtil.makeInstructionHandler<{
  cursor?: string;
}>('observeCursor', (state, params) =>
  ok(
    !params.cursor || params.cursor === state.cursor
      ? state
      : {
          ...state,
          cursor: params.cursor,
        },
  ),
);

const noteRuntimeActivityInstruction =
  constructViewUtil.makeInstructionHandler<{
    ts: string;
  }>('noteRuntimeActivity', (state, params) =>
    ok({
      ...state,
      live: {
        ...state.live,
        hasLiveRuntimeEvents: true,
        lastRuntimeActivityAt: params.ts,
      },
    }),
  );

const applyConstructEventInstruction =
  constructViewUtil.makeInstructionHandler<{
    event: ConstructEvent;
    ts: string;
  }>('applyConstructEvent', (state, params) =>
    ok({
      ...state,
      live: reduceConstructEvent(state.live, params.event, params.ts),
    }),
  );

const applyResponseThinkingDeltaInstruction =
  constructViewUtil.makeInstructionHandler<{
    responseId: string;
    stage: ResponseThinkingStage;
    delta: string;
    ts: string;
  }>('applyResponseThinkingDelta', (state, params) =>
    ok({
      ...state,
      live: reduceResponseThinkingDelta(
        state.live,
        params.responseId,
        params.stage,
        params.delta,
        params.ts,
      ),
    }),
  );

const applyResponseDeltaInstruction = constructViewUtil.makeInstructionHandler<{
  responseId: string;
  delta: string;
  ts: string;
}>('applyResponseDelta', (state, params) =>
  ok({
    ...state,
    live: reduceResponseDelta(
      state.live,
      params.responseId,
      params.delta,
      params.ts,
    ),
  }),
);

const applySourceFactLifecycleInstruction =
  constructViewUtil.makeInstructionHandler<{
    event: ConstructViewSourceFactLifecycleEvent;
  }>('applySourceFactLifecycle', (state, params) => {
    const event = params.event;
    const previous = state.live.liveSourceFactsById[event.factId];
    const nextSourceFact = applyConstructSourceFactLifecycleReceipt(previous, {
      constructId: event.constructId,
      factId: event.factId,
      factType: event.factType,
      phase: event.phase,
      timestamp: event.ts,
      previewText: event.previewText,
      traceId: event.traceId,
      journal: event.journal,
      queueRef: event.queueRef,
      impulseId: event.impulseId,
      responseId: event.responseId,
      clearReason: event.clearReason,
    });
    if (isConstructLiveDebugFact(event.factId)) {
      logConstructLiveDebug('sourceFactLifecycle', {
        event,
        previous,
        nextSourceFact,
      });
    }
    return ok({
      ...state,
      live: {
        ...state.live,
        hasLiveRuntimeEvents: true,
        lastRuntimeActivityAt: event.ts,
        liveSourceFactsById: {
          ...state.live.liveSourceFactsById,
          [event.factId]: nextSourceFact,
        },
      },
    });
  });

const ingressAcceptedInstruction = constructViewUtil.makeInstructionHandler<{
  ref: string;
  opId: string;
  opKind: string;
  ts: string;
}>('ingressAccepted', (state, params) =>
  ok({
    ...state,
    ingressByRef: {
      ...state.ingressByRef,
      [params.ref]: {
        ref: params.ref,
        opId: params.opId,
        opKind: params.opKind,
        status: 'accepted',
        attempts: 0,
        updatedAt: params.ts,
      },
    },
  }),
);

const ingressCommittedInstruction = constructViewUtil.makeInstructionHandler<{
  ref: string;
  opId: string;
  opKind: string;
  ts: string;
}>('ingressCommitted', (state, params) =>
  ok({
    ...state,
    ingressByRef: {
      ...state.ingressByRef,
      [params.ref]: {
        ref: params.ref,
        opId: params.opId,
        opKind: params.opKind,
        status: 'committed',
        attempts: state.ingressByRef[params.ref]?.attempts ?? 0,
        updatedAt: params.ts,
      },
    },
    latestIngressIssue:
      state.latestIngressIssue?.ref === params.ref
        ? undefined
        : state.latestIngressIssue,
  }),
);

const ingressStalledInstruction = constructViewUtil.makeInstructionHandler<{
  ref: string;
  opId: string;
  opKind: string;
  reason:
    | 'commit_timeout'
    | 'invalid_ref'
    | 'failed_permanent'
    | 'failed_not_open';
  ts: string;
}>('ingressStalled', (state, params) =>
  ok({
    ...state,
    ingressByRef: {
      ...state.ingressByRef,
      [params.ref]: {
        ref: params.ref,
        opId: params.opId,
        opKind: params.opKind,
        status: 'stalled',
        attempts: state.ingressByRef[params.ref]?.attempts ?? 0,
        updatedAt: params.ts,
        error: params.reason,
      },
    },
    latestIngressIssue: {
      level: params.reason === 'commit_timeout' ? 'warning' : 'error',
      message:
        params.reason === 'invalid_ref'
          ? `Construct ingress stalled for ${params.opKind}: invalid ref.`
          : `Construct is taking longer than expected for ${params.opKind}.`,
      ref: params.ref,
      ts: params.ts,
    },
  }),
);

const projectConstructView = constructViewUtil.makeView(
  'projectConstructView',
  (state) => ok(computeConstructViewProjection(state as ConstructViewState)),
);

export function unwrapConstructViewResult<T>(
  result: Result<T, unknown>,
  fallback: T,
): T {
  return result.isOk() ? result.value : fallback;
}

export function createConstructViewState(
  snapshot: ConstructViewSnapshot,
): ConstructViewState {
  return unwrapConstructViewResult(constructViewUtil.create!(snapshot), {
    cursor: snapshot.cursor,
    constructSnapshot: snapshot.constructSnapshot,
    runtimeSnapshot: snapshot.runtimeSnapshot,
    frontier: getSnapshotFrontier(snapshot.constructSnapshot),
    pendingChatMessages: [],
    live: createConstructLiveEventState(),
    ingressByRef: {},
    latestIngressIssue: undefined,
  });
}

export function replaceConstructViewSnapshot(
  state: ConstructViewState,
  snapshot: ConstructViewSnapshot,
): ConstructViewState {
  return unwrapConstructViewResult(
    replaceSnapshotInstruction(state, snapshot),
    state,
  );
}

export function replaceConstructViewConstructSnapshot(
  state: ConstructViewState,
  constructSnapshot: ConstructSnapshot,
): ConstructViewState {
  return unwrapConstructViewResult(
    replaceConstructSnapshotInstruction(state, { constructSnapshot }),
    state,
  );
}

export function replaceConstructViewRuntimeSnapshot(
  state: ConstructViewState,
  runtimeSnapshot: ConstructRuntimeFullSnapshotView,
): ConstructViewState {
  return unwrapConstructViewResult(
    replaceRuntimeSnapshotInstruction(state, { runtimeSnapshot }),
    state,
  );
}

export function queueConstructPendingChatMessage(
  state: ConstructViewState,
  pendingChatMessage: ConstructPendingChatMessage,
): ConstructViewState {
  return unwrapConstructViewResult(
    enqueuePendingChatInstruction(state, { pendingChatMessage }),
    state,
  );
}

export function reconcileConstructPendingChatMessage(
  state: ConstructViewState,
  pendingId: string,
  patch: Partial<ConstructPendingChatMessage>,
): ConstructViewState {
  return unwrapConstructViewResult(
    reconcilePendingChatInstruction(state, { pendingId, patch }),
    state,
  );
}

export function dropConstructPendingChatMessage(
  state: ConstructViewState,
  pendingId: string,
): ConstructViewState {
  return unwrapConstructViewResult(
    dropPendingChatInstruction(state, { pendingId }),
    state,
  );
}

export function observeConstructViewCursor(
  state: ConstructViewState,
  cursor: string | undefined,
): ConstructViewState {
  return unwrapConstructViewResult(
    observeCursorInstruction(state, { cursor }),
    state,
  );
}

export function noteConstructViewRuntimeActivity(
  state: ConstructViewState,
  ts: string,
): ConstructViewState {
  return unwrapConstructViewResult(
    noteRuntimeActivityInstruction(state, { ts }),
    state,
  );
}

export function applyConstructViewConstructEvent(
  state: ConstructViewState,
  event: ConstructEvent,
  ts: string,
): ConstructViewState {
  return unwrapConstructViewResult(
    applyConstructEventInstruction(state, { event, ts }),
    state,
  );
}

export function applyConstructViewResponseThinkingDelta(
  state: ConstructViewState,
  responseId: string,
  stage: ResponseThinkingStage,
  delta: string,
  ts: string,
): ConstructViewState {
  return unwrapConstructViewResult(
    applyResponseThinkingDeltaInstruction(state, {
      responseId,
      stage,
      delta,
      ts,
    }),
    state,
  );
}

export function applyConstructViewResponseDelta(
  state: ConstructViewState,
  responseId: string,
  delta: string,
  ts: string,
): ConstructViewState {
  return unwrapConstructViewResult(
    applyResponseDeltaInstruction(state, { responseId, delta, ts }),
    state,
  );
}

export function applyConstructViewSourceFactLifecycle(
  state: ConstructViewState,
  event: ConstructViewSourceFactLifecycleEvent,
): ConstructViewState {
  return unwrapConstructViewResult(
    applySourceFactLifecycleInstruction(state, { event }),
    state,
  );
}

export function advanceConstructViewFrontier(
  state: ConstructViewState,
  frontier: ConstructIngressFrontier,
): ConstructViewState {
  const nextState = {
    ...state,
    frontier: {
      processedCursor: pickNewerCursor(
        state.frontier.processedCursor,
        frontier.processedCursor,
      ),
      committedCursor: pickNewerCursor(
        state.frontier.committedCursor,
        frontier.committedCursor,
      ),
    },
  };

  if (hasConstructLiveDebugTarget()) {
    const debugFactId = getConstructLiveDebugFactId();
    logConstructLiveDebug('frontierAdvanced', {
      incoming: frontier,
      previousFrontier: state.frontier,
      nextFrontier: nextState.frontier,
      debugFactId,
      liveSourceFact: debugFactId
        ? nextState.live.liveSourceFactsById[debugFactId]
        : undefined,
      transcriptRow: debugFactId
        ? nextState.constructSnapshot.transcript.find(
            (entry) => entry.factId === debugFactId,
          )
        : undefined,
    });
  }

  return nextState;
}

export function noteConstructViewIngressAccepted(
  state: ConstructViewState,
  params: { ref: string; opId: string; opKind: string; ts: string },
): ConstructViewState {
  return unwrapConstructViewResult(
    ingressAcceptedInstruction(state, params),
    state,
  );
}

export function noteConstructViewIngressCommitted(
  state: ConstructViewState,
  params: { ref: string; opId: string; opKind: string; ts: string },
): ConstructViewState {
  return unwrapConstructViewResult(
    ingressCommittedInstruction(state, params),
    state,
  );
}

export function noteConstructViewIngressStalled(
  state: ConstructViewState,
  params: {
    ref: string;
    opId: string;
    opKind: string;
    reason:
      | 'commit_timeout'
      | 'invalid_ref'
      | 'failed_permanent'
      | 'failed_not_open';
    ts: string;
  },
): ConstructViewState {
  return unwrapConstructViewResult(
    ingressStalledInstruction(state, params),
    state,
  );
}

export function projectConstructViewState(
  state: ConstructViewState,
): ConstructViewProjection {
  return unwrapConstructViewResult(
    projectConstructView(state, undefined),
    computeConstructViewProjection(state),
  );
}
