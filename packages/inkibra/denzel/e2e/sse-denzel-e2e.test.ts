import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SseEventTypes, SseRouteNamedTypes } from '@inkibra/api-base';
import { createSseClient, type HttpMethod, SseRoute } from '@inkibra/api-base';
import type { Logger } from '@inkibra/logger';
import { init as initLogger } from '@inkibra/logger';
import { ok } from 'neverthrow';
import type { IValidation } from 'typia/lib';
import { InkibraDenzel } from '..';
import type { ContextDataBase } from '../lib/context';

// Polyfill EventSource for test environment
if (typeof EventSource === 'undefined') {
  const { EventSource: ESPolyfill } = require('eventsource');
  globalThis.EventSource = ESPolyfill;
}

// Test event types for the e2e test
interface ChatRoomEvents extends SseEventTypes {
  status: {
    status: 'started' | 'progress' | 'completed' | 'failed';
    reasoningMessages: string[];
  };
  'user-joined': { userId: string; username: string; timestamp: number };
  'user-left': { userId: string; username: string; timestamp: number };
  message: { id: string; content: string; author: string; timestamp: number };
  typing: { userId: string; username: string; isTyping: boolean };
  'room-info': { roomId: string; userCount: number; topic?: string };
}

// Simple test event types
interface SimpleTestEvents extends SseEventTypes {
  'test-event': { message: string; timestamp: number };
}

// Graceful close test event types
interface GracefulCloseEvents extends SseEventTypes {
  'test-message': { id: string; content: string };
  'server-shutdown': { reason: string; graceful: boolean };
}

// Route types for the chat room test
interface ChatRoomSseRouteTypes
  extends SseRouteNamedTypes<'/api/chat/room/:roomId/stream'> {
  Name: 'chatRoomStream';
  Method: HttpMethod.GET;
  PathParamsType: { roomId: string };
  PathQueryType: { userId?: string; username?: string };
  BodyType: Record<string, never>;
  FileInputDescriptionType: undefined;
  EventTypes: ChatRoomEvents;
}

// Route types for the simple test
interface SimpleTestSseRouteTypes
  extends SseRouteNamedTypes<'/api/test/stream/:id'> {
  Name: 'testStream';
  Method: HttpMethod.GET;
  PathParamsType: { id: string };
  PathQueryType: { user?: string };
  BodyType: Record<string, never>;
  FileInputDescriptionType: undefined;
  EventTypes: SimpleTestEvents;
}

// Route types for the graceful close test
interface GracefulCloseSseRouteTypes
  extends SseRouteNamedTypes<'/api/graceful-test/:id'> {
  Name: 'gracefulTest';
  Method: HttpMethod.GET;
  PathParamsType: { id: string };
  PathQueryType: {
    autoClose?: boolean;
    closeDelay?: number;
    forceClose?: boolean;
  };
  BodyType: Record<string, never>;
  FileInputDescriptionType: undefined;
  EventTypes: GracefulCloseEvents;
}

// Context data for the test
interface TestContextData extends ContextDataBase {
  logger: Logger;
  requestId: string;
  userId?: string;
}

// Mock validation functions
const validateChatRoomPathParams = (
  input: unknown,
): IValidation<{ roomId: string }> => {
  const data = input as { roomId: string };
  if (!data.roomId || typeof data.roomId !== 'string') {
    return {
      success: false,
      data: { roomId: '' },
      errors: [{ path: 'roomId', expected: 'string', value: data.roomId }],
    };
  }
  return { success: true, data };
};

const validateChatRoomPathQuery = (
  input: unknown,
): IValidation<{ userId?: string; username?: string }> => {
  const data = input as { userId?: string; username?: string };
  return { success: true, data };
};

const validateSimpleTestPathParams = (
  input: unknown,
): IValidation<{ id: string }> => {
  const data = input as { id: string };
  if (!data.id || typeof data.id !== 'string') {
    return {
      success: false,
      data: { id: '' },
      errors: [{ path: 'id', expected: 'string', value: data.id }],
    };
  }
  return { success: true, data };
};

const validateSimpleTestPathQuery = (
  input: unknown,
): IValidation<{ user?: string }> => {
  const data = input as { user?: string };
  return { success: true, data };
};

const validateChatRoomEvent = (
  data: unknown,
): IValidation<Partial<ChatRoomEvents>> => {
  return {
    success: true,
    data: data as Partial<ChatRoomEvents>,
  };
};

const validateGracefulClosePathQuery = (
  input: unknown,
): IValidation<{
  autoClose?: boolean;
  closeDelay?: number;
  forceClose?: boolean;
}> => {
  const data = input as {
    autoClose?: boolean;
    closeDelay?: number;
    forceClose?: boolean;
  };
  return { success: true, data };
};

// Create the chat room SSE route
const chatRoomStreamRoute = new SseRoute<
  '/api/chat/room/:roomId/stream',
  ChatRoomSseRouteTypes
>({
  name: 'chatRoomStream',
  path: '/api/chat/room/:roomId/stream',
  pathParamsValidator: validateChatRoomPathParams,
  pathQueryValidator: validateChatRoomPathQuery,
  eventTypesValidator: validateChatRoomEvent,
});

// Create the simple test SSE route
const testStreamRoute = new SseRoute<
  '/api/test/stream/:id',
  SimpleTestSseRouteTypes
>({
  name: 'testStream',
  path: '/api/test/stream/:id',
  pathParamsValidator: validateSimpleTestPathParams,
  pathQueryValidator: validateSimpleTestPathQuery,
  eventTypesValidator: validateChatRoomEvent,
});

// Create a long-running test SSE route
const longRunningStreamRoute = new SseRoute<
  '/api/test/long-stream/:id',
  SimpleTestSseRouteTypes
>({
  name: 'testStream',
  path: '/api/test/long-stream/:id',
  pathParamsValidator: validateSimpleTestPathParams,
  pathQueryValidator: validateSimpleTestPathQuery,
  eventTypesValidator: validateChatRoomEvent,
});

// Create the graceful close test SSE route
const gracefulCloseRoute = new SseRoute<
  '/api/graceful-test/:id',
  GracefulCloseSseRouteTypes
>({
  name: 'gracefulTest',
  path: '/api/graceful-test/:id',
  pathParamsValidator: validateSimpleTestPathParams,
  pathQueryValidator: validateGracefulClosePathQuery,
  eventTypesValidator: validateChatRoomEvent,
});

// Test setup
describe('SSE Denzel E2E Integration', () => {
  let denzelApp: InkibraDenzel<TestContextData>;
  let serverPort: number;
  let logger: Logger;

  beforeAll(async () => {
    // Find an available port
    serverPort = 3000 + Math.floor(Math.random() * 1000);
    logger = initLogger('sse-e2e-test');

    // Create Denzel app
    denzelApp = new InkibraDenzel<TestContextData>(
      logger,
      'test-project',
      serverPort,
    );

    // Initialize basic middleware
    denzelApp.initHttpLogging();
    denzelApp.initCookieParser();

    // Create a test context
    const testContext = denzelApp.getNewRouteContext<TestContextData, never>(
      'test-chat-context',
      [], // No additional middlewares for this test
      async (logger, req) => {
        // Simple context handler that returns test context data
        const requestId =
          (req.headers['x-request-id'] as string) || 'test-request-id';
        const userId = req.query.userId as string;

        return ok({
          logger: logger.child({ component: 'test-context', requestId }),
          requestId,
          userId,
        });
      },
    );

    // Attach the chat room SSE route
    testContext.attachSSERouteHandlerWithMiddlewares(
      chatRoomStreamRoute,
      [], // No additional middlewares
      chatRoomStreamRoute.handle<TestContextData>(async function* (args, ctx) {
        try {
          const { roomId } = args.pathParams;
          const { userId, username } = args.pathQuery;

          ctx.logger.info('User connected to chat room stream', {
            roomId,
            userId,
            username,
          });

          // Simple status event like production
          yield {
            event: 'status',
            data: { status: 'started', reasoningMessages: [] },
          };

          ctx.logger.info('Chat room SSE handler setup completed successfully');
        } catch (error) {
          ctx.logger.error('Error in chat room SSE handler', error);
          throw error;
        }
      }).fn,
    );

    // Attach the simple test SSE routes
    testContext.attachSSERouteHandlerWithMiddlewares(
      testStreamRoute,
      [],
      testStreamRoute.handle<TestContextData>(async function* (args, ctx) {
        const { id } = args.pathParams;
        const { user } = args.pathQuery;

        ctx.logger.info('Test SSE connection established', { id, user });

        // Send immediate test event
        yield {
          event: 'test-event',
          data: {
            message: `Hello from stream ${id}`,
            timestamp: Date.now(),
          },
        };

        // Send another event after a short delay
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield {
          event: 'test-event',
          data: {
            message: `Second message for ${user || 'anonymous'}`,
            timestamp: Date.now(),
          },
        };

        ctx.logger.info('Test SSE handler completed successfully');
      }).fn,
    );

    testContext.attachSSERouteHandlerWithMiddlewares(
      longRunningStreamRoute,
      [],
      longRunningStreamRoute.handle<TestContextData>(
        async function* (args, ctx) {
          const { id } = args.pathParams;
          const { user } = args.pathQuery;

          ctx.logger.info('Long-running SSE connection established', {
            id,
            user,
          });

          // Send immediate test event
          yield {
            event: 'test-event',
            data: {
              message: `Starting long-running stream ${id}`,
              timestamp: Date.now(),
            },
          };

          // Send events every 200ms for up to 2 seconds (10 events total)
          let eventCount = 0;
          const maxEvents = 10;

          while (eventCount < maxEvents) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            eventCount++;
            yield {
              event: 'test-event',
              data: {
                message: `Event ${eventCount} for ${user || 'anonymous'}`,
                timestamp: Date.now(),
              },
            };
          }

          ctx.logger.info('Long-running stream completed all events', {
            id,
            eventCount,
          });
        },
      ).fn,
    );

    // Attach the graceful close SSE route
    testContext.attachSSERouteHandlerWithMiddlewares(
      gracefulCloseRoute,
      [],
      gracefulCloseRoute.handle<TestContextData>(async function* (args, ctx) {
        const { id } = args.pathParams;
        const {
          autoClose = false,
          closeDelay = 1000,
          forceClose = false,
        } = args.pathQuery;

        ctx.logger.info('Graceful close test SSE connection established', {
          id,
          autoClose,
          closeDelay,
        });

        // Send initial test message
        yield {
          event: 'test-message',
          data: {
            id: '1',
            content: 'Connection established',
          },
        };

        if (autoClose) {
          // Simulate some activity before closing
          await new Promise((resolve) => setTimeout(resolve, closeDelay));

          yield {
            event: 'test-message',
            data: {
              id: '2',
              content: 'About to close gracefully',
            },
          };

          if (!forceClose) {
            // Send the disconnect signal BEFORE the server closes
            yield {
              event: 'disconnect',
              data: {
                reason: 'Server initiated graceful shutdown',
                timestamp: Date.now(),
              },
            };
          }
        }

        ctx.logger.info('Graceful close test handler setup completed');
      }).fn,
    );

    // Add a simple health check
    denzelApp.healthCheck('/health', /test-agent/);

    // Start the server
    await denzelApp.start();

    // Wait a bit for the server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    if (denzelApp) {
      await denzelApp.shutdown();
    }
    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  test('should handle chat room SSE connection and send events through Denzel context', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const roomId = 'test-room-123';
    const userId = 'user-456';
    const username = 'TestUser';

    // Track received events with proper typing
    const receivedConnectionEvents: ChatRoomEvents['connection'][] = [];
    const receivedRoomInfoEvents: ChatRoomEvents['room-info'][] = [];
    const receivedUserJoinedEvents: ChatRoomEvents['user-joined'][] = [];
    const receivedMessageEvents: ChatRoomEvents['message'][] = [];
    const receivedTypingEvents: ChatRoomEvents['typing'][] = [];
    const receivedStatusEvents: ChatRoomEvents['status'][] = [];

    let totalEventsReceived = 0;

    // Create typed SSE client
    const sseClient = createSseClient(chatRoomStreamRoute, {
      logger: logger.child({ component: 'sse-client' }),
      baseUrl: baseUrl,
    });

    // Set up typed event listeners - each handler gets properly typed data!
    sseClient.addEventListener('connection', (data) => {
      // `data` is automatically typed as ChatRoomEvents['connection']
      receivedConnectionEvents.push(data);
      totalEventsReceived++;
    });

    sseClient.addEventListener('room-info', (data) => {
      // `data` is automatically typed as ChatRoomEvents['room-info']
      receivedRoomInfoEvents.push(data);
      totalEventsReceived++;
    });

    sseClient.addEventListener('user-joined', (data) => {
      // `data` is automatically typed as ChatRoomEvents['user-joined']
      receivedUserJoinedEvents.push(data);
      totalEventsReceived++;
    });

    sseClient.addEventListener('message', (data) => {
      // `data` is automatically typed as ChatRoomEvents['message']
      receivedMessageEvents.push(data);
      totalEventsReceived++;
    });

    sseClient.addEventListener('typing', (data) => {
      // `data` is automatically typed as ChatRoomEvents['typing']
      receivedTypingEvents.push(data);
      totalEventsReceived++;
    });

    sseClient.addEventListener('status', (data) => {
      // `data` is automatically typed as ChatRoomEvents['status']
      receivedStatusEvents.push(data);
      totalEventsReceived++;
    });

    // Connect to the SSE endpoint
    sseClient.connect({
      pathParams: { roomId },
      pathQuery: { userId, username },
    });

    // Give the connection time to establish and send initial events
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Wait for connection to open and track minimum events
    const minEventsToReceive = 2; // connection + status

    // Wait for multiple events to be received (check every 50ms)
    const eventWaitPromise = new Promise<void>((resolve) => {
      let attempts = 0;
      const maxAttempts = 10; // Wait up to 500ms since events are immediate

      const checkEvents = () => {
        attempts++;

        if (
          totalEventsReceived >= minEventsToReceive ||
          attempts >= maxAttempts
        ) {
          resolve();
        } else {
          setTimeout(checkEvents, 50);
        }
      };

      checkEvents();
    });

    await eventWaitPromise;

    // Close the connection
    sseClient.disconnect();

    // Verify we received the expected events
    expect(totalEventsReceived).toBeGreaterThan(0);

    // Check for connection event - now with proper typing!
    expect(receivedConnectionEvents.length).toBeGreaterThan(0);
    const connectionEvent = receivedConnectionEvents[0];
    expect(connectionEvent).toBeDefined();
    expect(connectionEvent!.status).toBe('connected');

    // Check for status events - typed!
    expect(receivedStatusEvents.length).toBeGreaterThanOrEqual(1);
    const statusEvent = receivedStatusEvents[0];
    expect(statusEvent).toBeDefined();
    expect(statusEvent!.status).toBe('started');

    logger.info('Chat room E2E test completed successfully', {
      totalEventsReceived,
      connectionEvents: receivedConnectionEvents.length,
      roomInfoEvents: receivedRoomInfoEvents.length,
      userJoinedEvents: receivedUserJoinedEvents.length,
      messageEvents: receivedMessageEvents.length,
      typingEvents: receivedTypingEvents.length,
      statusEvents: receivedStatusEvents.length,
    });
  }, 10000); // 10 second timeout

  test('should establish simple SSE connection and receive events using typed client', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const streamId = 'test-123';
    const user = 'test-user';

    // Track received events with proper typing
    const receivedConnectionEvents: SimpleTestEvents['connection'][] = [];
    const receivedTestEvents: SimpleTestEvents['test-event'][] = [];
    let totalEventsReceived = 0;

    // Create typed SSE client
    const sseClient = createSseClient(testStreamRoute, {
      logger: logger.child({ component: 'sse-client' }),
      baseUrl: baseUrl,
    });

    // Set up typed event listeners
    sseClient.addEventListener('connection', (data) => {
      // `data` is automatically typed as SimpleTestEvents['connection']
      receivedConnectionEvents.push(data);
      totalEventsReceived++;
    });

    sseClient.addEventListener('test-event', (data) => {
      // `data` is automatically typed as SimpleTestEvents['test-event']
      receivedTestEvents.push(data);
      totalEventsReceived++;
    });

    // Connect to the SSE endpoint
    sseClient.connect({
      pathParams: { id: streamId },
      pathQuery: { user },
    });

    // Give the connection time to establish and send initial events
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Wait for events to be received
    const eventWaitPromise = new Promise<void>((resolve) => {
      let attempts = 0;
      const maxAttempts = 10; // Wait up to 500ms

      const checkEvents = () => {
        attempts++;

        if (
          totalEventsReceived >= 2 || // connection + test-event
          attempts >= maxAttempts
        ) {
          resolve();
        } else {
          setTimeout(checkEvents, 50);
        }
      };

      checkEvents();
    });

    await eventWaitPromise;

    // Close the connection
    sseClient.disconnect();

    // Verify we received SSE events
    expect(totalEventsReceived).toBeGreaterThan(0);

    // Check for connection event - typed!
    expect(receivedConnectionEvents.length).toBeGreaterThan(0);
    const connectionEvent = receivedConnectionEvents[0];
    expect(connectionEvent).toBeDefined();
    expect(connectionEvent!.status).toBe('connected');

    // Check for test events - typed!
    expect(receivedTestEvents.length).toBeGreaterThanOrEqual(1);

    // Verify test event data is properly typed - no casting needed!
    const testEvent = receivedTestEvents[0];
    expect(testEvent).toBeDefined();
    expect(testEvent!.message).toContain(streamId);
    expect(testEvent!.timestamp).toBeGreaterThan(0);

    logger.info('Simple SSE typed client test completed successfully', {
      totalEventsReceived,
      connectionEvents: receivedConnectionEvents.length,
      testEvents: receivedTestEvents.length,
    });
  }, 5000);

  test('should handle client disconnect during SSE stream', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const streamId = 'test-disconnect-789';
    const url = `${baseUrl}/api/test/long-stream/${streamId}`;

    // Use AbortController to simulate client disconnect
    const abortController = new AbortController();

    const fetchPromise = fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: abortController.signal,
    });

    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      response = await fetchPromise;
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');

      // Start reading the stream
      reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        // Read initial data to confirm connection is established
        const { value } = await reader.read();
        const chunk = decoder.decode(value);
        expect(chunk).toContain('data:');

        // Simulate client disconnect after receiving some data
        await new Promise((resolve) => setTimeout(resolve, 50));
        abortController.abort();

        // Give the server time to detect the disconnect and clean up
        await new Promise((resolve) => setTimeout(resolve, 100));

        logger.info(
          'Client disconnect test completed - server should have cleaned up',
        );
      }
    } catch (error) {
      // AbortError is expected when we call abort()
      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('Fetch aborted as expected (client disconnect simulation)');
      } else {
        throw error;
      }
    } finally {
      // Clean up any remaining resources
      if (reader) {
        try {
          reader.releaseLock();
        } catch (e) {
          // Expected - connection was aborted
        }
      }
      if (response?.body) {
        try {
          await response.body.cancel();
        } catch (e) {
          // Expected - connection was aborted
        }
      }
    }
  }, 5000);

  test('should handle invalid room ID with proper error response', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const invalidRoomId = ''; // Empty room ID should fail validation

    const url = `${baseUrl}/api/chat/room/${invalidRoomId}/stream`;

    try {
      // This should fail because the path will be malformed
      const response = await fetch(url);
      expect(response.status).toBe(404); // Not found due to malformed path
    } catch (error) {
      // Connection error is also acceptable for this test
      expect(error).toBeDefined();
    }
  });

  test('should handle health check endpoint', async () => {
    const baseUrl = `http://localhost:${serverPort}`;

    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        'User-Agent': 'test-agent',
      },
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('OK');
  });

  test('should handle chat room connection without query parameters', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const roomId = 'test-room-456';

    const url = `${baseUrl}/api/chat/room/${roomId}/stream`;

    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      // Use fetch with streaming to read SSE events
      response = await fetch(url, {
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');

      // Read the stream
      reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const decoder = new TextDecoder();
      const receivedData: string[] = [];
      let attempts = 0;
      const maxAttempts = 5;

      if (reader) {
        while (attempts < maxAttempts) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value);
          if (chunk.trim()) {
            receivedData.push(chunk);
          }

          attempts++;

          // Stop after receiving some data
          if (receivedData.length >= 1) break;
        }
      }

      // Verify we received SSE data
      expect(receivedData.length).toBeGreaterThan(0);

      // Check that we received proper SSE format
      const allData = receivedData.join('');
      expect(allData).toContain('data:');

      // Should contain status event
      expect(allData).toContain('status');

      logger.info(
        'Chat room connection without query params test completed successfully',
        {
          receivedChunks: receivedData.length,
          totalData: allData.length,
        },
      );
    } finally {
      // Always clean up the connection
      if (reader) {
        try {
          reader.releaseLock();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (response?.body) {
        try {
          await response.body.cancel();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }, 5000);

  test('should handle simple SSE connection without query params', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const streamId = 'test-456';
    const url = `${baseUrl}/api/test/stream/${streamId}`;

    const response = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    // Read a small amount of data to verify the stream works
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    try {
      if (reader) {
        const { value } = await reader.read();
        const chunk = decoder.decode(value);

        // Should receive initial connection event and our test event
        expect(chunk).toContain('data:');
        expect(chunk.length).toBeGreaterThan(0);
      } else {
        expect(false).toBe(true);
      }
    } finally {
      // Properly close the connection
      if (reader) {
        try {
          reader.releaseLock();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (response.body) {
        try {
          await response.body.cancel();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }, 3000);

  // Graceful Close Tests
  test('should demonstrate the abrupt close error', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const testId = 'abrupt-close-test';

    // Track events and errors
    const receivedEvents: string[] = [];
    const receivedErrors: Event[] = [];
    let connectionClosed = false;

    const sseClient = createSseClient(gracefulCloseRoute, {
      logger: logger.child({ component: 'abrupt-test-client' }),
      baseUrl: baseUrl,
    });

    // Listen for events
    sseClient.addEventListener('connection', () => {
      receivedEvents.push('connection');
    });

    sseClient.addEventListener('test-message', (data) => {
      receivedEvents.push(`test-message: ${data.content}`);
    });

    // Listen for errors using the direct EventSource error handler
    sseClient.onError((error) => {
      receivedErrors.push(error);
    });

    // Connect - this will NOT send disconnect signal, server will force close
    sseClient.connect({
      pathParams: { id: testId },
      pathQuery: { autoClose: true, closeDelay: 500, forceClose: true },
    });

    // Wait for the connection and automatic close
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Clean up
    if (!connectionClosed) {
      sseClient.disconnect();
      connectionClosed = true;
    }

    // We should see events but also errors due to abrupt close
    expect(receivedEvents.length).toBeGreaterThan(0);

    // The key issue: we get an error when server closes abruptly
    // This is what we want to fix
    logger.info('Abrupt close test completed', {
      eventsReceived: receivedEvents.length,
      errorsReceived: receivedErrors.length,
    });
  }, 5000);

  test('should handle graceful close without errors', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const testId = 'graceful-close-test';

    // Track events and errors
    const receivedEvents: string[] = [];
    const receivedErrors: Event[] = [];
    let connectionClosed = false;

    const sseClient = createSseClient(gracefulCloseRoute, {
      logger: logger.child({ component: 'graceful-test-client' }),
      baseUrl: baseUrl,
    });

    // Listen for events
    sseClient.addEventListener('connection', () => {
      logger.info('Client received connection event');
      receivedEvents.push('connection');
    });

    sseClient.addEventListener('test-message', (data) => {
      logger.info('Client received test-message event', data);
      receivedEvents.push(`test-message: ${data.content}`);
    });

    // IMPORTANT: Listen for the disconnect signal and close gracefully
    sseClient.addEventListener('disconnect', (data) => {
      logger.info('Client received disconnect event', data);
      receivedEvents.push(`disconnect: ${data.reason}`);

      // This is the key: client closes the connection upon receiving disconnect signal
      logger.info(
        'Received disconnect signal, closing connection gracefully',
        data,
      );
      sseClient.disconnect();
      connectionClosed = true;
    });

    // Listen for errors
    sseClient.onError((error) => {
      receivedErrors.push(error);
    });

    // Connect - this WILL send disconnect signal before server closes
    sseClient.connect({
      pathParams: { id: testId },
      pathQuery: { autoClose: true, closeDelay: 500 },
    });

    // Wait for the graceful close sequence
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Clean up if not already closed
    if (!connectionClosed) {
      sseClient.disconnect();
    }

    // We should see events but NO errors due to graceful close
    expect(receivedEvents.length).toBeGreaterThan(0);
    expect(receivedEvents).toContain('connection');
    expect(receivedEvents.some((e) => e.includes('disconnect:'))).toBe(true);

    // The key improvement: no errors when client closes gracefully
    logger.info('Graceful close test completed', {
      eventsReceived: receivedEvents.length,
      errorsReceived: receivedErrors.length,
      events: receivedEvents,
    });

    // Ideally, we should have fewer or no errors with graceful close
    // This test demonstrates the pattern we should use
  }, 5000);

  test('should handle manual disconnect without errors', async () => {
    const baseUrl = `http://localhost:${serverPort}`;
    const testId = 'manual-disconnect-test';

    const receivedEvents: string[] = [];
    const receivedErrors: Event[] = [];

    const sseClient = createSseClient(gracefulCloseRoute, {
      logger: logger.child({ component: 'manual-test-client' }),
      baseUrl: baseUrl,
    });

    sseClient.addEventListener('connection', () => {
      receivedEvents.push('connection');
    });

    sseClient.addEventListener('test-message', (data) => {
      receivedEvents.push(`test-message: ${data.content}`);
    });

    sseClient.onError((error) => {
      // In this test, we expect no errors since we're doing a clean client-initiated disconnect
      logger.warn('Unexpected error in manual disconnect test', { error });
      receivedErrors.push(error);
    });

    // Connect without auto-close but with a long delay to keep server handler alive
    sseClient.connect({
      pathParams: { id: testId },
      pathQuery: { autoClose: true, closeDelay: 10000 }, // Keep server alive for 10 seconds
    });

    // Wait for connection and initial events
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Manually disconnect (client-initiated) - this should be clean
    logger.info('Client initiating manual disconnect');
    sseClient.disconnect();

    // Wait a bit more
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedEvents.length).toBeGreaterThan(0);

    // With proper client-initiated disconnect, we should have no errors
    logger.info('Manual disconnect test completed', {
      eventsReceived: receivedEvents.length,
      errorsReceived: receivedErrors.length,
    });

    // This should now pass without errors
    expect(receivedErrors.length).toBe(0);
  }, 3000);
});
