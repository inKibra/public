import { describe, expect, test } from 'bun:test';
import { splitConstructResponseMessages } from './message-splitting';

describe('splitConstructResponseMessages', () => {
  test('does not split on double newlines (standard paragraphs)', () => {
    expect(
      splitConstructResponseMessages('First\n\nSecond\n\nThird', 10),
    ).toEqual(['First\n\nSecond\n\nThird']);
  });

  test('splits on triple newlines (deliberate message break)', () => {
    expect(
      splitConstructResponseMessages('First\n\n\nSecond\n\n\nThird', 10),
    ).toEqual(['First', 'Second', 'Third']);
  });

  test('does not split inside fenced code blocks with triple newlines', () => {
    expect(
      splitConstructResponseMessages(
        'Before\n\n\n```ts\nconst x = 1;\n\n\nconst y = 2;\n```\n\n\nAfter',
        10,
      ),
    ).toEqual([
      'Before',
      '```ts\nconst x = 1;\n\n\nconst y = 2;\n```',
      'After',
    ]);
  });

  test('still supports legacy MESSAGE blocks', () => {
    expect(
      splitConstructResponseMessages(
        'MESSAGE 1:\nFirst\n---\nMESSAGE 2:\nSecond',
        10,
      ),
    ).toEqual(['First', 'Second']);
  });
});
