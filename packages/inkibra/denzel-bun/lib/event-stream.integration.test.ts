import { describe, expect, test } from 'bun:test';
import initLogger from '@inkibra/logger';
import {
  createEventStreamHandler,
  createEventStreamRoute,
  createInMemoryChannelFactory,
  defineEventStreamSchema,
  Ok,
} from '@inkibra/router';
import { stub } from '@inkibra/test-support/stub';
import type { Redis } from 'ioredis';
import { FakeRedis } from '../../streams/__tests__/fixtures/fake-redis';
import { createStreamsClient } from '../../streams/client';
import { notificationsStreamRoute } from './__tests__/fixtures/router-integration.schemas';
import { createBackend } from './create-backend';

type DurableNotificationsContract = {
  pathParams: { roomId: string };
  pathQuery: { cursor?: string; take?: string };
  eventTypes: {
    connection: { status: 'connected'; timestamp?: number };
    disconnect: { reason?: string; timestamp?: number };
    heartbeat: { timestamp: number };
    error: { message: string; code?: string; details?: unknown };
    streamCursor: {
      cursor: string;
      phase: 'replay' | 'live';
      source: 'redis' | 'postgres';
      recovered?: boolean;
      reason?: string;
    };
    message: { text: string };
  };
  completionData: { done: true };
  completionError: { code: string };
};

type DurableEvents = {
  status: { status: 'started' | 'completed' | 'failed' };
  messageDelta: { delta: string };
};

const durableNotificationsRoute = createEventStreamRoute({
  name: 'durableNotifications',
  path: '/api/durable-stream/:roomId',
  schema: defineEventStreamSchema({
    pathParams: (input) => ({
      success: true,
      data: input as DurableNotificationsContract['pathParams'],
      errors: [],
    }),
    pathQuery: (input) => ({
      success: true,
      data: input as DurableNotificationsContract['pathQuery'],
      errors: [],
    }),
    eventTypes: (input) => ({
      success: true,
      data: input as Partial<DurableNotificationsContract['eventTypes']>,
      errors: [],
    }),
    completionData: (input) => ({
      success: true,
      data: input as DurableNotificationsContract['completionData'],
      errors: [],
    }),
    completionError: (input) => ({
      success: true,
      data: input as DurableNotificationsContract['completionError'],
      errors: [],
    }),
  }),
});

function parseEventDataLines(body: string) {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map(
      (line) => JSON.parse(line.slice(6)) as { event: string; data: unknown },
    );
}

describe('event stream integration', () => {
  test('streams connection, business events, and completion events', async () => {
    const backend = createBackend({
      logLevel: 'fatal',
      apiHandlers: {},
      streamHandlers: {
        notifications: createEventStreamHandler({
          route: notificationsStreamRoute,
          handler: async function* (args) {
            yield {
              event: 'message' as const,
              data: { text: `hello-${args.pathParams.roomId}` },
            };

            return Ok({ done: true as const });
          },
        }),
      },
      channelFactory: createInMemoryChannelFactory(),
    });

    const response = await backend.fetch(
      new Request('http://localhost/api/stream/room-1?since=0', {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('event: connection');
    expect(body).toContain(
      'data: {"event":"message","data":{"text":"hello-room-1"}}',
    );
    expect(body).toContain('event: __complete');
    expect(body).toContain('"type":"Ok"');
  });

  test('falls back to default context for invalid stream context payloads', async () => {
    const backend = createBackend({
      logLevel: 'fatal',
      apiHandlers: {},
      streamHandlers: {
        notifications: createEventStreamHandler({
          route: notificationsStreamRoute,
          handler: async function* () {
            yield { event: 'message' as const, data: { text: 'ready' } };
            return Ok({ done: true as const });
          },
        }),
      },
      channelFactory: createInMemoryChannelFactory(),
    });

    const response = await backend.fetch(
      new Request('http://localhost/api/stream/room-1', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'X-Session-session': 'not-json',
        },
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('event: connection');
    expect(body).toContain('event: __complete');
  });

  test('does not match stream routes without text/event-stream accept header', async () => {
    const backend = createBackend({
      logLevel: 'fatal',
      apiHandlers: {},
      streamHandlers: {
        notifications: createEventStreamHandler({
          route: notificationsStreamRoute,
          handler: async function* () {
            yield { event: 'message' as const, data: { text: 'ready' } };
            return Ok({ done: true as const });
          },
        }),
      },
      channelFactory: createInMemoryChannelFactory(),
    });

    const response = await backend.fetch(
      new Request('http://localhost/api/stream/room-1', {
        method: 'GET',
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Not found');
  });

  test('emits __error event when stream handler throws', async () => {
    const backend = createBackend({
      logLevel: 'fatal',
      apiHandlers: {},
      streamHandlers: {
        notifications: createEventStreamHandler({
          route: notificationsStreamRoute,
          handler: async function* () {
            yield { event: 'message' as const, data: { text: 'ready' } };
            throw new Error('stream boom');
          },
        }),
      },
      channelFactory: createInMemoryChannelFactory(),
    });

    const response = await backend.fetch(
      new Request('http://localhost/api/stream/room-1', {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('event: __error');
    expect(body).toContain('HANDLER_ERROR');
    expect(body).toContain('stream boom');
  });
});

describe('durable event stream integration', () => {
  test('replays from an earlier empty-stream live cursor over SSE', async () => {
    const logger = initLogger('denzel-bun-durable-stream-test');
    const redis = new FakeRedis();
    const prefix = `denzel-bun-durable-stream-${Date.now()}`;
    const roomId = 'room-durable';

    try {
      const streams = await createStreamsClient({
        logger,
        redis: stub<Redis>(redis),
        defaults: {
          redisPrefix: prefix,
        },
      });

      const backend = createBackend({
        logLevel: 'fatal',
        apiHandlers: {},
        streamHandlers: {
          durableNotifications: createEventStreamHandler({
            route: durableNotificationsRoute,
            handler: async function* (args) {
              const take = Number(args.pathQuery.take ?? 10);
              let emitted = 0;
              for await (const item of streams.stream<DurableEvents>({
                streamKey: args.pathParams.roomId,
                cursor: args.pathQuery.cursor,
                blockMs: 100,
                limit: 50,
              })) {
                if (item.type === 'cursor') {
                  yield {
                    event: 'streamCursor' as const,
                    data: item.status,
                  };
                } else {
                  yield {
                    event: 'message' as const,
                    data: {
                      text: `${item.item.event}:${JSON.stringify(item.item.data)}`,
                    },
                  };
                }
                emitted += 1;
                if (emitted >= take) {
                  return Ok({ done: true as const });
                }
              }

              return Ok({ done: true as const });
            },
          }),
        },
        channelFactory: createInMemoryChannelFactory(),
      });

      const firstResponse = await backend.fetch(
        new Request(`http://localhost/api/durable-stream/${roomId}?take=2`, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
        }),
      );
      const firstBody = await firstResponse.text();
      const firstEvents = parseEventDataLines(firstBody).filter(
        (item) => item.event === 'streamCursor',
      );

      expect(firstResponse.status).toBe(200);
      expect(firstEvents.length).toBeGreaterThanOrEqual(2);
      const liveCursor = (
        firstEvents.at(-1)?.data as
          | { cursor?: string; phase?: string }
          | undefined
      )?.cursor;
      expect(
        (firstEvents.at(-1)?.data as { phase?: string } | undefined)?.phase,
      ).toBe('live');
      expect(liveCursor).toBeTruthy();
      if (!liveCursor) {
        throw new Error('Missing live cursor from first SSE response');
      }

      await streams.append<DurableEvents, 'status'>({
        streamKey: roomId,
        event: 'status',
        data: { status: 'started' },
        durability: 'strict',
      });

      const secondResponse = await backend.fetch(
        new Request(
          `http://localhost/api/durable-stream/${roomId}?take=3&cursor=${encodeURIComponent(liveCursor)}`,
          {
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
          },
        ),
      );
      const secondBody = await secondResponse.text();
      const secondEvents = parseEventDataLines(secondBody);

      expect(secondResponse.status).toBe(200);
      expect(
        secondEvents.some(
          (item) =>
            item.event === 'message' &&
            (item.data as { text?: string }).text ===
              'status:{"status":"started"}',
        ),
      ).toBe(true);
      expect(
        secondEvents.some(
          (item) =>
            item.event === 'streamCursor' &&
            (item.data as { phase?: string }).phase === 'live',
        ),
      ).toBe(true);
    } finally {
      // FakeRedis requires no async teardown.
    }
  }, 30_000);
});
