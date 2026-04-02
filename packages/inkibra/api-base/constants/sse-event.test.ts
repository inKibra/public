import { describe, expect, test } from 'bun:test';
import { formatSseEvent } from './sse-event';

describe('formatSseEvent', () => {
  describe('basic formatting', () => {
    test('should format SSE event with all fields', () => {
      const event = {
        type: 'user-joined',
        data: { userId: '123', username: 'test-user' },
        id: 'event-1',
        retry: 3000,
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'id: event-1\nretry: 3000\nevent: user-joined\ndata: {"userId":"123","username":"test-user"}\n\n',
      );
    });

    test('should format SSE event with only required fields', () => {
      const event = {
        type: 'message',
        data: { id: '1', content: 'Hello', author: 'user' },
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'event: message\ndata: {"id":"1","content":"Hello","author":"user"}\n\n',
      );
    });

    test('should format SSE event with id only', () => {
      const event = {
        type: 'system',
        data: { message: 'Server starting', level: 'info' as const },
        id: 'sys-1',
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'id: sys-1\nevent: system\ndata: {"message":"Server starting","level":"info"}\n\n',
      );
    });

    test('should format SSE event with retry only', () => {
      const event = {
        type: 'system',
        data: { message: 'Connection lost', level: 'error' as const },
        retry: 5000,
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'retry: 5000\nevent: system\ndata: {"message":"Connection lost","level":"error"}\n\n',
      );
    });
  });

  describe('data serialization', () => {
    test('should serialize complex object data', () => {
      const event = {
        type: 'data-update',
        data: {
          timestamp: 1640995200000,
          values: [1, 2, 3, 4, 5],
        },
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'event: data-update\ndata: {"timestamp":1640995200000,"values":[1,2,3,4,5]}\n\n',
      );
    });

    test('should serialize nested object data', () => {
      const event = {
        type: 'user-joined',
        data: {
          userId: '123',
          username: 'test-user',
        },
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'event: user-joined\ndata: {"userId":"123","username":"test-user"}\n\n',
      );
    });

    test('should handle empty object data', () => {
      const event = {
        type: 'system',
        data: {},
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe('event: system\ndata: {}\n\n');
    });
  });

  describe('field ordering', () => {
    test('should maintain consistent field ordering', () => {
      const event = {
        type: 'message',
        data: { id: '1', content: 'test', author: 'user' },
        retry: 1000,
        id: 'msg-1',
      };

      const formatted = formatSseEvent(event);

      // Should follow order: id, retry, event, data
      expect(formatted).toBe(
        'id: msg-1\nretry: 1000\nevent: message\ndata: {"id":"1","content":"test","author":"user"}\n\n',
      );
    });
  });

  describe('edge cases', () => {
    test('should handle special characters in data', () => {
      const event = {
        type: 'message',
        data: {
          id: '1',
          content: 'Hello "world" with\nnewlines and\ttabs',
          author: 'user',
        },
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toContain(
        'Hello \\"world\\" with\\nnewlines and\\ttabs',
      );
    });

    test('should handle numeric event IDs', () => {
      const event = {
        type: 'message',
        data: { id: '1', content: 'test', author: 'user' },
        id: '12345',
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'id: 12345\nevent: message\ndata: {"id":"1","content":"test","author":"user"}\n\n',
      );
    });

    test('should handle zero retry value', () => {
      const event = {
        type: 'system',
        data: { message: 'No retry', level: 'info' as const },
        retry: 0,
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'retry: 0\nevent: system\ndata: {"message":"No retry","level":"info"}\n\n',
      );
    });
  });

  describe('real-world scenarios', () => {
    test('should format chat message event', () => {
      const event = {
        type: 'message',
        data: {
          id: 'msg-123',
          content: 'Hey everyone! How are you doing?',
          author: 'alice',
        },
        id: 'chat-msg-123',
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'id: chat-msg-123\nevent: message\ndata: {"id":"msg-123","content":"Hey everyone! How are you doing?","author":"alice"}\n\n',
      );
    });

    test('should format user presence event', () => {
      const event = {
        type: 'user-joined',
        data: {
          userId: 'user-456',
          username: 'bob_developer',
        },
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'event: user-joined\ndata: {"userId":"user-456","username":"bob_developer"}\n\n',
      );
    });

    test('should format system notification with retry', () => {
      const event = {
        type: 'system',
        data: {
          message: 'Server will restart in 5 minutes',
          level: 'warning' as const,
        },
        retry: 30000, // 30 seconds
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe(
        'retry: 30000\nevent: system\ndata: {"message":"Server will restart in 5 minutes","level":"warning"}\n\n',
      );
    });
  });
});
