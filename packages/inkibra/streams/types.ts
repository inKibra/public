import type {
  Driver,
  EnsureCollectionOptions,
  TypedObjectBase,
} from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import type { Redis } from 'ioredis';

export type StreamDurability = 'volatile' | 'buffered' | 'strict';

export type StreamReadMode =
  | 'redis_only'
  | 'redis_with_pg_fallback'
  | 'pg_only';

export type StreamRetention = {
  maxAgeMs?: number;
  maxLen?: number;
};

export type StreamSettings = {
  durability?: StreamDurability;
  retention?: StreamRetention;
};

export type StreamDefaults = {
  readMode?: StreamReadMode;
  durability?: StreamDurability;
  retention?: StreamRetention;
  redisPrefix?: string;
};

export type StreamCursor = string;

export type StreamCursorStatusReason =
  | 'cursor_trimmed'
  | 'redis_unavailable'
  | 'gap_detected';

export type StreamCursorStatus = {
  cursor: StreamCursor;
  phase: 'replay' | 'live';
  source: 'redis' | 'postgres';
  recovered?: boolean;
  reason?: StreamCursorStatusReason;
};

export type StreamEnvelope<TEvent extends string, TData> = {
  event: TEvent;
  data: TData;
  cursor: StreamCursor;
  ts: string;
};

export type StreamMessage<TEvents extends object> = {
  [K in keyof TEvents]: StreamEnvelope<K & string, TEvents[K]>;
}[keyof TEvents];

export type StreamItem<TEvents extends object> =
  | { type: 'event'; item: StreamMessage<TEvents> }
  | { type: 'cursor'; status: StreamCursorStatus };

export type StreamAppendArgs<
  TEvents extends object,
  K extends keyof TEvents & string,
> = {
  streamKey: string;
  event: K & string;
  data: TEvents[K];
  durability?: StreamDurability;
  retention?: StreamRetention;
  idempotencyKey?: string;
};

export type StreamReadArgs = {
  streamKey: string;
  cursor?: StreamCursor;
  limit?: number;
  readMode?: StreamReadMode;
};

// StreamArgs extends StreamReadArgs with optional blockMs for long-polling
// and optional AbortSignal for graceful cancellation of the live tail loop.
export type StreamArgs = StreamReadArgs & {
  blockMs?: number;
  signal?: AbortSignal;
};

export type StreamsClient = {
  append<TEvents extends object, K extends keyof TEvents & string>(
    args: StreamAppendArgs<TEvents, K>,
  ): Promise<{ cursor: StreamCursor }>;
  latestCursor(args: { streamKey: string }): Promise<StreamCursor>;
  stream<TEvents extends object>(
    args: StreamArgs,
  ): AsyncGenerator<StreamItem<TEvents>, void, unknown>;
  read<TEvents extends object>(
    args: StreamReadArgs,
  ): Promise<{
    items: Array<StreamMessage<TEvents>>;
    nextCursor?: StreamCursor;
  }>;
};

export type CreateStreamsClientOptions = {
  logger: Logger;
  redis: Redis;
  driver?: Driver;
  defaults?: StreamDefaults;
  streams?: Record<string, StreamSettings>;
  collectionName?: string;
  ensureCollectionOptions?: EnsureCollectionOptions;
};

export type CursorState = {
  streamKey: string;
  seq: number;
  redisId: string;
};

export type PersistedStreamEvent = TypedObjectBase & {
  type: 'STREAM_EVENT';
  version: 1;
  streamKey: string;
  seq: number;
  redisId: string;
  event: string;
  dataJson: string;
  ts: string;
  idempotencyKey?: string;
};
