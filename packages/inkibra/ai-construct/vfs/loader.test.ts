import { describe, expect, test } from 'bun:test';
import { createOverlayFs, serializeContextFile } from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';
import {
  renderOpenedLogTimeline,
  renderOpenedNonLogFilesContext,
  renderRecentLogTimeline,
} from './loader';

describe('loader opened rendering', () => {
  test('renders opened non-log files and upgrades direct opens over dir frontmatter', async () => {
    const vfs = createOverlayFs();
    const soulPath = `${VFS_PATHS.core.root}/SOUL.md`;
    const userPath = `${VFS_PATHS.core.root}/USER.md`;

    await vfs.write(
      soulPath,
      serializeContextFile(
        {
          id: 'soul',
          tags: [],
          created: '2026-03-16T12:00:00.000Z',
          updated: '2026-03-16T12:00:00.000Z',
          title: 'Soul',
        },
        '# SOUL\n\nfull soul body',
      ),
    );
    await vfs.write(
      userPath,
      serializeContextFile(
        {
          id: 'user',
          tags: [],
          created: '2026-03-16T12:00:00.000Z',
          updated: '2026-03-16T12:05:00.000Z',
          title: 'User',
        },
        '# USER\n\nfull user body',
      ),
    );
    await writeOpenedState(vfs, [
      {
        path: VFS_PATHS.core.root,
        type: 'directory',
        mode: 'frontmatter',
      },
      {
        path: soulPath,
        type: 'file',
        mode: 'full',
      },
    ]);

    const rendered = await renderOpenedNonLogFilesContext(vfs, {
      title: 'Opened Files',
    });

    expect(rendered).toContain(`### ${soulPath}`);
    expect(rendered).toContain('full soul body');
    expect(rendered).toContain(`### ${userPath} (frontmatter)`);
    expect(rendered).toContain('title: User');
    expect(rendered).not.toContain('full user body');
  });

  test('renders opened logs as one timeline and upgrades direct opens over dir frontmatter', async () => {
    const vfs = createOverlayFs();
    const weekDir = `${VFS_PATHS.logs.root}/2026/W11`;
    const oldLogPath = `${weekDir}/2026-03-15-0.conversation.log`;
    const currentLogPath = `${weekDir}/2026-03-16-0.conversation.log`;

    await vfs.write(
      oldLogPath,
      serializeContextFile(
        {
          id: 'old-log',
          tags: [],
          created: '2026-03-15T09:00:00.000Z',
          updated: '2026-03-15T09:00:00.000Z',
          summary: 'older compacted summary',
        },
        '',
      ),
    );
    await vfs.write(
      currentLogPath,
      serializeContextFile(
        {
          id: 'current-log',
          tags: [],
          created: '2026-03-16T09:05:00.000Z',
          updated: '2026-03-16T09:05:00.000Z',
          log_type: 'conversation',
        },
        `[2026-03-16T09:05:00.000Z] impulse-1\nfrom: user\ntrigger: "hello"\n\ncurrent full log entry`,
      ),
    );
    await writeOpenedState(vfs, [
      {
        path: weekDir,
        type: 'directory',
        mode: 'frontmatter',
      },
      {
        path: currentLogPath,
        type: 'file',
        mode: 'full',
      },
    ]);

    const rendered = await renderOpenedLogTimeline(vfs, {
      now: new Date('2026-03-16T12:00:00.000Z'),
      title: 'Open Logs (chronological)',
    });

    expect(rendered).toContain(
      'listening_thoughts:summary 2026-03-15-0.conversation.log',
    );
    expect(rendered).toContain('summary: older compacted summary');
    expect(rendered).toContain('impulse:listening_thoughts impulse-1');
    expect(rendered).toContain('current full log entry');
    expect(rendered).not.toContain(
      'impulse:listening_thoughts summary 2026-03-16-0.conversation.log',
    );
  });

  test('renders recent log timeline with bodies, not just headers', async () => {
    const vfs = createOverlayFs();
    const logPath = `${VFS_PATHS.logs.root}/2026/W11/2026-03-16-0.internal.log`;

    await vfs.write(
      logPath,
      serializeContextFile(
        {
          id: 'recent-log',
          tags: [],
          created: '2026-03-16T11:55:00.000Z',
          updated: '2026-03-16T11:55:00.000Z',
          log_type: 'internal',
        },
        '[2026-03-16T11:55:00.000Z] impulse-2\nfrom: system\ntrigger: heartbeat\n\nbody text should appear',
      ),
    );

    const rendered = await renderRecentLogTimeline(vfs, {
      now: new Date('2026-03-16T12:00:00.000Z'),
      minutes: 30,
      maxItems: 10,
      title: 'Recent Log Timeline',
    });

    expect(rendered).toContain('Recent Log Timeline');
    expect(rendered).toContain('internal impulse-2');
    expect(rendered).toContain('body text should appear');
  });
});

async function writeOpenedState(
  vfs: ReturnType<typeof createOverlayFs>,
  files: Array<{
    path: string;
    type: 'file' | 'directory';
    mode?: 'full' | 'frontmatter';
  }>,
) {
  await vfs.write(
    VFS_PATHS.handles.opened,
    serializeContextFile(
      {
        id: 'opened-files',
        tags: [],
        created: '2026-03-16T12:00:00.000Z',
        updated: '2026-03-16T12:00:00.000Z',
        context_bytes: 0,
        context_tokens: 0,
        files: files.map((entry) => ({
          ...entry,
          opened_at: '2026-03-16T12:00:00.000Z',
          size_bytes: 0,
        })),
        ai_pins: [],
        recently_closed: [],
      },
      '',
    ),
  );
}
