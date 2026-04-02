import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { defineCommand } from './define-command';
import { createCommandRegistry } from './registry';
import type { CommandContext } from './types';

function createTestCtx(): CommandContext {
  return {
    fs: createOverlayFs(),
    registry: createCommandRegistry(),
  };
}

describe('CommandRegistry', () => {
  test('registers and dispatches a command', async () => {
    const registry = createCommandRegistry();
    const greet = defineCommand({
      name: 'greet',
      description: 'Say hello',
      args: {
        name: { type: 'string', position: 0, required: true },
      },
      async fn(parsed) {
        return `Hello, ${parsed.name}!`;
      },
      render(result) {
        return result;
      },
    });

    registry.register(greet);
    expect(registry.has('greet')).toBe(true);

    const ctx = createTestCtx();
    const result = await registry.dispatch('greet', ['World'], ctx);
    expect(result).toBe('Hello, World!');
  });

  test('throws on duplicate registration', () => {
    const registry = createCommandRegistry();
    const cmd = defineCommand({
      name: 'dup',
      description: 'test',
      args: {},
      async fn() {
        return null;
      },
      render() {
        return '';
      },
    });
    registry.register(cmd);
    expect(() => registry.register(cmd)).toThrow('already registered');
  });

  test('throws on unknown command', async () => {
    const registry = createCommandRegistry();
    const ctx = createTestCtx();
    await expect(registry.dispatch('nope', [], ctx)).rejects.toThrow(
      'Unknown command: nope',
    );
  });

  test('dispatch handles --help', async () => {
    const registry = createCommandRegistry();
    registry.register(
      defineCommand({
        name: 'test',
        description: 'A test command',
        args: {
          path: { type: 'string', position: 0, required: true },
        },
        async fn() {
          return null;
        },
        render() {
          return '';
        },
      }),
    );

    const ctx = createTestCtx();
    const help = await registry.dispatch('test', ['--help'], ctx);
    expect(typeof help).toBe('string');
    expect(help as string).toContain('test — A test command');
  });

  test('list returns all commands', () => {
    const registry = createCommandRegistry();
    registry.register(
      defineCommand({
        name: 'a',
        description: 'cmd a',
        args: {},
        async fn() {
          return null;
        },
        render() {
          return '';
        },
      }),
    );
    registry.register(
      defineCommand({
        name: 'b',
        description: 'cmd b',
        args: {},
        async fn() {
          return null;
        },
        render() {
          return '';
        },
      }),
    );
    expect(registry.list()).toHaveLength(2);
  });

  test('dispatch passes context to command fn', async () => {
    const registry = createCommandRegistry();
    const fs = createOverlayFs();
    await fs.write('/test.txt', 'hello');

    registry.register(
      defineCommand({
        name: 'readtest',
        description: 'Read a file',
        args: {
          path: { type: 'string', position: 0, required: true },
        },
        async fn(parsed, ctx) {
          return ctx.fs.read(parsed.path as string);
        },
        render(result) {
          return result;
        },
      }),
    );

    const ctx: CommandContext = { fs, registry };
    const result = await registry.dispatch('readtest', ['/test.txt'], ctx);
    expect(result).toBe('hello');
  });
});
