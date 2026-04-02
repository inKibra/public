import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';
import { getLatestLogPathForDir } from './logs';
import { parseSourceEventLog, writeSourceEventEntry } from './source-events';

describe('source event log writer', () => {
  test('writes and parses machine source-event entries', async () => {
    const vfs = createOverlayFs();

    await writeSourceEventEntry(vfs, {
      factId: 'fact-system-1',
      factType: 'system_event',
      traceId: 'trace-system-1',
      timestamp: new Date('2026-03-05T12:00:00.000Z'),
      payload: {
        event: 'heartbeat',
        state: 'tick',
      },
    });

    const logPath = await getLatestLogPathForDir(vfs, VFS_PATHS.logs.root);
    expect(logPath).toBeTruthy();

    const content = await vfs.read(logPath!);
    const entries = parseSourceEventLog(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      factId: 'fact-system-1',
      factType: 'system_event',
      traceId: 'trace-system-1',
      payload: {
        event: 'heartbeat',
        state: 'tick',
      },
    });
  });
});
