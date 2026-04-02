/**
 * EventStream Channel - Abstract pub/sub interface
 *
 * The channel provides the core abstraction for EventStream pub/sub.
 * This is transport-agnostic - implementations can be in-memory (testing)
 * or Redis-backed (production).
 *
 * Supports the `using` syntax for automatic cleanup via Symbol.asyncDispose.
 */

import type { EventStreamEventTypes } from '../constants/event-stream';
import type {
  AnyEventStreamRoute,
  EventStreamRouteArgs,
  EventStreamRouteCompletion,
  EventStreamRouteEventTypes,
} from './event-stream-route';
import type { Result } from './result';

// ============================================================================
// Channel Types
// ============================================================================

/**
 * Completion type definition for a channel
 */
export type ChannelCompletion<TData, TError> = {
  data: TData;
  error: TError;
};

/**
 * Message types sent through a channel
 */
export type ChannelMessage<
  TEvents,
  TCompletion extends ChannelCompletion<unknown, unknown>,
> =
  | { type: 'event'; event: keyof TEvents; data: TEvents[keyof TEvents] }
  | {
      type: 'complete';
      result: Result<TCompletion['data'], TCompletion['error']>;
    };

/**
 * EventStream Channel - pub/sub interface
 *
 * @template TEvents - Map of event names to event data types
 * @template TCompletion - Completion type (data and error)
 */
export type EventStreamChannel<
  TEvents extends EventStreamEventTypes,
  TCompletion extends ChannelCompletion<unknown, unknown>,
> = {
  /**
   * Publish an event to all subscribers
   */
  publish<K extends keyof TEvents>(event: K, data: TEvents[K]): Promise<void>;

  /**
   * Complete the channel with a result (success or error)
   * After completion, no more events can be published
   */
  complete(
    result: Result<TCompletion['data'], TCompletion['error']>,
  ): Promise<void>;

  /**
   * Async iterator for consuming events
   * Yields events until completion, then returns
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<{
    event: keyof TEvents;
    data: TEvents[keyof TEvents];
  }>;

  /**
   * Cleanup when done (unsubscribe, close connections)
   * Supports `using` syntax
   */
  [Symbol.asyncDispose](): Promise<void>;
};

/**
 * EventStream Channel Factory - creates channels for routes
 */
type CompletionFromRoute<R extends AnyEventStreamRoute> =
  EventStreamRouteCompletion<R> extends Result<infer D, infer E>
    ? ChannelCompletion<D, E>
    : ChannelCompletion<unknown, unknown>;

export type EventStreamChannelFactory = {
  /**
   * Get a channel for a specific route and args
   * Same route + args = same channel (for pub/sub)
   */
  get<R extends AnyEventStreamRoute>(
    route: R,
    args: EventStreamRouteArgs<R>,
  ): EventStreamChannel<
    EventStreamRouteEventTypes<R> extends EventStreamEventTypes
      ? EventStreamRouteEventTypes<R>
      : EventStreamEventTypes,
    CompletionFromRoute<R>
  >;
};

// ============================================================================
// In-Memory Channel Implementation
// ============================================================================

type Subscriber = (
  msg: ChannelMessage<
    EventStreamEventTypes,
    ChannelCompletion<unknown, unknown>
  >,
) => void;

/**
 * Create an in-memory channel factory
 *
 * For testing and single-process usage. Does not support multi-server.
 *
 * @example
 * ```typescript
 * const channelFactory = createInMemoryChannelFactory();
 *
 * // Get a channel
 * const channel = channelFactory.get(myRoute, { pathParams: { id: '123' } });
 *
 * // Publish events
 * await channel.publish('progress', { percent: 50 });
 *
 * // Complete the channel
 * await channel.complete(Ok({ summary: 'Done' }));
 * ```
 */
export function createInMemoryChannelFactory(): EventStreamChannelFactory {
  const channels = new Map<string, Set<Subscriber>>();

  function getChannelKey(route: AnyEventStreamRoute, args: unknown): string {
    return `${route.name}:${JSON.stringify(args)}`;
  }

  return {
    get(route, args) {
      const key = getChannelKey(route, args);

      if (!channels.has(key)) {
        channels.set(key, new Set());
      }

      const subscribers = channels.get(key)!;
      let handler: Subscriber | null = null;
      let isCompleted = false;

      const channel: EventStreamChannel<
        EventStreamEventTypes,
        ChannelCompletion<unknown, unknown>
      > = {
        async publish(event, data) {
          if (isCompleted) {
            throw new Error('Cannot publish to completed channel');
          }
          const message: ChannelMessage<
            EventStreamEventTypes,
            ChannelCompletion<unknown, unknown>
          > = {
            type: 'event',
            event,
            data,
          };
          subscribers.forEach((h) => h(message));
        },

        async complete(result) {
          if (isCompleted) {
            throw new Error('Channel already completed');
          }
          isCompleted = true;
          const message: ChannelMessage<
            EventStreamEventTypes,
            ChannelCompletion<unknown, unknown>
          > = {
            type: 'complete',
            result,
          };
          subscribers.forEach((h) => h(message));
        },

        async *[Symbol.asyncIterator]() {
          const queue: ChannelMessage<
            EventStreamEventTypes,
            ChannelCompletion<unknown, unknown>
          >[] = [];
          let resolve: (() => void) | null = null;
          let done = false;

          handler = (msg) => {
            queue.push(msg);
            resolve?.();
          };
          subscribers.add(handler);

          try {
            while (!done) {
              const msg = queue.shift();
              if (msg) {
                if (msg.type === 'event') {
                  yield { event: msg.event, data: msg.data };
                } else if (msg.type === 'complete') {
                  done = true;
                  return;
                }
              } else {
                await new Promise<void>((r) => {
                  resolve = r;
                });
              }
            }
          } finally {
            if (handler) {
              subscribers.delete(handler);
              handler = null;
            }
          }
        },

        async [Symbol.asyncDispose]() {
          if (handler) {
            subscribers.delete(handler);
            handler = null;
          }
        },
      };

      // biome-ignore lint/suspicious/noExplicitAny: Required for flexible typing
      return channel as any;
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a stable string key from route args
 * Used for channel identification
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }

  const keys = Object.keys(obj as object).sort();
  const pairs = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`,
  );
  return `{${pairs.join(',')}}`;
}

// ============================================================================
// Type Extraction Utilities
// ============================================================================

/**
 * Extract events type from a channel
 */
export type ChannelEvents<T> = T extends EventStreamChannel<
  infer E,
  ChannelCompletion<unknown, unknown>
>
  ? E
  : never;

/**
 * Extract completion type from a channel
 */
export type ChannelCompletionType<T> = T extends EventStreamChannel<
  EventStreamEventTypes,
  infer C
>
  ? C
  : never;
