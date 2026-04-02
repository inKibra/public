import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Logger } from '@inkibra/logger';
import type { SseEventTypes } from '../constants/sse-event';
import { EventStream, type StreamResponse } from './event-stream';

// Test event types
interface TestEvents extends SseEventTypes {
  'user-joined': { userId: string; username: string };
  'user-left': { userId: string; username: string };
  message: { id: string; content: string; author: string };
  system: { message: string; level: 'info' | 'warning' | 'error' };
}

// Mock StreamResponse for testing
const createMockStreamResponse = () => {
  const events: Record<string, ((...args: unknown[]) => void)[]> = {};
  const writtenData: string[] = [];

  return {
    mockResponse: {
      init: mock(() => {
        // Initialization called
      }),
      write: mock((data: string) => {
        writtenData.push(data);
        return true;
      }),
      end: mock(() => {}),
      on: mock((event: string, callback: (...args: unknown[]) => void) => {
        if (!events[event]) {
          events[event] = [];
        }
        events[event].push(callback);
      }),
    } as StreamResponse,
    emit: (event: string, ...args: unknown[]) => {
      if (events[event]) {
        events[event].forEach((callback) => callback(...args));
      }
    },
    getWrittenData: () => writtenData,
  };
};

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

describe('EventStream', () => {
  let mockLogger: Logger;
  let mockResponse: StreamResponse;
  let emit: (event: string, ...args: unknown[]) => void;
  let getWrittenData: () => string[];
  let eventStream: EventStream<TestEvents>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    const mockSetup = createMockStreamResponse();
    mockResponse = mockSetup.mockResponse;
    emit = mockSetup.emit;
    getWrittenData = mockSetup.getWrittenData;
    eventStream = new EventStream<TestEvents>(mockResponse, mockLogger);
  });

  describe('initialization', () => {
    test('should call init on response', () => {
      expect(mockResponse.init).toHaveBeenCalled();
    });

    test('should send initial connection event', () => {
      const writtenData = getWrittenData();
      expect(writtenData).toContain(
        'event: connection\ndata: {"status":"connected"}\n\n',
      );
    });

    test('should be active after initialization', () => {
      expect(eventStream.isActive()).toBe(true);
    });
  });

  describe('event sending', () => {
    test('should send typed events correctly', () => {
      const testData = { userId: '123', username: 'testuser' };
      eventStream.send('user-joined', testData, { id: 'event-1' });

      const writtenData = getWrittenData();
      expect(writtenData).toContain(
        'id: event-1\nevent: user-joined\ndata: {"userId":"123","username":"testuser"}\n\n',
      );
    });

    test('should send events without optional metadata', () => {
      const testData = { id: '1', content: 'Hello', author: 'user' };
      eventStream.send('message', testData);

      const writtenData = getWrittenData();
      expect(writtenData).toContain(
        'event: message\ndata: {"id":"1","content":"Hello","author":"user"}\n\n',
      );
    });

    test('should send events with retry metadata', () => {
      const testData = { message: 'Connection lost', level: 'error' as const };
      eventStream.send('system', testData, { retry: 5000 });

      const writtenData = getWrittenData();
      expect(writtenData).toContain(
        'retry: 5000\nevent: system\ndata: {"message":"Connection lost","level":"error"}\n\n',
      );
    });

    test('should not send events to closed stream', () => {
      eventStream.forceClose();

      const initialDataLength = getWrittenData().length;
      eventStream.send('message', { id: '1', content: 'test', author: 'user' });

      // Should not have written additional data
      expect(getWrittenData().length).toBe(initialDataLength);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Attempted to send event to closed stream',
        { eventType: 'message' },
      );
    });

    test('should send heartbeat events', () => {
      eventStream.sendHeartbeat();

      const writtenData = getWrittenData();
      const allData = writtenData.join('');
      expect(allData).toContain('event: heartbeat');
      expect(allData).toContain('timestamp');
    });
  });

  describe('stream lifecycle', () => {
    test('should handle client disconnect correctly', () => {
      const closeCallback = mock(() => {});
      eventStream.onClose(closeCallback);

      expect(eventStream.isActive()).toBe(true);

      // Simulate client disconnect
      emit('close');

      expect(eventStream.isActive()).toBe(false);
      expect(closeCallback).toHaveBeenCalled();
      expect(mockResponse.end).toHaveBeenCalled();
    });

    test('should handle response errors and close stream', () => {
      const error = new Error('Test error');
      emit('error', error);

      expect(eventStream.isActive()).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'SSE Response Error',
        error,
      );
    });

    test('should handle manual close correctly', () => {
      const closeCallback = mock(() => {});
      eventStream.onClose(closeCallback);

      expect(eventStream.isActive()).toBe(true);

      eventStream.forceClose();

      expect(eventStream.isActive()).toBe(false);
      expect(closeCallback).toHaveBeenCalled();
      expect(mockResponse.end).toHaveBeenCalled();
    });

    test('should handle multiple close callbacks', () => {
      const callback1 = mock(() => {});
      const callback2 = mock(() => {});

      eventStream.onClose(callback1);
      eventStream.onClose(callback2);

      emit('close');

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    test('should not call close callbacks multiple times', () => {
      const closeCallback = mock(() => {});
      eventStream.onClose(closeCallback);

      // Close multiple times
      eventStream.forceClose();
      eventStream.forceClose();
      emit('close'); // Should not trigger again

      expect(closeCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    test('should handle write errors gracefully', () => {
      // Mock write to throw an error
      (
        mockResponse.write as unknown as {
          mockImplementation: (...args: unknown[]) => void;
        }
      ).mockImplementation(() => {
        throw new Error('Write error');
      });

      eventStream.send('message', { id: '1', content: 'test', author: 'user' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error sending SSE event',
        expect.objectContaining({
          error: expect.any(Error),
          eventType: 'message',
        }),
      );
    });
  });

  describe('complex scenarios', () => {
    test('should handle rapid event sending', () => {
      const events = [
        { type: 'user-joined', data: { userId: '1', username: 'user1' } },
        { type: 'user-joined', data: { userId: '2', username: 'user2' } },
        {
          type: 'message',
          data: { id: '1', content: 'Hello', author: 'user1' },
        },
        {
          type: 'message',
          data: { id: '2', content: 'Hi there', author: 'user2' },
        },
        { type: 'user-left', data: { userId: '1', username: 'user1' } },
      ];

      events.forEach((event, index) => {
        eventStream.send(
          event.type as keyof TestEvents,
          event.data as TestEvents[keyof TestEvents],
          {
            id: `event-${index}`,
          },
        );
      });

      const writtenData = getWrittenData();

      // Verify all events were written
      events.forEach((event, index) => {
        expect(
          writtenData.some(
            (data) =>
              data.includes(`event: ${event.type}`) &&
              data.includes(`id: event-${index}`),
          ),
        ).toBe(true);
      });
    });

    test('should demonstrate typical chat room usage', () => {
      // Simulate a chat room scenario
      eventStream.send('user-joined', { userId: '123', username: 'alice' });
      eventStream.send('message', {
        id: '1',
        content: 'Hello everyone!',
        author: 'alice',
      });
      eventStream.send('user-joined', { userId: '456', username: 'bob' });
      eventStream.send('message', {
        id: '2',
        content: 'Hi Alice!',
        author: 'bob',
      });
      eventStream.send('system', {
        message: 'Chat room is active',
        level: 'info',
      });

      const writtenData = getWrittenData();

      // Verify all events were written
      expect(
        writtenData.some(
          (data) => data.includes('user-joined') && data.includes('alice'),
        ),
      ).toBe(true);
      expect(
        writtenData.some(
          (data) =>
            data.includes('message') && data.includes('Hello everyone!'),
        ),
      ).toBe(true);
      expect(
        writtenData.some(
          (data) => data.includes('user-joined') && data.includes('bob'),
        ),
      ).toBe(true);
      expect(
        writtenData.some(
          (data) => data.includes('message') && data.includes('Hi Alice!'),
        ),
      ).toBe(true);
      expect(
        writtenData.some(
          (data) =>
            data.includes('system') && data.includes('Chat room is active'),
        ),
      ).toBe(true);

      // Verify connection event was sent first
      expect(writtenData[0]).toContain('connection');

      // Clean up
      eventStream.forceClose();
      expect(eventStream.isActive()).toBe(false);
    });
  });
});
