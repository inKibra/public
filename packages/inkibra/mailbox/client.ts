import { decodeCursor, type StreamCursor } from '@inkibra/streams';
import type {
  CreateMailboxClientOptions,
  MailboxClient,
  MailboxDeadLetterEvent,
  MailboxIdleEvent,
  MailboxMessage,
  MailboxOperation,
  MailboxStreamEvents,
} from './types';

const DEFAULT_STREAM_PREFIX = 'mailbox';

export function createMailboxClient(
  options: CreateMailboxClientOptions,
): MailboxClient {
  const prefix = options.streamPrefix ?? DEFAULT_STREAM_PREFIX;

  async function scheduleIdleIfConfigured(args: {
    mailboxKey: string;
    markerCursor: StreamCursor;
    quietPeriodMs: number;
  }): Promise<void> {
    if (!options.idleScheduler) {
      return;
    }

    await options.idleScheduler.schedule({
      mailboxKey: args.mailboxKey,
      markerCursor: args.markerCursor,
      quietPeriodMs: args.quietPeriodMs,
      run: async () => {
        await client.emitIdleIfQuiet({
          mailboxKey: args.mailboxKey,
          markerCursor: args.markerCursor,
          quietPeriodMs: args.quietPeriodMs,
        });
      },
    });
  }

  const client: MailboxClient = {
    appendOperation: async <TPayload = unknown>(args: {
      mailboxKey: string;
      operation: MailboxOperation<TPayload>;
      quietPeriodMs?: number;
    }) => {
      const quietPeriodMs = args.quietPeriodMs ?? options.quietPeriodMs;
      const streamKey = inboxStreamKey(prefix, args.mailboxKey);
      const result = await options.streams.append<MailboxStreamEvents, 'op'>({
        streamKey,
        event: 'op',
        data: {
          operation: {
            ...args.operation,
            createdAt: args.operation.createdAt ?? new Date().toISOString(),
          },
        },
      });

      void (async () => {
        const prevState = await options.stateStore.getState(args.mailboxKey);
        // Only advance cursor forward to prevent concurrent appends from
        // overwriting with an older cursor value.
        const currentCursor = prevState?.lastWriteCursor;
        if (currentCursor && currentCursor >= result.cursor) {
          // Another concurrent append already advanced past this cursor
        } else {
          await options.stateStore.setState(args.mailboxKey, {
            ...prevState,
            lastWriteCursor: result.cursor,
          });
        }

        if (quietPeriodMs && quietPeriodMs > 0) {
          await scheduleIdleIfConfigured({
            mailboxKey: args.mailboxKey,
            markerCursor: result.cursor,
            quietPeriodMs,
          });
        }
      })();

      return result;
    },

    readBatch: async (args) => {
      const streamKey = inboxStreamKey(prefix, args.mailboxKey);
      const cursor = await options.cursorStore.getCursor(
        args.mailboxKey,
        args.consumerKey,
      );
      const read = await options.streams.read<MailboxStreamEvents>({
        streamKey,
        cursor,
        limit: args.limit ?? 100,
      });

      const messages: MailboxMessage[] = read.items
        .map(
          (item: {
            event: string;
            data: unknown;
            cursor: StreamCursor;
            ts: string;
          }) => mapStreamMessage(item),
        )
        .filter(
          (item: MailboxMessage | null): item is MailboxMessage =>
            item !== null,
        );

      return {
        messages,
        nextCursor: read.nextCursor,
      };
    },

    commit: async (args) => {
      const existingCursor = await options.cursorStore.getCursor(
        args.mailboxKey,
        args.consumerKey,
      );
      const cursorOrder = compareCursorProgress(existingCursor, args.cursor);
      if (cursorOrder === 'same' || cursorOrder === 'behind') {
        return;
      }

      await options.cursorStore.setCursor(
        args.mailboxKey,
        args.consumerKey,
        args.cursor,
      );
    },

    sendToDlq: async (args) => {
      const streamKey = dlqStreamKey(prefix, args.mailboxKey);
      const event: MailboxDeadLetterEvent = {
        mailboxKey: args.mailboxKey,
        operation: args.operation,
        reason: args.reason,
        error: args.error,
        failedAt: new Date().toISOString(),
      };

      return options.streams.append<MailboxStreamEvents, 'dlq'>({
        streamKey,
        event: 'dlq',
        data: event,
      });
    },

    emitIdleIfQuiet: async (args) => {
      const state = await options.stateStore.getState(args.mailboxKey);
      if (!state?.lastWriteCursor) {
        return { emitted: false };
      }

      if (state.lastWriteCursor !== args.markerCursor) {
        return { emitted: false };
      }

      if (state.lastIdleMarkerCursor === args.markerCursor) {
        return { emitted: false };
      }

      const streamKey = inboxStreamKey(prefix, args.mailboxKey);
      const idleEvent: MailboxIdleEvent = {
        mailboxKey: args.mailboxKey,
        markerCursor: args.markerCursor,
        quietPeriodMs: args.quietPeriodMs,
        emittedAt: new Date().toISOString(),
      };

      const result = await options.streams.append<MailboxStreamEvents, 'idle'>({
        streamKey,
        event: 'idle',
        data: idleEvent,
      });

      await options.stateStore.setState(args.mailboxKey, {
        ...state,
        lastIdleMarkerCursor: args.markerCursor,
      });

      return { emitted: true, cursor: result.cursor };
    },

    getConsumerCursor: async (args) => {
      return options.cursorStore.getCursor(args.mailboxKey, args.consumerKey);
    },

    peekBatch: async (args) => {
      const streamKey = inboxStreamKey(prefix, args.mailboxKey);
      const read = await options.streams.read<MailboxStreamEvents>({
        streamKey,
        cursor: args.cursor,
        limit: args.limit ?? 100,
      });

      const messages: MailboxMessage[] = read.items
        .map(
          (item: {
            event: string;
            data: unknown;
            cursor: StreamCursor;
            ts: string;
          }) => mapStreamMessage(item),
        )
        .filter(
          (item: MailboxMessage | null): item is MailboxMessage =>
            item !== null,
        );

      return {
        messages,
        nextCursor: read.nextCursor,
      };
    },
  };

  return client;
}

function mapStreamMessage(message: {
  event: string;
  data: unknown;
  cursor: StreamCursor;
  ts: string;
}): MailboxMessage | null {
  if (message.event === 'op' && isOperationEnvelope(message.data)) {
    return {
      kind: 'op',
      operation: message.data.operation,
      cursor: message.cursor,
      ts: message.ts,
    };
  }

  if (message.event === 'idle' && isMailboxIdleEvent(message.data)) {
    return {
      kind: 'idle',
      idle: message.data,
      cursor: message.cursor,
      ts: message.ts,
    };
  }

  if (message.event === 'dlq' && isMailboxDeadLetterEvent(message.data)) {
    return {
      kind: 'dlq',
      deadLetter: message.data,
      cursor: message.cursor,
      ts: message.ts,
    };
  }

  return null;
}

function inboxStreamKey(prefix: string, mailboxKey: string): string {
  return `${prefix}:${mailboxKey}:inbox`;
}

function dlqStreamKey(prefix: string, mailboxKey: string): string {
  return `${prefix}:${mailboxKey}:dlq`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMailboxOperation(value: unknown): value is MailboxOperation {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.opId === 'string' &&
    typeof value.kind === 'string' &&
    'payload' in value &&
    typeof value.createdAt === 'string'
  );
}

function isOperationEnvelope(
  value: unknown,
): value is { operation: MailboxOperation } {
  if (!isObjectRecord(value)) {
    return false;
  }

  return isMailboxOperation(value.operation);
}

function isMailboxIdleEvent(value: unknown): value is MailboxIdleEvent {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.mailboxKey === 'string' &&
    typeof value.markerCursor === 'string' &&
    typeof value.quietPeriodMs === 'number' &&
    typeof value.emittedAt === 'string'
  );
}

function isMailboxDeadLetterEvent(
  value: unknown,
): value is MailboxDeadLetterEvent {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.mailboxKey === 'string' &&
    isMailboxOperation(value.operation) &&
    typeof value.reason === 'string' &&
    typeof value.failedAt === 'string'
  );
}

type CursorProgress = 'ahead' | 'same' | 'behind' | 'incomparable';

type ComparableCursor =
  | {
      kind: 'streams';
      seq: number;
      streamKey: string;
    }
  | {
      kind: 'fake';
      seq: number;
    };

function compareCursorProgress(
  existing: StreamCursor | undefined,
  incoming: StreamCursor,
): CursorProgress {
  if (!existing) {
    return 'ahead';
  }

  if (existing === incoming) {
    return 'same';
  }

  const existingComparable = toComparableCursor(existing);
  const incomingComparable = toComparableCursor(incoming);

  if (!existingComparable || !incomingComparable) {
    return 'incomparable';
  }

  if (existingComparable.kind !== incomingComparable.kind) {
    return 'incomparable';
  }

  if (
    existingComparable.kind === 'streams' &&
    incomingComparable.kind === 'streams'
  ) {
    if (existingComparable.streamKey !== incomingComparable.streamKey) {
      return 'incomparable';
    }
  }

  if (incomingComparable.seq > existingComparable.seq) {
    return 'ahead';
  }

  if (incomingComparable.seq < existingComparable.seq) {
    return 'behind';
  }

  return 'same';
}

function toComparableCursor(cursor: StreamCursor): ComparableCursor | null {
  const decoded = decodeCursor(cursor);
  if (decoded) {
    return {
      kind: 'streams',
      seq: decoded.seq,
      streamKey: decoded.streamKey,
    };
  }

  const fakeMatch = /^fake\.(\d+)$/.exec(cursor);
  if (fakeMatch) {
    return {
      kind: 'fake',
      seq: Number(fakeMatch[1]),
    };
  }

  return null;
}
