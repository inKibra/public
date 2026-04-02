import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';
import {
  inferPinnedKind,
  loadPinnedState,
  type PinnedEntry,
  queryPinnedEntries,
  removePinnedEntry,
  savePinnedState,
  upsertPinnedEntry,
} from './pinned';

function makePinnedEntry(
  overrides: Partial<PinnedEntry> & { path: string },
): PinnedEntry {
  const now = new Date().toISOString();
  return {
    kind: 'file',
    mode: 'full',
    scope: '*',
    source: 'ai',
    created_at: now,
    updated: now,
    ...overrides,
  };
}

describe('inferPinnedKind', () => {
  test('plain file path', () => {
    expect(inferPinnedKind('/foo/bar.md')).toBe('file');
  });
  test('directory path (trailing slash)', () => {
    expect(inferPinnedKind('/foo/bar/')).toBe('directory');
  });
  test('shallow glob', () => {
    expect(inferPinnedKind('/foo/bar/*')).toBe('glob');
  });
  test('recursive glob', () => {
    expect(inferPinnedKind('/foo/bar/**')).toBe('glob_recursive');
  });
  test('root path', () => {
    expect(inferPinnedKind('/')).toBe('directory');
  });
});

describe('loadPinnedState', () => {
  test('returns empty array when file does not exist', async () => {
    const vfs = createOverlayFs({});
    const result = await loadPinnedState(vfs);
    expect(result).toEqual([]);
  });

  test('returns empty array when file has no pins', async () => {
    const vfs = createOverlayFs({
      mount: {
        [VFS_PATHS.handles.pinned]: [
          '---',
          'id: runtime-pinned',
          'tags: [runtime, handles]',
          '---',
          '',
        ].join('\n'),
      },
    });
    const result = await loadPinnedState(vfs);
    expect(result).toEqual([]);
  });

  test('loads pins from valid state file', async () => {
    const entry = makePinnedEntry({ path: '/notes/foo.md' });
    const vfs = createOverlayFs({});
    await savePinnedState(vfs, [entry]);
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/notes/foo.md');
    expect(result[0]?.kind).toBe('file');
  });
});

describe('savePinnedState', () => {
  test('creates file when it does not exist', async () => {
    const vfs = createOverlayFs({});
    const entry = makePinnedEntry({ path: '/a.md' });
    await savePinnedState(vfs, [entry]);
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/a.md');
  });

  test('overwrites existing pins', async () => {
    const vfs = createOverlayFs({});
    await savePinnedState(vfs, [makePinnedEntry({ path: '/a.md' })]);
    await savePinnedState(vfs, [makePinnedEntry({ path: '/b.md' })]);
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/b.md');
  });
});

describe('upsertPinnedEntry', () => {
  test('appends new entry when no match exists', async () => {
    const vfs = createOverlayFs({});
    await upsertPinnedEntry(vfs, {
      path: '/foo.md',
      kind: 'file',
      mode: 'full',
      scope: '*',
      source: 'ai',
    });
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/foo.md');
    expect(result[0]?.created_at).toBeTruthy();
    expect(result[0]?.updated).toBeTruthy();
  });

  test('updates existing entry matched by dedup key (path, scope)', async () => {
    const vfs = createOverlayFs({});
    await upsertPinnedEntry(vfs, {
      path: '/foo.md',
      kind: 'file',
      mode: 'full',
      scope: '*',
      source: 'ai',
      reason: 'first',
    });
    const first = await loadPinnedState(vfs);
    const originalCreatedAt = first[0]?.created_at;

    await upsertPinnedEntry(vfs, {
      path: '/foo.md',
      kind: 'file',
      mode: 'full',
      scope: '*',
      source: 'ai',
      reason: 'updated',
    });

    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe('updated');
    // created_at is preserved from original entry
    expect(result[0]?.created_at).toBe(originalCreatedAt);
  });

  test('different scope creates a separate entry', async () => {
    const vfs = createOverlayFs({});
    await upsertPinnedEntry(vfs, {
      path: '/foo.md',
      kind: 'file',
      mode: 'full',
      scope: '*',
      source: 'ai',
    });
    await upsertPinnedEntry(vfs, {
      path: '/foo.md',
      kind: 'file',
      mode: 'full',
      scope: 'nap',
      source: 'ai',
    });
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(2);
  });

  test('same path+scope but different mode updates in place', async () => {
    const vfs = createOverlayFs({});
    await upsertPinnedEntry(vfs, {
      path: '/foo.md',
      kind: 'file',
      mode: 'full',
      scope: 'conversation',
      source: 'ai',
    });
    await upsertPinnedEntry(vfs, {
      path: '/foo.md',
      kind: 'file',
      mode: 'frontmatter',
      scope: 'conversation',
      source: 'ai',
    });
    const result = await loadPinnedState(vfs);
    // Same dedup key (path, scope) — should update, not create second entry
    expect(result).toHaveLength(1);
    expect(result[0]?.mode).toBe('frontmatter');
  });
});

describe('removePinnedEntry', () => {
  test('removes matching entry by dedup key (path, scope)', async () => {
    const vfs = createOverlayFs({});
    await savePinnedState(vfs, [
      makePinnedEntry({ path: '/a.md', scope: '*' }),
      makePinnedEntry({ path: '/b.md', scope: '*' }),
    ]);
    await removePinnedEntry(vfs, { path: '/a.md', scope: '*' });
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/b.md');
  });

  test('no-ops when no matching entry exists', async () => {
    const vfs = createOverlayFs({});
    await savePinnedState(vfs, [makePinnedEntry({ path: '/a.md' })]);
    await removePinnedEntry(vfs, { path: '/nonexistent.md', scope: '*' });
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
  });

  test('no-ops when file does not exist', async () => {
    const vfs = createOverlayFs({});
    // Should not throw
    await removePinnedEntry(vfs, { path: '/a.md', scope: '*' });
  });

  test('only removes entry with matching scope', async () => {
    const vfs = createOverlayFs({});
    await savePinnedState(vfs, [
      makePinnedEntry({ path: '/a.md', scope: '*' }),
      makePinnedEntry({ path: '/a.md', scope: 'nap' }),
    ]);
    await removePinnedEntry(vfs, { path: '/a.md', scope: '*' });
    const result = await loadPinnedState(vfs);
    expect(result).toHaveLength(1);
    expect(result[0]?.scope).toBe('nap');
  });
});

describe('queryPinnedEntries', () => {
  const entries: PinnedEntry[] = [
    makePinnedEntry({ path: '/global.md', scope: '*' }),
    makePinnedEntry({ path: '/nap-only.md', scope: 'nap' }),
    makePinnedEntry({ path: '/conv.md', scope: 'conversation' }),
    makePinnedEntry({ path: '/heartbeat.md', scope: 'heartbeat' }),
  ];

  test('stage=impulse with no lane returns only global entries', () => {
    const result = queryPinnedEntries(entries, 'impulse');
    const paths = result.map((e) => e.path);
    expect(paths).toContain('/global.md');
    expect(paths).not.toContain('/nap-only.md');
    expect(paths).not.toContain('/conv.md');
    expect(paths).not.toContain('/heartbeat.md');
  });

  test('stage=nap/commit with no lane returns global + nap-scoped entries', () => {
    const result = queryPinnedEntries(entries, 'nap/commit');
    const paths = result.map((e) => e.path);
    expect(paths).toContain('/global.md');
    expect(paths).toContain('/nap-only.md');
    expect(paths).not.toContain('/conv.md');
  });

  test('stage=impulse with lane=conversation returns global + conversation-scoped', () => {
    const result = queryPinnedEntries(entries, 'impulse', 'conversation');
    const paths = result.map((e) => e.path);
    expect(paths).toContain('/global.md');
    expect(paths).toContain('/conv.md');
    expect(paths).not.toContain('/nap-only.md');
    expect(paths).not.toContain('/heartbeat.md');
  });

  test('stage=nap/analyze with lane=conversation returns global + lane entries only', () => {
    const result = queryPinnedEntries(entries, 'nap/analyze', 'conversation');
    const paths = result.map((e) => e.path);
    expect(paths).toContain('/global.md');
    expect(paths).not.toContain('/nap-only.md');
    expect(paths).toContain('/conv.md');
    expect(paths).not.toContain('/heartbeat.md');
  });

  test('non-matching lane returns only global', () => {
    const result = queryPinnedEntries(entries, 'impulse', 'background');
    const paths = result.map((e) => e.path);
    expect(paths).toContain('/global.md');
    expect(paths).not.toContain('/conv.md');
    expect(paths).not.toContain('/heartbeat.md');
  });

  test('empty entries returns empty', () => {
    expect(queryPinnedEntries([], 'impulse')).toEqual([]);
  });
});
