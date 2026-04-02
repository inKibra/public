import { describe, expect, test } from 'bun:test';
import type { Logger } from '@inkibra/logger';
import initLogger from '@inkibra/logger';
import {
  createInMemoryMailboxCursorStore,
  createInMemoryMailboxStateStore,
  createMailboxClient,
} from '@inkibra/mailbox';
import { stub } from '@inkibra/test-support/stub';
import type { Redis } from 'ioredis';
import { FakeRedis } from '../streams/__tests__/fixtures/fake-redis';
import { createStreamsClient } from '../streams/client';
import {
  createInMemoryActorCheckpointStore,
  createInMemoryActorLeaseStore,
} from './memory';
import { createMailboxActorRuntime } from './runtime';

const logger = initLogger('actor-runtime-test') as Logger;

describe('createMailboxActorRuntime', () => {
  async function waitUntil(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 2_000,
    label = 'predicate',
  ): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  test('processes mailbox messages and commits cursor through checkpoint store', async () => {
    // This stays a narrow package-level unit test. Real durability, lease,
    // timer, and recovery behavior should be covered with Dragonfly-backed
    // integration tests instead of expanding FakeRedis further.
    const streams = await createStreamsClient({
      logger,
      redis: stub<Redis>(new FakeRedis()),
      defaults: {
        redisPrefix: 'actor-runtime-test',
      },
    });
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
    });
    const leaseStore = createInMemoryActorLeaseStore();
    const checkpointStore = createInMemoryActorCheckpointStore<{
      seen: string[];
    }>();
    const seen: string[] = [];

    const runtime = createMailboxActorRuntime({
      logger,
      leaseStore,
      checkpointStore,
      maxResidentActors: 1,
      idleTtlMs: 50,
      definition: {
        name: 'test',
        getMailboxBinding: (actorId) => ({
          mailbox,
          mailboxKey: `mb:${actorId}`,
          consumerKey: `consumer:${actorId}`,
          batchSize: 10,
        }),
        createInitialCheckpoint: () => ({ seen: [] }),
        async processMessages({ messages }) {
          for (const message of messages) {
            if (message.kind === 'op') {
              seen.push(message.operation.opId);
            }
          }
          return {
            didWork: true,
            checkpoint: { seen: [...seen] },
          };
        },
      },
    });

    await mailbox.appendOperation({
      mailboxKey: 'mb:a1',
      operation: {
        opId: 'op-1',
        kind: 'test',
        payload: {},
        createdAt: new Date().toISOString(),
      },
    });

    void runtime.ensureRunning('a1');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seen).toEqual(['op-1']);
    const checkpoint = await checkpointStore.load('a1');
    expect(checkpoint?.phase).toBe('committed');
    expect(checkpoint?.committedCursor).toBeDefined();
    await runtime.shutdown();
  });

  test('can advance processed cursor ahead of committed cursor', async () => {
    const streams = await createStreamsClient({
      logger,
      redis: stub<Redis>(new FakeRedis()),
      defaults: {
        redisPrefix: 'actor-runtime-processed-frontier-test',
      },
    });
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
    });
    const leaseStore = createInMemoryActorLeaseStore();
    const checkpointStore = createInMemoryActorCheckpointStore<{
      seen: string[];
    }>();
    const seen: string[] = [];
    let allowCommit = false;
    let didCommit = false;

    const runtime = createMailboxActorRuntime({
      logger,
      leaseStore,
      checkpointStore,
      maxResidentActors: 1,
      idleTtlMs: 500,
      pollIntervalMs: 10,
      definition: {
        name: 'processed-frontier-test',
        getMailboxBinding: (actorId) => ({
          mailbox,
          mailboxKey: `mb:${actorId}`,
          consumerKey: `consumer:${actorId}`,
          batchSize: 10,
        }),
        createInitialCheckpoint: () => ({ seen: [] }),
        async processMessages({ messages }) {
          for (const message of messages) {
            if (message.kind === 'op') {
              seen.push(message.operation.opId);
            }
          }
          return {
            didWork: true,
            checkpoint: { seen: [...seen] },
            deferCommit: true,
          };
        },
        async processIdle() {
          if (!allowCommit) {
            return { didWork: false, keepAlive: true };
          }
          if (didCommit) {
            return null;
          }
          didCommit = true;
          return {
            didWork: true,
            commitProcessedCursor: true,
          };
        },
      },
    });

    await mailbox.appendOperation({
      mailboxKey: 'mb:a1',
      operation: {
        opId: 'op-1',
        kind: 'test',
        payload: {},
        createdAt: new Date().toISOString(),
      },
    });

    void runtime.ensureRunning('a1');
    await waitUntil(() => seen.includes('op-1'), 2_000, 'op-1 seen');

    let checkpoint = await checkpointStore.load('a1');
    expect(checkpoint?.phase).toBe('prepared');
    expect(checkpoint?.processedCursor).toBeDefined();
    expect(checkpoint?.committedCursor).toBeUndefined();
    expect(
      await mailbox.getConsumerCursor({
        mailboxKey: 'mb:a1',
        consumerKey: 'consumer:a1',
      }),
    ).toBeUndefined();

    await mailbox.appendOperation({
      mailboxKey: 'mb:a1',
      operation: {
        opId: 'op-2',
        kind: 'test',
        payload: {},
        createdAt: new Date().toISOString(),
      },
    });
    runtime.nudge('a1');

    await waitUntil(() => seen.includes('op-2'), 2_000, 'op-2 seen');
    checkpoint = await checkpointStore.load('a1');
    expect(checkpoint?.phase).toBe('prepared');
    expect(checkpoint?.processedCursor).toBeDefined();
    expect(checkpoint?.committedCursor).toBeUndefined();

    allowCommit = true;
    runtime.nudge('a1');
    await waitUntil(
      async () => {
        const next = await checkpointStore.load('a1');
        return (
          next?.phase === 'committed' && next.committedCursor !== undefined
        );
      },
      2_000,
      'committed checkpoint',
    );

    checkpoint = await checkpointStore.load('a1');
    expect(checkpoint?.phase).toBe('committed');
    expect(checkpoint?.committedCursor).toBeDefined();
    expect(checkpoint?.processedCursor).toBe(checkpoint?.committedCursor);
    expect(
      await mailbox.getConsumerCursor({
        mailboxKey: 'mb:a1',
        consumerKey: 'consumer:a1',
      }),
    ).toBe(checkpoint?.committedCursor);

    await runtime.shutdown();
  }, 10_000);
});
