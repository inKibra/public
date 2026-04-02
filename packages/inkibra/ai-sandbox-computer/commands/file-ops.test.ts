import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { createCommandRegistry } from '../registry';
import type { CommandContext } from '../types';
import {
  fileOperationCommands,
  readCommand,
  statCommand,
  writeCommand,
} from './file-ops';

function createTestEnv() {
  const fs = createOverlayFs();
  const registry = createCommandRegistry();
  for (const cmd of fileOperationCommands) {
    registry.register(cmd);
  }
  const ctx: CommandContext = { fs, registry };
  return { fs, registry, ctx };
}

describe('file operation commands', () => {
  test('write + read round-trip', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/test.md', 'hello world'], ctx);
    const content = await registry.dispatch('read', ['/test.md'], ctx);
    expect(content).toBe('hello world');
  });

  test('read with --head', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch(
      'write',
      ['/lines.md', 'line1\nline2\nline3\nline4\nline5'],
      ctx,
    );
    const content = await registry.dispatch(
      'read',
      ['/lines.md', '--head', '3'],
      ctx,
    );
    expect(content).toBe('line1\nline2\nline3');
  });

  test('read with --tail', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch(
      'write',
      ['/lines.md', 'line1\nline2\nline3\nline4\nline5'],
      ctx,
    );
    const content = await registry.dispatch(
      'read',
      ['/lines.md', '--tail', '2'],
      ctx,
    );
    expect(content).toBe('line4\nline5');
  });

  test('edit replaces text', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/doc.md', 'hello world hello'], ctx);
    const result = await registry.dispatch(
      'edit',
      ['/doc.md', 'hello', 'hi'],
      ctx,
    );
    expect(result).toEqual({ path: '/doc.md', replacements: 2 });
    const content = await registry.dispatch('read', ['/doc.md'], ctx);
    expect(content).toBe('hi world hi');
  });

  test('edit with --count limits replacements', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/doc.md', 'aaa'], ctx);
    await registry.dispatch('edit', ['/doc.md', 'a', 'b', '--count', '2'], ctx);
    const content = await registry.dispatch('read', ['/doc.md'], ctx);
    expect(content).toBe('bba');
  });

  test('edit throws when text not found', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/doc.md', 'hello'], ctx);
    await expect(
      registry.dispatch('edit', ['/doc.md', 'xyz', 'abc'], ctx),
    ).rejects.toThrow('text not found');
  });

  test('list shows files and directories', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/dir/a.md', 'a'], ctx);
    await registry.dispatch('write', ['/dir/b.md', 'b'], ctx);
    const entries = (await registry.dispatch('list', ['/dir'], ctx)) as Array<{
      name: string;
      type: string;
    }>;
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['a.md', 'b.md']);
  });

  test('stat returns file metadata', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/test.md', 'hello world\nfoo bar'], ctx);
    const stat = (await registry.dispatch('stat', ['/test.md'], ctx)) as {
      size: number;
      lines: number;
      words: number;
    };
    expect(stat.lines).toBe(2);
    expect(stat.words).toBe(4);
    expect(stat.size).toBeGreaterThan(0);
  });

  test('remove deletes a file', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/del.md', 'gone'], ctx);
    await registry.dispatch('remove', ['/del.md'], ctx);
    await expect(registry.dispatch('read', ['/del.md'], ctx)).rejects.toThrow();
  });

  test('search finds pattern in files', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/a.md', 'hello world'], ctx);
    await registry.dispatch('write', ['/b.md', 'goodbye world'], ctx);
    const matches = (await registry.dispatch(
      'search',
      ['hello', '/'],
      ctx,
    )) as Array<{ path: string; text: string }>;
    expect(matches).toHaveLength(1);
    expect(matches[0]!.path).toBe('/a.md');
  });

  test('find locates files by name pattern', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('write', ['/src/app.ts', 'code'], ctx);
    await registry.dispatch('write', ['/src/utils.ts', 'utils'], ctx);
    await registry.dispatch('write', ['/src/readme.md', 'docs'], ctx);
    const found = (await registry.dispatch(
      'find',
      ['/', '--name', '*.ts'],
      ctx,
    )) as string[];
    expect(found.filter((f) => f.endsWith('.ts'))).toHaveLength(2);
  });

  test('command renders produce readable output', () => {
    const rendered = readCommand.render('line1\nline2\nline3');
    expect(rendered).toContain('   1: line1');
    expect(rendered).toContain('   2: line2');

    expect(writeCommand.render({ path: '/test.md', bytes: 42 })).toBe(
      'Wrote 42 bytes to /test.md',
    );

    expect(
      statCommand.render({ path: '/f.md', size: 100, lines: 10, words: 20 }),
    ).toContain('100 bytes');
  });
});
