import { describe, expect, test } from 'bun:test';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import {
  appendPersistedEvent,
  initializeStreamsCollection,
  readLatestPersistedEvent,
  readLatestPersistedSeq,
  readPersistedEventsAfter,
} from './postgres-mirror';
import type { PersistedStreamEvent } from './types';

function makeEvent(
  streamKey: string,
  seq: number,
  event: string,
  data: unknown,
): PersistedStreamEvent {
  const now = new Date().toISOString();
  return {
    id: `${streamKey}:${seq}`,
    type: 'STREAM_EVENT',
    version: 1,
    streamKey,
    seq,
    redisId: `${Date.now()}-${seq}`,
    event,
    dataJson: JSON.stringify(data),
    ts: now,
    created: now,
    modified: now,
  };
}

describe('postgres mirror', () => {
  test('initializes collection and reads persisted events by stream and sequence', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('streams-postgres-mirror-test');
    const collectionName = 'streams-test';

    try {
      await initializeStreamsCollection(logger, driver, collectionName, {
        createIfNotExists: true,
      });

      await appendPersistedEvent(
        logger,
        driver,
        collectionName,
        makeEvent('stream-a', 1, 'status', { status: 'started' }),
      );
      await appendPersistedEvent(
        logger,
        driver,
        collectionName,
        makeEvent('stream-a', 2, 'messageDelta', { delta: 'Hello' }),
      );
      await appendPersistedEvent(
        logger,
        driver,
        collectionName,
        makeEvent('stream-b', 1, 'status', { status: 'started' }),
      );

      const streamAAfter1 = await readPersistedEventsAfter(
        logger,
        driver,
        collectionName,
        'stream-a',
        1,
        10,
      );

      expect(streamAAfter1.map((x) => x.seq)).toEqual([2]);
      expect(streamAAfter1[0]?.event).toBe('messageDelta');

      const latestEventA = await readLatestPersistedEvent(
        logger,
        driver,
        collectionName,
        'stream-a',
      );
      const latestA = await readLatestPersistedSeq(
        logger,
        driver,
        collectionName,
        'stream-a',
      );
      const latestB = await readLatestPersistedSeq(
        logger,
        driver,
        collectionName,
        'stream-b',
      );

      expect(latestEventA?.seq).toBe(2);
      expect(latestEventA?.event).toBe('messageDelta');
      expect(latestA).toBe(2);
      expect(latestB).toBe(1);
    } finally {
      await driver.disconnect();
    }
  });

  test('reads latest and after-seq correctly when seq crosses 9999', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('streams-postgres-mirror-seq-order-test');
    const collectionName = 'streams-seq-order-test';

    try {
      await initializeStreamsCollection(logger, driver, collectionName, {
        createIfNotExists: true,
      });

      await appendPersistedEvent(
        logger,
        driver,
        collectionName,
        makeEvent('stream-c', 9999, 'thinkingDelta', { n: 9999 }),
      );
      await appendPersistedEvent(
        logger,
        driver,
        collectionName,
        makeEvent('stream-c', 10000, 'thinkingDelta', { n: 10000 }),
      );
      await appendPersistedEvent(
        logger,
        driver,
        collectionName,
        makeEvent('stream-c', 10001, 'constructEvent', { n: 10001 }),
      );

      const latest = await readLatestPersistedSeq(
        logger,
        driver,
        collectionName,
        'stream-c',
      );
      expect(latest).toBe(10001);

      const after = await readPersistedEventsAfter(
        logger,
        driver,
        collectionName,
        'stream-c',
        9999,
        10,
      );
      expect(after.map((item) => item.seq)).toEqual([10000, 10001]);
    } finally {
      await driver.disconnect();
    }
  });
});
