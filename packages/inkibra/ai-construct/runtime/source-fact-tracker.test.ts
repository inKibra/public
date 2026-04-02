import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import {
  loadSourceFactState,
  recordSourceFactReceipt,
} from '../vfs/source-fact-state';
import {
  createConstructSourceFactTracker,
  publishQueuedSourceFact,
} from './source-fact-tracker';

describe('construct source fact tracker', () => {
  test('tracks reflected, spawned, cleared, and delivered lifecycle for impulse-backed facts', async () => {
    const receipts: Array<{
      factId: string;
      phase: string;
      clearReason?: string;
    }> = [];
    const vfs = createOverlayFs();
    const tracker = createConstructSourceFactTracker({
      constructId: 'construct-1',
      vfs: vfs,
      sink: {
        publish: async (receipt) => {
          receipts.push({
            factId: receipt.factId,
            phase: receipt.phase,
            clearReason: receipt.clearReason,
          });
        },
      },
    });

    await tracker.onConstructEvent({
      type: 'source-fact:reflected',
      factId: 'fact-1',
      factType: 'user_message',
      journal: 'lane-log',
      reflectedAt: '2026-03-05T12:00:00.000Z',
      traceId: 'trace-1',
      processingStrategy: 'impulse',
    });
    await tracker.onConstructEvent({
      type: 'impulse:started',
      impulseId: 'impulse-1',
      perception: {
        lane: 'conversation',
        role: 'user',
        source: 'user_message',
        content: 'hello',
        occurredAt: new Date('2026-03-05T12:00:00.000Z'),
        receivedAt: new Date('2026-03-05T12:00:00.000Z'),
        metadata: {
          op_id: 'fact-1',
          trace_id: 'trace-1',
        },
      },
    });
    await tracker.onConstructEvent({
      type: 'response:schedule_requested',
      scheduledBy: 'impulse-1',
      intent: 'reply now',
      urgency: 'normal',
    });
    await tracker.onConstructEvent({
      type: 'response:scheduled',
      responseId: 'response-1',
      scheduledBy: 'impulse-1',
      intent: 'reply now',
      urgency: 'normal',
    });
    await tracker.onConstructEvent({
      type: 'impulse:completed',
      impulseId: 'impulse-1',
      durationMs: 10,
    });
    await tracker.onConstructEvent({
      type: 'response:delivered',
      responseId: 'response-1',
    });

    expect(receipts.map((entry) => entry.phase)).toEqual([
      'reflected',
      'spawned',
      'cleared',
      'delivered',
    ]);
    expect(receipts[2]?.clearReason).toBe('response_scheduled');

    // Terminal facts (delivered) are pruned from active state and moved to diag logs.
    // Verify receipts above cover the full lifecycle; state should be empty after pruning.
    const state = await loadSourceFactState(vfs);
    expect(state['fact-1']).toBeUndefined();
  });

  test('reuses stored queueRef on later lifecycle receipts', async () => {
    const receipts: Array<{ phase: string; queueRef?: string }> = [];
    const vfs = createOverlayFs();

    await publishQueuedSourceFact({
      constructId: 'construct-1',
      vfs: vfs,
      queueRef: 'cursor-queue-1',
      op: {
        opId: 'fact-queue-1',
        kind: 'user_message',
        payload: { content: 'hello' },
        createdAt: '2026-03-05T12:00:00.000Z',
      },
    });

    const tracker = createConstructSourceFactTracker({
      constructId: 'construct-1',
      vfs: vfs,
      sink: {
        publish: async (receipt) => {
          receipts.push({
            phase: receipt.phase,
            queueRef: receipt.queueRef,
          });
        },
      },
    });

    await tracker.bootstrap();
    await tracker.onConstructEvent({
      type: 'source-fact:reflected',
      factId: 'fact-queue-1',
      factType: 'user_message',
      journal: 'lane-log',
      reflectedAt: '2026-03-05T12:00:01.000Z',
      traceId: 'trace-queue-1',
      processingStrategy: 'impulse',
    });

    expect(receipts).toEqual([
      {
        phase: 'reflected',
        queueRef: 'cursor-queue-1',
      },
    ]);

    const state = await loadSourceFactState(vfs);
    expect(state['fact-queue-1']).toMatchObject({
      queueRef: 'cursor-queue-1',
      reflectedAt: '2026-03-05T12:00:01.000Z',
      lastPhase: 'reflected',
    });
  });

  test('reloads queueRef from vfs when queued receipt was recorded after bootstrap', async () => {
    const receipts: Array<{ phase: string; queueRef?: string }> = [];
    const vfs = createOverlayFs();
    const tracker = createConstructSourceFactTracker({
      constructId: 'construct-1',
      vfs: vfs,
      sink: {
        publish: async (receipt) => {
          receipts.push({ phase: receipt.phase, queueRef: receipt.queueRef });
        },
      },
    });

    await tracker.bootstrap();
    await recordSourceFactReceipt(vfs, {
      constructId: 'construct-1',
      factId: 'fact-late-queue',
      factType: 'user_message',
      phase: 'queued',
      timestamp: '2026-03-05T12:10:00.000Z',
      previewText: 'late queue ref',
      queueRef: 'cursor-late-1',
    });

    await tracker.onConstructEvent({
      type: 'source-fact:reflected',
      factId: 'fact-late-queue',
      factType: 'user_message',
      journal: 'lane-log',
      reflectedAt: '2026-03-05T12:10:01.000Z',
      traceId: 'trace-late-1',
      processingStrategy: 'impulse',
    });

    expect(receipts).toEqual([
      {
        phase: 'reflected',
        queueRef: 'cursor-late-1',
      },
    ]);
  });

  test('clears non-processing facts immediately after reflection', async () => {
    const receipts: string[] = [];
    const vfs = createOverlayFs();
    const tracker = createConstructSourceFactTracker({
      constructId: 'construct-1',
      vfs: vfs,
      sink: {
        publish: async (receipt) => {
          receipts.push(`${receipt.phase}:${receipt.clearReason ?? ''}`);
        },
      },
    });

    await tracker.onConstructEvent({
      type: 'source-fact:reflected',
      factId: 'fact-feedback-1',
      factType: 'rate_response',
      journal: 'lane-log',
      reflectedAt: '2026-03-05T12:00:00.000Z',
      processingStrategy: 'none',
    });

    expect(receipts).toEqual(['reflected:', 'cleared:no_processing_required']);

    // Terminal facts (cleared) are pruned from active state.
    const state = await loadSourceFactState(vfs);
    expect(state['fact-feedback-1']).toBeUndefined();
  });

  test('publishQueuedSourceFact emits queue lifecycle for source-fact ops only', async () => {
    const receipts: string[] = [];

    await publishQueuedSourceFact({
      constructId: 'construct-1',
      sink: {
        publish: async (receipt) => {
          receipts.push(
            `${receipt.phase}:${receipt.factId}:${receipt.queueRef}`,
          );
        },
      },
      queueRef: 'cursor-1',
      op: {
        opId: 'fact-queued-1',
        kind: 'user_message',
        payload: { content: 'hello' },
        createdAt: '2026-03-05T12:00:00.000Z',
      },
    });

    await publishQueuedSourceFact({
      constructId: 'construct-1',
      sink: {
        publish: async (receipt) => {
          receipts.push(
            `${receipt.phase}:${receipt.factId}:${receipt.queueRef}`,
          );
        },
      },
      queueRef: 'cursor-2',
      op: {
        opId: 'shutdown-1',
        kind: 'shutdown',
        payload: {},
        createdAt: '2026-03-05T12:00:01.000Z',
      },
    });

    expect(receipts).toEqual(['queued:fact-queued-1:cursor-1']);
  });

  test('serializes overlapping lifecycle events so reflected data is not lost', async () => {
    const vfs = createOverlayFs();
    const tracker = createConstructSourceFactTracker({
      constructId: 'construct-1',
      vfs: vfs,
    });

    await Promise.all([
      tracker.onConstructEvent({
        type: 'source-fact:reflected',
        factId: 'fact-race-1',
        factType: 'user_message',
        journal: 'lane-log',
        reflectedAt: '2026-03-05T12:00:00.000Z',
        traceId: 'trace-race-1',
        processingStrategy: 'impulse',
      }),
      tracker.onConstructEvent({
        type: 'impulse:started',
        impulseId: 'impulse-race-1',
        perception: {
          lane: 'conversation',
          role: 'user',
          source: 'user_message',
          content: 'hello',
          occurredAt: new Date('2026-03-05T12:00:00.000Z'),
          receivedAt: new Date('2026-03-05T12:00:00.000Z'),
          metadata: {
            op_id: 'fact-race-1',
            trace_id: 'trace-race-1',
          },
        },
      }),
      tracker.onConstructEvent({
        type: 'impulse:error',
        impulseId: 'impulse-race-1',
        error: new Error('boom'),
      }),
    ]);

    // Terminal facts (cleared) are pruned from active state.
    const state = await loadSourceFactState(vfs);
    expect(state['fact-race-1']).toBeUndefined();
  });

  test('bootstraps persisted metadata so replayed events keep the original fact type', async () => {
    const vfs = createOverlayFs();
    const now = new Date().toISOString();
    await recordSourceFactReceipt(vfs, {
      constructId: 'construct-1',
      factId: 'fact-steer-1',
      factType: 'steer_directive',
      phase: 'reflected',
      timestamp: now,
      traceId: 'trace-steer-1',
      journal: 'lane-log',
    });

    const receipts: Array<{ factType: string; phase: string }> = [];
    const tracker = createConstructSourceFactTracker({
      constructId: 'construct-1',
      vfs: vfs,
      sink: {
        publish: async (receipt) => {
          receipts.push({
            factType: receipt.factType,
            phase: receipt.phase,
          });
        },
      },
    });

    await tracker.bootstrap();
    await tracker.onConstructEvent({
      type: 'impulse:started',
      impulseId: 'impulse-steer-1',
      perception: {
        lane: 'heartbeat',
        role: 'system',
        source: 'system_event',
        event: 'heartbeat',
        content: 'heartbeat',
        occurredAt: new Date(),
        metadata: {
          op_id: 'fact-steer-1',
          trace_id: 'trace-steer-1',
        },
      },
    });

    expect(receipts).toEqual([
      {
        factType: 'steer_directive',
        phase: 'spawned',
      },
    ]);
  });
});
