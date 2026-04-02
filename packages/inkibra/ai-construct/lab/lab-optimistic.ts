/**
 * Generic construct lab optimistic chat overlay.
 *
 * Provides the optimistic sending-chat overlay that bridges the gap between
 * when a user submits a chat message and when the server confirms it in the
 * canonical transcript/in-flight pipeline.
 */

import type { ConstructInFlightItem } from '../live/in-flight';
import type { ConstructSnapshotTranscriptMessage } from '../live/snapshot-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An optimistic chat message that has been submitted but not yet confirmed
 * by the canonical transcript or in-flight pipeline.
 */
export type OptimisticSendingChat = {
  /** Client-generated unique ID */
  id: string;
  /** The chat message text */
  message: string;
  /** Client-side ISO timestamp when submitted */
  createdAt: string;
  /** Server-assigned source fact ID (set after Accepted response) */
  factId?: string;
  /** Server-assigned queued timestamp (set after Accepted response) */
  queuedAt?: string;
};

/**
 * The result of overlaying an optimistic chat onto the projected state.
 */
export type ConstructLabOptimisticOverlay = {
  /** Transcript with optimistic entry appended (if not yet canonical) */
  transcript: ConstructSnapshotTranscriptMessage[];
  /** In-flight items with optimistic entry prepended (if not yet canonical) */
  inFlightItems: ConstructInFlightItem[];
  /** True when the optimistic message has been matched in canonical data */
  matchedCanonical: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPTIMISTIC_CHAT_MATCH_WINDOW_MS = 5_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseIso(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function hasMatchingTranscriptEntry(
  transcript: ConstructSnapshotTranscriptMessage[],
  optimisticChat: OptimisticSendingChat,
): boolean {
  if (optimisticChat.factId) {
    return transcript.some((entry) => entry.factId === optimisticChat.factId);
  }

  const optimisticAt = parseIso(optimisticChat.createdAt);

  return transcript.some((entry) => {
    if (entry.role !== 'user' || entry.kind !== 'chat') {
      return false;
    }
    if (entry.content !== optimisticChat.message) {
      return false;
    }

    const entryAt = parseIso(entry.queuedAt ?? entry.createdAt);
    if (!Number.isFinite(optimisticAt) || !Number.isFinite(entryAt)) {
      return true;
    }

    return Math.abs(entryAt - optimisticAt) <= OPTIMISTIC_CHAT_MATCH_WINDOW_MS;
  });
}

function hasMatchingInFlightItem(
  inFlightItems: ConstructInFlightItem[],
  optimisticChat: OptimisticSendingChat,
): boolean {
  if (optimisticChat.factId) {
    return inFlightItems.some((item) => item.factId === optimisticChat.factId);
  }

  const optimisticAt = parseIso(optimisticChat.createdAt);

  return inFlightItems.some((item) => {
    if (item.message !== optimisticChat.message) {
      return false;
    }

    const itemAt = parseIso(item.queuedAt ?? item.updatedAt);
    if (!Number.isFinite(optimisticAt) || !Number.isFinite(itemAt)) {
      return true;
    }

    return Math.abs(itemAt - optimisticAt) <= OPTIMISTIC_CHAT_MATCH_WINDOW_MS;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Overlays an optimistic sending-chat message onto the projected transcript
 * and in-flight items.
 *
 * If the optimistic message is already present in the canonical data
 * (matched by `factId` or by content+timestamp), returns the inputs unchanged
 * with `matchedCanonical: true`. Otherwise, appends a synthetic `sending`
 * transcript entry and prepends a synthetic `sending` in-flight item.
 */
export function overlayOptimisticSendingChat(args: {
  transcript: ConstructSnapshotTranscriptMessage[];
  inFlightItems: ConstructInFlightItem[];
  optimisticChat?: OptimisticSendingChat;
}): ConstructLabOptimisticOverlay {
  const { optimisticChat } = args;
  if (!optimisticChat) {
    return {
      transcript: args.transcript,
      inFlightItems: args.inFlightItems,
      matchedCanonical: false,
    };
  }

  const transcriptMatched = hasMatchingTranscriptEntry(
    args.transcript,
    optimisticChat,
  );
  const inFlightMatched = hasMatchingInFlightItem(
    args.inFlightItems,
    optimisticChat,
  );
  const matchedCanonical = transcriptMatched || inFlightMatched;

  const transcript = transcriptMatched
    ? args.transcript
    : [
        ...args.transcript,
        {
          id: optimisticChat.id,
          role: 'user' as const,
          content: optimisticChat.message,
          factId: optimisticChat.factId,
          createdAt: optimisticChat.queuedAt ?? optimisticChat.createdAt,
          queuedAt: optimisticChat.queuedAt ?? optimisticChat.createdAt,
          deliveryState: 'sending' as const,
          kind: 'chat' as const,
        },
      ];

  const inFlightItems = inFlightMatched
    ? args.inFlightItems
    : [
        {
          id: optimisticChat.id,
          factId: optimisticChat.factId,
          message: optimisticChat.message,
          deliveryState: 'sending' as const,
          stage: 'sending' as const,
          queuedAt: optimisticChat.queuedAt ?? optimisticChat.createdAt,
          updatedAt: optimisticChat.queuedAt ?? optimisticChat.createdAt,
          impulseIds: [],
          responseIds: [],
          activeImpulseIds: [],
          activeResponseIds: [],
          scheduledByImpulseIds: [],
        },
        ...args.inFlightItems,
      ];

  return {
    transcript,
    inFlightItems,
    matchedCanonical,
  };
}
