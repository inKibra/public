import { describe, expect, test } from 'bun:test';
import {
  deriveMessageDeliveryStatus,
  deriveTranscriptEntryDeliveryStatus,
  enrichPendingFromLiveSourceFacts,
  type PendingChatMessage,
  prunePendingAfterSnapshotTakeover,
} from './delivery-state';
import type { ConstructLiveSourceFactView } from './projection';

// ---------------------------------------------------------------------------
// Helper to build a minimal source fact view
// ---------------------------------------------------------------------------

function makeSourceFact(
  overrides: Partial<ConstructLiveSourceFactView> & { factId: string },
): ConstructLiveSourceFactView {
  return {
    factType: 'user_message',
    lastPhase: 'queued',
    updatedAt: '2026-03-14T10:00:00.000Z',
    previewText: undefined,
    traceId: undefined,
    journal: undefined,
    queueRef: undefined,
    queuedAt: undefined,
    reflectedAt: undefined,
    spawnedAt: undefined,
    clearedAt: undefined,
    deliveredAt: undefined,
    clearReason: undefined,
    responseIds: [],
    impulseIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveMessageDeliveryStatus
// ---------------------------------------------------------------------------

describe('deriveMessageDeliveryStatus', () => {
  test('returns sending when no factId and no server queuedAt', () => {
    const pending: PendingChatMessage = {
      id: 'opt-1',
      message: 'hello',
      createdAt: '2026-03-14T10:00:00.000Z',
      queuedAt: '2026-03-14T10:00:00.000Z',
    };

    expect(deriveMessageDeliveryStatus(pending, undefined)).toBe('sending');
  });

  test('returns sent when factId is set', () => {
    const pending: PendingChatMessage = {
      id: 'opt-1',
      factId: 'fact-1',
      message: 'hello',
      createdAt: '2026-03-14T10:00:00.000Z',
      queuedAt: '2026-03-14T10:00:00.000Z',
    };

    expect(deriveMessageDeliveryStatus(pending, undefined)).toBe('sent');
  });

  test('returns sent when live fact has queuedAt but no reflectedAt', () => {
    const pending: PendingChatMessage = {
      id: 'opt-1',
      factId: 'fact-1',
      message: 'hello',
      createdAt: '2026-03-14T10:00:00.000Z',
    };

    const liveFact = makeSourceFact({
      factId: 'fact-1',
      queuedAt: '2026-03-14T10:00:01.000Z',
    });

    expect(deriveMessageDeliveryStatus(pending, liveFact)).toBe('sent');
  });

  test('returns seen when live fact has reflectedAt', () => {
    const pending: PendingChatMessage = {
      id: 'opt-1',
      factId: 'fact-1',
      message: 'hello',
      createdAt: '2026-03-14T10:00:00.000Z',
    };

    const liveFact = makeSourceFact({
      factId: 'fact-1',
      queuedAt: '2026-03-14T10:00:01.000Z',
      reflectedAt: '2026-03-14T10:00:03.000Z',
      lastPhase: 'reflected',
    });

    expect(deriveMessageDeliveryStatus(pending, liveFact)).toBe('seen');
  });

  test('returns seen when pending itself has reflectedAt', () => {
    const pending: PendingChatMessage = {
      id: 'opt-1',
      factId: 'fact-1',
      message: 'hello',
      createdAt: '2026-03-14T10:00:00.000Z',
      reflectedAt: '2026-03-14T10:00:03.000Z',
    };

    expect(deriveMessageDeliveryStatus(pending, undefined)).toBe('seen');
  });
});

// ---------------------------------------------------------------------------
// deriveTranscriptEntryDeliveryStatus
// ---------------------------------------------------------------------------

describe('deriveTranscriptEntryDeliveryStatus', () => {
  test('prefers explicit deliveryState when present', () => {
    expect(
      deriveTranscriptEntryDeliveryStatus({
        queuedAt: '2026-03-14T10:00:00.000Z',
        reflectedAt: '2026-03-14T10:00:03.000Z',
        deliveryState: 'durable',
      }),
    ).toBe('durable');
  });

  test('returns durable for entries with no timestamps', () => {
    expect(deriveTranscriptEntryDeliveryStatus({})).toBe('durable');
  });

  test('returns sent for entries with queuedAt only', () => {
    expect(
      deriveTranscriptEntryDeliveryStatus({
        queuedAt: '2026-03-14T10:00:00.000Z',
      }),
    ).toBe('sent');
  });

  test('returns seen for entries with reflectedAt', () => {
    expect(
      deriveTranscriptEntryDeliveryStatus({
        queuedAt: '2026-03-14T10:00:00.000Z',
        reflectedAt: '2026-03-14T10:00:03.000Z',
      }),
    ).toBe('seen');
  });
});

// ---------------------------------------------------------------------------
// enrichPendingFromLiveSourceFacts
// ---------------------------------------------------------------------------

describe('enrichPendingFromLiveSourceFacts', () => {
  test('returns same reference when nothing changes', () => {
    const pending: PendingChatMessage[] = [
      {
        id: 'opt-1',
        message: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
    ];

    const result = enrichPendingFromLiveSourceFacts(pending, {});
    expect(result).toBe(pending);
  });

  test('copies reflectedAt from live source fact', () => {
    const pending: PendingChatMessage[] = [
      {
        id: 'opt-1',
        factId: 'fact-1',
        message: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
        queuedAt: '2026-03-14T10:00:00.000Z',
      },
    ];

    const result = enrichPendingFromLiveSourceFacts(pending, {
      'fact-1': makeSourceFact({
        factId: 'fact-1',
        queuedAt: '2026-03-14T10:00:00.000Z',
        reflectedAt: '2026-03-14T10:00:03.000Z',
        lastPhase: 'reflected',
      }),
    });

    expect(result).not.toBe(pending);
    expect(result[0]?.reflectedAt).toBe('2026-03-14T10:00:03.000Z');
  });

  test('returns same reference when live fact has same data', () => {
    const pending: PendingChatMessage[] = [
      {
        id: 'opt-1',
        factId: 'fact-1',
        message: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
        queuedAt: '2026-03-14T10:00:00.000Z',
        reflectedAt: '2026-03-14T10:00:03.000Z',
      },
    ];

    const result = enrichPendingFromLiveSourceFacts(pending, {
      'fact-1': makeSourceFact({
        factId: 'fact-1',
        queuedAt: '2026-03-14T10:00:00.000Z',
        reflectedAt: '2026-03-14T10:00:03.000Z',
        lastPhase: 'reflected',
      }),
    });

    expect(result).toBe(pending);
  });
});

// ---------------------------------------------------------------------------
// prunePendingAfterSnapshotTakeover
// ---------------------------------------------------------------------------

describe('prunePendingAfterSnapshotTakeover', () => {
  test('returns same reference when no pending messages', () => {
    const pending: PendingChatMessage[] = [];
    const result = prunePendingAfterSnapshotTakeover(pending, []);
    expect(result).toBe(pending);
  });

  test('removes pending when snapshot has matching factId', () => {
    const pending: PendingChatMessage[] = [
      {
        id: 'opt-1',
        factId: 'fact-1',
        message: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
    ];

    const transcript = [
      {
        factId: 'fact-1',
        role: 'user',
        content: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
    ];

    const result = prunePendingAfterSnapshotTakeover(pending, transcript);
    expect(result).toHaveLength(0);
  });

  test('keeps pending when snapshot does not have the message', () => {
    const pending: PendingChatMessage[] = [
      {
        id: 'opt-1',
        factId: 'fact-1',
        message: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
    ];

    const result = prunePendingAfterSnapshotTakeover(pending, []);
    expect(result).toBe(pending);
  });

  test('does NOT remove pending just because a live source fact exists', () => {
    // This is the key behavioral change vs the old Effect 3.
    // The pending row should stay until the SNAPSHOT TRANSCRIPT has taken over,
    // not when a live source fact arrives.
    const pending: PendingChatMessage[] = [
      {
        id: 'opt-1',
        factId: 'fact-1',
        message: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
        reflectedAt: '2026-03-14T10:00:03.000Z',
      },
    ];

    // Empty transcript — snapshot hasn't caught up yet
    const result = prunePendingAfterSnapshotTakeover(pending, []);
    expect(result).toBe(pending);
    expect(result).toHaveLength(1);
  });

  test('removes pending by content match when no factId', () => {
    const pending: PendingChatMessage[] = [
      {
        id: 'opt-1',
        message: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
        queuedAt: '2026-03-14T10:00:00.000Z',
      },
    ];

    const transcript = [
      {
        role: 'user',
        content: 'hello',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
    ];

    const result = prunePendingAfterSnapshotTakeover(pending, transcript);
    expect(result).toHaveLength(0);
  });
});
