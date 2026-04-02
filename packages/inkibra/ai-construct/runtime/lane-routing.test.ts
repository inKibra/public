import { afterEach, describe, expect, test } from 'bun:test';
import { createOverlayFs, type OverlayFs } from '@inkibra/ai-flow';
import type { MailboxMessage } from '@inkibra/mailbox';
import {
  loadDeferredParentResolutionRecords,
  loadPendingDeferredPerceptionQueueEntries,
} from '../vfs/deferred-perceptions';
import { processMailboxMessages } from './processor';
import {
  createMailboxProcessorConstruct,
  disposeMailboxProcessorConstructs,
} from './test-processor-harness';

afterEach(async () => {
  await disposeMailboxProcessorConstructs();
});

describe('construct runtime lane routing', () => {
  test('routes deferred mailbox perception into nap-lane child metadata', async () => {
    const vfs = createInMemoryVfs();
    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => true,
      reflectPerceptionSourceFact: async () => {},
      ingest: async () => {},
      getScheduler: () => ({
        poll: async () => {},
      }),
      getRuntimeState: async () => ({
        activeImpulses: 0,
        scheduledResponses: 0,
        activeResponses: 0,
        schedulerBusy: false,
      }),
    });

    const result = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-lane-1',
          kind: 'user_message',
          payload: { content: 'defer into nap lane' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-lane-1',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-lane-1',
        opKind: 'user_message',
        ref: 'cursor-lane-1',
        lifecycle: 'applied_deferred',
      },
    ]);

    const pending = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: 'nap-child:op-lane-1',
      parentOpId: 'op-lane-1',
      childOpId: 'nap-child:op-lane-1',
      lane: 'nap-lane',
      op: {
        opId: 'nap-child:op-lane-1',
        kind: 'user_message',
        sourceFactId: 'op-lane-1',
        sourceFactReflected: true,
      },
    });

    const parentResolutions = await loadDeferredParentResolutionRecords(vfs);
    expect(parentResolutions['op-lane-1']).toEqual({
      parentOpId: 'op-lane-1',
      childOpId: 'nap-child:op-lane-1',
      lane: 'nap-lane',
      status: 'pending',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  test('does not mark parent deferred when durable child enqueue fails', async () => {
    const vfs = createInMemoryVfs({
      failWritesContaining: '/runtime/queue/deferred.md',
    });

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => true,
      reflectPerceptionSourceFact: async () => {},
      ingest: async () => {},
      getScheduler: () => ({
        poll: async () => {},
      }),
      getRuntimeState: async () => ({
        activeImpulses: 0,
        scheduledResponses: 0,
        activeResponses: 0,
        schedulerBusy: false,
      }),
    });

    const messages: MailboxMessage[] = [
      {
        kind: 'op',
        operation: {
          opId: 'op-lane-fail',
          kind: 'user_message',
          payload: { content: 'fails durable defer write' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-lane-fail',
        ts: new Date().toISOString(),
      },
    ];

    await expect(processMailboxMessages(construct, messages)).rejects.toThrow(
      'simulated vfs write failure',
    );
  });

  test('replays nap-lane child once across duplicate parent delivery', async () => {
    const vfs = createInMemoryVfs();
    let hypnoActive = true;
    let ingested = 0;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => hypnoActive,
      reflectPerceptionSourceFact: async () => {},
      ingest: async () => {
        ingested += 1;
      },
      getScheduler: () => ({
        poll: async () => {},
      }),
      getRuntimeState: async () => ({
        activeImpulses: 0,
        scheduledResponses: 0,
        activeResponses: 0,
        schedulerBusy: false,
      }),
    });

    const deferMessage: MailboxMessage = {
      kind: 'op',
      operation: {
        opId: 'op-lane-dedupe-parent',
        kind: 'user_message',
        payload: { content: 'same parent delivered twice' },
        createdAt: new Date().toISOString(),
      },
      cursor: 'cursor-lane-dedupe-1',
      ts: new Date().toISOString(),
    };

    await processMailboxMessages(construct, [deferMessage]);

    hypnoActive = false;
    await processMailboxMessages(construct, []);
    expect(ingested).toBe(1);

    const parentResolutions = await loadDeferredParentResolutionRecords(vfs);
    expect(parentResolutions['op-lane-dedupe-parent']).toEqual({
      parentOpId: 'op-lane-dedupe-parent',
      childOpId: 'nap-child:op-lane-dedupe-parent',
      lane: 'nap-lane',
      status: 'applied',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      resolvedAt: expect.any(String),
    });

    hypnoActive = true;
    await processMailboxMessages(construct, [
      {
        ...deferMessage,
        cursor: 'cursor-lane-dedupe-2',
        ts: new Date().toISOString(),
      },
    ]);

    hypnoActive = false;
    const replay = await processMailboxMessages(construct, []);
    expect(replay.processedCount).toBe(0);
    expect(ingested).toBe(1);

    const parentResolutionsAfterDuplicate =
      await loadDeferredParentResolutionRecords(vfs);
    expect(
      parentResolutionsAfterDuplicate['op-lane-dedupe-parent']?.status,
    ).toBe('applied');
  });
});

function createInMemoryVfs(options?: {
  failWritesContaining?: string;
}): OverlayFs {
  const vfs = createOverlayFs();
  const failWritesContaining = options?.failWritesContaining;

  if (typeof failWritesContaining !== 'string') {
    return vfs;
  }

  const originalWrite = vfs.write.bind(vfs);
  vfs.write = async (path: string, content: string) => {
    if (path.includes(failWritesContaining)) {
      throw new Error('simulated vfs write failure');
    }

    await originalWrite(path, content);
  };

  return vfs;
}
