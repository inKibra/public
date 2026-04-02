import { describe, expect, test } from 'bun:test';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import { stub } from '@inkibra/test-support/stub';
import type { Redis } from 'ioredis';
import { FakeRedis } from './__tests__/fixtures/fake-redis';
import { createStreamsClient } from './client';
import { decodeCursor, encodeCursor } from './cursor';

type StatusEvents = {
  status: { status: 'started' | 'completed' | 'failed' };
  messageDelta: { delta: string };
};

describe('streams client', () => {
  test('appends, reads, and streams replay/live cursor events from redis', async () => {
    const logger = initLogger('streams-client-unit-test');
    const redis = new FakeRedis();
    const client = await createStreamsClient({
      logger,
      redis: stub<Redis>(redis),
      defaults: {
        redisPrefix: 'streams-test',
      },
    });

    const first = await client.append<StatusEvents, 'status'>({
      streamKey: 'conversation:1',
      event: 'status',
      data: { status: 'started' },
    });
    const second = await client.append<StatusEvents, 'messageDelta'>({
      streamKey: 'conversation:1',
      event: 'messageDelta',
      data: { delta: 'hello' },
    });

    expect(decodeCursor(first.cursor)?.seq).toBe(1);
    expect(decodeCursor(second.cursor)?.seq).toBe(2);

    const read = await client.read<StatusEvents>({
      streamKey: 'conversation:1',
      limit: 10,
    });
    expect(read.items.length).toBe(2);
    expect(read.items[0]?.event).toBe('status');
    expect(read.items[1]?.event).toBe('messageDelta');
    expect(decodeCursor(read.nextCursor ?? '')?.seq).toBe(2);

    const iterator = client.stream<StatusEvents>({
      streamKey: 'conversation:1',
      blockMs: 50,
      limit: 10,
    });

    const i1 = await iterator.next();
    const i2 = await iterator.next();
    const i3 = await iterator.next();
    const i4 = await iterator.next();

    expect(i1.done).toBe(false);
    expect(i1.value?.type).toBe('cursor');
    if (i1.value?.type === 'cursor') {
      expect(i1.value.status.phase).toBe('replay');
      expect(i1.value.status.source).toBe('redis');
    }

    expect(i2.value?.type).toBe('event');
    if (i2.value?.type === 'event') {
      expect(i2.value.item.event).toBe('status');
    }

    expect(i3.value?.type).toBe('event');
    if (i3.value?.type === 'event') {
      expect(i3.value.item.event).toBe('messageDelta');
    }

    expect(i4.value?.type).toBe('cursor');
    if (i4.value?.type === 'cursor') {
      expect(i4.value.status.phase).toBe('live');
      expect(i4.value.status.source).toBe('redis');
    }

    await iterator.return(undefined);
  });

  test('latest cursor on an empty stream remains durable for later replay', async () => {
    const logger = initLogger('streams-client-empty-latest-cursor-test');
    const redis = new FakeRedis();
    const client = await createStreamsClient({
      logger,
      redis: stub<Redis>(redis),
      defaults: {
        redisPrefix: 'streams-empty-latest-cursor-test',
      },
    });

    const latestCursor = await client.latestCursor({
      streamKey: 'conversation:empty-latest',
    });
    expect(decodeCursor(latestCursor)?.seq).toBe(0);
    expect(decodeCursor(latestCursor)?.redisId).toBe('0-0');

    await client.append<StatusEvents, 'status'>({
      streamKey: 'conversation:empty-latest',
      event: 'status',
      data: { status: 'started' },
    });

    const iterator = client.stream<StatusEvents>({
      streamKey: 'conversation:empty-latest',
      cursor: latestCursor,
      blockMs: 50,
      limit: 10,
    });

    const first = await iterator.next();
    const second = await iterator.next();

    expect(first.value?.type).toBe('cursor');
    expect(second.value?.type).toBe('event');
    if (second.value?.type === 'event') {
      expect(second.value.item.event).toBe('status');
      expect(second.value.item.data).toEqual({ status: 'started' });
    }

    await iterator.return(undefined);
  });

  test('falls back to postgres when redis read fails', async () => {
    const logger = initLogger('streams-client-fallback-test');
    const redis = new FakeRedis();
    const driver = await createTestDriver();

    try {
      const client = await createStreamsClient({
        logger,
        redis: stub<Redis>(redis),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-fallback-test',
        },
      });

      await client.append<StatusEvents, 'status'>({
        streamKey: 'conversation:2',
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });

      redis.setFailReads(true);

      const read = await client.read<StatusEvents>({
        streamKey: 'conversation:2',
        limit: 10,
        readMode: 'redis_with_pg_fallback',
      });

      expect(read.items.length).toBe(1);
      expect(read.items[0]?.event).toBe('status');
      expect(read.items[0]?.data).toEqual({ status: 'started' });
      expect(decodeCursor(read.nextCursor ?? '')?.seq).toBe(1);
    } finally {
      await driver.disconnect();
    }
  });

  test('resyncs redis sequence from persisted floor after redis restart', async () => {
    const logger = initLogger('streams-client-seq-resync-test');
    const driver = await createTestDriver();

    try {
      const redisA = new FakeRedis();
      const firstClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisA),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-resync-test',
        },
      });

      const first = await firstClient.append<StatusEvents, 'status'>({
        streamKey: 'conversation:resync',
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });
      expect(decodeCursor(first.cursor)?.seq).toBe(1);

      // Simulate Dragonfly restart: sequence key resets while persisted rows remain.
      const redisB = new FakeRedis();
      const secondClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisB),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-resync-test',
        },
      });

      const second = await secondClient.append<StatusEvents, 'messageDelta'>({
        streamKey: 'conversation:resync',
        event: 'messageDelta',
        data: { delta: 'after-restart' },
        durability: 'strict',
      });

      expect(decodeCursor(second.cursor)?.seq).toBe(2);

      const pgRead = await secondClient.read<StatusEvents>({
        streamKey: 'conversation:resync',
        readMode: 'pg_only',
      });

      expect(pgRead.items.map((item) => item.event)).toEqual([
        'status',
        'messageDelta',
      ]);
      expect(pgRead.items[1]?.data).toEqual({ delta: 'after-restart' });
    } finally {
      await driver.disconnect();
    }
  });

  test('does not over-bump sequence when concurrent appends resync after restart', async () => {
    const logger = initLogger('streams-client-concurrent-seq-resync-test');
    const driver = await createTestDriver();

    try {
      const redisA = new FakeRedis();
      const firstClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisA),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-resync-concurrent-test',
        },
      });

      const first = await firstClient.append<StatusEvents, 'status'>({
        streamKey: 'conversation:resync-concurrent',
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });
      expect(decodeCursor(first.cursor)?.seq).toBe(1);

      const redisB = new FakeRedis();
      const secondClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisB),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-resync-concurrent-test',
        },
      });

      const [a, b] = await Promise.all([
        secondClient.append<StatusEvents, 'messageDelta'>({
          streamKey: 'conversation:resync-concurrent',
          event: 'messageDelta',
          data: { delta: 'a' },
          durability: 'strict',
        }),
        secondClient.append<StatusEvents, 'messageDelta'>({
          streamKey: 'conversation:resync-concurrent',
          event: 'messageDelta',
          data: { delta: 'b' },
          durability: 'strict',
        }),
      ]);

      const seqs = [
        decodeCursor(a.cursor)?.seq ?? 0,
        decodeCursor(b.cursor)?.seq ?? 0,
      ].sort((x, y) => x - y);

      expect(seqs).toEqual([2, 3]);

      const pgRead = await secondClient.read<StatusEvents>({
        streamKey: 'conversation:resync-concurrent',
        readMode: 'pg_only',
      });

      expect(
        pgRead.items.map((item) => decodeCursor(item.cursor)?.seq),
      ).toEqual([1, 2, 3]);
    } finally {
      await driver.disconnect();
    }
  });

  test('recovers when resume cursor is ahead of current redis tail', async () => {
    const logger = initLogger('streams-client-gap-detect-test');
    const driver = await createTestDriver();

    try {
      const redisA = new FakeRedis();
      const firstClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisA),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-gap-detect-test',
        },
      });

      await firstClient.append<StatusEvents, 'status'>({
        streamKey: 'conversation:gap-detect',
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });

      await firstClient.append<StatusEvents, 'messageDelta'>({
        streamKey: 'conversation:gap-detect',
        event: 'messageDelta',
        data: { delta: 'before-restart' },
        durability: 'strict',
      });

      const redisB = new FakeRedis();
      const secondClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisB),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-gap-detect-test',
        },
      });

      await secondClient.append<StatusEvents, 'status'>({
        streamKey: 'conversation:gap-detect',
        event: 'status',
        data: { status: 'completed' },
        durability: 'strict',
      });

      const impossibleFutureCursor = encodeCursor({
        streamKey: 'conversation:gap-detect',
        seq: 999,
        redisId: '9999999999999-0',
      });

      const iterator = secondClient.stream<StatusEvents>({
        streamKey: 'conversation:gap-detect',
        cursor: impossibleFutureCursor,
        readMode: 'redis_with_pg_fallback',
        blockMs: 50,
        limit: 10,
      });

      const first = await iterator.next();
      expect(first.value?.type).toBe('cursor');
      if (first.value?.type === 'cursor') {
        expect(first.value.status.phase).toBe('replay');
        expect(first.value.status.source).toBe('postgres');
        expect(first.value.status.reason).toBe('gap_detected');
      }

      const second = await iterator.next();
      expect(second.value?.type).toBe('cursor');
      if (second.value?.type === 'cursor') {
        expect(second.value.status.phase).toBe('live');
        expect(second.value.status.source).toBe('postgres');
        expect(second.value.status.reason).toBe('gap_detected');
      }

      const third = await iterator.next();
      expect(third.value?.type).toBe('cursor');
      if (third.value?.type === 'cursor') {
        expect(third.value.status.phase).toBe('live');
        expect(third.value.status.source).toBe('redis');
        expect(third.value.status.reason).toBe('gap_detected');
      }

      const nextAppend = await secondClient.append<
        StatusEvents,
        'messageDelta'
      >({
        streamKey: 'conversation:gap-detect',
        event: 'messageDelta',
        data: { delta: 'after-gap-recovery' },
        durability: 'strict',
      });
      expect(decodeCursor(nextAppend.cursor)?.seq).toBe(4);

      const fourth = await iterator.next();
      expect(fourth.value?.type).toBe('event');
      if (fourth.value?.type === 'event') {
        expect(fourth.value.item.event).toBe('messageDelta');
        expect(fourth.value.item.data).toEqual({ delta: 'after-gap-recovery' });
      }

      await iterator.return(undefined);
    } finally {
      await driver.disconnect();
    }
  });

  test('recovers when resume cursor has a redis id ahead of current tail', async () => {
    const logger = initLogger('streams-client-redisid-gap-test');
    const driver = await createTestDriver();

    try {
      const redisA = new FakeRedis();
      const firstClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisA),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-redisid-gap-test',
        },
      });

      await firstClient.append<StatusEvents, 'status'>({
        streamKey: 'conversation:redisid-gap',
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });

      await firstClient.append<StatusEvents, 'messageDelta'>({
        streamKey: 'conversation:redisid-gap',
        event: 'messageDelta',
        data: { delta: 'before-restart' },
        durability: 'strict',
      });

      const redisB = new FakeRedis();
      const secondClient = await createStreamsClient({
        logger,
        redis: stub<Redis>(redisB),
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: 'streams-redisid-gap-test',
        },
      });

      const existing = await secondClient.append<StatusEvents, 'status'>({
        streamKey: 'conversation:redisid-gap',
        event: 'status',
        data: { status: 'completed' },
        durability: 'strict',
      });

      const impossibleRedisIdCursor = encodeCursor({
        streamKey: 'conversation:redisid-gap',
        seq: 2,
        redisId: '9999999999999-0',
      });

      const iterator = secondClient.stream<StatusEvents>({
        streamKey: 'conversation:redisid-gap',
        cursor: impossibleRedisIdCursor,
        readMode: 'redis_with_pg_fallback',
        blockMs: 50,
        limit: 10,
      });

      const first = await iterator.next();
      expect(first.value?.type).toBe('cursor');
      if (first.value?.type === 'cursor') {
        expect(first.value.status.phase).toBe('replay');
        expect(first.value.status.source).toBe('postgres');
        expect(first.value.status.reason).toBe('gap_detected');
      }

      const second = await iterator.next();
      expect(second.value?.type).toBe('event');
      if (second.value?.type === 'event') {
        expect(second.value.item.event).toBe('status');
        expect(second.value.item.data).toEqual({ status: 'completed' });
      }

      const third = await iterator.next();
      expect(third.value?.type).toBe('cursor');
      if (third.value?.type === 'cursor') {
        expect(third.value.status.phase).toBe('live');
        expect(third.value.status.source).toBe('postgres');
        expect(third.value.status.reason).toBe('gap_detected');
      }

      const fourth = await iterator.next();
      expect(fourth.value?.type).toBe('cursor');
      if (fourth.value?.type === 'cursor') {
        expect(fourth.value.status.phase).toBe('live');
        expect(fourth.value.status.source).toBe('redis');
        expect(fourth.value.status.reason).toBe('gap_detected');
        expect(decodeCursor(fourth.value.status.cursor)?.seq).toBe(
          decodeCursor(existing.cursor)?.seq,
        );
      }

      const nextAppend = await secondClient.append<
        StatusEvents,
        'messageDelta'
      >({
        streamKey: 'conversation:redisid-gap',
        event: 'messageDelta',
        data: { delta: 'after-redisid-gap-recovery' },
        durability: 'strict',
      });
      expect(decodeCursor(nextAppend.cursor)?.seq).toBe(4);

      const fifth = await iterator.next();
      expect(fifth.value?.type).toBe('event');
      if (fifth.value?.type === 'event') {
        expect(fifth.value.item.event).toBe('messageDelta');
        expect(fifth.value.item.data).toEqual({
          delta: 'after-redisid-gap-recovery',
        });
      }

      await iterator.return(undefined);
    } finally {
      await driver.disconnect();
    }
  });
});
