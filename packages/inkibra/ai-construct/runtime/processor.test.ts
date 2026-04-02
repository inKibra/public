import { afterEach, describe, expect, test } from 'bun:test';
import { createOverlayFs, type OverlayFs } from '@inkibra/ai-flow';
import type { MailboxMessage } from '@inkibra/mailbox';
import {
  enqueueDeferredPerceptionOps,
  loadDeferredParentResolutionRecords,
  loadPendingDeferredPerceptionQueueEntries,
} from '../vfs/deferred-perceptions';
import {
  drainScheduledResponses,
  isQuiescentState,
  processMailboxMessages,
} from './processor';
import {
  createMailboxProcessorConstruct,
  disposeMailboxProcessorConstructs,
} from './test-processor-harness';

afterEach(async () => {
  await disposeMailboxProcessorConstructs();
});

describe('construct runtime processor', () => {
  test('processes op messages and ignores idle mailbox messages', async () => {
    const ingested: unknown[] = [];
    const vfs = createInMemoryVfs();
    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      ingest: async (perception: unknown) => {
        ingested.push(perception);
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

    const messages: MailboxMessage[] = [
      {
        kind: 'op',
        operation: {
          opId: 'op-1',
          kind: 'user_message',
          payload: { content: 'hello' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
      {
        kind: 'idle',
        idle: {
          mailboxKey: 'construct:1',
          markerCursor: 'cursor-1',
          quietPeriodMs: 1000,
          emittedAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ];

    const result = await processMailboxMessages(construct, messages);
    expect(result.processedCount).toBe(1);
    expect(result.shutdownRequested).toBe(false);
    expect(ingested.length).toBe(1);
    expect(result.diagnostics.mailbox.messageCount).toBe(2);
    expect(result.diagnostics.mailbox.opCount).toBe(1);
    expect(result.diagnostics.mailbox.idleCount).toBe(1);
    expect(result.diagnostics.processed.perceptionCount).toBe(1);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-1',
        opKind: 'user_message',
        ref: 'cursor-1',
        lifecycle: 'applied',
      },
    ]);
  });

  test('sets shutdownRequested for shutdown control op', async () => {
    const vfs = createInMemoryVfs();
    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
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
          opId: 'op-shutdown',
          kind: 'shutdown',
          payload: {},
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
    ];

    const result = await processMailboxMessages(construct, messages);
    expect(result.shutdownRequested).toBe(true);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-shutdown',
        opKind: 'shutdown',
        ref: 'cursor-1',
        lifecycle: 'applied',
      },
    ]);
  });

  test('queues next nap runtime ops', async () => {
    const queuedPins: Array<{ path: string; id?: string }> = [];
    const queuedImprints: Array<{ text: string; id?: string }> = [];
    const vfs = createInMemoryVfs();
    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      ingest: async () => {},
      queueNextNapPin: async (entry: { path: string; id?: string }) => {
        queuedPins.push(entry);
      },
      queueNextNapImprint: async (entry: { text: string; id?: string }) => {
        queuedImprints.push(entry);
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

    const messages: MailboxMessage[] = [
      {
        kind: 'op',
        operation: {
          opId: 'op-open-1',
          kind: 'next_nap_pin',
          payload: { path: '/agent/home/PRINCIPLES.md' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-imprint-1',
          kind: 'next_nap_imprint',
          payload: { text: 'Reflect recurring feedback into principles.' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ];

    const result = await processMailboxMessages(construct, messages);
    expect(result.processedCount).toBe(2);
    expect(queuedPins).toEqual([
      { path: '/agent/home/PRINCIPLES.md', id: 'op-open-1' },
    ]);
    expect(queuedImprints).toEqual([
      {
        text: 'Reflect recurring feedback into principles.',
        id: 'op-imprint-1',
      },
    ]);
  });

  test('applies response_delivered runtime op as durable semantic marker', async () => {
    const vfs = createInMemoryVfs();
    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
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
          opId: 'response-delivered:construct-1:response-1',
          kind: 'response_delivered',
          payload: {
            responseId: 'response-1',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-response-delivered-1',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.processedCount).toBe(1);
    expect(result.diagnostics.processed.runtimeCount).toBe(1);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'response-delivered:construct-1:response-1',
        opKind: 'response_delivered',
        ref: 'cursor-response-delivered-1',
        lifecycle: 'applied',
      },
    ]);
  });

  test('marks invalid response_delivered payload as failed_permanent', async () => {
    const vfs = createInMemoryVfs();
    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
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
          opId: 'response-delivered:construct-1:invalid',
          kind: 'response_delivered',
          payload: {
            responseId: '',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-response-delivered-invalid',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.processedCount).toBe(0);
    expect(result.diagnostics.processed.runtimeCount).toBe(0);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'response-delivered:construct-1:invalid',
        opKind: 'response_delivered',
        ref: 'cursor-response-delivered-invalid',
        lifecycle: 'failed_permanent',
      },
    ]);
  });

  test('processes multiple perception ops in the same batch asynchronously', async () => {
    let releaseFirstIngest: (() => void) | undefined;
    const firstIngestGate = new Promise<void>((resolve) => {
      releaseFirstIngest = resolve;
    });

    let secondStarted = false;
    const vfs = createInMemoryVfs();

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      ingest: async (perception: {
        type: string;
        messages?: Array<{ content: string }>;
      }) => {
        const content = perception.messages?.[0]?.content;
        if (content === 'first') {
          await firstIngestGate;
          return;
        }
        if (content === 'second') {
          secondStarted = true;
        }
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

    const messages: MailboxMessage[] = [
      {
        kind: 'op',
        operation: {
          opId: 'op-1',
          kind: 'user_message',
          payload: { content: 'first' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-2',
          kind: 'user_message',
          payload: { content: 'second' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ];

    const processing = processMailboxMessages(construct, messages);

    await waitForCondition(() => secondStarted);
    expect(secondStarted).toBe(true);
    releaseFirstIngest?.();

    const result = await processing;
    expect(result.processedCount).toBe(2);
  });

  test('waits for pending perception lane work before executing command lane op', async () => {
    let releaseIngest: (() => void) | undefined;
    const ingestGate = new Promise<void>((resolve) => {
      releaseIngest = resolve;
    });

    let napCalled = false;
    const vfs = createInMemoryVfs();

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      ingest: async () => {
        await ingestGate;
      },
      nap: async () => {
        napCalled = true;
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

    const messages: MailboxMessage[] = [
      {
        kind: 'op',
        operation: {
          opId: 'op-1',
          kind: 'user_message',
          payload: { content: 'hello' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-2',
          kind: 'run_nap',
          payload: {},
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ];

    const processing = processMailboxMessages(construct, messages);

    await Promise.resolve();
    expect(napCalled).toBe(false);

    releaseIngest?.();
    const result = await processing;

    expect(napCalled).toBe(true);
    expect(result.processedCount).toBe(2);
  });

  test('treats rate and steer as perception lane ops', async () => {
    let releaseRate: (() => void) | undefined;
    const rateGate = new Promise<void>((resolve) => {
      releaseRate = resolve;
    });

    let steerCalled = false;
    const vfs = createInMemoryVfs();

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      rate: async () => {
        await rateGate;
      },
      steer: async () => {
        steerCalled = true;
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

    const messages: MailboxMessage[] = [
      {
        kind: 'op',
        operation: {
          opId: 'op-rate',
          kind: 'rate_response',
          payload: {
            rating: 'good',
            annotation: 'helpful',
            lane: 'conversation',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-steer',
          kind: 'steer_directive',
          payload: {
            directive: 'stay concise',
            lane: 'conversation',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ];

    const processing = processMailboxMessages(construct, messages);

    await waitForCondition(() => steerCalled);
    expect(steerCalled).toBe(true);
    releaseRate?.();
    const result = await processing;

    expect(result.processedCount).toBe(2);
  });

  test('defers perception ops while hypno is active', async () => {
    const vfs = createInMemoryVfs();
    let ingested = 0;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => true,
      ingest: async () => {
        ingested += 1;
      },
      reflectPerceptionSourceFact: async () => {},
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
          opId: 'op-defer-1',
          kind: 'user_message',
          payload: { content: 'held while hypno' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.processedCount).toBe(0);
    expect(ingested).toBe(0);
    expect(result.diagnostics.deferredQueue.deferredByHypnoCount).toBe(1);
    expect(result.diagnostics.deferredQueue.enqueuedCount).toBe(1);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-defer-1',
        opKind: 'user_message',
        ref: 'cursor-1',
        lifecycle: 'applied_deferred',
      },
    ]);

    const deferred = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(deferred).toEqual([
      {
        id: 'nap-child:op-defer-1',
        parentOpId: 'op-defer-1',
        childOpId: 'nap-child:op-defer-1',
        lane: 'nap-lane',
        op: {
          opId: 'nap-child:op-defer-1',
          kind: 'user_message',
          payload: { content: 'held while hypno' },
          createdAt: expect.any(String),
          sourceFactId: 'op-defer-1',
          sourceFactReflected: true,
        },
        createdAt: expect.any(String),
        status: 'pending',
      },
    ]);
  });

  test('replays deferred perception ops in FIFO order after hypno completes', async () => {
    const vfs = createInMemoryVfs();
    const ingestedOrder: string[] = [];
    let hypnoActive = true;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => hypnoActive,
      reflectPerceptionSourceFact: async () => {},
      ingest: async (perception: {
        type: string;
        messages?: Array<{ content: string }>;
      }) => {
        const content = perception.messages?.[0]?.content;
        if (content) {
          ingestedOrder.push(content);
        }
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

    await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-fifo-1',
          kind: 'user_message',
          payload: { content: 'first deferred' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-fifo-2',
          kind: 'user_message',
          payload: { content: 'second deferred' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ]);

    hypnoActive = false;

    const replay = await processMailboxMessages(construct, []);
    expect(replay.processedCount).toBe(2);
    expect(ingestedOrder).toEqual(['first deferred', 'second deferred']);
    expect(replay.diagnostics.deferredQueue.loadedCount).toBe(2);
    expect(replay.diagnostics.deferredQueue.replayedCount).toBe(2);
    expect(replay.diagnostics.deferredQueue.consumedCount).toBe(2);

    const deferred = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(deferred.length).toBe(0);
  });

  test('replays deferred mailbox perception with the parent source fact id', async () => {
    const vfs = createInMemoryVfs();
    let hypnoActive = true;
    let reflectedCount = 0;
    const ingested: Array<{
      type: string;
      messages?: Array<{ metadata?: Record<string, unknown> }>;
    }> = [];

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => hypnoActive,
      reflectPerceptionSourceFact: async () => {
        reflectedCount += 1;
      },
      ingest: async (perception: {
        type: string;
        messages?: Array<{ metadata?: Record<string, unknown> }>;
      }) => {
        ingested.push(perception);
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

    await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-parent-reflect-1',
          kind: 'user_message',
          payload: { content: 'reflect before replay' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-parent-reflect-1',
        ts: new Date().toISOString(),
      },
    ]);

    expect(reflectedCount).toBe(1);

    hypnoActive = false;
    await processMailboxMessages(construct, []);

    expect(ingested).toHaveLength(1);
    expect(ingested[0]).toMatchObject({
      type: 'USER_MESSAGE',
      messages: [
        {
          metadata: {
            op_id: 'op-parent-reflect-1',
            source_fact_reflected: true,
          },
        },
      ],
    });
  });

  test('continues processing commands while perception lane is deferred', async () => {
    const vfs = createInMemoryVfs();
    let chatCalls = 0;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => true,
      reflectPerceptionSourceFact: async () => {},
      ingest: async () => {},
      chatHypnoReview: async () => {
        chatCalls += 1;
        return 'ok';
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

    const result = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-chat-defer-user',
          kind: 'user_message',
          payload: { content: 'defer me' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-chat-review',
          kind: 'chat_hypno_review',
          payload: { text: 'continue review' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.processedCount).toBe(1);
    expect(chatCalls).toBe(1);

    const deferred = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(deferred.map((entry) => entry.op.opId)).toEqual([
      'nap-child:op-chat-defer-user',
    ]);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-chat-review',
        opKind: 'chat_hypno_review',
        ref: 'cursor-2',
        lifecycle: 'applied',
      },
      {
        source: 'mailbox',
        opId: 'op-chat-defer-user',
        opKind: 'user_message',
        ref: 'cursor-1',
        lifecycle: 'applied_deferred',
      },
    ]);
  });

  test('replays deferred steering command with skipReflection after parent reflection', async () => {
    const vfs = createInMemoryVfs();
    let hypnoActive = true;
    const reflected: Array<Record<string, unknown>> = [];
    const steered: Array<Record<string, unknown>> = [];

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => hypnoActive,
      reflectSteeringDirective: async (options: Record<string, unknown>) => {
        reflected.push(options);
      },
      steer: async (options: Record<string, unknown>) => {
        steered.push(options);
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

    await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-steer-parent-reflect-1',
          kind: 'steer_directive',
          payload: {
            directive: 'hold this for replay',
            source: 'processor-test',
            lane: 'conversation',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-steer-parent-reflect-1',
        ts: new Date().toISOString(),
      },
    ]);

    expect(reflected).toEqual([
      {
        directive: 'hold this for replay',
        source: 'processor-test',
        lane: 'conversation',
        id: 'op-steer-parent-reflect-1',
        traceId: undefined,
      },
    ]);

    hypnoActive = false;
    await processMailboxMessages(construct, []);

    expect(steered).toEqual([
      {
        directive: 'hold this for replay',
        source: 'processor-test',
        lane: 'conversation',
        id: 'op-steer-parent-reflect-1',
        traceId: undefined,
        skipReflection: true,
      },
    ]);
  });

  test('reflects deferred steering parents before invalid child replay fails permanent', async () => {
    const vfs = createInMemoryVfs();
    let hypnoActive = true;
    const reflected: Array<Record<string, unknown>> = [];

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => hypnoActive,
      reflectSteeringDirective: async (options: Record<string, unknown>) => {
        reflected.push(options);
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

    const deferred = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-steer-invalid-parent-reflect-1',
          kind: 'steer_directive',
          payload: {
            directive: '',
            source: 'processor-test',
            lane: 'conversation',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-steer-invalid-parent-reflect-1',
        ts: new Date().toISOString(),
      },
    ]);

    expect(deferred.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-steer-invalid-parent-reflect-1',
        opKind: 'steer_directive',
        ref: 'cursor-steer-invalid-parent-reflect-1',
        lifecycle: 'applied_deferred',
      },
    ]);

    expect(reflected).toEqual([
      {
        directive: '',
        source: 'processor-test',
        lane: 'conversation',
        id: 'op-steer-invalid-parent-reflect-1',
        traceId: undefined,
      },
    ]);

    const pending = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.op).toMatchObject({
      sourceFactId: 'op-steer-invalid-parent-reflect-1',
      sourceFactReflected: true,
    });

    hypnoActive = false;
    const replay = await processMailboxMessages(construct, []);

    expect(replay.opOutcomes).toEqual([]);

    const parentResolutions = await loadDeferredParentResolutionRecords(vfs);
    expect(
      parentResolutions['op-steer-invalid-parent-reflect-1'],
    ).toMatchObject({
      parentOpId: 'op-steer-invalid-parent-reflect-1',
      childOpId: 'nap-child:op-steer-invalid-parent-reflect-1',
      status: 'failed_permanent',
    });
  });

  test('replays legacy deferred rate child against the parent source fact id', async () => {
    const vfs = createInMemoryVfs();
    const rated: Array<Record<string, unknown>> = [];

    await enqueueDeferredPerceptionOps(vfs, [
      {
        parentOpId: 'op-legacy-rate-parent',
        childOpId: 'nap-child:op-legacy-rate-parent',
        lane: 'nap-lane',
        op: {
          opId: 'nap-child:op-legacy-rate-parent',
          kind: 'rate_response',
          payload: {
            rating: 'good',
            source: 'legacy-deferred-rate',
            lane: 'conversation',
          },
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => false,
      rate: async (options: Record<string, unknown>) => {
        rated.push(options);
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

    const replay = await processMailboxMessages(construct, []);

    expect(replay.processedCount).toBe(1);
    expect(rated).toEqual([
      {
        rating: 'good',
        annotation: undefined,
        source: 'legacy-deferred-rate',
        lane: 'conversation',
        id: 'op-legacy-rate-parent',
        traceId: undefined,
        skipReflection: false,
      },
    ]);
  });

  test('maps stale hypno commands to failed_permanent without throwing', async () => {
    const vfs = createInMemoryVfs();

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      chatHypnoReview: async () => {
        throw new Error('No hypno session active');
      },
      acceptHypno: () => {
        throw new Error('No hypno session active');
      },
      updateHypno: () => {
        throw new Error('No hypno session active');
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

    const result = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-stale-chat',
          kind: 'chat_hypno_review',
          payload: { text: 'still there?' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-stale-chat',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-stale-accept',
          kind: 'accept_hypno',
          payload: {},
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-stale-accept',
        ts: new Date().toISOString(),
      },
      {
        kind: 'op',
        operation: {
          opId: 'op-stale-update',
          kind: 'update_hypno',
          payload: {},
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-stale-update',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.processedCount).toBe(0);
    expect(result.diagnostics.processed.exclusiveCommandCount).toBe(0);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-stale-chat',
        opKind: 'chat_hypno_review',
        ref: 'cursor-stale-chat',
        lifecycle: 'failed_permanent',
      },
      {
        source: 'mailbox',
        opId: 'op-stale-accept',
        opKind: 'accept_hypno',
        ref: 'cursor-stale-accept',
        lifecycle: 'failed_permanent',
      },
      {
        source: 'mailbox',
        opId: 'op-stale-update',
        opKind: 'update_hypno',
        ref: 'cursor-stale-update',
        lifecycle: 'failed_permanent',
      },
    ]);
  });

  test('rethrows unknown hypno command failures', async () => {
    const vfs = createInMemoryVfs();

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      updateHypno: () => {
        throw new Error('unexpected update failure');
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

    await expect(
      processMailboxMessages(construct, [
        {
          kind: 'op',
          operation: {
            opId: 'op-update-explode',
            kind: 'update_hypno',
            payload: {},
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-update-explode',
          ts: new Date().toISOString(),
        },
      ]),
    ).rejects.toThrow('unexpected update failure');
  });

  test('re-enqueues deferred lane ops with undefined optional fields safely', async () => {
    const vfs = createInMemoryVfs();

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => true,
      rate: async () => {},
      reflectSteeringDirective: async () => {},
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

    const first = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-undefined-rate',
          kind: 'rate_response',
          payload: {
            rating: 'good',
            annotation: undefined,
            source: undefined,
            lane: 'conversation',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-undefined-rate',
        ts: new Date().toISOString(),
      },
    ]);

    const second = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-undefined-steer',
          kind: 'steer_directive',
          payload: {
            directive: 'keep going',
            source: undefined,
            lane: 'conversation',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-undefined-steer',
        ts: new Date().toISOString(),
      },
    ]);

    expect(first.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-undefined-rate',
        opKind: 'rate_response',
        ref: 'cursor-undefined-rate',
        lifecycle: 'applied',
      },
    ]);
    expect(second.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-undefined-steer',
        opKind: 'steer_directive',
        ref: 'cursor-undefined-steer',
        lifecycle: 'applied_deferred',
      },
    ]);

    const deferred = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(deferred.map((entry) => entry.childOpId)).toEqual([
      'nap-child:op-undefined-steer',
    ]);
    expect(deferred[0]?.op).toMatchObject({
      sourceFactId: 'op-undefined-steer',
      sourceFactReflected: true,
    });

    const resolutions = await loadDeferredParentResolutionRecords(vfs);
    const steerResolution = resolutions['op-undefined-steer'];

    expect(steerResolution).toMatchObject({
      status: 'pending',
      childOpId: 'nap-child:op-undefined-steer',
    });
    expect(resolutions['op-undefined-rate']).toBeUndefined();
    expect(steerResolution).toBeDefined();
    expect('resolvedAt' in (steerResolution as object)).toBe(false);
  });

  test('fuzzes random mailbox mixes without stage-fatal errors', async () => {
    const vfs = createInMemoryVfs();
    const rand = createMulberry32(4201337);
    let hypnoActive = false;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => hypnoActive,
      ingest: async () => {},
      rate: async () => {},
      steer: async () => {},
      nap: async () => {},
      queueNextNapPin: async () => {},
      queueNextNapImprint: async () => {},
      startHypno: async () => {
        hypnoActive = true;
      },
      cancelHypno: () => {
        hypnoActive = false;
      },
      chatHypnoReview: async () => {
        if (!hypnoActive) {
          throw new Error('No hypno session active');
        }
        return 'ok';
      },
      acceptHypno: () => {
        if (!hypnoActive) {
          throw new Error('No hypno session active');
        }
      },
      updateHypno: () => {
        if (!hypnoActive) {
          throw new Error('No hypno session active');
        }
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

    const opKinds = [
      'user_message',
      'next_nap_pin',
      'next_nap_imprint',
      'rate_response',
      'steer_directive',
      'start_hypno',
      'chat_hypno_review',
      'accept_hypno',
      'update_hypno',
      'cancel_hypno',
      'run_nap',
    ] as const;

    let opIndex = 0;
    for (let round = 0; round < 35; round += 1) {
      const burstSize = randomInt(rand, 1, 4);
      const messages: MailboxMessage[] = [];

      for (let i = 0; i < burstSize; i += 1) {
        opIndex += 1;
        const kind = opKinds[Math.floor(rand() * opKinds.length)]!;
        const operation = buildFuzzOp(kind, `op-fuzz-${opIndex}`, rand);
        messages.push({
          kind: 'op',
          operation,
          cursor: `cursor-fuzz-${opIndex}`,
          ts: new Date().toISOString(),
        });
      }

      const result = await processMailboxMessages(construct, messages);
      expect(result.opOutcomes.length).toBe(messages.length);
    }

    hypnoActive = false;
    const replay = await processMailboxMessages(construct, []);
    expect(replay.shutdownRequested).toBe(false);
    const pending = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(pending).toHaveLength(0);
  });

  test('marks invalid command payloads as failed_permanent outcomes', async () => {
    const vfs = createInMemoryVfs();
    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      rate: async () => {},
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
          opId: 'op-invalid-rate',
          kind: 'rate_response',
          payload: {
            rating: 'invalid',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-invalid-rate',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.processedCount).toBe(0);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-invalid-rate',
        opKind: 'rate_response',
        ref: 'cursor-invalid-rate',
        lifecycle: 'failed_permanent',
      },
    ]);
  });

  test('fails rate_response without a lane before calling construct.rate', async () => {
    const vfs = createInMemoryVfs();
    let rateCalls = 0;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      rate: async () => {
        rateCalls += 1;
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

    const result = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-missing-lane-rate',
          kind: 'rate_response',
          payload: {
            rating: 'good',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-missing-lane-rate',
        ts: new Date().toISOString(),
      } satisfies MailboxMessage,
    ]);

    expect(rateCalls).toBe(0);
    expect(result.processedCount).toBe(0);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-missing-lane-rate',
        opKind: 'rate_response',
        ref: 'cursor-missing-lane-rate',
        lifecycle: 'failed_permanent',
      },
    ]);
  });

  test('fails steer_directive without a lane before calling construct.steer', async () => {
    const vfs = createInMemoryVfs();
    let steerCalls = 0;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      steer: async () => {
        steerCalls += 1;
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

    const result = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-missing-lane-steer',
          kind: 'steer_directive',
          payload: {
            directive: 'stay concise',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-missing-lane-steer',
        ts: new Date().toISOString(),
      } satisfies MailboxMessage,
    ]);

    expect(steerCalls).toBe(0);
    expect(result.processedCount).toBe(0);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-missing-lane-steer',
        opKind: 'steer_directive',
        ref: 'cursor-missing-lane-steer',
        lifecycle: 'failed_permanent',
      },
    ]);
  });

  test('fails blank perception-lane values before reflection or delivery', async () => {
    const vfs = createInMemoryVfs();
    let reflectCalls = 0;

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      reflectSteeringDirective: async () => {
        reflectCalls += 1;
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

    const result = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-blank-lane-steer',
          kind: 'steer_directive',
          payload: {
            directive: 'stay concise',
            lane: '   ',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-blank-lane-steer',
        ts: new Date().toISOString(),
      } satisfies MailboxMessage,
    ]);

    expect(reflectCalls).toBe(0);
    expect(result.processedCount).toBe(0);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-blank-lane-steer',
        opKind: 'steer_directive',
        ref: 'cursor-blank-lane-steer',
        lifecycle: 'failed_permanent',
      },
    ]);
  });

  test('does not re-enqueue or replay consumed nap-lane child for duplicate parent op', async () => {
    const vfs = createInMemoryVfs();
    let ingested = 0;
    let hypnoActive = true;

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

    await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-duplicate-parent',
          kind: 'user_message',
          payload: { content: 'first defer' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-1',
        ts: new Date().toISOString(),
      },
    ]);

    hypnoActive = false;
    const replay = await processMailboxMessages(construct, []);
    expect(replay.processedCount).toBe(1);
    expect(ingested).toBe(1);

    hypnoActive = true;
    const duplicateParent = await processMailboxMessages(construct, [
      {
        kind: 'op',
        operation: {
          opId: 'op-duplicate-parent',
          kind: 'user_message',
          payload: { content: 'second defer attempt' },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-2',
        ts: new Date().toISOString(),
      },
    ]);

    expect(duplicateParent.processedCount).toBe(0);
    expect(duplicateParent.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-duplicate-parent',
        opKind: 'user_message',
        ref: 'cursor-2',
        lifecycle: 'applied_deferred',
      },
    ]);

    hypnoActive = false;
    const replayAfterDuplicate = await processMailboxMessages(construct, []);
    expect(replayAfterDuplicate.processedCount).toBe(0);
    expect(ingested).toBe(1);
  });

  test('fails invalid rate_response immediately without deferred child under hypno', async () => {
    const vfs = createInMemoryVfs();

    const construct = await createMailboxProcessorConstruct({
      getVfs: () => vfs,
      isHypnoActive: () => true,
      rate: async () => {},
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
          opId: 'op-deferred-invalid-rate',
          kind: 'rate_response',
          payload: {
            rating: 'invalid',
          },
          createdAt: new Date().toISOString(),
        },
        cursor: 'cursor-invalid-rate-1',
        ts: new Date().toISOString(),
      },
    ]);

    expect(result.processedCount).toBe(0);
    expect(result.opOutcomes).toEqual([
      {
        source: 'mailbox',
        opId: 'op-deferred-invalid-rate',
        opKind: 'rate_response',
        ref: 'cursor-invalid-rate-1',
        lifecycle: 'failed_permanent',
      },
    ]);

    const pending = await loadPendingDeferredPerceptionQueueEntries(vfs);
    expect(pending).toHaveLength(0);

    const parentResolutions = await loadDeferredParentResolutionRecords(vfs);
    expect(parentResolutions['op-deferred-invalid-rate']).toBeUndefined();
  });

  test('drains scheduled responses up to max polls', async () => {
    let polls = 0;
    const states = [
      {
        activeImpulses: 0,
        scheduledResponses: 1,
        activeResponses: 1,
        schedulerBusy: true,
      },
      {
        activeImpulses: 0,
        scheduledResponses: 1,
        activeResponses: 0,
        schedulerBusy: false,
      },
      {
        activeImpulses: 0,
        scheduledResponses: 1,
        activeResponses: 0,
        schedulerBusy: false,
      },
    ];

    const construct = await createMailboxProcessorConstruct({
      getScheduler: () => ({
        poll: async () => {
          polls += 1;
        },
      }),
      getRuntimeState: async () => states[Math.min(polls, states.length - 1)]!,
    });

    const result = await drainScheduledResponses(construct, 5);
    expect(polls).toBeGreaterThan(0);
    expect(result.stopReason).toBe('stabilized');
    expect(result.pollCount).toBeGreaterThan(0);
  });

  test('quiescent state requires all runtime counters to be zero/idle', () => {
    expect(
      isQuiescentState({
        activeImpulses: 0,
        scheduledResponses: 0,
        activeResponses: 0,
        schedulerBusy: false,
      }),
    ).toBe(true);

    expect(
      isQuiescentState({
        activeImpulses: 1,
        scheduledResponses: 0,
        activeResponses: 0,
        schedulerBusy: false,
      }),
    ).toBe(false);

    expect(
      isQuiescentState({
        activeImpulses: 0,
        scheduledResponses: 1,
        activeResponses: 0,
        schedulerBusy: false,
      }),
    ).toBe(false);

    expect(
      isQuiescentState({
        activeImpulses: 0,
        scheduledResponses: 0,
        activeResponses: 1,
        schedulerBusy: false,
      }),
    ).toBe(false);

    expect(
      isQuiescentState({
        activeImpulses: 0,
        scheduledResponses: 0,
        activeResponses: 0,
        schedulerBusy: true,
      }),
    ).toBe(false);
  });
});

function createInMemoryVfs(): OverlayFs {
  return createOverlayFs();
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function buildFuzzOp(
  kind:
    | 'user_message'
    | 'next_nap_pin'
    | 'next_nap_imprint'
    | 'rate_response'
    | 'steer_directive'
    | 'start_hypno'
    | 'chat_hypno_review'
    | 'accept_hypno'
    | 'update_hypno'
    | 'cancel_hypno'
    | 'run_nap',
  opId: string,
  rand: () => number,
): Extract<MailboxMessage, { kind: 'op' }>['operation'] {
  const createdAt = new Date().toISOString();

  if (kind === 'user_message') {
    return {
      opId,
      kind,
      payload: {
        content: `fuzz-msg-${randomInt(rand, 1, 9999)}`,
      },
      createdAt,
    };
  }

  if (kind === 'next_nap_pin') {
    return {
      opId,
      kind,
      payload: {
        path:
          rand() < 0.9 ? `/context/fuzz/${randomInt(rand, 1, 9999)}.md` : '',
      },
      createdAt,
    };
  }

  if (kind === 'next_nap_imprint') {
    return {
      opId,
      kind,
      payload: {
        text: rand() < 0.9 ? `fuzz-imprint-${randomInt(rand, 1, 9999)}` : '',
      },
      createdAt,
    };
  }

  if (kind === 'rate_response') {
    return {
      opId,
      kind,
      payload: {
        rating: rand() < 0.5 ? 'good' : 'bad',
        annotation:
          rand() < 0.5 ? undefined : `note-${randomInt(rand, 1, 999)}`,
        source: undefined,
        lane: 'conversation',
      },
      createdAt,
    };
  }

  if (kind === 'steer_directive') {
    return {
      opId,
      kind,
      payload: {
        directive: rand() < 0.9 ? `directive-${randomInt(rand, 1, 999)}` : '',
        source: undefined,
        lane: 'conversation',
      },
      createdAt,
    };
  }

  if (kind === 'chat_hypno_review') {
    return {
      opId,
      kind,
      payload: {
        text: rand() < 0.9 ? `review-${randomInt(rand, 1, 999)}` : '',
      },
      createdAt,
    };
  }

  return {
    opId,
    kind,
    payload: {},
    createdAt,
  };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await Promise.resolve();
  }
}
