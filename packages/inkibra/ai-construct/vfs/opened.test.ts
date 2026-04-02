import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import {
  inferPinKind,
  loadOpenedState,
  type OpenedFilesState,
  saveOpenedState,
} from './opened';

function createState(overrides?: Partial<OpenedFilesState>): OpenedFilesState {
  const now = new Date().toISOString();
  return {
    updated: now,
    context_bytes: 0,
    context_tokens: 0,
    files: [],
    recently_closed: [],
    ...overrides,
  };
}

describe('inferPinKind', () => {
  test('resolves file, directory, and recursive glob patterns', () => {
    expect(inferPinKind('/agent/home/SOUL.md')).toBe('file');
    expect(inferPinKind('/agent/home/')).toBe('directory');
    expect(inferPinKind('/agent/home/*')).toBe('glob');
    expect(inferPinKind('/agent/home/**')).toBe('glob_recursive');
  });
});

describe('autoCloseOldest', () => {
  test('does not close files with pin field set', async () => {
    const { autoCloseOldest } = await import('./context-pressure');
    const vfs = createOverlayFs();
    const now = new Date().toISOString();

    await saveOpenedState(
      vfs,
      createState({
        context_bytes: 600,
        context_tokens: 600,
        files: [
          {
            path: '/agent/home/pinned.md',
            type: 'file',
            opened_at: now,
            size_bytes: 200,
            size_tokens: 200,
            score: 0,
            pin: 'both',
          },
          {
            path: '/agent/home/unpinned.md',
            type: 'file',
            opened_at: now,
            size_bytes: 200,
            size_tokens: 200,
            score: 0,
          },
        ],
      }),
    );

    const result = await autoCloseOldest(vfs, 200);

    // Should only close the unpinned file
    expect(result.closed.length).toBe(1);
    expect(result.closed[0]!.path).toBe('/agent/home/unpinned.md');

    const state = await loadOpenedState(vfs);
    expect(state.files.some((f) => f.path === '/agent/home/pinned.md')).toBe(
      true,
    );
  });
});
