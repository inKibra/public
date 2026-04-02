import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { SseEventTypes } from '../constants/sse-event';
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

// Mock global EventSource
const originalEventSource = globalThis.EventSource;
beforeEach(() => {
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
});

describe('SseRoute', () => {
  let testRoute: SseRoute<'/test/stream/:roomId', TestSseRouteTypes>;

  beforeEach(() => {
    // Create a mock route
    testRoute = new SseRoute<'/test/stream/:roomId', TestSseRouteTypes>({
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
    });
  });

  describe('basic functionality', () => {
    test('should have correct name and path', () => {
      expect(testRoute.name).toBe('testStream');
      expect(testRoute.path).toBe('/test/stream/:roomId');
    });

    test('should construct path correctly', () => {
      const path = testRoute.constructPath({
        pathParams: { roomId: 'chat-room-1' },
        pathQuery: { userId: 'user123' },
      });

      expect(path).toBe('/test/stream/chat-room-1?userId=%22user123%22');
    });

    test('should validate path params', () => {
      const result = testRoute.validatePathParams({ roomId: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.roomId).toBe('test-room');
      }
    });

    test('should validate path query', () => {
      const result = testRoute.validatePathQuery({ userId: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe('test-user');
      }
    });
  });
});
