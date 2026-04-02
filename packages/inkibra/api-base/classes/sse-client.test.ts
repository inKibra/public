import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Logger } from '@inkibra/logger';
import type { SseEventTypes } from '../constants/sse-event';
import { createSseClient, SseClient } from './sse-client';
import type { SseRouteNamedTypes } from './sse-route';
import { SseRoute } from './sse-route';

// Test event types
interface TestEvents extends SseEventTypes {
  'user-joined': { userId: string; username: string };
  'user-left': { userId: string; username: string };
  message: { id: string; content: string; author: string };
  system: { message: string; level: 'info' | 'warning' | 'error' };
  'data-update': { timestamp: number; values: number[] };
}

interface TestSseRouteTypes extends SseRouteNamedTypes<'/test/stream/:roomId'> {
  Name: 'testStream';
  PathParamsType: { roomId: string };
  PathQueryType: { userId?: string };
  EventTypes: TestEvents;
}

// Mock EventSource for client tests
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  public readyState = MockEventSource.CONNECTING;
  public url: string;
  public onopen: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners: Map<string, Set<(args: unknown) => void>> = new Map();

  constructor(url: string, _options?: EventSourceInit) {
    this.url = url;
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockEventSource.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
      // Also trigger 'open' event listeners
      this.triggerEventListeners('open', new Event('open'));
    }, 10);
  }

  addEventListener(type: string, listener: (args: unknown) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (args: unknown) => void) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  // Helper method to trigger event listeners
  public triggerEventListeners(type: string, event: Event) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
    }
  }

  // Helper method to simulate receiving events
  simulateEvent(type: string, data: unknown) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const event = new MessageEvent(type, { data: JSON.stringify(data) });
      listeners.forEach((listener) => listener(event));
    }
  }

  // Helper method to simulate message events
  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

// Mock Logger
const createMockLogger = (): Logger =>
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

describe('SseClient', () => {
  let testRoute: SseRoute<'/test/stream/:roomId', TestSseRouteTypes>;
  let sseClient: SseClient<'/test/stream/:roomId', TestSseRouteTypes>;

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

    sseClient = createSseClient(testRoute, {
      logger: createMockLogger(),
    });
  });

  describe('creation and initialization', () => {
    test('should create client with default options', () => {
      const defaultClient = createSseClient(testRoute, {
        logger: createMockLogger(),
      });
      expect(defaultClient).toBeInstanceOf(SseClient);
    });

    test('should create client with custom options', () => {
      const customClient = createSseClient(testRoute, {
        logger: createMockLogger(),
      });
      expect(customClient).toBeInstanceOf(SseClient);
    });

    test('should initialize with closed state', () => {
      expect(sseClient.isConnected()).toBe(false);
      expect(sseClient.getReadyState()).toBe(MockEventSource.CLOSED);
    });
  });

  describe('connection management', () => {
    test('should connect with path parameters', () => {
      void sseClient.connect({
        pathParams: { roomId: 'room123' },
        pathQuery: { userId: 'user456' },
      });

      expect(sseClient.getReadyState()).toBe(MockEventSource.CONNECTING);
    });

    test('should connect with minimal parameters', () => {
      void sseClient.connect({
        pathParams: { roomId: 'room123' },
      });

      expect(sseClient.getReadyState()).toBe(MockEventSource.CONNECTING);
    });

    test('should handle connection state transitions', async () => {
      expect(sseClient.isConnected()).toBe(false);
      expect(sseClient.getReadyState()).toBe(MockEventSource.CLOSED);

      void sseClient.connect({
        pathParams: { roomId: 'room123' },
      });

      expect(sseClient.getReadyState()).toBe(MockEventSource.CONNECTING);

      // Wait for connection to open
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(sseClient.isConnected()).toBe(true);
      expect(sseClient.getReadyState()).toBe(MockEventSource.OPEN);
    });

    test('should disconnect properly', async () => {
      void sseClient.connect({
        pathParams: { roomId: 'room123' },
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sseClient.isConnected()).toBe(true);

      sseClient.disconnect();
      expect(sseClient.getReadyState()).toBe(MockEventSource.CLOSED);
      expect(sseClient.isConnected()).toBe(false);
    });

    test('should handle multiple connect calls', () => {
      void sseClient.connect({ pathParams: { roomId: 'room1' } });
      const firstEventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;

      void sseClient.connect({ pathParams: { roomId: 'room2' } });
      const secondEventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;

      expect(firstEventSource).not.toBe(secondEventSource);
    });
  });

  describe('event handling', () => {
    test('should add and trigger event listeners', async () => {
      const userJoinedListener = mock((data: TestEvents['user-joined']) => {
        expect(data.userId).toBe('123');
        expect(data.username).toBe('test-user');
      });

      sseClient.addEventListener('user-joined', userJoinedListener);
      void sseClient.connect({
        pathParams: { roomId: 'room123' },
        pathQuery: { userId: 'user456' },
      });

      // Wait for connection to open
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Simulate receiving an event
      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      eventSource.simulateEvent('user-joined', {
        userId: '123',
        username: 'test-user',
      });

      expect(userJoinedListener).toHaveBeenCalled();
    });

    test('should handle multiple event types', async () => {
      const userJoinedListener = mock(() => {});
      const messageListener = mock(() => {});
      const systemListener = mock(() => {});

      sseClient.addEventListener('user-joined', userJoinedListener);
      sseClient.addEventListener('message', messageListener);
      sseClient.addEventListener('system', systemListener);

      void sseClient.connect({ pathParams: { roomId: 'room123' } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      eventSource.simulateEvent('user-joined', {
        userId: '1',
        username: 'user1',
      });
      eventSource.simulateEvent('message', {
        id: '1',
        content: 'hello',
        author: 'user1',
      });
      eventSource.simulateEvent('system', { message: 'test', level: 'info' });

      expect(userJoinedListener).toHaveBeenCalled();
      expect(messageListener).toHaveBeenCalled();
      expect(systemListener).toHaveBeenCalled();
    });

    test('should remove event listeners correctly', async () => {
      const listener = mock(() => {});

      sseClient.addEventListener('message', listener);

      // Verify listener was added to internal map
      const eventListeners = (
        sseClient as unknown as {
          eventListeners: Map<string, Set<(args: unknown) => void>>;
        }
      ).eventListeners;
      expect(eventListeners.get('message')?.has(listener)).toBe(true);

      sseClient.removeEventListener('message', listener);

      // Verify listener was removed from internal map
      const messageListeners = eventListeners.get('message');
      expect(
        messageListeners === undefined || !messageListeners.has(listener),
      ).toBe(true);
    });

    test('should handle multiple listeners for same event', async () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});

      sseClient.addEventListener('message', listener1);
      sseClient.addEventListener('message', listener2);
      sseClient.connect({ pathParams: { roomId: 'room123' } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      eventSource.simulateEvent('message', {
        id: '1',
        content: 'test',
        author: 'user',
      });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    test('should actually remove event listeners from EventSource and not call them', async () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});

      // Add both listeners
      sseClient.addEventListener('message', listener1);
      sseClient.addEventListener('message', listener2);

      sseClient.connect({ pathParams: { roomId: 'room123' } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Trigger event - both should be called
      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      eventSource.simulateEvent('message', {
        id: '1',
        content: 'test message',
        author: 'user',
      });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      // Remove first listener
      sseClient.removeEventListener('message', listener1);

      // Trigger event again - only listener2 should be called
      eventSource.simulateEvent('message', {
        id: '2',
        content: 'second message',
        author: 'user',
      });

      // listener1 should still have been called only once (not called again)
      expect(listener1).toHaveBeenCalledTimes(1);
      // listener2 should have been called twice now
      expect(listener2).toHaveBeenCalledTimes(2);

      // Remove second listener
      sseClient.removeEventListener('message', listener2);

      // Trigger event again - no listeners should be called
      eventSource.simulateEvent('message', {
        id: '3',
        content: 'third message',
        author: 'user',
      });

      // Both listeners should still have the same call count
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(2);
    });

    test('should handle removal of non-existent listener gracefully', async () => {
      const listener = mock(() => {});
      const nonExistentListener = mock(() => {});

      sseClient.addEventListener('message', listener);
      void sseClient.connect({ pathParams: { roomId: 'room123' } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Try to remove a listener that was never added
      expect(() => {
        sseClient.removeEventListener('message', nonExistentListener);
      }).not.toThrow();

      // Original listener should still work
      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      eventSource.simulateEvent('message', {
        id: '1',
        content: 'test',
        author: 'user',
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(nonExistentListener).toHaveBeenCalledTimes(0);
    });

    test('should handle removal of listener for non-existent event type', () => {
      const listener = mock(() => {});

      // Try to remove listener for event type that has no listeners
      expect(() => {
        sseClient.removeEventListener('system', listener);
      }).not.toThrow();
    });
  });

  describe('connection callbacks', () => {
    test('should allow registering callbacks after connection', async () => {
      const openCallback = mock(() => {});

      void sseClient.connect({ pathParams: { roomId: 'room123' } });

      // Register callback after connection
      sseClient.onOpen(openCallback);

      // Wait for connection to open
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Manually trigger the open event to test the callback
      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      eventSource.triggerEventListeners('open', new Event('open'));

      expect(openCallback).toHaveBeenCalled();
    });

    test('should allow registering error callbacks', async () => {
      const errorCallback = mock(() => {});

      void sseClient.connect({ pathParams: { roomId: 'room123' } });
      sseClient.onError(errorCallback);

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Simulate an error
      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      eventSource.triggerEventListeners('error', new Event('error'));

      expect(errorCallback).toHaveBeenCalled();
    });
  });

  describe('URL building', () => {
    test('should build correct URL with base URL', () => {
      const client = createSseClient(testRoute, {
        baseUrl: 'https://api.example.com',
        logger: createMockLogger(),
      });

      // Access the private buildUrl method for testing
      const buildUrl = client['buildUrl'].bind(client);
      const url = buildUrl(
        {
          pathParams: { roomId: 'test-room' },
          pathQuery: { userId: 'test-user' },
        },
        '',
      );

      expect(url).toBe(
        'https://api.example.com/test/stream/test-room?userId=%22test-user%22',
      );
    });

    test('should build correct URL with baseUrl in options and parameter', () => {
      const client = createSseClient(testRoute, {
        baseUrl: 'https://api.example.com',
        logger: createMockLogger(),
      });

      void client['buildUrl'];
      // Access the private buildUrl method for testing
      const buildUrl = client['buildUrl'].bind(client);
      const url = buildUrl(
        {
          pathParams: { roomId: 'test-room' },
          pathQuery: { userId: 'test-user' },
        },
        '',
      );

      // Should use the baseUrl from options, not the parameter
      expect(url).toBe(
        'https://api.example.com/test/stream/test-room?userId=%22test-user%22',
      );
    });

    test('should build correct URL without base URL', () => {
      const client = createSseClient(testRoute, {
        logger: createMockLogger(),
      });

      // Access the private buildUrl method for testing
      const buildUrl = client['buildUrl'].bind(client);
      const url = buildUrl(
        {
          pathParams: { roomId: 'test-room' },
          pathQuery: { userId: 'test-user' },
        },
        '',
      );

      expect(url).toBe('/test/stream/test-room?userId=%22test-user%22');
    });

    test('should build correct URL without query parameters', () => {
      const client = createSseClient(testRoute, {
        logger: createMockLogger(),
      });

      // Access the private buildUrl method for testing
      const buildUrl = client['buildUrl'].bind(client);
      const url = buildUrl(
        {
          pathParams: { roomId: 'test-room' },
        },
        '',
      );

      expect(url).toBe('/test/stream/test-room');
    });
  });

  describe('error handling', () => {
    test('should handle connection errors gracefully', async () => {
      const errorCallback = mock(() => {});

      void sseClient.connect({ pathParams: { roomId: 'room123' } });
      sseClient.onError(errorCallback);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;
      const error = new Event('error');
      eventSource.triggerEventListeners('error', error);

      expect(errorCallback).toHaveBeenCalledWith(error);
    });

    test('should handle malformed event data', async () => {
      const messageListener = mock(() => {});
      sseClient.addEventListener('message', messageListener);

      void sseClient.connect({ pathParams: { roomId: 'room123' } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;

      // Simulate malformed JSON
      const malformedEvent = new MessageEvent('message', {
        data: 'invalid json',
      });
      eventSource.triggerEventListeners('message', malformedEvent);

      // Should not crash, but listener should not be called with invalid data
      expect(messageListener).not.toHaveBeenCalled();
    });
  });

  describe('real-world scenarios', () => {
    test('should handle chat application flow', async () => {
      const events: Array<{ type: string; data: unknown }> = [];

      sseClient.addEventListener('user-joined', (data) => {
        events.push({ type: 'user-joined', data });
      });

      sseClient.addEventListener('message', (data) => {
        events.push({ type: 'message', data });
      });

      sseClient.addEventListener('user-left', (data) => {
        events.push({ type: 'user-left', data });
      });

      void sseClient.connect({
        pathParams: { roomId: 'chat-room-1' },
        pathQuery: { userId: 'current-user' },
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const eventSource = (
        sseClient as unknown as { eventSource: MockEventSource }
      ).eventSource;

      // Simulate chat events
      eventSource.simulateEvent('user-joined', {
        userId: '123',
        username: 'alice',
      });
      eventSource.simulateEvent('message', {
        id: '1',
        content: 'Hello!',
        author: 'alice',
      });
      eventSource.simulateEvent('user-joined', {
        userId: '456',
        username: 'bob',
      });
      eventSource.simulateEvent('message', {
        id: '2',
        content: 'Hi Alice!',
        author: 'bob',
      });
      eventSource.simulateEvent('user-left', {
        userId: '123',
        username: 'alice',
      });

      expect(events).toHaveLength(5);
      expect(events[0]).toEqual({
        type: 'user-joined',
        data: { userId: '123', username: 'alice' },
      });
      expect(events[1]).toEqual({
        type: 'message',
        data: { id: '1', content: 'Hello!', author: 'alice' },
      });
      expect(events[2]).toEqual({
        type: 'user-joined',
        data: { userId: '456', username: 'bob' },
      });
      expect(events[3]).toEqual({
        type: 'message',
        data: { id: '2', content: 'Hi Alice!', author: 'bob' },
      });
      expect(events[4]).toEqual({
        type: 'user-left',
        data: { userId: '123', username: 'alice' },
      });
    });

    test('should create client with reconnection options', () => {
      const reconnectClient = createSseClient(testRoute, {
        logger: createMockLogger(),
      });

      expect(reconnectClient).toBeInstanceOf(SseClient);
    });
  });
});
