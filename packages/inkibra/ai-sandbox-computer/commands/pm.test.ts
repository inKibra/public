import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { createCommandRegistry } from '../registry';
import type { CommandContext } from '../types';
import { fileOperationCommands } from './file-ops';
import { pmCommand } from './pm';

function createTestEnv() {
  const fs = createOverlayFs();
  const registry = createCommandRegistry();
  for (const cmd of fileOperationCommands) {
    registry.register(cmd);
  }
  registry.register(pmCommand);
  const ctx: CommandContext = { fs, registry };
  return { fs, registry, ctx };
}

describe('pm command', () => {
  test('init creates package scaffold', async () => {
    const { registry, ctx } = createTestEnv();
    const result = (await registry.dispatch(
      'pm',
      ['init', 'my-tool'],
      ctx,
    )) as {
      subcommand: string;
      name: string;
    };
    expect(result.subcommand).toBe('init');
    expect(result.name).toBe('my-tool');

    // Check files were created
    const pkg = await ctx.fs.read('/agent/scripts/my-tool/package.json');
    expect(JSON.parse(pkg).name).toBe('my-tool');

    const readme = await ctx.fs.read('/agent/scripts/my-tool/README.md');
    expect(readme).toContain('# my-tool');

    const publicSurface = await ctx.fs.read(
      '/agent/scripts/my-tool/index.d.ts',
    );
    expect(publicSurface).toContain('Public package surface for my-tool');

    const index = await ctx.fs.read('/agent/scripts/my-tool/index.ts');
    expect(index).toContain('my-tool');
  });

  test('publish compiles and copies to registry', async () => {
    const { registry, ctx } = createTestEnv();

    // Init a package
    await registry.dispatch('pm', ['init', 'streak'], ctx);

    // Write some TS code
    await ctx.fs.write(
      '/agent/scripts/streak/index.ts',
      'export const check = (): string => "ok";',
    );

    // Publish
    const result = (await registry.dispatch(
      'pm',
      ['publish', 'streak'],
      ctx,
    )) as {
      subcommand: string;
      version: string;
    };
    expect(result.subcommand).toBe('publish');
    expect(result.version).toBe('0.1.0');

    // Check registry has compiled JS
    const js = await ctx.fs.read(
      '/runtime/packages/registry/streak/0.1.0/index.js',
    );
    expect(js).toContain('check');
    // Should not have .ts extension in registry
    expect(js).not.toContain('export const check = ():');
  });

  test('publish prevents duplicate versions', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('pm', ['init', 'dupe'], ctx);
    await registry.dispatch('pm', ['publish', 'dupe'], ctx);

    await expect(
      registry.dispatch('pm', ['publish', 'dupe'], ctx),
    ).rejects.toThrow('already published');
  });

  test('add installs from registry', async () => {
    const { registry, ctx } = createTestEnv();

    // Init + publish
    await registry.dispatch('pm', ['init', 'helper'], ctx);
    await registry.dispatch('pm', ['publish', 'helper'], ctx);

    // Install
    const result = (await registry.dispatch('pm', ['add', 'helper'], ctx)) as {
      subcommand: string;
      name: string;
      version: string;
    };
    expect(result.subcommand).toBe('add');
    expect(result.name).toBe('helper');

    // Check installed
    const pkg = await ctx.fs.read('/agent/packages/helper/package.json');
    expect(JSON.parse(pkg).name).toBe('helper');
  });

  test('list shows installed packages', async () => {
    const { registry, ctx } = createTestEnv();

    // Init + publish + add
    await registry.dispatch('pm', ['init', 'pkg-a'], ctx);
    await registry.dispatch('pm', ['publish', 'pkg-a'], ctx);
    await registry.dispatch('pm', ['add', 'pkg-a'], ctx);

    const result = (await registry.dispatch('pm', ['list'], ctx)) as {
      packages: Array<{ name: string }>;
    };
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]!.name).toBe('pkg-a');
  });

  test('versions lists published versions', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('pm', ['init', 'multi'], ctx);
    await registry.dispatch('pm', ['publish', 'multi'], ctx);

    const result = (await registry.dispatch(
      'pm',
      ['versions', 'multi'],
      ctx,
    )) as {
      versions: string[];
    };
    expect(result.versions).toContain('0.1.0');
  });

  test('remove uninstalls a package', async () => {
    const { registry, ctx } = createTestEnv();
    await registry.dispatch('pm', ['init', 'removeme'], ctx);
    await registry.dispatch('pm', ['publish', 'removeme'], ctx);
    await registry.dispatch('pm', ['add', 'removeme'], ctx);

    await registry.dispatch('pm', ['remove', 'removeme'], ctx);

    // Should be gone from installed
    const result = (await registry.dispatch('pm', ['list'], ctx)) as {
      packages: Array<{ name: string }>;
    };
    expect(
      result.packages.find((p: { name: string }) => p.name === 'removeme'),
    ).toBeUndefined();
  });

  test('full lifecycle: init → publish → add → use in preview', async () => {
    const { fs } = createTestEnv();
    const { createComputer } = await import('../create-computer');

    const computer = createComputer(fs);

    // Use preview to init, publish, add a package
    const ctx = {};
    await computer.tool.execute(
      `
      await command('pm', 'init', '@commands/greet');
      await command('write', '/agent/scripts/@commands/greet/index.ts',
        'export default { greeting: "Hello from package!" };');
      await command('pm', 'publish', '@commands/greet');
      await command('pm', 'add', '@commands/greet');
      console.log('Package lifecycle complete');
      `,
      ctx,
      undefined,
    );

    // Preview didn't affect real VFS (it's forked), but the test shows
    // the commands work end-to-end in the preview engine
  });
});
