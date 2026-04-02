/**
 * Construct Live Event Reducer
 *
 * This module provides a pure state machine that reduces construct SSE events
 * into a live state shape. It is the single source of truth for mapping
 * construct events to client-visible state.
 *
 * Consumers (persona-lab.tsx, CLI, tests) should use these functions rather
 * than maintaining their own event dispatch logic.
 */

import type { ConstructEvent, ResponseThinkingStage } from '../construct/types';
import type {
  SchedulerDecision,
  SchedulerDecisionMetrics,
} from '../scheduler/types';
import type {
  ConstructLiveImpulseView,
  ConstructLiveResponseStatus,
  ConstructLiveSourceFactView,
} from './projection';
import {
  appendConstructLiveDelta,
  appendConstructLiveImpulseDelta,
  type ConstructLiveDecisionEntry,
  formatConstructPerceptionSummary,
  mergeConstructLiveResponseStatuses,
  pruneConstructLiveDecisionEntries,
  pruneConstructLiveImpulses,
  pruneConstructLiveImpulseThinking,
} from './runtime-state';
import {
  buildConstructLiveResponseHistory,
  type ConstructLiveResponseHistory,
  getLatestConstructLiveResponseAttempt,
  pruneConstructLiveResponseHistories,
  shouldStartNewConstructLiveResponseAttempt,
  startNewConstructLiveResponseAttempt,
  upsertConstructLiveResponseAttempt,
} from './selectors';
import type {
  ConstructHypnoSnapshot,
  ConstructToolLogEvent,
} from './snapshot-types';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

/**
 * The construct-generic live event state. This shape is owned by
 * ai-construct/live and does not include UI-specific concerns like
 * refreshToken, SSE cursor, or ingress lifecycle views.
 */
export type ConstructLiveEventState = {
  hasLiveRuntimeEvents: boolean;
  lastRuntimeActivityAt?: string;
  liveImpulsesById: Record<string, ConstructLiveImpulseView>;
  liveImpulseThinkingById: Record<string, string>;
  liveResponseStatusById: Record<string, ConstructLiveResponseStatus>;
  liveResponseHistoriesById: Record<string, ConstructLiveResponseHistory>;
  liveSourceFactsById: Record<string, ConstructLiveSourceFactView>;
  liveDecisionEntries: ConstructLiveDecisionEntry[];
  defaultSelectedResponseId?: string;
  commandInFlight: boolean;
  /**
   * Live-derived hypno state — overrides snapshot.hypno when newer.
   * Cleared on snapshot takeover.
   */
  liveHypno?: ConstructHypnoSnapshot;
  /**
   * Nap tool log entries received since the last snapshot refresh.
   * Appended to snapshot.toolLog in the projection.
   * Cleared on snapshot takeover.
   */
  liveNapToolLogEntries: ConstructToolLogEvent[];
  /**
   * Transcript entries received via transcript:entry events.
   * These are authoritative — they carry both user and construct messages
   * so the transcript can be fully reconstructed from the stream alone.
   */
  liveTranscriptEntries: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
    factId?: string;
    kind: 'chat' | 'decision' | 'tool' | 'hypno-review';
    lane?: string;
  }>;
};

export function createConstructLiveEventState(): ConstructLiveEventState {
  return {
    hasLiveRuntimeEvents: false,
    liveImpulsesById: {},
    liveImpulseThinkingById: {},
    liveResponseStatusById: {},
    liveResponseHistoriesById: {},
    liveSourceFactsById: {},
    liveDecisionEntries: [],
    commandInFlight: false,
    liveNapToolLogEntries: [],
    liveTranscriptEntries: [],
  };
}

// ---------------------------------------------------------------------------
// Hypno stage helper
// ---------------------------------------------------------------------------

function mapLiveHypnoStage(rawStage: string): ConstructHypnoSnapshot['stage'] {
  if (rawStage === 'analyze') return 'analyze';
  if (rawStage === 'propose') return 'propose';
  if (rawStage === 'commit') return 'commit';
  if (rawStage === 'completed') return 'completed';
  return 'review';
}

// ---------------------------------------------------------------------------
// Event sets
// ---------------------------------------------------------------------------

/**
 * Events that should trigger a snapshot refresh.
 */
export const CONSTRUCT_REFRESH_EVENTS = new Set<string>([
  'response:delivered',
  'response:dropped',
  'response:cleared',
  'response:batch_completed',
  'scheduler:decided',
  'source-fact:cleared',
  'nap:completed',
  'hypno:completed',
  'compaction:completed',
]);

/**
 * Events that mark the start of a command (for commandInFlight tracking).
 */
export const CONSTRUCT_STARTS_COMMAND_EVENTS = new Set<string>([
  'nap:started',
  'hypno:started',
  'compaction:started',
]);

/**
 * Events that mark the end of a command (for commandInFlight tracking).
 */
export const CONSTRUCT_ENDS_COMMAND_EVENTS = new Set<string>([
  'nap:completed',
  'nap:cancelled',
  'hypno:completed',
  'hypno:cancelled',
  'hypno:error',
  'compaction:completed',
  'compaction:failed',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function appendConstructLiveDeltaValue(
  current: string,
  delta: string,
): string {
  return appendConstructLiveDelta(current, delta);
}

// ---------------------------------------------------------------------------
// Main reducer — construct events
// ---------------------------------------------------------------------------

/**
 * Reduce a single construct event into the live event state.
 */
export function reduceConstructEvent(
  state: ConstructLiveEventState,
  event: ConstructEvent,
  eventTs: string,
): ConstructLiveEventState {
  let next: ConstructLiveEventState = {
    ...state,
    hasLiveRuntimeEvents: true,
    lastRuntimeActivityAt: eventTs,
  };

  const eventRecord = asRecord(event);

  // Command lifecycle
  if (CONSTRUCT_STARTS_COMMAND_EVENTS.has(event.type)) {
    next = { ...next, commandInFlight: true };
  }
  if (CONSTRUCT_ENDS_COMMAND_EVENTS.has(event.type)) {
    next = { ...next, commandInFlight: false };
  }

  // ── Nap lifecycle ───────────────────────────────────────────────────────

  if (event.type === 'nap:started') {
    // Reset live nap tool log for this new nap session
    next = { ...next, liveNapToolLogEntries: [] };
  }

  if (event.type === 'nap:tool') {
    const command =
      typeof eventRecord?.command === 'string' ? eventRecord.command : '';
    const output =
      typeof eventRecord?.output === 'string' ? eventRecord.output : '';
    const entry: ConstructToolLogEvent = {
      id: `live-nap-tool:${eventTs}:${next.liveNapToolLogEntries.length}`,
      tool: 'nap',
      command,
      output,
      createdAt: eventTs,
    };
    next = {
      ...next,
      liveNapToolLogEntries: [...next.liveNapToolLogEntries, entry],
    };
  }

  // ── Hypno lifecycle ─────────────────────────────────────────────────────

  if (event.type === 'hypno:started') {
    next = {
      ...next,
      liveNapToolLogEntries: [],
      liveHypno: {
        active: true,
        stage: 'idle',
        pendingPlan: false,
        acceptRequiresConfirmation: false,
        lastReviewReply: undefined,
        updatedAt: eventTs,
      },
    };
  }

  if (event.type === 'hypno:stage-change') {
    const rawStage =
      typeof eventRecord?.stage === 'string' ? eventRecord.stage : '';
    next = {
      ...next,
      liveHypno: {
        ...(next.liveHypno ?? {
          active: true,
          pendingPlan: false,
          acceptRequiresConfirmation: false,
        }),
        active: true,
        stage: mapLiveHypnoStage(rawStage),
        updatedAt: eventTs,
      } as ConstructHypnoSnapshot,
    };
  }

  if (event.type === 'hypno:review-reply') {
    const reply =
      typeof eventRecord?.reply === 'string' ? eventRecord.reply : '';
    next = {
      ...next,
      liveHypno: {
        ...(next.liveHypno ?? {
          active: true,
          stage: 'review' as const,
          pendingPlan: false,
          acceptRequiresConfirmation: false,
        }),
        lastReviewReply: reply,
        updatedAt: eventTs,
      } as ConstructHypnoSnapshot,
    };
  }

  if (event.type === 'hypno:plan-updated') {
    next = {
      ...next,
      liveHypno: {
        ...(next.liveHypno ?? {
          active: true,
          stage: 'review' as const,
          acceptRequiresConfirmation: false,
        }),
        pendingPlan: true,
        acceptRequiresConfirmation: true,
        updatedAt: eventTs,
      } as ConstructHypnoSnapshot,
    };
  }

  if (event.type === 'hypno:completed') {
    next = {
      ...next,
      liveHypno: {
        ...(next.liveHypno ?? {
          pendingPlan: false,
          acceptRequiresConfirmation: false,
        }),
        active: false,
        stage: 'completed' as const,
        updatedAt: eventTs,
      } as ConstructHypnoSnapshot,
    };
  }

  if (event.type === 'hypno:cancelled' || event.type === 'hypno:error') {
    next = {
      ...next,
      liveHypno: {
        ...(next.liveHypno ?? {
          pendingPlan: false,
          acceptRequiresConfirmation: false,
        }),
        active: false,
        stage: 'idle' as const,
        updatedAt: eventTs,
      } as ConstructHypnoSnapshot,
    };
  }

  // ── Impulse lifecycle ───────────────────────────────────────────────────

  if (event.type === 'impulse:started') {
    const impulseId =
      typeof eventRecord?.impulseId === 'string' ? eventRecord.impulseId : '';
    if (impulseId) {
      const existing = next.liveImpulsesById[impulseId];
      const summary = formatConstructPerceptionSummary(eventRecord?.perception);
      next = {
        ...next,
        liveImpulsesById: pruneConstructLiveImpulses(
          {
            ...next.liveImpulsesById,
            [impulseId]: {
              id: impulseId,
              pool: existing?.pool ?? 'live',
              profile: existing?.profile ?? 'runtime',
              status: 'running',
              summary: summary || existing?.summary || 'running impulse',
              startedAt: existing?.startedAt ?? eventTs,
              thinking: next.liveImpulseThinkingById[impulseId] ?? '',
              updatedAt: eventTs,
            },
          },
          eventTs,
        ),
      };
    }
  }

  if (event.type === 'impulse:thinking') {
    const impulseId =
      typeof eventRecord?.impulseId === 'string' ? eventRecord.impulseId : '';
    const delta =
      typeof eventRecord?.delta === 'string' ? eventRecord.delta : '';
    if (impulseId && delta) {
      const nextThinking = appendConstructLiveImpulseDelta(
        next.liveImpulseThinkingById,
        impulseId,
        delta,
      );
      const existing = next.liveImpulsesById[impulseId];
      next = {
        ...next,
        liveImpulseThinkingById: nextThinking,
        liveImpulsesById: pruneConstructLiveImpulses(
          {
            ...next.liveImpulsesById,
            [impulseId]: {
              id: impulseId,
              pool: existing?.pool ?? 'live',
              profile: existing?.profile ?? 'runtime',
              status: 'running',
              summary: existing?.summary ?? 'processing impulse',
              startedAt: existing?.startedAt ?? eventTs,
              thinking: nextThinking[impulseId] ?? '',
              updatedAt: eventTs,
            },
          },
          eventTs,
        ),
      };
    }
  }

  if (event.type === 'impulse:completed' || event.type === 'impulse:error') {
    const impulseId =
      typeof eventRecord?.impulseId === 'string' ? eventRecord.impulseId : '';
    if (impulseId) {
      const nextImpulses = { ...next.liveImpulsesById };
      delete nextImpulses[impulseId];
      const pruned = pruneConstructLiveImpulses(nextImpulses, eventTs);
      next = {
        ...next,
        liveImpulsesById: pruned,
        liveImpulseThinkingById: pruneConstructLiveImpulseThinking(
          next.liveImpulseThinkingById,
          pruned,
        ),
      };
    }
  }

  // ── Response lifecycle ──────────────────────────────────────────────────

  if (event.type === 'response:scheduled') {
    const responseId =
      typeof eventRecord?.responseId === 'string' ? eventRecord.responseId : '';
    const scheduledBy =
      typeof eventRecord?.scheduledBy === 'string'
        ? eventRecord.scheduledBy
        : undefined;
    if (responseId) {
      const existingDecision = next.liveDecisionEntries.find(
        (e) => e.responseId === responseId,
      );
      const scheduledEntry: ConstructLiveDecisionEntry = {
        id: existingDecision?.id ?? `live:${responseId}:decide`,
        responseId,
        stage: 'scheduler/decide',
        text:
          existingDecision?.text ??
          (scheduledBy
            ? `scheduled from ${scheduledBy}`
            : 'scheduled for response decision'),
        status: 'scheduled',
        scheduledBy,
        state: 'live',
        createdAt: existingDecision?.createdAt ?? eventTs,
        updatedAt: eventTs,
      };
      next = {
        ...next,
        liveResponseStatusById: mergeConstructLiveResponseStatuses(
          next.liveResponseStatusById,
          responseId,
          { status: 'scheduled', scheduledBy, updatedAt: eventTs },
        ),
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          [
            scheduledEntry,
            ...next.liveDecisionEntries.filter(
              (e) => e.responseId !== responseId,
            ),
          ].slice(0, 4),
          eventTs,
        ),
        liveResponseHistoriesById: pruneConstructLiveResponseHistories({
          ...next.liveResponseHistoriesById,
          [responseId]: buildConstructLiveResponseHistory(
            next.liveResponseHistoriesById[responseId],
            responseId,
            eventTs,
            {
              status: 'scheduled',
              scheduledBy,
              intent:
                typeof eventRecord?.intent === 'string'
                  ? eventRecord.intent
                  : undefined,
              urgency:
                eventRecord?.urgency === 'none' ||
                eventRecord?.urgency === 'defer' ||
                eventRecord?.urgency === 'low' ||
                eventRecord?.urgency === 'normal' ||
                eventRecord?.urgency === 'urgent' ||
                eventRecord?.urgency === 'now'
                  ? (eventRecord.urgency as string)
                  : undefined,
              waitForIdleTargets: Array.isArray(eventRecord?.waitForIdleTargets)
                ? (eventRecord.waitForIdleTargets as ConstructLiveResponseHistory['waitForIdleTargets'])
                : undefined,
              updatedAt: eventTs,
            },
          ),
        }),
        defaultSelectedResponseId: responseId,
      };
    }
  }

  if (event.type === 'response:selected') {
    const responseId =
      typeof eventRecord?.responseId === 'string' ? eventRecord.responseId : '';
    if (responseId) {
      const existingDecision = next.liveDecisionEntries.find(
        (e) => e.responseId === responseId,
      );
      const scheduledBy =
        next.liveResponseStatusById[responseId]?.scheduledBy ??
        existingDecision?.scheduledBy;
      const runningEntry: ConstructLiveDecisionEntry = {
        id: existingDecision?.id ?? `live:${responseId}:decide`,
        responseId,
        stage: 'scheduler/decide',
        text:
          existingDecision?.text ||
          (scheduledBy
            ? `deciding whether to answer ${scheduledBy}`
            : 'running scheduler decision'),
        status: 'running',
        scheduledBy,
        state: 'live',
        createdAt: existingDecision?.createdAt ?? eventTs,
        updatedAt: eventTs,
      };
      next = {
        ...next,
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          [
            runningEntry,
            ...next.liveDecisionEntries
              .filter((e) => e.responseId !== responseId)
              .map((e) =>
                e.state === 'live' ? { ...e, state: 'cooldown' as const } : e,
              ),
          ].slice(0, 4),
          eventTs,
        ),
        liveResponseHistoriesById: pruneConstructLiveResponseHistories({
          ...next.liveResponseHistoriesById,
          [responseId]: upsertConstructLiveResponseAttempt(
            buildConstructLiveResponseHistory(
              next.liveResponseHistoriesById[responseId],
              responseId,
              eventTs,
              { status: 'running', scheduledBy, updatedAt: eventTs },
            ),
            eventTs,
            { status: 'running' },
          ),
        }),
        defaultSelectedResponseId: responseId,
      };
    }
  }

  // ── Scheduler decision events ───────────────────────────────────────────

  if (event.type === 'scheduler:decided') {
    const decision = event.decision as SchedulerDecision | undefined;
    const metrics = (event as { metrics?: SchedulerDecisionMetrics }).metrics;
    if (!decision) return next;

    if (decision.action === 'act') {
      // For each respondTo: mark as decided/respond
      for (const responseId of decision.respondTo) {
        const existingDecision = next.liveDecisionEntries.find(
          (e) => e.responseId === responseId,
        );
        const scheduledBy =
          next.liveResponseStatusById[responseId]?.scheduledBy ??
          existingDecision?.scheduledBy;
        const metricsText = metrics
          ? ` [gate:${metrics.gateDelayMs}ms ai:${metrics.aiDecisionMs}ms]`
          : '';
        const decidedEntry: ConstructLiveDecisionEntry = {
          id: existingDecision?.id ?? `live:${responseId}:decide`,
          responseId,
          stage: 'scheduler/decide',
          text: `respond${metricsText} · ${decision.reason}`,
          status: 'decided',
          scheduledBy,
          decision: 'respond',
          reason: decision.reason,
          state: 'live',
          createdAt: existingDecision?.createdAt ?? eventTs,
          updatedAt: eventTs,
        };
        next = {
          ...next,
          liveDecisionEntries: pruneConstructLiveDecisionEntries(
            [
              decidedEntry,
              ...next.liveDecisionEntries
                .filter((e) => e.responseId !== responseId)
                .map((e) =>
                  e.state === 'live' ? { ...e, state: 'cooldown' as const } : e,
                ),
            ].slice(0, 4),
            eventTs,
          ),
          liveResponseHistoriesById: pruneConstructLiveResponseHistories({
            ...next.liveResponseHistoriesById,
            [responseId]: upsertConstructLiveResponseAttempt(
              buildConstructLiveResponseHistory(
                next.liveResponseHistoriesById[responseId],
                responseId,
                eventTs,
                { status: 'decided', scheduledBy, updatedAt: eventTs },
              ),
              eventTs,
              {
                status: 'decided',
                decision: 'respond',
                reason: decision.reason,
              },
            ),
          }),
          defaultSelectedResponseId: responseId,
        };
      }
      // For each drop: terminal-drop
      for (const responseId of decision.drop) {
        const nextStatuses = { ...next.liveResponseStatusById };
        delete nextStatuses[responseId];
        next = {
          ...next,
          liveResponseStatusById: nextStatuses,
          liveDecisionEntries: pruneConstructLiveDecisionEntries(
            next.liveDecisionEntries.filter((e) => e.responseId !== responseId),
            eventTs,
          ),
        };
      }
    } else {
      // action === 'wait'
      const waitUntilText = decision.waitUntil
        ? decision.waitUntil.kind === 'impulse'
          ? ` waiting for ${decision.waitUntil.impulseId}`
          : ' waiting for any impulse'
        : '';
      const metricsText = metrics
        ? ` [gate:${metrics.gateDelayMs}ms ai:${metrics.aiDecisionMs}ms]`
        : '';
      // Update all live decision entries to show wait state
      next = {
        ...next,
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          next.liveDecisionEntries.map((e) =>
            e.state === 'live'
              ? {
                  ...e,
                  decision: 'wait' as const,
                  text: `wait${waitUntilText}${metricsText} · ${decision.reason}`,
                  updatedAt: eventTs,
                }
              : e,
          ),
          eventTs,
        ),
      };
    }
  }

  // ── Batch response events ───────────────────────────────────────────────

  if (event.type === 'response:batch_started') {
    const respondTo = Array.isArray(eventRecord?.respondTo)
      ? (eventRecord.respondTo as string[])
      : [];
    for (const responseId of respondTo) {
      const existing = next.liveResponseStatusById[responseId];
      next = {
        ...next,
        liveResponseStatusById: mergeConstructLiveResponseStatuses(
          next.liveResponseStatusById,
          responseId,
          {
            status: 'executing',
            scheduledBy: existing?.scheduledBy,
            updatedAt: eventTs,
          },
        ),
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          next.liveDecisionEntries.map((e) =>
            e.responseId === responseId
              ? {
                  ...e,
                  status: 'running' as const,
                  state: 'live' as const,
                  updatedAt: eventTs,
                }
              : e,
          ),
          eventTs,
        ),
        liveResponseHistoriesById: pruneConstructLiveResponseHistories({
          ...next.liveResponseHistoriesById,
          [responseId]: upsertConstructLiveResponseAttempt(
            buildConstructLiveResponseHistory(
              next.liveResponseHistoriesById[responseId],
              responseId,
              eventTs,
              {
                status: 'executing',
                scheduledBy: existing?.scheduledBy,
                updatedAt: eventTs,
              },
            ),
            eventTs,
            {
              status: 'executing',
              schedulerDecisionText: '',
              generateThinking: '',
              draftText: '',
              evalDraftText: '',
            },
          ),
        }),
        defaultSelectedResponseId:
          respondTo[0] ?? next.defaultSelectedResponseId,
      };
    }
  }

  if (event.type === 'response:batch_completed') {
    const respondTo = Array.isArray(eventRecord?.respondTo)
      ? (eventRecord.respondTo as string[])
      : [];
    const disposition = eventRecord?.disposition as string | undefined;
    if (disposition === 'executed') {
      // Clean up executing entries — delivered will handle individual cleanup
    } else {
      // Drop all selected
      for (const responseId of respondTo) {
        const nextStatuses = { ...next.liveResponseStatusById };
        delete nextStatuses[responseId];
        next = {
          ...next,
          liveResponseStatusById: nextStatuses,
          liveDecisionEntries: pruneConstructLiveDecisionEntries(
            next.liveDecisionEntries.filter((e) => e.responseId !== responseId),
            eventTs,
          ),
        };
      }
    }
  }

  // ── Legacy response:decided (deprecated — kept for backward compat) ─────

  if (event.type === 'response:decided') {
    const responseId =
      typeof eventRecord?.responseId === 'string' ? eventRecord.responseId : '';
    const decision =
      eventRecord?.decision === 'respond' ||
      eventRecord?.decision === 'wait' ||
      eventRecord?.decision === 'drop'
        ? (eventRecord.decision as 'respond' | 'wait' | 'drop')
        : undefined;
    const reason =
      typeof eventRecord?.reason === 'string' ? eventRecord.reason : undefined;
    if (responseId && decision) {
      const existingDecision = next.liveDecisionEntries.find(
        (e) => e.responseId === responseId,
      );
      const scheduledBy =
        next.liveResponseStatusById[responseId]?.scheduledBy ??
        existingDecision?.scheduledBy;
      const decidedEntry: ConstructLiveDecisionEntry = {
        id: existingDecision?.id ?? `live:${responseId}:decide`,
        responseId,
        stage: 'scheduler/decide',
        text: reason ? `${decision} · ${reason}` : decision,
        status: 'decided',
        scheduledBy,
        decision,
        reason,
        state: 'live',
        createdAt: existingDecision?.createdAt ?? eventTs,
        updatedAt: eventTs,
      };
      next = {
        ...next,
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          [
            decidedEntry,
            ...next.liveDecisionEntries
              .filter((e) => e.responseId !== responseId)
              .map((e) =>
                e.state === 'live' ? { ...e, state: 'cooldown' as const } : e,
              ),
          ].slice(0, 4),
          eventTs,
        ),
        liveResponseHistoriesById: pruneConstructLiveResponseHistories({
          ...next.liveResponseHistoriesById,
          [responseId]: upsertConstructLiveResponseAttempt(
            buildConstructLiveResponseHistory(
              next.liveResponseHistoriesById[responseId],
              responseId,
              eventTs,
              { status: 'decided', scheduledBy, updatedAt: eventTs },
            ),
            eventTs,
            { status: 'decided', decision, reason },
          ),
        }),
      };
    }
  }

  if (event.type === 'response:executing') {
    const responseId =
      typeof eventRecord?.responseId === 'string' ? eventRecord.responseId : '';
    if (responseId) {
      const existing = next.liveResponseStatusById[responseId];
      next = {
        ...next,
        liveResponseStatusById: mergeConstructLiveResponseStatuses(
          next.liveResponseStatusById,
          responseId,
          {
            status: 'executing',
            scheduledBy: existing?.scheduledBy,
            updatedAt: eventTs,
          },
        ),
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          next.liveDecisionEntries.map((e) =>
            e.responseId === responseId
              ? {
                  ...e,
                  status: 'running' as const,
                  state: 'live' as const,
                  updatedAt: eventTs,
                }
              : e,
          ),
          eventTs,
        ),
        liveResponseHistoriesById: pruneConstructLiveResponseHistories({
          ...next.liveResponseHistoriesById,
          [responseId]: upsertConstructLiveResponseAttempt(
            buildConstructLiveResponseHistory(
              next.liveResponseHistoriesById[responseId],
              responseId,
              eventTs,
              {
                status: 'executing',
                scheduledBy: existing?.scheduledBy,
                updatedAt: eventTs,
              },
            ),
            eventTs,
            {
              status: 'executing',
              schedulerDecisionText: '',
              generateThinking: '',
              draftText: '',
              evalDraftText: '',
            },
          ),
        }),
      };
    }
  }

  if (event.type === 'transcript:entry') {
    const id =
      typeof eventRecord?.id === 'string' ? eventRecord.id : `live-${eventTs}`;
    const role =
      typeof eventRecord?.role === 'string'
        ? (eventRecord.role as 'user' | 'assistant' | 'system')
        : 'system';
    const content =
      typeof eventRecord?.content === 'string' ? eventRecord.content : '';
    const createdAt =
      typeof eventRecord?.createdAt === 'string'
        ? eventRecord.createdAt
        : eventTs;
    const factId =
      typeof eventRecord?.factId === 'string' ? eventRecord.factId : undefined;
    const kind =
      typeof eventRecord?.kind === 'string'
        ? (eventRecord.kind as 'chat' | 'decision' | 'tool' | 'hypno-review')
        : 'chat';
    const lane =
      typeof eventRecord?.lane === 'string' ? eventRecord.lane : undefined;
    // Deduplicate by id
    if (!next.liveTranscriptEntries.some((e) => e.id === id)) {
      next = {
        ...next,
        liveTranscriptEntries: [
          ...next.liveTranscriptEntries,
          { id, role, content, createdAt, factId, kind, lane },
        ],
      };
    }
  }

  if (event.type === 'response:delivered') {
    const responseId =
      typeof eventRecord?.responseId === 'string' ? eventRecord.responseId : '';
    const draftText =
      typeof eventRecord?.draftText === 'string'
        ? eventRecord.draftText
        : undefined;
    if (responseId) {
      const nextStatuses = { ...next.liveResponseStatusById };
      delete nextStatuses[responseId];
      next = {
        ...next,
        liveResponseStatusById: nextStatuses,
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          next.liveDecisionEntries.filter((e) => e.responseId !== responseId),
          eventTs,
        ),
        liveResponseHistoriesById: pruneConstructLiveResponseHistories({
          ...next.liveResponseHistoriesById,
          [responseId]: upsertConstructLiveResponseAttempt(
            buildConstructLiveResponseHistory(
              next.liveResponseHistoriesById[responseId],
              responseId,
              eventTs,
              { status: 'delivered', updatedAt: eventTs },
            ),
            eventTs,
            {
              status: 'delivered',
              draftText:
                draftText ??
                getLatestConstructLiveResponseAttempt(
                  next.liveResponseHistoriesById[responseId],
                )?.draftText ??
                '',
            },
          ),
        }),
      };
    }
  }

  if (event.type === 'response:dropped' || event.type === 'response:cleared') {
    const responseId =
      typeof eventRecord?.responseId === 'string' ? eventRecord.responseId : '';
    if (responseId) {
      const nextStatuses = { ...next.liveResponseStatusById };
      delete nextStatuses[responseId];
      const finalStatus =
        event.type === 'response:dropped' ? 'dropped' : 'cleared';
      next = {
        ...next,
        liveResponseStatusById: nextStatuses,
        liveDecisionEntries: pruneConstructLiveDecisionEntries(
          next.liveDecisionEntries.filter((e) => e.responseId !== responseId),
          eventTs,
        ),
        liveResponseHistoriesById: pruneConstructLiveResponseHistories({
          ...next.liveResponseHistoriesById,
          [responseId]: upsertConstructLiveResponseAttempt(
            buildConstructLiveResponseHistory(
              next.liveResponseHistoriesById[responseId],
              responseId,
              eventTs,
              { status: finalStatus, updatedAt: eventTs },
            ),
            eventTs,
            { status: finalStatus },
          ),
        }),
      };
    }
  }

  // Prune impulses on every event
  const prunedImpulses = pruneConstructLiveImpulses(
    next.liveImpulsesById,
    eventTs,
  );
  return {
    ...next,
    liveImpulsesById: prunedImpulses,
    liveImpulseThinkingById: pruneConstructLiveImpulseThinking(
      next.liveImpulseThinkingById,
      prunedImpulses,
    ),
  };
}

// ---------------------------------------------------------------------------
// Response thinking delta reducer
// ---------------------------------------------------------------------------

/**
 * Reduce a response thinking delta event into the live event state.
 *
 * Stage mapping:
 * - scheduler/decide or response/decide → schedulerDecisionText
 * - response/generate                  → generateThinking + draftText (streaming)
 * - response/evalDraft                 → evalDraftText
 */
export function reduceResponseThinkingDelta(
  state: ConstructLiveEventState,
  responseId: string,
  stage: ResponseThinkingStage,
  delta: string,
  eventTs: string,
): ConstructLiveEventState {
  if (!responseId || !delta) return state;

  // Skip stage markers like [[stage:response/generate]]
  if (delta.startsWith('[[stage:') && delta.endsWith(']]')) return state;

  // Update decision entry text for scheduler stages
  let nextDecisionEntries = state.liveDecisionEntries;
  if (stage === 'scheduler/decide' || stage === 'response/decide') {
    const existing = state.liveDecisionEntries.find(
      (e) => e.responseId === responseId,
    );
    const updated: ConstructLiveDecisionEntry = {
      id: existing?.id ?? `live:${responseId}:decide`,
      responseId,
      stage: 'scheduler/decide',
      text: appendConstructLiveDelta(existing?.text ?? '', delta),
      status: existing?.status ?? 'running',
      scheduledBy: existing?.scheduledBy,
      state: 'live',
      createdAt: existing?.createdAt ?? eventTs,
      updatedAt: eventTs,
    };
    const others = state.liveDecisionEntries
      .filter((e) => e.responseId !== responseId)
      .map((e) =>
        e.state === 'live' ? { ...e, state: 'cooldown' as const } : e,
      );
    nextDecisionEntries = pruneConstructLiveDecisionEntries(
      [updated, ...others].slice(0, 4),
      eventTs,
    );
  }

  // Update response history attempt
  const existingHistory = state.liveResponseHistoriesById[responseId];
  const latestAttempt = getLatestConstructLiveResponseAttempt(existingHistory);

  let nextHistory = buildConstructLiveResponseHistory(
    existingHistory,
    responseId,
    eventTs,
    { status: 'running', updatedAt: eventTs },
  );

  if (shouldStartNewConstructLiveResponseAttempt(nextHistory)) {
    nextHistory = startNewConstructLiveResponseAttempt(nextHistory, eventTs, {
      status: 'running',
    });
  }

  nextHistory = upsertConstructLiveResponseAttempt(nextHistory, eventTs, {
    status: 'running',
    schedulerDecisionText:
      stage === 'scheduler/decide' || stage === 'response/decide'
        ? appendConstructLiveDelta(
            latestAttempt?.schedulerDecisionText ?? '',
            delta,
          )
        : (latestAttempt?.schedulerDecisionText ?? ''),
    generateThinking:
      stage === 'response/generate'
        ? appendConstructLiveDelta(latestAttempt?.generateThinking ?? '', delta)
        : (latestAttempt?.generateThinking ?? ''),
    evalDraftText:
      stage === 'response/evalDraft' ||
      stage === 'response/evalRepeat' ||
      stage === 'response/evalTone'
        ? appendConstructLiveDelta(latestAttempt?.evalDraftText ?? '', delta)
        : (latestAttempt?.evalDraftText ?? ''),
  });

  return {
    ...state,
    hasLiveRuntimeEvents: true,
    lastRuntimeActivityAt: eventTs,
    liveDecisionEntries: nextDecisionEntries,
    liveResponseHistoriesById: pruneConstructLiveResponseHistories({
      ...state.liveResponseHistoriesById,
      [responseId]: nextHistory,
    }),
    defaultSelectedResponseId: responseId,
  };
}

// ---------------------------------------------------------------------------
// Response draft delta reducer
// ---------------------------------------------------------------------------

/**
 * Reduce a response draft delta (the actual user-visible text streaming).
 */
export function reduceResponseDelta(
  state: ConstructLiveEventState,
  responseId: string,
  delta: string,
  eventTs: string,
): ConstructLiveEventState {
  if (!responseId) return state;

  const existingHistory = state.liveResponseHistoriesById[responseId];
  const latestAttempt = getLatestConstructLiveResponseAttempt(existingHistory);

  const existing = state.liveResponseStatusById[responseId];
  let nextHistory = buildConstructLiveResponseHistory(
    existingHistory,
    responseId,
    eventTs,
    { status: 'executing', updatedAt: eventTs },
  );

  if (shouldStartNewConstructLiveResponseAttempt(nextHistory)) {
    nextHistory = startNewConstructLiveResponseAttempt(nextHistory, eventTs, {
      status: 'executing',
      draftText: delta,
      schedulerDecisionText: latestAttempt?.schedulerDecisionText ?? '',
    });
  } else {
    nextHistory = upsertConstructLiveResponseAttempt(nextHistory, eventTs, {
      status: 'executing',
      draftText: appendConstructLiveDelta(
        latestAttempt?.draftText ?? '',
        delta,
      ),
    });
  }

  return {
    ...state,
    hasLiveRuntimeEvents: true,
    lastRuntimeActivityAt: eventTs,
    liveDecisionEntries: pruneConstructLiveDecisionEntries(
      state.liveDecisionEntries,
      eventTs,
    ),
    liveResponseStatusById: mergeConstructLiveResponseStatuses(
      state.liveResponseStatusById,
      responseId,
      {
        status: 'executing',
        scheduledBy: existing?.scheduledBy,
        updatedAt: eventTs,
      },
    ),
    liveResponseHistoriesById: pruneConstructLiveResponseHistories({
      ...state.liveResponseHistoriesById,
      [responseId]: nextHistory,
    }),
    defaultSelectedResponseId: responseId,
  };
}
