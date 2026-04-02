import { describe, expect, test } from 'bun:test';
import { encodeCursor } from '@inkibra/streams';
import type { ResponseLifecycleRecord } from '../vfs/response-lifecycle-state';
import {
  appendAwaitingDurableResponseDrafts,
  deriveConstructTranscriptDeliveryState,
} from './transcript-snapshot';

describe('construct transcript snapshot', () => {
  test('appends delivered assistant draft while awaiting durable', () => {
    const queueRef = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-1',
      seq: 1,
    });
    const transcript = appendAwaitingDurableResponseDrafts({
      transcript: [
        {
          id: 'fact-1',
          factId: 'fact-1',
          role: 'user',
          content: 'ping',
          createdAt: '2026-03-16T05:00:00.000Z',
          queuedAt: '2026-03-16T05:00:00.000Z',
          reflectedAt: '2026-03-16T05:00:01.000Z',
          queueRef,
          deliveryState: 'seen',
          kind: 'chat',
        },
      ],
      sourceFacts: {
        'fact-1': {
          factId: 'fact-1',
          factType: 'user_message',
          lastPhase: 'delivered',
          updatedAt: '2026-03-16T05:00:05.000Z',
          queuedAt: '2026-03-16T05:00:00.000Z',
          reflectedAt: '2026-03-16T05:00:01.000Z',
          spawnedAt: '2026-03-16T05:00:02.000Z',
          deliveredAt: '2026-03-16T05:00:05.000Z',
          responseIds: ['response-1'],
          impulseIds: ['impulse-1'],
          queueRef,
        },
      },
      responseLifecycleById: {
        'response-1': {
          responseId: 'response-1',
          sourceFactId: 'fact-1',
          lastPhase: 'delivered',
          deliveredAt: '2026-03-16T05:00:05.000Z',
          updatedAt: '2026-03-16T05:00:05.000Z',
          draftText: 'MESSAGE 1:\nGot it.',
        } as ResponseLifecycleRecord,
      },
      frontier: {},
    });

    expect(transcript).toContainEqual(
      expect.objectContaining({
        id: 'response-1:snapshot-delivered:1',
        role: 'assistant',
        content: 'Got it.',
        deliveryState: 'seen',
      }),
    );
  });

  test('does not append awaiting-durable assistant draft after durability', () => {
    const queueRef = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-1',
      seq: 1,
    });
    const committedCursor = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-1',
      seq: 1,
    });

    const deliveryState = deriveConstructTranscriptDeliveryState({
      queuedAt: '2026-03-16T05:00:00.000Z',
      reflectedAt: '2026-03-16T05:00:01.000Z',
      queueRef,
      frontier: { committedCursor },
    });
    expect(deliveryState).toBe('durable');

    const transcript = appendAwaitingDurableResponseDrafts({
      transcript: [
        {
          id: 'fact-1',
          factId: 'fact-1',
          role: 'user',
          content: 'ping',
          createdAt: '2026-03-16T05:00:00.000Z',
          queuedAt: '2026-03-16T05:00:00.000Z',
          reflectedAt: '2026-03-16T05:00:01.000Z',
          queueRef,
          deliveryState: 'durable',
          kind: 'chat',
        },
      ],
      sourceFacts: {
        'fact-1': {
          factId: 'fact-1',
          factType: 'user_message',
          lastPhase: 'delivered',
          updatedAt: '2026-03-16T05:00:05.000Z',
          queuedAt: '2026-03-16T05:00:00.000Z',
          reflectedAt: '2026-03-16T05:00:01.000Z',
          deliveredAt: '2026-03-16T05:00:05.000Z',
          responseIds: ['response-1'],
          impulseIds: ['impulse-1'],
          queueRef,
        },
      },
      responseLifecycleById: {
        'response-1': {
          responseId: 'response-1',
          sourceFactId: 'fact-1',
          lastPhase: 'delivered',
          deliveredAt: '2026-03-16T05:00:05.000Z',
          updatedAt: '2026-03-16T05:00:05.000Z',
          draftText: 'MESSAGE 1:\nGot it.',
        } as ResponseLifecycleRecord,
      },
      frontier: { committedCursor },
    });

    expect(
      transcript.some(
        (entry) => entry.id === 'response-1:snapshot-delivered:1',
      ),
    ).toBe(false);
  });
});
