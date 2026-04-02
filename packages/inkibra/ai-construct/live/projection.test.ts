import { describe, expect, test } from 'bun:test';
import type { SourceFactLifecycleReceipt } from '../source-facts';
import {
  applyConstructSourceFactLifecycleReceipt,
  buildConstructTranscriptForView,
  type ConstructLiveSourceFactView,
  mergeConstructRuntimeSnapshot,
} from './projection';

describe('ai-construct live projection', () => {
  test('builds transcript rows from remote queued preview text', () => {
    const sourceFactsById = {
      'fact-1': {
        factId: 'fact-1',
        factType: 'user_message',
        lastPhase: 'queued',
        updatedAt: '2026-03-13T18:00:00.000Z',
        previewText: 'hello from another tab',
        queuedAt: '2026-03-13T18:00:00.000Z',
        reflectedAt: undefined,
        spawnedAt: undefined,
        clearedAt: undefined,
        deliveredAt: undefined,
        traceId: undefined,
        journal: undefined,
        queueRef: undefined,
        clearReason: undefined,
        responseIds: [],
        impulseIds: [],
      },
    } satisfies Record<string, ConstructLiveSourceFactView>;

    const next = buildConstructTranscriptForView({
      transcript: [],
      pendingChatMessages: [],
      sourceFactsById,
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      factId: 'fact-1',
      role: 'user',
      content: 'hello from another tab',
      queuedAt: '2026-03-13T18:00:00.000Z',
    });
  });

  test('keeps preview-backed user row visible after reflected until transcript entry exists', () => {
    const sourceFactsById = {
      'fact-1': {
        factId: 'fact-1',
        factType: 'user_message',
        lastPhase: 'reflected',
        updatedAt: '2026-03-13T18:00:02.000Z',
        previewText: 'still visible after reflected',
        queuedAt: '2026-03-13T18:00:00.000Z',
        reflectedAt: '2026-03-13T18:00:02.000Z',
        spawnedAt: undefined,
        clearedAt: undefined,
        deliveredAt: undefined,
        traceId: undefined,
        journal: 'lane-log',
        queueRef: undefined,
        clearReason: undefined,
        responseIds: [],
        impulseIds: [],
      },
    } satisfies Record<string, ConstructLiveSourceFactView>;

    const next = buildConstructTranscriptForView({
      transcript: [],
      pendingChatMessages: [],
      sourceFactsById,
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      factId: 'fact-1',
      role: 'user',
      content: 'still visible after reflected',
      reflectedAt: '2026-03-13T18:00:02.000Z',
    });
  });

  test('keeps preview-backed user row visible after delivered until transcript entry exists', () => {
    const sourceFactsById = {
      'fact-1': {
        factId: 'fact-1',
        factType: 'user_message',
        lastPhase: 'delivered',
        updatedAt: '2026-03-13T18:00:05.000Z',
        previewText: 'still visible after delivered',
        queuedAt: '2026-03-13T18:00:00.000Z',
        reflectedAt: '2026-03-13T18:00:02.000Z',
        spawnedAt: '2026-03-13T18:00:03.000Z',
        clearedAt: undefined,
        deliveredAt: '2026-03-13T18:00:05.000Z',
        traceId: undefined,
        journal: 'lane-log',
        queueRef: undefined,
        clearReason: undefined,
        responseIds: ['response-1'],
        impulseIds: ['impulse-1'],
      },
    } satisfies Record<string, ConstructLiveSourceFactView>;

    const next = buildConstructTranscriptForView({
      transcript: [],
      pendingChatMessages: [],
      sourceFactsById,
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      factId: 'fact-1',
      role: 'user',
      content: 'still visible after delivered',
      reflectedAt: '2026-03-13T18:00:02.000Z',
    });
  });

  test('appends delivered live construct messages beyond the initial snapshot', () => {
    const next = buildConstructTranscriptForView({
      transcript: [
        {
          id: 'user-1',
          role: 'user',
          content: 'ping',
          createdAt: '2026-03-13T18:00:00.000Z',
          kind: 'chat',
        },
      ],
      pendingChatMessages: [],
      sourceFactsById: {},
      liveResponseHistories: {
        'response-1': {
          responseId: 'response-1',
          status: 'delivered',
          createdAt: '2026-03-13T18:00:05.000Z',
          updatedAt: '2026-03-13T18:00:07.000Z',
          attempts: [
            {
              id: 'response-1:attempt:1',
              responseId: 'response-1',
              attemptNumber: 1,
              status: 'delivered',
              createdAt: '2026-03-13T18:00:05.000Z',
              updatedAt: '2026-03-13T18:00:07.000Z',
              schedulerDecisionText: '',
              generateThinking: '',
              draftText:
                'MESSAGE 1:\nReceived: `ping`.\n---\nMESSAGE 2:\nStill here.',
              evalDraftText: '',
            },
          ],
        },
      },
    });

    expect(next).toHaveLength(3);
    expect(next[1]).toMatchObject({
      role: 'assistant',
      content: 'Received: `ping`.',
      kind: 'chat',
    });
    expect(next[2]).toMatchObject({
      role: 'assistant',
      content: 'Still here.',
      kind: 'chat',
    });
  });

  test('marks runtime awake from recent live activity', () => {
    const merged = mergeConstructRuntimeSnapshot(
      {
        runtimeState: {
          activeImpulses: 0,
          scheduledResponses: 0,
          activeResponses: 0,
          schedulerBusy: false,
        },
        residency: {
          awake: false,
          status: 'idle',
          lastActiveAt: undefined,
        },
        impulses: [],
        sourceFacts: [],
      },
      {
        hasLiveRuntimeEvents: true,
        liveImpulsesById: {},
        liveResponseStatusById: {},
        liveSourceFactsById: {},
        lastRuntimeActivityAt: new Date().toISOString(),
        commandInFlight: false,
      },
    );

    expect(merged.residency.awake).toBe(true);
    expect(merged.residency.status).toBe('active');
  });

  test('trusts live-only running impulses when recent runtime activity exists', () => {
    const merged = mergeConstructRuntimeSnapshot(
      {
        runtimeState: {
          activeImpulses: 0,
          scheduledResponses: 0,
          activeResponses: 0,
          schedulerBusy: false,
        },
        residency: {
          awake: false,
          status: 'idle',
          lastActiveAt: undefined,
        },
        impulses: [],
        sourceFacts: [],
      },
      {
        hasLiveRuntimeEvents: true,
        liveImpulsesById: {
          'impulse-1': {
            id: 'impulse-1',
            pool: 'conversation',
            profile: 'runtime',
            status: 'running',
            summary: 'processing impulse',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            thinking: 'hello',
          },
        },
        liveResponseStatusById: {},
        liveSourceFactsById: {},
        lastRuntimeActivityAt: new Date().toISOString(),
        commandInFlight: false,
      },
    );

    expect(merged.runtimeState.activeImpulses).toBe(1);
    expect(merged.impulses).toHaveLength(1);
    expect(merged.impulses[0]?.id).toBe('impulse-1');
  });

  test('applies source fact lifecycle receipts into merged source fact view', () => {
    const queued: SourceFactLifecycleReceipt = {
      constructId: 'construct-1',
      factId: 'fact-1',
      factType: 'user_message',
      phase: 'queued',
      timestamp: '2026-03-13T18:00:00.000Z',
      previewText: 'hello there',
      queueRef: 'q1',
    };
    const reflected: SourceFactLifecycleReceipt = {
      constructId: 'construct-1',
      factId: 'fact-1',
      factType: 'user_message',
      phase: 'reflected',
      timestamp: '2026-03-13T18:00:03.000Z',
      journal: 'lane-log',
    };

    const next = applyConstructSourceFactLifecycleReceipt(
      applyConstructSourceFactLifecycleReceipt(undefined, queued),
      reflected,
    );

    expect(next).toMatchObject({
      factId: 'fact-1',
      lastPhase: 'reflected',
      previewText: 'hello there',
      queuedAt: '2026-03-13T18:00:00.000Z',
      reflectedAt: '2026-03-13T18:00:03.000Z',
      journal: 'lane-log',
    });
  });
});
