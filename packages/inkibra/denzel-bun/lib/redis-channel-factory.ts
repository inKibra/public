/**
 * Redis Channel Factory - Production-ready EventStream channels
 *
 * Provides EventStreamChannelFactory backed by Redis pub/sub for:
 * - Multi-server event routing
 * - Fan-out to multiple subscribers
 * - Standalone usage (not tied to HTTP server)
 *
 * Uses Bun's native Redis client for optimal performance.
 */

import type {
  AnyEventStreamRoute,
  ChannelCompletion,
  EventStreamChannel,
  EventStreamChannelFactory,
  EventStreamEventTypes,
  EventStreamRouteArgs,
  Result,
} from '@inkibra/router';
import { stableStringify } from '@inkibra/router';
import type { RedisClient } from 'bun';

// ============================================================================
// Redis Channel Factory Types
// ============================================================================

/**
 * Dependencies for Redis channel factory
 */
export type RedisChannelFactoryDeps = {
  /** Redis client for publishing (Bun.RedisClient) */
  redis: RedisClient;
  /** Optional: prefix for Redis channels */
  channelPrefix?: string;
};

/**
 * Internal channel message format
 */
type RedisChannelMessage =
  | { type: 'event'; event: string; data: unknown }
  | { type: 'complete'; result: Result<unknown, unknown> };

// ============================================================================
// Redis Channel Factory
// ============================================================================

/**
 * Create a Redis-backed EventStream channel factory
 *
 * This factory is standalone - not tied to any server. Use it anywhere
 * you need to publish/subscribe to EventStream channels:
 * - Background jobs
 * - API handlers
 * - EventStream handlers
 *
 * @example
 * ```typescript
 * const channelFactory = createRedisChannelFactory({ redis });
 *
 * // In background job
 * const channel = channelFactory.get(renderStatusStream, { renderJobId: '123' });
 * await channel.publish('progress', { percent: 50 });
 * await channel.complete(Ok({ output: renderResult }));
 *
 * // In EventStream handler
 * async function* handler(args, ctx, channelFactory, deps) {
 *   await using channel = channelFactory.get(renderStatusStream, args);
 *
 *   for await (const { event, data } of channel) {
 *     yield { event, data };
 *   }
 * }
 * ```
 */
export function createRedisChannelFactory(
  deps: RedisChannelFactoryDeps,
): EventStreamChannelFactory {
  const { redis, channelPrefix = 'inkibra:stream:' } = deps;

  // Cache of subscriber connections (one per channel)
  // Bun.redis requires a separate connection for subscriptions
  const subscribers = new Map<
    string,
    {
      redis: RedisClient;
      handlers: Set<(msg: RedisChannelMessage) => void>;
    }
  >();

  function getChannelKey(route: AnyEventStreamRoute, args: unknown): string {
    return `${channelPrefix}${route.name}:${stableStringify(args)}`;
  }

  return {
    get(route, args) {
      const channelKey = getChannelKey(route, args);

      let isCompleted = false;
      let handler: ((msg: RedisChannelMessage) => void) | null = null;

      const channel: EventStreamChannel<
        EventStreamEventTypes,
        ChannelCompletion<unknown, unknown>
      > = {
        async publish(event, data) {
          console.debug('[redis-channel] publish', {
            key: channelKey,
            event,
          });
          if (isCompleted) {
            throw new Error('Cannot publish to completed channel');
          }

          const message: RedisChannelMessage = {
            type: 'event',
            event: String(event),
            data,
          };

          await redis.publish(channelKey, JSON.stringify(message));
        },

        async complete(result) {
          console.debug('[redis-channel] complete', {
            key: channelKey,
          });
          if (isCompleted) {
            throw new Error('Channel already completed');
          }

          isCompleted = true;

          const message: RedisChannelMessage = {
            type: 'complete',
            result,
          };

          await redis.publish(channelKey, JSON.stringify(message));
        },

        async *[Symbol.asyncIterator]() {
          console.debug('[redis-channel] iterator subscribe', {
            key: channelKey,
          });
          // Create subscriber if not exists
          if (!subscribers.has(channelKey)) {
            // Bun.redis requires duplicate() for subscription connections
            console.debug('[redis-channel] duplicating redis connection', {
              key: channelKey,
            });
            const subscriberRedis = await redis.duplicate();
            const handlerSet = new Set<(msg: RedisChannelMessage) => void>();

            console.debug('[redis-channel] subscribing to channel', {
              key: channelKey,
            });
            // Bun.redis uses callback-based subscribe
            await subscriberRedis.subscribe(
              channelKey,
              (message: string, _channel: string) => {
                try {
                  const parsed = JSON.parse(message) as RedisChannelMessage;
                  for (const h of handlerSet) {
                    h(parsed);
                  }
                } catch {
                  console.error('Failed to parse Redis message:', message);
                }
              },
            );
            console.debug('[redis-channel] subscribe succeeded', {
              key: channelKey,
            });

            subscribers.set(channelKey, {
              redis: subscriberRedis,
              handlers: handlerSet,
            });
          }

          // biome-ignore lint/style/noNonNullAssertion: Just set in the if block above
          const subscriber = subscribers.get(channelKey)!;

          // Queue for incoming messages
          const queue: RedisChannelMessage[] = [];
          let resolve: (() => void) | null = null;
          let done = false;

          handler = (msg) => {
            queue.push(msg);
            resolve?.();
          };
          subscriber.handlers.add(handler);

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
                // Wait for next message
                await new Promise<void>((r) => {
                  resolve = r;
                });
              }
            }
          } finally {
            if (handler) {
              subscriber.handlers.delete(handler);
              handler = null;
            }

            // Clean up subscriber if no more handlers
            if (subscriber.handlers.size === 0) {
              await subscriber.redis.unsubscribe(channelKey);
              subscriber.redis.close();
              subscribers.delete(channelKey);
            }
          }
        },

        async [Symbol.asyncDispose]() {
          console.debug('[redis-channel] asyncDispose', { key: channelKey });
          if (handler) {
            const subscriber = subscribers.get(channelKey);
            if (subscriber) {
              subscriber.handlers.delete(handler);
              handler = null;

              // Clean up subscriber if no more handlers
              if (subscriber.handlers.size === 0) {
                await subscriber.redis.unsubscribe(channelKey);
                subscriber.redis.close();
                subscribers.delete(channelKey);
              }
            }
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
 * Create a one-shot publish to a channel
 *
 * For publishing events without subscribing.
 *
 * @example
 * ```typescript
 * import { RedisClient } from 'bun';
 *
 * const redis = new RedisClient('redis://localhost:6379');
 * await publishToChannel(
 *   redis,
 *   renderStatusStream,
 *   { renderJobId: '123' },
 *   'progress',
 *   { percent: 75 },
 * );
 * ```
 */
export async function publishToChannel<R extends AnyEventStreamRoute>(
  redis: RedisClient,
  route: R,
  args: EventStreamRouteArgs<R>,
  event: string,
  data: unknown,
  options?: { channelPrefix?: string },
): Promise<void> {
  const channelPrefix = options?.channelPrefix ?? 'inkibra:stream:';
  const channelKey = `${channelPrefix}${route.name}:${stableStringify(args)}`;

  const message: RedisChannelMessage = {
    type: 'event',
    event,
    data,
  };

  await redis.publish(channelKey, JSON.stringify(message));
}

/**
 * Complete a channel (one-shot)
 *
 * For completing a channel from outside the handler.
 *
 * @example
 * ```typescript
 * import { RedisClient } from 'bun';
 * import { Ok } from '@inkibra/router';
 *
 * const redis = new RedisClient('redis://localhost:6379');
 * await completeChannel(
 *   redis,
 *   renderStatusStream,
 *   { renderJobId: '123' },
 *   Ok({ output: renderResult }),
 * );
 * ```
 */
export async function completeChannel<R extends AnyEventStreamRoute>(
  redis: RedisClient,
  route: R,
  args: EventStreamRouteArgs<R>,
  result: Result<unknown, unknown>,
  options?: { channelPrefix?: string },
): Promise<void> {
  const channelPrefix = options?.channelPrefix ?? 'inkibra:stream:';
  const channelKey = `${channelPrefix}${route.name}:${stableStringify(args)}`;

  const message: RedisChannelMessage = {
    type: 'complete',
    result,
  };

  await redis.publish(channelKey, JSON.stringify(message));
}
