import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import initLogger, { type Logger } from '@inkibra/logger';
import type { IValidation } from 'typia/lib';
import { HttpMethod } from '../constants/http-method';
import { StatusCode } from '../constants/status-code';
import { createAPIRoute, defineRouteSchema } from './api-route';
import {
  createEventStreamRoute,
  defineEventStreamSchema,
} from './event-stream-route';
import {
  createFetchTransport,
  createMemoryStorageAdapter,
} from './fetch-provider';
import { SerializableResult } from './result';

class MockEventSource {
  static instances: MockEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readonly url: string;
  readonly withCredentials: boolean;
  readyState = MockEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(_type: string, _listener: (event: Event) => void): void {}

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }
}

const createMockLogger = (): Logger => initLogger('fetch-provider-test');

function okValidation<T>(data: T): IValidation<T> {
  return { success: true, data };
}

const okRouteResponse = SerializableResult.toOk(
  { ok: true as const },
  StatusCode.OK,
);

const healthRoute = createAPIRoute({
  name: 'HealthCheck',
  method: HttpMethod.GET,
  path: '/api/health',
  schema: defineRouteSchema<
    Record<string, never>,
    Record<string, never>,
    undefined,
    typeof okRouteResponse
  >({
    pathParams: () => okValidation({}),
    pathQuery: () => okValidation({}),
    body: () => okValidation(undefined),
    response: () => okValidation(okRouteResponse),
  }),
});

const runtimeStreamRoute = createEventStreamRoute({
  name: 'RuntimeStream',
  path: '/runtime/events',
  schema: defineEventStreamSchema({
    pathParams: () => okValidation({}),
    pathQuery: () => okValidation({}),
    eventTypes: () => okValidation({ runtimeEvent: { ok: true } }),
  }),
});

const originalEventSource = globalThis.EventSource;
const originalFetch = globalThis.fetch;

describe('FetchProvider event stream auth propagation', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: MockEventSource,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: originalEventSource,
    });
    globalThis.fetch = originalFetch;
  });

  test('uses authorization discovered from API response headers for EventSource URLs', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mock(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const headers = new Headers();
        headers.set('X-Use-Authorization', 'Bearer auth-from-header');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers,
        });
      }),
    });

    const transport = createFetchTransport({
      baseUrl: 'https://example.test',
      logger: createMockLogger(),
      includeCredentials: true,
      storageAdapters: {
        session: createMemoryStorageAdapter(),
        device: createMemoryStorageAdapter(),
      },
    });

    const apiHandler = transport.createApiHandler(healthRoute);

    await apiHandler.execute(
      {
        pathParams: {},
        pathQuery: {},
        body: undefined,
        files: undefined,
      },
      {},
    );

    const streamHandler =
      transport.createEventStreamHandler(runtimeStreamRoute);

    const bus = streamHandler.getBus(
      {
        pathParams: {},
        pathQuery: {},
      },
      {},
    );

    const unsubscribe = bus.subscribe('runtimeEvent', () => {});

    const openedUrl = MockEventSource.instances.at(-1)?.url;
    expect(openedUrl).toBe(
      'https://example.test/runtime/events?authorization=Bearer%20auth-from-header',
    );

    unsubscribe();
  });

  test('omits authorization query for same-origin EventSource URLs when using credentials', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mock(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const headers = new Headers();
        headers.set('X-Use-Authorization', 'Bearer auth-from-header');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers,
        });
      }),
    });

    const transport = createFetchTransport({
      baseUrl: '',
      logger: createMockLogger(),
      includeCredentials: true,
      storageAdapters: {
        session: createMemoryStorageAdapter(),
        device: createMemoryStorageAdapter(),
      },
    });

    const apiHandler = transport.createApiHandler(healthRoute);

    await apiHandler.execute(
      {
        pathParams: {},
        pathQuery: {},
        body: undefined,
        files: undefined,
      },
      {},
    );

    const streamHandler =
      transport.createEventStreamHandler(runtimeStreamRoute);

    const bus = streamHandler.getBus(
      {
        pathParams: {},
        pathQuery: {},
      },
      {},
    );

    const unsubscribe = bus.subscribe('runtimeEvent', () => {});

    const openedUrl = MockEventSource.instances.at(-1)?.url;
    expect(openedUrl).toBe('/runtime/events');

    unsubscribe();
  });
});
