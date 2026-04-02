import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Logger } from '@inkibra/logger';
import type { SseEventTypes } from '../constants/sse-event';
import { FetchProvider } from './sdk';
import { SseRoute } from './sse-route';

// Test event types
interface TestEvents extends SseEventTypes {
  'user-joined': { userId: string; username: string };
  'user-left': { userId: string; username: string };
  message: { id: string; content: string; author: string };
}

// Test SSE route types
type TestSseRouteTypes = {
  Name: 'testStream';
  PathParamsType: { roomId: string };
  PathQueryType: { userId?: string };
  EventTypes: TestEvents;
};

// Mock EventSource for tests
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  public readyState = MockEventSource.CLOSED;
  public url: string;
  public onopen: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string, _options?: EventSourceInit) {
    this.url = url;
  }

  addEventListener(_type: string, _listener: (args: unknown) => void) {}
  removeEventListener(_type: string, _listener: (args: unknown) => void) {}
  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

// Mock Logger
const createMockLogger = () =>
  ({
    trace: mock(() => {}),
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  }) as unknown as Logger;

// Mock global EventSource
const originalEventSource = globalThis.EventSource;
beforeEach(() => {
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
});

describe('FetchProvider', () => {
  describe('createSSERouteHandler', () => {
    test('should create SSE client with correct configuration', () => {
      const logger = createMockLogger();
      const fetchProvider = new FetchProvider({
        fetch: globalThis.fetch,
        Request: globalThis.Request,
        Response: globalThis.Response,
        Headers: globalThis.Headers,
        domain: 'api.example.com',
        port: 443,
        protocol: 'https:',
        logger,
        storage: {
          authorization: 'Bearer test-token',
        },
        includeCredentials: true,
      });

      const testRoute = new SseRoute<'/test/stream/:roomId', TestSseRouteTypes>(
        {
          name: 'testStream',
          path: '/test/stream/:roomId',
          pathParamsValidator: () => ({
            success: true,
            data: { roomId: 'test-room' },
          }),
          pathQueryValidator: () => ({
            success: true,
            data: { userId: 'test-user' },
          }),
          eventTypesValidator: () => ({ success: true, data: {} }),
        },
      );

      const sseClient = fetchProvider.createSSERouteHandler(testRoute);

      // Verify the client is created with the correct configuration
      expect(sseClient).toBeDefined();
      expect(sseClient.isConnected()).toBe(false);
      expect(sseClient.getReadyState()).toBe(2); // CLOSED state
    });

    test('should configure SSE client with FetchProvider settings', () => {
      const logger = createMockLogger();
      const fetchProvider = new FetchProvider({
        fetch: globalThis.fetch,
        Request: globalThis.Request,
        Response: globalThis.Response,
        Headers: globalThis.Headers,
        domain: 'localhost',
        port: 3000,
        protocol: 'http:',
        logger,
        storage: {
          authorization: 'Bearer test-token',
        },
        includeCredentials: false,
      });

      const testRoute = new SseRoute<'/test/stream/:roomId', TestSseRouteTypes>(
        {
          name: 'testStream',
          path: '/test/stream/:roomId',
          pathParamsValidator: () => ({
            success: true,
            data: { roomId: 'test-room' },
          }),
          pathQueryValidator: () => ({
            success: true,
            data: { userId: 'test-user' },
          }),
          eventTypesValidator: () => ({ success: true, data: {} }),
        },
      );

      const sseClient = fetchProvider.createSSERouteHandler(testRoute);

      // Access the private options to verify configuration
      const options = sseClient['options'];
      expect(options.logger).toBe(logger);
      expect(options.baseUrl).toBe('http://localhost:3000');
      expect(options.authorization).toBe('Bearer test-token');
      expect(options.eventSourceOptions).toBeDefined();
      expect(options.eventSourceOptions.withCredentials).toBe(false);
    });
  });
});
