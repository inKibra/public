import { describe, expect, test } from 'bun:test';
import { encodeCursor } from '@inkibra/streams';
import { buildConstructInFlightItems } from './in-flight';

describe('buildConstructInFlightItems', () => {
  test('builds one row per message during rapid multi-send', () => {
    const baseMs = Date.now();
    const iso = (offsetMs: number) => new Date(baseMs + offsetMs).toISOString();

    const items = buildConstructInFlightItems({
      transcript: [
        {
          id: 'fact-a',
          factId: 'fact-a',
          role: 'user',
          content: 'A',
          createdAt: iso(0),
          queuedAt: iso(0),
          reflectedAt: iso(100),
          deliveryState: 'seen',
          kind: 'chat',
        },
        {
          id: 'fact-b',
          factId: 'fact-b',
          role: 'user',
          content: 'B',
          createdAt: iso(1_000),
          queuedAt: iso(1_000),
          reflectedAt: iso(1_100),
          deliveryState: 'seen',
          kind: 'chat',
        },
        {
          id: 'fact-c',
          factId: 'fact-c',
          role: 'user',
          content: 'C',
          createdAt: iso(2_000),
          queuedAt: iso(2_000),
          deliveryState: 'sent',
          kind: 'chat',
        },
      ],
      sourceFacts: [
        {
          factId: 'fact-a',
          factType: 'user_message',
          lastPhase: 'reflected',
          updatedAt: iso(100),
          reflectedAt: iso(100),
          impulseIds: ['impulse-a'],
          responseIds: ['response-a'],
        },
        {
          factId: 'fact-b',
          factType: 'user_message',
          lastPhase: 'reflected',
          updatedAt: iso(1_100),
          reflectedAt: iso(1_100),
          impulseIds: ['impulse-b'],
          responseIds: ['response-b'],
        },
        {
          factId: 'fact-c',
          factType: 'user_message',
          lastPhase: 'queued',
          updatedAt: iso(2_000),
          queuedAt: iso(2_000),
          impulseIds: [],
          responseIds: [],
        },
      ],
      runtimeImpulses: [
        {
          id: 'impulse-b',
          pool: 'conversation',
          profile: 'conversation.user_message',
          status: 'running',
          summary: 'B',
          startedAt: iso(1_100),
        },
      ],
      liveImpulsesById: {
        'impulse-b': {
          id: 'impulse-b',
          pool: 'conversation',
          profile: 'conversation.user_message',
          status: 'running',
          summary: 'B',
          startedAt: iso(1_100),
          updatedAt: iso(1_200),
        },
      },
      scheduledResponses: [
        {
          id: 'response-a',
          scheduledBy: 'impulse-a',
          intent: 'Reply to A',
          urgency: 'normal',
        },
      ],
      liveDecisionEntries: [],
      liveResponseHistories: [
        {
          responseId: 'response-a',
          scheduledBy: 'impulse-a',
          status: 'scheduled',
          updatedAt: iso(300),
          urgency: 'normal',
        },
      ],
      liveImpulseThinkingById: {
        'impulse-b': 'Thinking about B',
      },
    });

    expect(items.map((item) => item.message)).toEqual(['C', 'B', 'A']);
    expect(items.find((item) => item.message === 'A')?.stage).toBe('scheduled');
    expect(items.find((item) => item.message === 'B')?.stage).toBe(
      'impulse-running',
    );
    expect(items.find((item) => item.message === 'C')?.stage).toBe('sent');
  });

  test('drops durable rows with no remaining work', () => {
    const items = buildConstructInFlightItems({
      transcript: [
        {
          id: 'fact-d',
          factId: 'fact-d',
          role: 'user',
          content: 'done',
          createdAt: '2026-03-15T17:10:00.000Z',
          queuedAt: '2026-03-15T17:10:00.000Z',
          reflectedAt: '2026-03-15T17:10:00.050Z',
          deliveryState: 'durable',
          kind: 'chat',
        },
      ],
      sourceFacts: [
        {
          factId: 'fact-d',
          factType: 'user_message',
          lastPhase: 'reflected',
          updatedAt: '2026-03-15T17:10:00.050Z',
          queuedAt: '2026-03-15T17:10:00.000Z',
          reflectedAt: '2026-03-15T17:10:00.050Z',
          impulseIds: [],
          responseIds: [],
        },
      ],
      runtimeImpulses: [],
      liveImpulsesById: {},
      scheduledResponses: [],
      liveDecisionEntries: [],
      liveResponseHistories: [],
    });

    expect(items).toHaveLength(0);
  });

  test('does not regress durable rows when transcript is stronger than frontier fallback', () => {
    const queueRef = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-1',
      seq: 1,
    });
    const committedCursor = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-2',
      seq: 2,
    });

    const items = buildConstructInFlightItems({
      transcript: [
        {
          id: 'fact-durable',
          factId: 'fact-durable',
          role: 'user',
          content: 'durable from snapshot',
          createdAt: '2026-03-15T17:10:00.000Z',
          queuedAt: '2026-03-15T17:10:00.000Z',
          reflectedAt: '2026-03-15T17:10:00.050Z',
          queueRef,
          deliveryState: 'durable',
          kind: 'chat',
        },
      ],
      sourceFacts: [
        {
          factId: 'fact-durable',
          factType: 'user_message',
          lastPhase: 'delivered',
          updatedAt: '2026-03-15T17:10:01.000Z',
          queuedAt: '2026-03-15T17:10:00.000Z',
          reflectedAt: '2026-03-15T17:10:00.050Z',
          deliveredAt: '2026-03-15T17:10:01.000Z',
          impulseIds: ['impulse-durable'],
          responseIds: ['response-durable'],
        },
      ],
      frontier: {
        committedCursor,
      },
      runtimeImpulses: [],
      liveImpulsesById: {},
      scheduledResponses: [],
      liveDecisionEntries: [],
      liveResponseHistories: [
        {
          responseId: 'response-durable',
          scheduledBy: 'impulse-durable',
          status: 'delivered',
          updatedAt: '2026-03-15T17:10:01.000Z',
          urgency: 'urgent',
        },
      ],
    });

    expect(items).toHaveLength(0);
  });

  test('drops stale passive seen rows with no active work', () => {
    const items = buildConstructInFlightItems({
      transcript: [
        {
          id: 'fact-old',
          factId: 'fact-old',
          role: 'user',
          content: 'old seen',
          createdAt: '2026-03-15T15:00:00.000Z',
          queuedAt: '2026-03-15T15:00:00.000Z',
          reflectedAt: '2026-03-15T15:00:00.050Z',
          deliveryState: 'seen',
          kind: 'chat',
        },
      ],
      sourceFacts: [
        {
          factId: 'fact-old',
          factType: 'user_message',
          lastPhase: 'reflected',
          updatedAt: '2026-03-15T15:00:00.050Z',
          queuedAt: '2026-03-15T15:00:00.000Z',
          reflectedAt: '2026-03-15T15:00:00.050Z',
          impulseIds: [],
          responseIds: [],
        },
      ],
      runtimeImpulses: [],
      liveImpulsesById: {},
      scheduledResponses: [],
      liveDecisionEntries: [],
      liveResponseHistories: [],
    });

    expect(items).toHaveLength(0);
  });

  test('keeps delivered rows as awaiting-durable until frontier advances', () => {
    const baseMs = Date.now();
    const iso = (offsetMs: number) => new Date(baseMs + offsetMs).toISOString();
    const items = buildConstructInFlightItems({
      transcript: [
        {
          id: 'fact-awaiting',
          factId: 'fact-awaiting',
          role: 'user',
          content: 'awaiting durable',
          createdAt: iso(0),
          queuedAt: iso(0),
          reflectedAt: iso(50),
          deliveryState: 'seen',
          kind: 'chat',
        },
      ],
      sourceFacts: [
        {
          factId: 'fact-awaiting',
          factType: 'user_message',
          lastPhase: 'delivered',
          updatedAt: iso(2_000),
          queuedAt: iso(0),
          reflectedAt: iso(50),
          deliveredAt: iso(2_000),
          impulseIds: ['impulse-awaiting'],
          responseIds: ['response-awaiting'],
        },
      ],
      runtimeImpulses: [],
      liveImpulsesById: {},
      scheduledResponses: [],
      liveDecisionEntries: [],
      liveResponseHistories: [
        {
          responseId: 'response-awaiting',
          scheduledBy: 'impulse-awaiting',
          status: 'delivered',
          updatedAt: iso(2_000),
          urgency: 'urgent',
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      factId: 'fact-awaiting',
      stage: 'awaiting-durable',
      deliveryState: 'seen',
    });
  });

  test('keeps dropped rows visible until durable frontier advances', () => {
    const baseMs = Date.now();
    const iso = (offsetMs: number) => new Date(baseMs + offsetMs).toISOString();
    const items = buildConstructInFlightItems({
      transcript: [
        {
          id: 'fact-dropped',
          factId: 'fact-dropped',
          role: 'user',
          content: 'drop me',
          createdAt: iso(0),
          queuedAt: iso(0),
          reflectedAt: iso(50),
          deliveryState: 'seen',
          kind: 'chat',
        },
      ],
      sourceFacts: [
        {
          factId: 'fact-dropped',
          factType: 'user_message',
          lastPhase: 'reflected',
          updatedAt: iso(1_000),
          queuedAt: iso(0),
          reflectedAt: iso(50),
          impulseIds: ['impulse-dropped'],
          responseIds: ['response-dropped'],
        },
      ],
      runtimeImpulses: [],
      liveImpulsesById: {},
      scheduledResponses: [],
      liveDecisionEntries: [],
      liveResponseHistories: [
        {
          responseId: 'response-dropped',
          scheduledBy: 'impulse-dropped',
          status: 'dropped',
          updatedAt: iso(2_000),
          urgency: 'normal',
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      factId: 'fact-dropped',
      stage: 'dropped',
      deliveryState: 'seen',
    });
  });
});
