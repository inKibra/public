import { describe, expect, test } from 'bun:test';
import type { ConstructInFlightItem } from '../live/in-flight';
import type { ConstructSnapshotTranscriptMessage } from '../live/snapshot-types';
import { overlayOptimisticSendingChat } from './lab-optimistic';

function makeTranscriptEntry(
  overrides: Partial<ConstructSnapshotTranscriptMessage> = {},
): ConstructSnapshotTranscriptMessage {
  return {
    id: 'msg-1',
    role: 'user',
    kind: 'chat',
    content: 'hello',
    createdAt: '2026-03-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeInFlightItem(
  overrides: Partial<ConstructInFlightItem> = {},
): ConstructInFlightItem {
  return {
    id: 'inflight-1',
    message: 'hello',
    deliveryState: 'sent',
    stage: 'sent',
    updatedAt: '2026-03-01T12:00:00.000Z',
    impulseIds: [],
    responseIds: [],
    activeImpulseIds: [],
    activeResponseIds: [],
    scheduledByImpulseIds: [],
    ...overrides,
  };
}

describe('overlayOptimisticSendingChat', () => {
  test('no optimistic chat — pass-through', () => {
    const transcript = [makeTranscriptEntry()];
    const inFlightItems = [makeInFlightItem()];
    const result = overlayOptimisticSendingChat({
      transcript,
      inFlightItems,
      optimisticChat: undefined,
    });

    expect(result.transcript).toBe(transcript);
    expect(result.inFlightItems).toBe(inFlightItems);
    expect(result.matchedCanonical).toBe(false);
  });

  test('optimistic chat not yet canonical — appends synthetic entries', () => {
    const result = overlayOptimisticSendingChat({
      transcript: [],
      inFlightItems: [],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
      },
    });

    expect(result.matchedCanonical).toBe(false);
    expect(result.transcript).toHaveLength(1);
    expect(result.transcript[0]!.role).toBe('user');
    expect(result.transcript[0]!.content).toBe('hello world');
    expect(result.transcript[0]!.deliveryState).toBe('sending');
    expect(result.transcript[0]!.kind).toBe('chat');
    expect(result.inFlightItems).toHaveLength(1);
    expect(result.inFlightItems[0]!.stage).toBe('sending');
    expect(result.inFlightItems[0]!.message).toBe('hello world');
  });

  test('matched by factId in transcript — matchedCanonical=true, original transcript', () => {
    const transcript = [
      makeTranscriptEntry({
        id: 'msg-1',
        factId: 'fact-abc',
        content: 'hello world',
      }),
    ];
    const result = overlayOptimisticSendingChat({
      transcript,
      inFlightItems: [],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
        factId: 'fact-abc',
      },
    });

    expect(result.matchedCanonical).toBe(true);
    expect(result.transcript).toBe(transcript);
  });

  test('matched by factId in in-flight — matchedCanonical=true', () => {
    const inFlightItems = [
      makeInFlightItem({ factId: 'fact-abc', message: 'hello world' }),
    ];
    const result = overlayOptimisticSendingChat({
      transcript: [],
      inFlightItems,
      optimisticChat: {
        id: 'opt-1',
        message: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
        factId: 'fact-abc',
      },
    });

    expect(result.matchedCanonical).toBe(true);
    expect(result.inFlightItems).toBe(inFlightItems);
  });

  test('matched by content + timestamp within 5s window', () => {
    const transcript = [
      makeTranscriptEntry({
        content: 'hello world',
        createdAt: '2026-03-01T12:00:02.000Z',
      }),
    ];
    const result = overlayOptimisticSendingChat({
      transcript,
      inFlightItems: [],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
      },
    });

    expect(result.matchedCanonical).toBe(true);
    expect(result.transcript).toBe(transcript);
  });

  test('not matched when content matches but timestamp is outside 5s window', () => {
    const transcript = [
      makeTranscriptEntry({
        content: 'hello world',
        createdAt: '2026-03-01T12:00:10.000Z',
      }),
    ];
    const result = overlayOptimisticSendingChat({
      transcript,
      inFlightItems: [],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
      },
    });

    expect(result.matchedCanonical).toBe(false);
    // Should have appended the optimistic entry
    expect(result.transcript).toHaveLength(2);
    expect(result.transcript[1]!.deliveryState).toBe('sending');
  });

  test('not matched when content differs', () => {
    const transcript = [
      makeTranscriptEntry({
        content: 'different message',
        createdAt: '2026-03-01T12:00:00.000Z',
      }),
    ];
    const result = overlayOptimisticSendingChat({
      transcript,
      inFlightItems: [],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
      },
    });

    expect(result.matchedCanonical).toBe(false);
    expect(result.transcript).toHaveLength(2);
  });

  test('optimistic with queuedAt uses queuedAt for synthetic entries', () => {
    const result = overlayOptimisticSendingChat({
      transcript: [],
      inFlightItems: [],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello',
        createdAt: '2026-03-01T12:00:00.000Z',
        queuedAt: '2026-03-01T12:00:01.000Z',
      },
    });

    expect(result.transcript[0]!.createdAt).toBe('2026-03-01T12:00:01.000Z');
    expect(result.inFlightItems[0]!.queuedAt).toBe('2026-03-01T12:00:01.000Z');
  });

  test('assistant messages in transcript are ignored for content matching', () => {
    const transcript = [
      makeTranscriptEntry({
        role: 'assistant',
        content: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
      }),
    ];
    const result = overlayOptimisticSendingChat({
      transcript,
      inFlightItems: [],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello world',
        createdAt: '2026-03-01T12:00:00.000Z',
      },
    });

    expect(result.matchedCanonical).toBe(false);
  });

  test('optimistic entry is prepended to in-flight items', () => {
    const existing = makeInFlightItem({
      id: 'existing-1',
      message: 'other',
    });
    const result = overlayOptimisticSendingChat({
      transcript: [],
      inFlightItems: [existing],
      optimisticChat: {
        id: 'opt-1',
        message: 'hello',
        createdAt: '2026-03-01T12:00:00.000Z',
      },
    });

    expect(result.inFlightItems).toHaveLength(2);
    expect(result.inFlightItems[0]!.id).toBe('opt-1');
    expect(result.inFlightItems[1]!.id).toBe('existing-1');
  });
});
