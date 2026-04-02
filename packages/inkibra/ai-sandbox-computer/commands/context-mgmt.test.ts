import { describe, expect, test } from 'bun:test';
import { createOverlayFs, parseContextFile } from '@inkibra/ai-flow';
import { createCommandRegistry } from '../registry';
import type { CommandContext } from '../types';
import { contextManagementCommands } from './context-management';

const PINNED_PATH = '/runtime/handles/pinned.md';

function createTestEnv() {
  const fs = createOverlayFs();
  const registry = createCommandRegistry();
  for (const cmd of contextManagementCommands) {
    registry.register(cmd);
  }
  const ctx: CommandContext = { fs, registry };
  return { fs, registry, ctx };
}

describe('context management commands', () => {
  test('open reads content without creating pinned state', async () => {
    const { fs, registry, ctx } = createTestEnv();
    await fs.write('/agent/home/notes.md', 'hello world');

    const result = (await registry.dispatch(
      'open',
      ['/agent/home/notes.md'],
      ctx,
    )) as {
      path: string;
      type: 'file';
      content: string;
    };

    expect(result.path).toBe('/agent/home/notes.md');
    expect(result.type).toBe('file');
    expect(result.content).toBe('hello world');
    await expect(fs.read(PINNED_PATH)).rejects.toThrow();
  });

  test('pin persists a scope-aware entry to pinned.md', async () => {
    const { fs, registry, ctx } = createTestEnv();

    await registry.dispatch(
      'pin',
      ['/agent/home/notes.md', 'nap', '--mode', 'frontmatter'],
      ctx,
    );

    const parsed = parseContextFile(await fs.read(PINNED_PATH));
    const pins = Array.isArray(parsed.meta.pins)
      ? (parsed.meta.pins as Array<Record<string, unknown>>)
      : [];
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      path: '/agent/home/notes.md',
      scope: 'nap',
      mode: 'frontmatter',
      source: 'ai',
    });

    const listed = (await registry.dispatch(
      'pinned',
      ['--scope', 'nap'],
      ctx,
    )) as Array<{
      path: string;
      scope: string;
    }>;
    expect(listed).toEqual([
      expect.objectContaining({
        path: '/agent/home/notes.md',
        scope: 'nap',
      }),
    ]);
  });

  test('unpin removes matching scope entry from pinned.md', async () => {
    const { fs, registry, ctx } = createTestEnv();

    // Pin the same file to two different scopes
    await registry.dispatch(
      'pin',
      ['/agent/home/notes.md', 'conversation'],
      ctx,
    );
    await registry.dispatch('pin', ['/agent/home/notes.md', 'nap'], ctx);

    // Unpin only the conversation-scoped pin
    await registry.dispatch(
      'unpin',
      ['/agent/home/notes.md', 'conversation'],
      ctx,
    );

    const parsed = parseContextFile(await fs.read(PINNED_PATH));
    const pins = Array.isArray(parsed.meta.pins)
      ? (parsed.meta.pins as Array<Record<string, unknown>>)
      : [];
    expect(pins).toEqual([
      expect.objectContaining({
        path: '/agent/home/notes.md',
        scope: 'nap',
      }),
    ]);
  });

  test('pin defaults to global scope when scope omitted', async () => {
    const { fs, registry, ctx } = createTestEnv();

    await registry.dispatch('pin', ['/agent/home/notes.md'], ctx);

    const parsed = parseContextFile(await fs.read(PINNED_PATH));
    const pins = Array.isArray(parsed.meta.pins)
      ? (parsed.meta.pins as Array<Record<string, unknown>>)
      : [];
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      path: '/agent/home/notes.md',
      scope: '*',
    });
  });

  test('unpin defaults to global scope when scope omitted', async () => {
    const { fs, registry, ctx } = createTestEnv();

    await registry.dispatch('pin', ['/agent/home/notes.md'], ctx);
    await registry.dispatch('unpin', ['/agent/home/notes.md'], ctx);

    const parsed = parseContextFile(await fs.read(PINNED_PATH));
    const pins = Array.isArray(parsed.meta.pins)
      ? (parsed.meta.pins as Array<Record<string, unknown>>)
      : [];
    expect(pins).toHaveLength(0);
  });
});
