import { isConstructLiveDebugFact, logConstructLiveDebug } from './debug';
import {
  deriveDeliveryStateFromFrontier,
  deriveTranscriptEntryDeliveryStatus,
  pickStrongerDeliveryState,
} from './delivery-state';
import type {
  ConstructLiveImpulseView,
  ConstructLiveSourceFactView,
  ConstructPendingChatMessage,
  ConstructRuntimeImpulseView,
} from './projection';
import type { ConstructLiveDecisionEntry } from './runtime-state';
import type { ConstructLiveResponseHistory } from './selectors';
import type {
  ConstructDeliveryState,
  ConstructIngressFrontier,
} from './snapshot-types';

const PASSIVE_IN_FLIGHT_GRACE_MS = 90_000;

export type ConstructInFlightStage =
  | 'sending'
  | 'sent'
  | 'seen'
  | 'impulse-running'
  | 'scheduler-running'
  | 'scheduled'
  | 'responding'
  | 'awaiting-durable'
  | 'dropped'
  | 'durable';

export type ConstructInFlightItem = {
  id: string;
  factId?: string;
  message: string;
  deliveryState?: ConstructDeliveryState;
  stage: ConstructInFlightStage;
  queuedAt?: string;
  reflectedAt?: string;
  updatedAt: string;
  impulseIds: string[];
  responseIds: string[];
  activeImpulseIds: string[];
  activeResponseIds: string[];
  scheduledByImpulseIds: string[];
  schedulerText?: string;
  urgency?: string;
  thinkingText?: string;
  selectedResponseId?: string;
};

type InFlightTranscriptEntry = {
  id: string;
  factId?: string;
  role: string;
  content: string;
  createdAt: string;
  queuedAt?: string;
  reflectedAt?: string;
  queueRef?: string;
  deliveryState?: ConstructDeliveryState;
  kind?: string;
};

type InFlightScheduledResponse = {
  id: string;
  scheduledBy: string;
  intent: string;
  urgency: string;
};

type InFlightResponseHistory = Pick<
  ConstructLiveResponseHistory,
  'responseId' | 'scheduledBy' | 'status' | 'updatedAt' | 'urgency'
>;

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function parseTs(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function latestIso(...values: Array<string | undefined>): string {
  const valid = values.filter(
    (value): value is string => typeof value === 'string',
  );
  if (valid.length === 0) {
    return new Date().toISOString();
  }
  return valid.sort((a, b) => parseTs(b) - parseTs(a))[0]!;
}

function isTerminalResponseStatus(status: string | undefined): boolean {
  return (
    status === 'delivered' ||
    status === 'dropped' ||
    status === 'cleared' ||
    status === 'error'
  );
}

function isDroppedResponseStatus(status: string | undefined): boolean {
  return status === 'dropped' || status === 'cleared' || status === 'error';
}

function buildBaseRows(args: {
  transcript: InFlightTranscriptEntry[];
  pendingChatMessages?: ConstructPendingChatMessage[];
}): InFlightTranscriptEntry[] {
  const rows = args.transcript.filter(
    (entry) => entry.role === 'user' && (entry.kind ?? 'chat') === 'chat',
  );
  const existingIds = new Set(rows.map((row) => row.factId ?? row.id));

  for (const pending of args.pendingChatMessages ?? []) {
    const id = pending.factId ?? pending.id;
    if (existingIds.has(id)) {
      continue;
    }
    rows.push({
      id,
      factId: pending.factId,
      role: 'user',
      content: pending.message,
      createdAt: pending.createdAt,
      queuedAt: pending.queuedAt,
      reflectedAt: pending.reflectedAt,
    });
  }

  return rows;
}

export function buildConstructInFlightItems(args: {
  transcript: InFlightTranscriptEntry[];
  pendingChatMessages?: ConstructPendingChatMessage[];
  sourceFacts: ConstructLiveSourceFactView[];
  frontier?: ConstructIngressFrontier;
  runtimeImpulses: ConstructRuntimeImpulseView[];
  liveImpulsesById: Record<string, ConstructLiveImpulseView>;
  scheduledResponses: InFlightScheduledResponse[];
  liveDecisionEntries: ConstructLiveDecisionEntry[];
  liveResponseHistories: InFlightResponseHistory[];
  liveImpulseThinkingById?: Record<string, string>;
}): ConstructInFlightItem[] {
  const baseRows = buildBaseRows(args);
  const sourceFactsById = Object.fromEntries(
    args.sourceFacts.map((fact) => [fact.factId, fact]),
  );
  const runtimeImpulsesById = Object.fromEntries(
    args.runtimeImpulses.map((impulse) => [impulse.id, impulse]),
  );

  const items: ConstructInFlightItem[] = [];

  for (const row of baseRows) {
    const sourceFact = row.factId ? sourceFactsById[row.factId] : undefined;
    const impulseIds = unique(sourceFact?.impulseIds ?? []);
    const responseIds = unique(sourceFact?.responseIds ?? []);

    const activeImpulseIds = impulseIds.filter((id) => {
      const liveImpulse = args.liveImpulsesById[id];
      const runtimeImpulse = runtimeImpulsesById[id];
      return (
        liveImpulse?.status === 'running' ||
        runtimeImpulse?.status === 'running'
      );
    });

    const linkedResponseHistories = args.liveResponseHistories.filter(
      (history) =>
        responseIds.includes(history.responseId) ||
        (history.scheduledBy
          ? impulseIds.includes(history.scheduledBy)
          : false),
    );
    const activeResponseIds = unique(
      linkedResponseHistories
        .filter((history) => !isTerminalResponseStatus(history.status))
        .map((history) => history.responseId),
    );

    const linkedDecisions = args.liveDecisionEntries.filter(
      (decision) =>
        responseIds.includes(decision.responseId) ||
        (decision.scheduledBy
          ? impulseIds.includes(decision.scheduledBy)
          : false),
    );
    const liveDecision = linkedDecisions.find(
      (decision) => decision.state === 'live',
    );

    const linkedScheduledResponses = args.scheduledResponses.filter(
      (response) =>
        responseIds.includes(response.id) ||
        impulseIds.includes(response.scheduledBy),
    );
    const hasScheduledHistory = linkedResponseHistories.some(
      (history) =>
        history.status === 'scheduled' ||
        history.status === 'running' ||
        history.status === 'decided',
    );
    const scheduledByImpulseIds = unique(
      linkedScheduledResponses.map((response) => response.scheduledBy),
    );

    const deliveryState = pickStrongerDeliveryState(
      row.deliveryState,
      deriveTranscriptEntryDeliveryStatus({
        deliveryState: row.deliveryState,
        queuedAt: row.queuedAt,
        reflectedAt: row.reflectedAt,
      }),
      deriveDeliveryStateFromFrontier({
        queuedAt: row.queuedAt ?? sourceFact?.queuedAt,
        reflectedAt: row.reflectedAt ?? sourceFact?.reflectedAt,
        queueRef: row.queueRef ?? sourceFact?.queueRef,
        frontier: args.frontier,
      }),
    );

    let stage: ConstructInFlightStage;
    const hasDeliveredOutcome =
      sourceFact?.lastPhase === 'delivered' ||
      Boolean(sourceFact?.deliveredAt) ||
      linkedResponseHistories.some((history) => history.status === 'delivered');
    const hasDroppedOutcome = linkedResponseHistories.some((history) =>
      isDroppedResponseStatus(history.status),
    );
    if (
      linkedResponseHistories.some((history) => history.status === 'executing')
    ) {
      stage = 'responding';
    } else if (liveDecision?.state === 'live') {
      stage = 'scheduler-running';
    } else if (linkedScheduledResponses.length > 0 || hasScheduledHistory) {
      stage = 'scheduled';
    } else if (activeImpulseIds.length > 0) {
      stage = 'impulse-running';
    } else if (hasDroppedOutcome && deliveryState !== 'durable') {
      stage = 'dropped';
    } else if (hasDeliveredOutcome && deliveryState !== 'durable') {
      stage = 'awaiting-durable';
    } else if (deliveryState === 'durable') {
      stage = 'durable';
    } else if (deliveryState === 'seen') {
      stage = 'seen';
    } else if (deliveryState === 'sent') {
      stage = 'sent';
    } else {
      stage = 'sending';
    }

    if (
      deliveryState === 'durable' &&
      activeImpulseIds.length === 0 &&
      activeResponseIds.length === 0 &&
      linkedScheduledResponses.length === 0 &&
      !hasScheduledHistory &&
      !liveDecision
    ) {
      continue;
    }

    const thinkingText =
      activeImpulseIds
        .map((id) => args.liveImpulseThinkingById?.[id]?.trim())
        .find((value): value is string => Boolean(value)) ?? liveDecision?.text;

    const updatedAt = latestIso(
      row.reflectedAt,
      row.queuedAt,
      sourceFact?.updatedAt,
      liveDecision?.updatedAt,
      ...linkedResponseHistories.map((history) => history.updatedAt),
      ...activeImpulseIds.map((id) => args.liveImpulsesById[id]?.updatedAt),
    );

    const hasActiveWork =
      activeImpulseIds.length > 0 ||
      activeResponseIds.length > 0 ||
      linkedScheduledResponses.length > 0 ||
      hasScheduledHistory ||
      Boolean(liveDecision);
    const updatedAtMs = parseTs(updatedAt);
    const isPassiveAndStale =
      !hasActiveWork &&
      Number.isFinite(updatedAtMs) &&
      Date.now() - updatedAtMs > PASSIVE_IN_FLIGHT_GRACE_MS;

    if (isConstructLiveDebugFact(row.factId)) {
      logConstructLiveDebug('inFlightDerivation', {
        row,
        sourceFact,
        frontier: args.frontier,
        linkedResponseHistories,
        linkedScheduledResponses,
        liveDecision,
        activeImpulseIds,
        activeResponseIds,
        hasDeliveredOutcome,
        hasDroppedOutcome,
        deliveryFromTranscript: deriveTranscriptEntryDeliveryStatus({
          deliveryState: row.deliveryState,
          queuedAt: row.queuedAt,
          reflectedAt: row.reflectedAt,
        }),
        deliveryFromFrontier: deriveDeliveryStateFromFrontier({
          queuedAt: row.queuedAt ?? sourceFact?.queuedAt,
          reflectedAt: row.reflectedAt ?? sourceFact?.reflectedAt,
          queueRef: row.queueRef ?? sourceFact?.queueRef,
          frontier: args.frontier,
        }),
        finalDeliveryState: deliveryState,
        finalStage: stage,
        isPassiveAndStale,
      });
    }

    if (isPassiveAndStale) {
      continue;
    }

    items.push({
      id: row.factId ?? row.id,
      factId: row.factId,
      message: row.content,
      deliveryState,
      stage,
      queuedAt: row.queuedAt ?? sourceFact?.queuedAt,
      reflectedAt: row.reflectedAt ?? sourceFact?.reflectedAt,
      updatedAt,
      impulseIds,
      responseIds,
      activeImpulseIds,
      activeResponseIds,
      scheduledByImpulseIds,
      schedulerText: liveDecision?.text,
      urgency:
        linkedResponseHistories[0]?.urgency ??
        linkedScheduledResponses[0]?.urgency,
      thinkingText,
      selectedResponseId:
        linkedResponseHistories[0]?.responseId ??
        linkedScheduledResponses[0]?.id,
    });
  }

  return items.sort(
    (left, right) => parseTs(right.updatedAt) - parseTs(left.updatedAt),
  );
}
