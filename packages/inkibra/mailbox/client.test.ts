import { describe, expect, test } from 'bun:test';
import { FakeStreamsClient } from './__tests__/fixtures/fake-streams-client';
import { createMailboxClient } from './client';
import {
  createInMemoryIdleScheduler,
  createInMemoryMailboxCursorStore,
  createInMemoryMailboxStateStore,
} from './memory';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mailbox client', () => {
  test('appends, reads, and commits mailbox operations per consumer cursor', async () => {
    const streams = new FakeStreamsClient();
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
    });

    const first = await mailbox.appendOperation({
      mailboxKey: 'construct:abc',
      operation: {
        opId: 'op-1',
        kind: 'user_message',
        payload: { text: 'hello' },
        createdAt: new Date().toISOString(),
      },
    });

    const read1 = await mailbox.readBatch({
      mailboxKey: 'construct:abc',
      consumerKey: 'worker-1',
      limit: 10,
    });

    expect(read1.messages.length).toBe(1);
    expect(read1.messages[0]?.kind).toBe('op');
    if (read1.messages[0]?.kind === 'op') {
      expect(read1.messages[0].operation.opId).toBe('op-1');
    }

    await mailbox.commit({
      mailboxKey: 'construct:abc',
      consumerKey: 'worker-1',
      cursor: first.cursor,
    });

    const read2 = await mailbox.readBatch({
      mailboxKey: 'construct:abc',
      consumerKey: 'worker-1',
      limit: 10,
    });
    expect(read2.messages.length).toBe(0);
  });

  test('commit is monotonic and ignores stale cursor regressions for same consumer', async () => {
    const streams = new FakeStreamsClient();
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
    });

    const first = await mailbox.appendOperation({
      mailboxKey: 'construct:monotonic',
      operation: {
        opId: 'op-1',
        kind: 'user_message',
        payload: { text: 'first' },
        createdAt: new Date().toISOString(),
      },
    });
    const second = await mailbox.appendOperation({
      mailboxKey: 'construct:monotonic',
      operation: {
        opId: 'op-2',
        kind: 'user_message',
        payload: { text: 'second' },
        createdAt: new Date().toISOString(),
      },
    });

    await mailbox.commit({
      mailboxKey: 'construct:monotonic',
      consumerKey: 'worker-1',
      cursor: second.cursor,
    });
    await mailbox.commit({
      mailboxKey: 'construct:monotonic',
      consumerKey: 'worker-1',
      cursor: first.cursor,
    });

    const cursor = await mailbox.getConsumerCursor({
      mailboxKey: 'construct:monotonic',
      consumerKey: 'worker-1',
    });
    expect(cursor).toBe(second.cursor);

    const read = await mailbox.readBatch({
      mailboxKey: 'construct:monotonic',
      consumerKey: 'worker-1',
      limit: 10,
    });
    expect(read.messages.length).toBe(0);
  });

  test('consumer cursor monotonicity is isolated per consumer key', async () => {
    const streams = new FakeStreamsClient();
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
    });

    const first = await mailbox.appendOperation({
      mailboxKey: 'construct:isolation',
      operation: {
        opId: 'op-1',
        kind: 'user_message',
        payload: { text: 'first' },
        createdAt: new Date().toISOString(),
      },
    });
    const second = await mailbox.appendOperation({
      mailboxKey: 'construct:isolation',
      operation: {
        opId: 'op-2',
        kind: 'user_message',
        payload: { text: 'second' },
        createdAt: new Date().toISOString(),
      },
    });

    await mailbox.commit({
      mailboxKey: 'construct:isolation',
      consumerKey: 'worker-a',
      cursor: second.cursor,
    });
    await mailbox.commit({
      mailboxKey: 'construct:isolation',
      consumerKey: 'worker-a',
      cursor: first.cursor,
    });

    await mailbox.commit({
      mailboxKey: 'construct:isolation',
      consumerKey: 'worker-b',
      cursor: first.cursor,
    });

    const workerACursor = await mailbox.getConsumerCursor({
      mailboxKey: 'construct:isolation',
      consumerKey: 'worker-a',
    });
    const workerBCursor = await mailbox.getConsumerCursor({
      mailboxKey: 'construct:isolation',
      consumerKey: 'worker-b',
    });

    expect(workerACursor).toBe(second.cursor);
    expect(workerBCursor).toBe(first.cursor);

    const readA = await mailbox.readBatch({
      mailboxKey: 'construct:isolation',
      consumerKey: 'worker-a',
      limit: 10,
    });
    expect(readA.messages.length).toBe(0);

    const readB = await mailbox.readBatch({
      mailboxKey: 'construct:isolation',
      consumerKey: 'worker-b',
      limit: 10,
    });
    expect(readB.messages.length).toBe(1);
    expect(readB.messages[0]?.kind).toBe('op');
    if (readB.messages[0]?.kind === 'op') {
      expect(readB.messages[0].operation.opId).toBe('op-2');
    }
  });

  test('emits idle event once per quiet period marker', async () => {
    const streams = new FakeStreamsClient();
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
    });

    const write = await mailbox.appendOperation({
      mailboxKey: 'construct:quiet',
      operation: {
        opId: 'op-quiet-1',
        kind: 'system_event',
        payload: { kind: 'tick' },
        createdAt: new Date().toISOString(),
      },
    });

    const firstEmit = await mailbox.emitIdleIfQuiet({
      mailboxKey: 'construct:quiet',
      markerCursor: write.cursor,
      quietPeriodMs: 1000,
    });
    const secondEmit = await mailbox.emitIdleIfQuiet({
      mailboxKey: 'construct:quiet',
      markerCursor: write.cursor,
      quietPeriodMs: 1000,
    });

    expect(firstEmit.emitted).toBe(true);
    expect(secondEmit.emitted).toBe(false);

    const read = await mailbox.readBatch({
      mailboxKey: 'construct:quiet',
      consumerKey: 'reader',
      limit: 10,
    });

    expect(read.messages.map((x) => x.kind)).toEqual(['op', 'idle']);
  });

  test('sends dead-letter events to dlq stream', async () => {
    const streams = new FakeStreamsClient();
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
    });

    await mailbox.sendToDlq({
      mailboxKey: 'construct:dlq',
      operation: {
        opId: 'op-bad',
        kind: 'user_message',
        payload: { text: 'bad op' },
        createdAt: new Date().toISOString(),
      },
      reason: 'validation_failed',
      error: 'schema mismatch',
    });

    const read = await streams.read<{ dlq: { reason: string } }>({
      streamKey: 'mailbox:construct:dlq:dlq',
      limit: 10,
    });
    expect(read.items.length).toBe(1);
    expect(read.items[0]?.event).toBe('dlq');
  });

  test('auto-schedules idle emission when quiet period is configured', async () => {
    const streams = new FakeStreamsClient();
    const mailbox = createMailboxClient({
      streams,
      cursorStore: createInMemoryMailboxCursorStore(),
      stateStore: createInMemoryMailboxStateStore(),
      idleScheduler: createInMemoryIdleScheduler(),
      quietPeriodMs: 20,
    });

    await mailbox.appendOperation({
      mailboxKey: 'construct:auto-idle',
      operation: {
        opId: 'op-auto-1',
        kind: 'user_message',
        payload: { text: 'hello' },
        createdAt: new Date().toISOString(),
      },
    });

    await sleep(60);

    const read = await mailbox.readBatch({
      mailboxKey: 'construct:auto-idle',
      consumerKey: 'reader',
      limit: 10,
    });

    expect(read.messages.some((m) => m.kind === 'idle')).toBe(true);
  });
});
