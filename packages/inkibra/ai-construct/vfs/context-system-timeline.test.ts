import { describe, expect, test } from 'bun:test';
import { createOverlayFs, serializeContextFile } from '@inkibra/ai-flow';
import { renderSection } from './context-system';

describe('renderSection timeline hybrid log rendering', () => {
  test('renders older selected directories as frontmatter summaries and explicit files in full', async () => {
    const vfs = createOverlayFs();
    const oldWeekDir = '/logs/2026/W10';
    const oldLogPath = `${oldWeekDir}/2026-03-09-0.conversation.log`;
    const currentLogPath = '/logs/2026/W11/2026-03-16-0.conversation.log';
    const now = new Date('2026-03-16T12:00:00.000Z');

    await vfs.write(`${oldWeekDir}/.keep`, '');
    await vfs.write('/logs/2026/W11/.keep', '');

    await vfs.write(
      oldLogPath,
      serializeContextFile(
        {
          id: oldLogPath,
          tags: [],
          created: '2026-03-09T09:00:00.000Z',
          updated: '2026-03-09T09:00:00.000Z',
          log_type: 'conversation',
          summary: 'older compacted summary',
          highlights: ['older highlight'],
        },
        '[2026-03-09T09:00:00.000Z] reflected_impulse reflected\nrole: user\nsource_lane: conversation\n\n[content]\nolder full body',
      ),
    );

    await vfs.write(
      currentLogPath,
      serializeContextFile(
        {
          id: currentLogPath,
          tags: [],
          created: '2026-03-16T09:05:00.000Z',
          updated: '2026-03-16T09:05:00.000Z',
          log_type: 'conversation',
        },
        '[2026-03-16T09:05:00.000Z] response response-1\nrole: construct\nsource_lane: conversation\nresponse_id: response-1\n\n[content]\ncurrent full log entry',
      ),
    );

    const rendered = await renderSection(
      vfs,
      '/logs',
      [oldWeekDir, currentLogPath],
      'timeline',
      { now },
    );

    expect(rendered).toContain('summary: older compacted summary');
    expect(rendered).toContain('highlights: [older highlight]');
    expect(rendered).toContain('current full log entry');
    expect(rendered).not.toContain('older full body');
  });
});
