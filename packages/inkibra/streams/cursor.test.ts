import { describe, expect, test } from 'bun:test';
import { decodeCursor, encodeCursor } from './cursor';

describe('cursor codec', () => {
  test('encodes and decodes cursor state', () => {
    const cursor = encodeCursor({
      streamKey: 'tonetempo:generation:abc',
      seq: 42,
      redisId: '1700000000000-3',
    });

    expect(cursor.startsWith('v1.')).toBe(true);
    expect(decodeCursor(cursor)).toEqual({
      streamKey: 'tonetempo:generation:abc',
      seq: 42,
      redisId: '1700000000000-3',
    });
  });

  test('returns null for invalid cursors', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('v2.bad')).toBeNull();
    expect(decodeCursor('v1.not-base64')).toBeNull();
    expect(
      decodeCursor(
        'v1.eyJ2IjoxLCJzdHJlYW1LZXkiOjEyMywic2VxIjoibm90LW51bWJlciIsInJlZGlzSWQiOm51bGx9',
      ),
    ).toBeNull();
  });

  test('decodes in browser-style environments without Buffer', () => {
    const cursor = encodeCursor({
      streamKey: 'tonetempo:generation:browser',
      seq: 7,
      redisId: '1700000000000-1',
    });

    const originalBuffer = (globalThis as { Buffer?: typeof Buffer }).Buffer;
    try {
      (globalThis as { Buffer?: typeof Buffer }).Buffer = undefined;
      expect(decodeCursor(cursor)).toEqual({
        streamKey: 'tonetempo:generation:browser',
        seq: 7,
        redisId: '1700000000000-1',
      });
    } finally {
      (globalThis as { Buffer?: typeof Buffer }).Buffer = originalBuffer;
    }
  });
});
