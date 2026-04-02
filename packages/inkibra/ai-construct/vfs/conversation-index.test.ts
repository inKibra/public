import { describe, expect, test } from 'bun:test';
import {
  createOverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { updateConversationIndex } from './conversation-index';

describe('conversation index', () => {
  test('updates index when logs have updated metadata', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-02-28T01:54:00.000Z').toISOString();
    const logPath = '/logs/2026/W09/2026-02-28-0.conversation.log';

    await vfs.write(
      logPath,
      serializeContextFile(
        {
          id: logPath,
          type: 'log',
          tags: [],
          created: now,
          updated: now,
          log_type: 'conversation',
          date: '2026-02-28',
          entry_count: 1,
        },
        '[2026-02-28T01:54:00.000Z] legacy entry',
      ),
    );

    const result = await updateConversationIndex(vfs);
    expect(result.indexPath).toBe('/logs/INDEX.md');

    const indexRaw = await vfs.read(result.indexPath);
    const parsedIndex = parseContextFile(indexRaw);
    const daily = Array.isArray(parsedIndex.meta.daily)
      ? parsedIndex.meta.daily
      : [];
    expect(daily.length).toBeGreaterThan(0);
    expect((daily[0] as Record<string, unknown>)?.path).toBe(logPath);
  });
});
