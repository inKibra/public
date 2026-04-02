import { describe, expect, test } from 'bun:test';
import type { ContextPersistence } from '../context/types';
import { createOverlayFs } from './overlay-fs';

describe('OverlayFs', () => {
  test('flushCurrent keeps dirty files when persistence fails', async () => {
    let attempts = 0;
    const writes: Array<{ id: string; content: string }> = [];

    const backend: ContextPersistence = {
      async load() {
        return null;
      },
      async list() {
        return [];
      },
      async write(ctx) {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient failure');
        }
        writes.push({ id: ctx.id, content: ctx.content });
      },
      async remove() {},
    };

    const fs = createOverlayFs({
      persistent: [{ prefix: '/context/', backend }],
    });

    await fs.write(
      '/context/test.md',
      '---\nid: test\ntags: []\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\nhello',
    );

    await expect(fs.flushCurrent()).rejects.toThrow('transient failure');
    expect(fs.getDirtyPaths()).toEqual(['/context/test.md']);

    await fs.flushCurrent();

    expect(fs.getDirtyPaths()).toEqual([]);
    expect(writes).toEqual([{ id: 'test.md', content: 'hello' }]);
  });

  test('fork reads through to parent for files not in memory', async () => {
    const parent = createOverlayFs();
    await parent.write('/file-a.md', 'from parent');
    await parent.write('/file-b.md', 'also from parent');

    const forked = parent.fork();

    // Fork can read parent files
    expect(await forked.read('/file-a.md')).toBe('from parent');
    expect(await forked.read('/file-b.md')).toBe('also from parent');

    // Fork writes don't affect parent
    await forked.write('/file-a.md', 'overwritten in fork');
    expect(await forked.read('/file-a.md')).toBe('overwritten in fork');
    expect(await parent.read('/file-a.md')).toBe('from parent');

    // Fork can write new files that don't exist in parent
    await forked.write('/new-file.md', 'fork only');
    expect(await forked.read('/new-file.md')).toBe('fork only');
    await expect(parent.read('/new-file.md')).rejects.toThrow('ENOENT');

    // Fork deletes hide parent files
    await forked.delete('/file-b.md');
    await expect(forked.read('/file-b.md')).rejects.toThrow('ENOENT');
    expect(await parent.read('/file-b.md')).toBe('also from parent');
  });

  test('fork list merges parent entries', async () => {
    const parent = createOverlayFs();
    await parent.write('/dir/a.md', 'a');
    await parent.write('/dir/b.md', 'b');

    const forked = parent.fork();
    await forked.write('/dir/c.md', 'c');

    const entries = await forked.list('/dir');
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['a.md', 'b.md', 'c.md']);
  });

  test('fork list hides deleted parent entries', async () => {
    const parent = createOverlayFs();
    await parent.write('/dir/a.md', 'a');
    await parent.write('/dir/b.md', 'b');

    const forked = parent.fork();
    await forked.delete('/dir/a.md');

    const entries = await forked.list('/dir');
    const names = entries.map((e) => e.name);
    expect(names).toEqual(['b.md']);
  });
});
