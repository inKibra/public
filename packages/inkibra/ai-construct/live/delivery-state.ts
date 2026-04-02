/**
 * Delivery State
 *
 * Shared model for user-message delivery status. This replaces the
 * route-local pending-message reconciliation effects that previously
 * lived in persona-lab.tsx.
 *
 * Status progression:
 *   sending → sent → seen → durable
 *
 * - sending: optimistic local row, not yet accepted by the server.
 * - sent:    server accepted / appended to mailbox. One check.
 * - seen:    construct reflected / started processing. Two green checks.
 * - durable: durability frontier has passed it. Two blue checks.
 */

import { decodeCursor } from '@inkibra/streams';
import type { ConstructLiveSourceFactView } from './projection';
import type {
  ConstructDeliveryState,
  ConstructIngressFrontier,
} from './snapshot-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * User-facing delivery status for a chat message.
 */
export type MessageDeliveryStatus = ConstructDeliveryState;

const DELIVERY_STATE_RANK: Record<MessageDeliveryStatus, number> = {
  sending: 0,
  sent: 1,
  seen: 2,
  durable: 3,
};

/**
 * A pending chat message created optimistically on the client.
 *
 * The route creates these on send and passes them into the shared
 * projection. The shared projection is responsible for:
 * - enriching them from live source facts
 * - deciding when they can be pruned (snapshot takeover)
 */
export type PendingChatMessage = {
  /** Client-generated optimistic id */
  id: string;
  /** Server-assigned fact id (set after server acceptance) */
  factId?: string;
  /** The message text */
  message: string;
  /** When the client created the optimistic row */
  createdAt: string;
  /** When the server accepted / queued the message */
  queuedAt?: string;
  /** When the construct reflected / started processing */
  reflectedAt?: string;
};

// ---------------------------------------------------------------------------
// Delivery status derivation
// ---------------------------------------------------------------------------

/**
 * Derive the delivery status for a pending chat message.
 *
 * This is the single source of truth for status. The route should call
 * this rather than inspecting timestamps directly.
 */
export function deriveMessageDeliveryStatus(
  pending: PendingChatMessage,
  liveFact: ConstructLiveSourceFactView | undefined,
): MessageDeliveryStatus {
  // Use live fact data if available (takes priority over pending fields)
  const reflectedAt = liveFact?.reflectedAt ?? pending.reflectedAt;
  if (reflectedAt) {
    return 'seen';
  }

  // Server accepted — has a factId and/or queuedAt from acceptance response
  const queuedAt = liveFact?.queuedAt ?? pending.queuedAt;
  if (pending.factId || (queuedAt && queuedAt !== pending.createdAt)) {
    return 'sent';
  }

  return 'sending';
}

/**
 * Derive the delivery status for a transcript entry that already has
 * timestamps (from snapshot or server transcript).
 */
export function deriveTranscriptEntryDeliveryStatus(entry: {
  deliveryState?: MessageDeliveryStatus;
  queuedAt?: string;
  reflectedAt?: string;
}): MessageDeliveryStatus {
  if (entry.deliveryState) {
    return entry.deliveryState;
  }
  if (entry.reflectedAt) {
    return 'seen';
  }
  if (entry.queuedAt) {
    return 'sent';
  }
  // Entries from the server transcript that predate the delivery-state
  // model are assumed durable (they were already persisted and loaded).
  return 'durable';
}

export function deriveDeliveryStateFromFrontier(args: {
  queuedAt?: string;
  reflectedAt?: string;
  queueRef?: string;
  frontier?: ConstructIngressFrontier;
}): MessageDeliveryStatus | undefined {
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

export function pickStrongerDeliveryState(
  ...states: Array<MessageDeliveryStatus | undefined>
): MessageDeliveryStatus | undefined {
  let strongest: MessageDeliveryStatus | undefined;
  for (const state of states) {
    if (!state) {
      continue;
    }
    if (
      !strongest ||
      DELIVERY_STATE_RANK[state] > DELIVERY_STATE_RANK[strongest]
    ) {
      strongest = state;
    }
  }
  return strongest;
}

// ---------------------------------------------------------------------------
// Pending message reconciliation
// ---------------------------------------------------------------------------

/**
 * Enrich pending chat messages with data from live source facts.
 *
 * This replaces the route-local "Effect 2" that previously copied
 * reflectedAt from live source facts into pending messages.
 *
 * Returns the same array reference if nothing changed (safe for React
 * state updates).
 */
export function enrichPendingFromLiveSourceFacts(
  pendingMessages: PendingChatMessage[],
  liveSourceFactsById: Record<string, ConstructLiveSourceFactView>,
): PendingChatMessage[] {
  if (pendingMessages.length === 0) {
    return pendingMessages;
  }

  let changed = false;
  const next = pendingMessages.map((pending) => {
    if (!pending.factId) {
      return pending;
    }

    const liveFact = liveSourceFactsById[pending.factId];
    if (!liveFact) {
      return pending;
    }

    // Check if live fact has newer data than what we already have
    const newQueuedAt = liveFact.queuedAt ?? pending.queuedAt;
    const newReflectedAt = liveFact.reflectedAt ?? pending.reflectedAt;

    if (
      newQueuedAt === pending.queuedAt &&
      newReflectedAt === pending.reflectedAt
    ) {
      return pending;
    }

    changed = true;
    return {
      ...pending,
      queuedAt: newQueuedAt,
      reflectedAt: newReflectedAt,
    };
  });

  return changed ? next : pendingMessages;
}

/**
 * Remove pending messages that have been taken over by the server
 * transcript.
 *
 * A pending message should only be removed when the snapshot transcript
 * contains a matching entry. This replaces the route-local "Effect 1".
 *
 * IMPORTANT: We deliberately do NOT remove pending messages just because
 * a live source fact exists for them. That was the old "Effect 3" which
 * caused the disappearing-message bug. The pending row must stay until
 * the snapshot transcript has taken over, ensuring continuous visibility.
 *
 * Returns the same array reference if nothing changed.
 */
export function prunePendingAfterSnapshotTakeover<
  TEntry extends {
    factId?: string;
    role: string;
    content: string;
    queuedAt?: string;
    createdAt: string;
  },
>(
  pendingMessages: PendingChatMessage[],
  snapshotTranscript: TEntry[],
): PendingChatMessage[] {
  if (pendingMessages.length === 0) {
    return pendingMessages;
  }

  const next = pendingMessages.filter(
    (pending) => !isInSnapshotTranscript(pending, snapshotTranscript),
  );

  return next.length === pendingMessages.length ? pendingMessages : next;
}

/**
 * Check whether a pending message has a matching entry in the snapshot
 * transcript (meaning the server has persisted it and we can stop
 * showing the optimistic row).
 */
function isInSnapshotTranscript<
  TEntry extends {
    factId?: string;
    role: string;
    content: string;
    queuedAt?: string;
    createdAt: string;
  },
>(pending: PendingChatMessage, transcript: TEntry[]): boolean {
  // Match by factId if available (strongest signal)
  if (pending.factId) {
    return transcript.some((entry) => entry.factId === pending.factId);
  }

  // Fall back to content + time matching
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
