import { describe, expect, test } from 'bun:test';
import { encodeCursor } from '@inkibra/streams';
import { stub } from '@inkibra/test-support/stub';
import type { ConstructEvent } from '../construct/types';
import {
  advanceConstructViewFrontier,
  applyConstructViewConstructEvent,
  applyConstructViewSourceFactLifecycle,
  createConstructViewState,
  noteConstructViewIngressAccepted,
  projectConstructViewState,
  queueConstructPendingChatMessage,
  replaceConstructViewConstructSnapshot,
} from './view-machine';

function makeConstructSnapshot() {
  return {
    transcript: [],
    hypno: {
      active: false,
      stage: 'idle' as const,
      pendingPlan: false,
      acceptRequiresConfirmation: false,
      updatedAt: '2026-03-15T18:00:00.000Z',
    },
    queuedNextNapPins: [],
    queuedNextNapImprints: [],
    toolLog: [],
    decisionLog: [],
    runtimeState: {
      activeImpulses: 0,
      scheduledResponses: 0,
      activeResponses: 0,
      schedulerBusy: false,
    },
  };
}

function makeRuntimeSnapshot() {
  return {
    runtimeState: {
      activeImpulses: 0,
      scheduledResponses: 0,
      activeResponses: 0,
      schedulerBusy: false,
    },
    residency: {
      awake: false,
      status: 'idle' as const,
      lastActiveAt: undefined,
    },
    impulses: [],
    sourceFacts: [],
    scheduledResponses: [],
    decisions: [],
    toolLog: [],
  };
}

describe('construct view machine', () => {
  test('drops in-flight row once a preview-backed message becomes durable', () => {
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

    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-1',
      factType: 'user_message',
      phase: 'queued',
      ts: '2026-03-15T18:00:00.000Z',
      previewText: 'hello from another tab',
      queueRef,
    });
    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-1',
      factType: 'user_message',
      phase: 'reflected',
      ts: '2026-03-15T18:00:01.000Z',
      previewText: 'hello from another tab',
      queueRef,
    });
    state = advanceConstructViewFrontier(state, {
      committedCursor,
    });

    const projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript).toHaveLength(1);
    expect(projected.constructSnapshot.transcript[0]).toMatchObject({
      factId: 'fact-1',
      content: 'hello from another tab',
      deliveryState: 'durable',
    });
    expect(projected.inFlightItems).toHaveLength(0);
  });

  test('preserves durable delivery from the first snapshot hydrate', () => {
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

    const state = createConstructViewState({
      constructSnapshot: {
        ...makeConstructSnapshot(),
        frontier: {
          committedCursor,
          processedCursor: committedCursor,
        },
        transcript: [
          {
            id: 'fact-1',
            factId: 'fact-1',
            role: 'user',
            content: 'already durable',
            createdAt: '2026-03-15T18:12:00.000Z',
            queuedAt: '2026-03-15T18:12:00.000Z',
            reflectedAt: '2026-03-15T18:12:01.000Z',
            queueRef,
            deliveryState: 'durable',
            kind: 'chat',
          },
        ],
      },
      runtimeSnapshot: {
        ...makeRuntimeSnapshot(),
        sourceFacts: [
          {
            factId: 'fact-1',
            factType: 'user_message',
            lastPhase: 'reflected',
            updatedAt: '2026-03-15T18:12:01.000Z',
            previewText: 'already durable',
            journal: 'lane-log',
            queueRef,
            queuedAt: '2026-03-15T18:12:00.000Z',
            reflectedAt: '2026-03-15T18:12:01.000Z',
            responseIds: [],
            impulseIds: [],
          },
        ],
      },
    });

    const projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript[0]).toMatchObject({
      factId: 'fact-1',
      deliveryState: 'durable',
    });
    expect(projected.inFlightItems).toHaveLength(0);
  });

  test('keeps durable snapshot takeover when live source fact lacks queueRef', () => {
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

    const state = createConstructViewState({
      constructSnapshot: {
        ...makeConstructSnapshot(),
        frontier: {
          committedCursor,
          processedCursor: committedCursor,
        },
        transcript: [
          {
            id: 'fact-1',
            factId: 'fact-1',
            role: 'user',
            content: 'already durable from snapshot',
            createdAt: '2026-03-15T18:12:00.000Z',
            queuedAt: '2026-03-15T18:12:00.000Z',
            reflectedAt: '2026-03-15T18:12:01.000Z',
            queueRef,
            deliveryState: 'durable',
            kind: 'chat',
          },
        ],
      },
      runtimeSnapshot: {
        ...makeRuntimeSnapshot(),
        sourceFacts: [
          {
            factId: 'fact-1',
            factType: 'user_message',
            lastPhase: 'delivered',
            updatedAt: '2026-03-15T18:12:01.000Z',
            previewText: 'already durable from snapshot',
            journal: 'lane-log',
            queuedAt: '2026-03-15T18:12:00.000Z',
            reflectedAt: '2026-03-15T18:12:01.000Z',
            deliveredAt: '2026-03-15T18:12:02.000Z',
            responseIds: ['response-1'],
            impulseIds: ['impulse-1'],
          },
        ],
      },
    });

    const projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript[0]).toMatchObject({
      factId: 'fact-1',
      deliveryState: 'durable',
    });
    expect(projected.inFlightItems).toHaveLength(0);
  });

  test('projects queued source-fact lifecycle into transcript before reflection', () => {
    const queuedAt = new Date().toISOString();
    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-queued-1',
      factType: 'user_message',
      phase: 'queued',
      ts: queuedAt,
      previewText: 'cross-tab queued preview',
      queueRef: encodeCursor({
        streamKey: 'construct:1',
        redisId: '0-3',
        seq: 3,
      }),
    });

    const projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript).toContainEqual(
      expect.objectContaining({
        factId: 'fact-queued-1',
        role: 'user',
        content: 'cross-tab queued preview',
        deliveryState: 'sent',
      }),
    );
    expect(projected.inFlightItems).toContainEqual(
      expect.objectContaining({
        factId: 'fact-queued-1',
        message: 'cross-tab queued preview',
        stage: 'sent',
      }),
    );
  });

  test('keeps delivered response rows awaiting durable until frontier advances', () => {
    const baseMs = Date.now();
    const iso = (offsetMs: number) => new Date(baseMs + offsetMs).toISOString();
    const queueRef = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-4',
      seq: 4,
    });
    const committedCursor = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-5',
      seq: 5,
    });

    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-awaiting',
      factType: 'user_message',
      phase: 'queued',
      ts: iso(0),
      previewText: 'awaiting durable preview',
      queueRef,
    });
    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-awaiting',
      factType: 'user_message',
      phase: 'reflected',
      ts: iso(1_000),
      previewText: 'awaiting durable preview',
      queueRef,
      responseId: 'response-awaiting',
      impulseId: 'impulse-awaiting',
    });
    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-awaiting',
      factType: 'user_message',
      phase: 'delivered',
      ts: iso(2_000),
      previewText: 'awaiting durable preview',
      queueRef,
      responseId: 'response-awaiting',
      impulseId: 'impulse-awaiting',
    });

    let projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript).toContainEqual(
      expect.objectContaining({
        factId: 'fact-awaiting',
        deliveryState: 'seen',
      }),
    );
    expect(projected.inFlightItems).toContainEqual(
      expect.objectContaining({
        factId: 'fact-awaiting',
        stage: 'awaiting-durable',
      }),
    );

    state = advanceConstructViewFrontier(state, { committedCursor });
    projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript).toContainEqual(
      expect.objectContaining({
        factId: 'fact-awaiting',
        deliveryState: 'durable',
      }),
    );
    expect(projected.inFlightItems).not.toContainEqual(
      expect.objectContaining({
        factId: 'fact-awaiting',
      }),
    );
  });

  test('uses ingress ref fallback when live source-fact queueRef is missing', () => {
    const committedCursor = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-8',
      seq: 8,
    });

    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = queueConstructPendingChatMessage(state, {
      id: 'pending-1',
      factId: 'fact-ingress',
      message: 'ingress fallback',
      createdAt: '2026-03-15T18:20:00.000Z',
      queuedAt: '2026-03-15T18:20:00.000Z',
    });
    state = noteConstructViewIngressAccepted(state, {
      ref: committedCursor,
      opId: 'fact-ingress',
      opKind: 'user_message',
      ts: '2026-03-15T18:20:00.010Z',
    });
    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-ingress',
      factType: 'user_message',
      phase: 'reflected',
      ts: '2026-03-15T18:20:01.000Z',
      previewText: 'ingress fallback',
      responseId: 'response-ingress',
      impulseId: 'impulse-ingress',
    });
    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-ingress',
      factType: 'user_message',
      phase: 'delivered',
      ts: '2026-03-15T18:20:02.000Z',
      previewText: 'ingress fallback',
      responseId: 'response-ingress',
      impulseId: 'impulse-ingress',
    });
    state = advanceConstructViewFrontier(state, { committedCursor });

    const projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript).toContainEqual(
      expect.objectContaining({
        factId: 'fact-ingress',
        deliveryState: 'durable',
      }),
    );
    expect(projected.inFlightItems).not.toContainEqual(
      expect.objectContaining({ factId: 'fact-ingress' }),
    );
  });

  test('does not let out-of-order frontier events regress durable rows', () => {
    const queueRef = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-9',
      seq: 9,
    });
    const committedCursor = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-10',
      seq: 10,
    });
    const olderCommittedCursor = encodeCursor({
      streamKey: 'construct:1',
      redisId: '0-8',
      seq: 8,
    });

    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-frontier',
      factType: 'user_message',
      phase: 'queued',
      ts: '2026-03-15T18:25:00.000Z',
      previewText: 'frontier monotonic',
      queueRef,
    });
    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-frontier',
      factType: 'user_message',
      phase: 'reflected',
      ts: '2026-03-15T18:25:01.000Z',
      previewText: 'frontier monotonic',
      responseId: 'response-frontier',
      impulseId: 'impulse-frontier',
    });
    state = applyConstructViewSourceFactLifecycle(state, {
      constructId: 'construct-1',
      factId: 'fact-frontier',
      factType: 'user_message',
      phase: 'delivered',
      ts: '2026-03-15T18:25:02.000Z',
      previewText: 'frontier monotonic',
      responseId: 'response-frontier',
      impulseId: 'impulse-frontier',
    });

    state = advanceConstructViewFrontier(state, { committedCursor });
    state = advanceConstructViewFrontier(state, {
      committedCursor: olderCommittedCursor,
    });

    const projected = projectConstructViewState(state);

    expect(projected.constructSnapshot.transcript).toContainEqual(
      expect.objectContaining({
        factId: 'fact-frontier',
        deliveryState: 'durable',
      }),
    );
    expect(projected.inFlightItems).not.toContainEqual(
      expect.objectContaining({ factId: 'fact-frontier' }),
    );
  });

  // ---------------------------------------------------------------------------
  // liveHypno merge (timestamp guard)
  // ---------------------------------------------------------------------------

  test('liveHypno wins over snapshot when its updatedAt is newer', () => {
    let state = createConstructViewState({
      constructSnapshot: {
        ...makeConstructSnapshot(),
        // snapshot hypno is older
        hypno: {
          active: false,
          stage: 'idle' as const,
          pendingPlan: false,
          acceptRequiresConfirmation: false,
          updatedAt: '2026-03-15T18:00:00.000Z',
        },
      },
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    // hypno:started fires — live timestamp is newer
    state = applyConstructViewConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:started' }),
      '2026-03-15T18:00:01.000Z',
    );

    const projected = projectConstructViewState(state);
    expect(projected.constructSnapshot.hypno.active).toBe(true);
    expect(projected.constructSnapshot.hypno.stage).toBe('idle');
  });

  test('snapshot hypno wins when liveHypno updatedAt is stale', () => {
    // Build a state where live hypno is older than the snapshot hypno
    let state = createConstructViewState({
      constructSnapshot: {
        ...makeConstructSnapshot(),
        hypno: {
          active: false,
          stage: 'completed' as const,
          pendingPlan: false,
          acceptRequiresConfirmation: false,
          updatedAt: '2026-03-15T18:00:05.000Z', // snapshot is newer
        },
      },
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    // Fire hypno:started with an older timestamp
    state = applyConstructViewConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:started' }),
      '2026-03-15T18:00:03.000Z', // older than snapshot
    );

    const projected = projectConstructViewState(state);
    // Snapshot wins — active should still be false from the snapshot
    expect(projected.constructSnapshot.hypno.active).toBe(false);
    expect(projected.constructSnapshot.hypno.stage).toBe('completed');
  });

  // ---------------------------------------------------------------------------
  // liveNapToolLogEntries appended to toolLog in projection
  // ---------------------------------------------------------------------------

  test('liveNapToolLogEntries are appended to toolLog in projection', () => {
    let state = createConstructViewState({
      constructSnapshot: {
        ...makeConstructSnapshot(),
        toolLog: [
          {
            id: 'snapshot-entry-1',
            tool: 'nap',
            command: 'pre-existing',
            output: 'output',
            createdAt: '2026-03-15T18:00:00.000Z',
          },
        ],
      },
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = applyConstructViewConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'nap:started' }),
      '2026-03-15T18:00:01.000Z',
    );
    state = applyConstructViewConstructEvent(
      state,
      stub<ConstructEvent>({
        type: 'nap:tool',
        command: 'read /USER.md',
        output: '# User',
      }),
      '2026-03-15T18:00:02.000Z',
    );

    const projected = projectConstructViewState(state);
    expect(projected.constructSnapshot.toolLog).toHaveLength(2);
    expect(projected.constructSnapshot.toolLog[0]?.id).toBe('snapshot-entry-1');
    expect(projected.constructSnapshot.toolLog[1]?.command).toBe(
      'read /USER.md',
    );
  });

  // ---------------------------------------------------------------------------
  // replaceConstructViewConstructSnapshot clears liveHypno + liveNapToolLogEntries
  // ---------------------------------------------------------------------------

  test('snapshot takeover clears liveHypno and liveNapToolLogEntries', () => {
    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    // Accumulate some live state
    state = applyConstructViewConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:started' }),
      '2026-03-15T18:00:01.000Z',
    );
    state = applyConstructViewConstructEvent(
      state,
      stub<ConstructEvent>({
        type: 'nap:tool',
        command: 'ls',
        output: 'files',
      }),
      '2026-03-15T18:00:02.000Z',
    );
    expect(state.live.liveHypno).toBeDefined();
    expect(state.live.liveNapToolLogEntries).toHaveLength(1);

    // Snapshot takeover
    state = replaceConstructViewConstructSnapshot(
      state,
      makeConstructSnapshot(),
    );

    expect(state.live.liveHypno).toBeUndefined();
    expect(state.live.liveNapToolLogEntries).toHaveLength(0);
  });

  test('after snapshot takeover, toolLog shows only snapshot entries (no duplication)', () => {
    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = applyConstructViewConstructEvent(
      state,
      stub<ConstructEvent>({
        type: 'nap:tool',
        command: 'ls',
        output: 'files',
      }),
      '2026-03-15T18:00:01.000Z',
    );

    // Snapshot refresh includes the tool entry in its toolLog
    const freshSnapshot = {
      ...makeConstructSnapshot(),
      toolLog: [
        {
          id: 'baked-in',
          tool: 'nap',
          command: 'ls',
          output: 'files',
          createdAt: '2026-03-15T18:00:01.000Z',
        },
      ],
    };
    state = replaceConstructViewConstructSnapshot(state, freshSnapshot);

    const projected = projectConstructViewState(state);
    // Should be exactly 1 — no duplication from live entries
    expect(projected.constructSnapshot.toolLog).toHaveLength(1);
    expect(projected.constructSnapshot.toolLog[0]?.id).toBe('baked-in');
  });

  test('prunes optimistic pending chat after snapshot takeover', () => {
    let state = createConstructViewState({
      constructSnapshot: makeConstructSnapshot(),
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    state = queueConstructPendingChatMessage(state, {
      id: 'pending-1',
      factId: 'fact-1',
      message: 'hello',
      createdAt: '2026-03-15T18:10:00.000Z',
      queuedAt: '2026-03-15T18:10:00.000Z',
    });

    state = replaceConstructViewConstructSnapshot(state, {
      ...makeConstructSnapshot(),
      transcript: [
        {
          id: 'fact-1',
          factId: 'fact-1',
          role: 'user',
          content: 'hello',
          createdAt: '2026-03-15T18:10:00.000Z',
          queuedAt: '2026-03-15T18:10:00.000Z',
          kind: 'chat',
        },
      ],
    });

    expect(state.pendingChatMessages).toHaveLength(0);
    expect(
      projectConstructViewState(state).constructSnapshot.transcript,
    ).toHaveLength(1);
  });
});
