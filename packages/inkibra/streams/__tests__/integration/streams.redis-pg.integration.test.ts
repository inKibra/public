import { describe, expect, test } from 'bun:test';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import Redis from 'ioredis';
import { createStreamsClient } from '../../client';
import { decodeCursor } from '../../cursor';

type Events = {
  status: { status: 'started' | 'completed' | 'failed' };
  messageDelta: { delta: string };
};

const runIntegration = process.env.STREAMS_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

describeIntegration('streams redis+postgres integration', () => {
  test('replays from an empty-stream live cursor for a later subscriber', async () => {
    const host = process.env.STREAMS_DRAGONFLY_HOST;
    const portRaw = process.env.STREAMS_DRAGONFLY_PORT;
    if (!host || !portRaw) {
      throw new Error('Missing STREAMS_DRAGONFLY_HOST/STREAMS_DRAGONFLY_PORT');
    }

    const logger = initLogger('streams-empty-live-cursor-integration-test');
    const redis = new Redis({ host, port: Number(portRaw) });
    const driver = await createTestDriver();
    const prefix = `streams-int-empty-live-${Date.now()}`;
    const streamKey = 'conversation:empty-live-cursor';

    try {
      const client = await createStreamsClient({
        logger,
        redis,
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: prefix,
          readMode: 'redis_with_pg_fallback',
        },
      });

      const subscriberA = client.stream<Events>({
        streamKey,
        blockMs: 100,
        limit: 50,
      });

      const a1 = await withTimeout(subscriberA.next(), 2000);
      const a2 = await withTimeout(subscriberA.next(), 2000);

      expect(a1.value?.type).toBe('cursor');
      if (a1.value?.type === 'cursor') {
        expect(a1.value.status.phase).toBe('replay');
        expect(a1.value.status.source).toBe('redis');
      }

      expect(a2.value?.type).toBe('cursor');
      let resumeCursor: string | undefined;
      if (a2.value?.type === 'cursor') {
        expect(a2.value.status.phase).toBe('live');
        expect(a2.value.status.source).toBe('redis');
        expect(decodeCursor(a2.value.status.cursor)?.redisId).toBe('0-0');
        resumeCursor = a2.value.status.cursor;
      }

      if (!resumeCursor) {
        throw new Error('Expected subscriber A live cursor');
      }

      await client.append<Events, 'status'>({
        streamKey,
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });

      const a3 = await withTimeout(subscriberA.next(), 3000);
      expect(a3.value?.type).toBe('event');
      if (a3.value?.type === 'event') {
        expect(a3.value.item.event).toBe('status');
        expect(a3.value.item.data).toEqual({ status: 'started' });
      }

      const subscriberB = client.stream<Events>({
        streamKey,
        cursor: resumeCursor,
        blockMs: 100,
        limit: 50,
      });

      const b1 = await withTimeout(subscriberB.next(), 2000);
      const b2 = await withTimeout(subscriberB.next(), 2000);
      const b3 = await withTimeout(subscriberB.next(), 2000);

      expect(b1.value?.type).toBe('cursor');
      if (b1.value?.type === 'cursor') {
        expect(b1.value.status.phase).toBe('replay');
        expect(b1.value.status.source).toBe('redis');
      }

      expect(b2.value?.type).toBe('event');
      if (b2.value?.type === 'event') {
        expect(b2.value.item.event).toBe('status');
        expect(b2.value.item.data).toEqual({ status: 'started' });
      }

      expect(b3.value?.type).toBe('cursor');
      if (b3.value?.type === 'cursor') {
        expect(b3.value.status.phase).toBe('live');
        expect(b3.value.status.source).toBe('redis');
      }

      await subscriberA.return(undefined);
      await subscriberB.return(undefined);
    } finally {
      await redis.quit();
      await driver.disconnect();
    }
  }, 30_000);

  test('two subscribers can replay missed events and continue tailing live events', async () => {
    const host = process.env.STREAMS_DRAGONFLY_HOST;
    const portRaw = process.env.STREAMS_DRAGONFLY_PORT;
    if (!host || !portRaw) {
      throw new Error('Missing STREAMS_DRAGONFLY_HOST/STREAMS_DRAGONFLY_PORT');
    }

    const logger = initLogger('streams-two-subscribers-integration-test');
    const redis = new Redis({ host, port: Number(portRaw) });
    const driver = await createTestDriver();
    const prefix = `streams-int-two-subscribers-${Date.now()}`;
    const streamKey = 'conversation:two-subscribers';

    try {
      const client = await createStreamsClient({
        logger,
        redis,
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: prefix,
          readMode: 'redis_with_pg_fallback',
        },
      });

      const subscriberA = client.stream<Events>({
        streamKey,
        blockMs: 100,
        limit: 50,
      });

      await withTimeout(subscriberA.next(), 2000); // replay cursor
      const aLive = await withTimeout(subscriberA.next(), 2000);
      expect(aLive.value?.type).toBe('cursor');
      const resumeCursor =
        aLive.value?.type === 'cursor' ? aLive.value.status.cursor : undefined;
      if (!resumeCursor) {
        throw new Error('Expected subscriber A live cursor');
      }

      await client.append<Events, 'status'>({
        streamKey,
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });

      const aFirstEvent = await withTimeout(subscriberA.next(), 3000);
      expect(aFirstEvent.value?.type).toBe('event');

      const subscriberB = client.stream<Events>({
        streamKey,
        cursor: resumeCursor,
        blockMs: 100,
        limit: 50,
      });

      await withTimeout(subscriberB.next(), 2000); // replay cursor
      const bReplayed = await withTimeout(subscriberB.next(), 2000);
      const bLive = await withTimeout(subscriberB.next(), 2000);
      expect(bReplayed.value?.type).toBe('event');
      if (bReplayed.value?.type === 'event') {
        expect(bReplayed.value.item.event).toBe('status');
        expect(bReplayed.value.item.data).toEqual({ status: 'started' });
      }
      expect(bLive.value?.type).toBe('cursor');

      await client.append<Events, 'messageDelta'>({
        streamKey,
        event: 'messageDelta',
        data: { delta: 'live-update' },
        durability: 'strict',
      });

      const aSecondEvent = await withTimeout(subscriberA.next(), 3000);
      const bSecondEvent = await withTimeout(subscriberB.next(), 3000);
      expect(aSecondEvent.value?.type).toBe('event');
      expect(bSecondEvent.value?.type).toBe('event');
      if (aSecondEvent.value?.type === 'event') {
        expect(aSecondEvent.value.item.event).toBe('messageDelta');
        expect(aSecondEvent.value.item.data).toEqual({ delta: 'live-update' });
      }
      if (bSecondEvent.value?.type === 'event') {
        expect(bSecondEvent.value.item.event).toBe('messageDelta');
        expect(bSecondEvent.value.item.data).toEqual({ delta: 'live-update' });
      }

      await subscriberA.return(undefined);
      await subscriberB.return(undefined);
    } finally {
      await redis.quit();
      await driver.disconnect();
    }
  }, 30_000);

  test('replays from postgres when redis cursor is trimmed and resumes live redis', async () => {
    const host = process.env.STREAMS_DRAGONFLY_HOST;
    const portRaw = process.env.STREAMS_DRAGONFLY_PORT;
    if (!host || !portRaw) {
      throw new Error('Missing STREAMS_DRAGONFLY_HOST/STREAMS_DRAGONFLY_PORT');
    }

    const logger = initLogger('streams-integration-test');
    const redis = new Redis({ host, port: Number(portRaw) });
    const driver = await createTestDriver();
    const prefix = `streams-int-${Date.now()}`;
    const streamKey = 'conversation:integration';

    try {
      const client = await createStreamsClient({
        logger,
        redis,
        driver,
        ensureCollectionOptions: {
          createIfNotExists: true,
        },
        defaults: {
          redisPrefix: prefix,
          readMode: 'redis_with_pg_fallback',
        },
      });

      const first = await client.append<Events, 'status'>({
        streamKey,
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });
      await client.append<Events, 'messageDelta'>({
        streamKey,
        event: 'messageDelta',
        data: { delta: 'two' },
        durability: 'strict',
      });
      const third = await client.append<Events, 'messageDelta'>({
        streamKey,
        event: 'messageDelta',
        data: { delta: 'three' },
        durability: 'strict',
      });

      const redisKey = `${prefix}:stream:${streamKey}`;
      const thirdState = decodeCursor(third.cursor);
      if (!thirdState) {
        throw new Error('Failed to decode third cursor');
      }
      await redis.xtrim(redisKey, 'MINID', thirdState.redisId);

      const iterator = client.stream<Events>({
        streamKey,
        cursor: first.cursor,
        blockMs: 100,
        limit: 50,
      });

      const p1 = await withTimeout(iterator.next(), 2000);
      const p2 = await withTimeout(iterator.next(), 2000);
      const p3 = await withTimeout(iterator.next(), 2000);
      const p4 = await withTimeout(iterator.next(), 2000);

      expect(p1.value?.type).toBe('cursor');
      if (p1.value?.type === 'cursor') {
        expect(p1.value.status.source).toBe('postgres');
        expect(p1.value.status.phase).toBe('replay');
        expect(p1.value.status.reason).toBe('cursor_trimmed');
      }

      expect(p2.value?.type).toBe('event');
      expect(p3.value?.type).toBe('event');
      if (p2.value?.type === 'event' && p3.value?.type === 'event') {
        expect(decodeCursor(p2.value.item.cursor)?.seq).toBe(2);
        expect(decodeCursor(p3.value.item.cursor)?.seq).toBe(3);
      }

      expect(p4.value?.type).toBe('cursor');
      if (p4.value?.type === 'cursor') {
        expect(p4.value.status.source).toBe('postgres');
        expect(p4.value.status.phase).toBe('live');
      }

      const p5 = await withTimeout(iterator.next(), 3000);
      if (p5.value?.type === 'cursor') {
        expect(p5.value.status.source).toBe('redis');
        expect(p5.value.status.phase).toBe('live');
        expect(p5.value.status.recovered).toBe(true);

        await client.append<Events, 'messageDelta'>({
          streamKey,
          event: 'messageDelta',
          data: { delta: 'four' },
          durability: 'strict',
        });

        const p6 = await withTimeout(iterator.next(), 3000);
        expect(p6.value?.type).toBe('event');
        if (p6.value?.type === 'event') {
          expect(decodeCursor(p6.value.item.cursor)?.seq).toBe(4);
          expect(p6.value.item.data).toEqual({ delta: 'four' });
        }
      } else {
        expect(p5.value?.type).toBe('event');
        if (p5.value?.type === 'event') {
          expect(decodeCursor(p5.value.item.cursor)?.seq).toBe(4);
          expect(p5.value.item.data).toEqual({ delta: 'four' });
        }
      }

      await iterator.return(undefined);
    } finally {
      await redis.quit();
      await driver.disconnect();
    }
  }, 30_000);
});
