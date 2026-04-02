import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import {
  loadResponseLifecycleState,
  recordResponseLifecycleReceipt,
} from '../vfs/response-lifecycle-state';
import { createConstructResponseLifecycleTracker } from './response-lifecycle-tracker';

describe('construct response lifecycle tracker', () => {
  test('tracks scheduled, selected, executing, and delivered lifecycle for response work', async () => {
    const receipts: Array<{
      responseId: string;
      phase: string;
      sourceFactId?: string;
    }> = [];
    const vfs = createOverlayFs();
    const tracker = createConstructResponseLifecycleTracker({
      constructId: 'construct-1',
      vfs,
      sink: {
        publish: async (receipt) => {
          receipts.push({
            responseId: receipt.responseId,
            phase: receipt.phase,
            sourceFactId: receipt.sourceFactId,
          });
        },
      },
    });

    await tracker.onConstructEvent({
      type: 'source-fact:reflected',
      factId: 'fact-user-1',
      factType: 'user_message',
      journal: 'lane-log',
      reflectedAt: '2026-03-06T17:00:00.000Z',
      traceId: 'trace-user-1',
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
        occurredAt: new Date('2026-03-06T17:00:00.000Z'),
        receivedAt: new Date('2026-03-06T17:00:00.000Z'),
        metadata: {
          op_id: 'fact-user-1',
          trace_id: 'trace-user-1',
        },
      },
    });
    await tracker.onConstructEvent({
      type: 'response:scheduled',
      responseId: 'response-1',
      scheduledBy: 'impulse-1',
      intent: 'reply now',
      urgency: 'normal',
      waitForIdleTargets: [{ kind: 'pool', name: 'conversation' }],
    });
    await tracker.onConstructEvent({
      type: 'response:selected',
      responseId: 'response-1',
    });
    await tracker.onConstructEvent({
      type: 'response:executing',
      responseId: 'response-1',
    });
    await tracker.onConstructEvent({
      type: 'response:delivered',
      responseId: 'response-1',
    });

    expect(receipts).toEqual([
      {
        responseId: 'response-1',
        phase: 'scheduled',
        sourceFactId: 'fact-user-1',
      },
      {
        responseId: 'response-1',
        phase: 'selected',
        sourceFactId: 'fact-user-1',
      },
      {
        responseId: 'response-1',
        phase: 'executing',
        sourceFactId: 'fact-user-1',
      },
      {
        responseId: 'response-1',
        phase: 'delivered',
        sourceFactId: 'fact-user-1',
      },
    ]);

    // Terminal responses (delivered) are pruned from active state and moved to diag logs.
    const state = await loadResponseLifecycleState(vfs);
    expect(state['response-1']).toBeUndefined();
  });

  test('bootstraps persisted response metadata so replayed delivery keeps source linkage', async () => {
    const vfs = createOverlayFs();
    const now = new Date().toISOString();
    await recordResponseLifecycleReceipt(vfs, {
      constructId: 'construct-1',
      responseId: 'response-boot-1',
      phase: 'scheduled',
      timestamp: now,
      scheduledBy: 'impulse-boot-1',
      sourceFactId: 'fact-boot-1',
      sourceFactType: 'steer_directive',
      traceId: 'trace-boot-1',
      intent: 'apply steering',
      urgency: 'urgent',
    });

    const receipts: Array<{ phase: string; sourceFactType?: string }> = [];
    const tracker = createConstructResponseLifecycleTracker({
      constructId: 'construct-1',
      vfs,
      sink: {
        publish: async (receipt) => {
          receipts.push({
            phase: receipt.phase,
            sourceFactType: receipt.sourceFactType,
          });
        },
      },
    });

    await tracker.bootstrap();
    await tracker.onConstructEvent({
      type: 'response:delivered',
      responseId: 'response-boot-1',
    });

    expect(receipts).toEqual([
      {
        phase: 'delivered',
        sourceFactType: 'steer_directive',
      },
    ]);
  });
});
