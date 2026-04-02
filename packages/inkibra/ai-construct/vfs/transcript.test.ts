import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { writeLaneLogEntry } from './lane-logs';
import { parseTranscriptLog, readDerivedTranscriptEntries } from './transcript';

describe('derived transcript helpers', () => {
  test('keeps all reflected impulse entries when concurrent writes target the same lane log', async () => {
    const vfs = createOverlayFs();
    const baseTime = new Date('2026-02-26T12:00:00.000Z');
    const messages = Array.from(
      { length: 20 },
      (_, index) => `concurrent-user-message-${index}`,
    );

    await Promise.all(
      messages.map((content, index) =>
        writeLaneLogEntry(vfs, 'conversation', {
          kind: 'reflected_impulse',
          role: 'user',
          sourceLane: 'conversation',
          timestamp: new Date(baseTime.getTime() + index),
          content,
        }),
      ),
    );

    const entries = await readDerivedTranscriptEntries(vfs);
    const userEntries = entries.filter((entry) => entry.role === 'user');

    expect(userEntries.length).toBe(messages.length);
    const observedMessages = new Set(userEntries.map((entry) => entry.content));
    expect(observedMessages.size).toBe(messages.length);
    for (const message of messages) {
      expect(observedMessages.has(message)).toBe(true);
    }
  });

  test('preserves separator lines inside reflected impulse content', async () => {
    const vfs = createOverlayFs();
    const timestamp = new Date('2026-02-26T12:00:00.000Z');

    await writeLaneLogEntry(vfs, 'conversation', {
      kind: 'reflected_impulse',
      role: 'user',
      sourceLane: 'conversation',
      timestamp,
      content:
        'MESSAGE 1:\nReceived: `PING`.\n---\nMESSAGE 2:\nStill same entry.',
    });

    const derived = await readDerivedTranscriptEntries(vfs);
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      role: 'user',
      content:
        'MESSAGE 1:\nReceived: `PING`.\n---\nMESSAGE 2:\nStill same entry.',
    });
  });

  test('projects response and reflected entries from a single lane log file', async () => {
    const vfs = createOverlayFs();
    const reflectedAt = new Date('2026-02-26T12:00:00.000Z');
    const responseAt = new Date('2026-02-26T12:00:01.000Z');

    await writeLaneLogEntry(vfs, 'conversation', {
      kind: 'reflected_impulse',
      role: 'user',
      sourceLane: 'conversation',
      timestamp: reflectedAt,
      content: 'hello there',
      factId: 'fact-1',
    });
    await writeLaneLogEntry(vfs, 'conversation', {
      kind: 'response',
      role: 'construct',
      sourceLane: 'conversation',
      timestamp: responseAt,
      impulseId: 'impulse-1',
      responseId: 'response-1',
      factId: 'fact-1',
      content: 'hi back',
    });

    const raw = await vfs.read('/logs/2026/W09/2026-02-26-0.conversation.log');
    const projected = parseTranscriptLog(raw);

    expect(projected).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'hello there',
        lane: 'conversation',
        factId: 'fact-1',
      }),
      expect.objectContaining({
        role: 'construct',
        content: 'hi back',
        lane: 'conversation',
        factId: 'fact-1',
        responseId: 'response-1',
      }),
    ]);
  });
});
