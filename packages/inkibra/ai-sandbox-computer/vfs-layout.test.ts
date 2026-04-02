import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { bootstrapComputerVfs, VFS_PATHS } from './vfs-layout';

describe('bootstrapComputerVfs', () => {
  test('creates standard directory structure', async () => {
    const fs = createOverlayFs();
    await bootstrapComputerVfs(fs);

    // Key directories should exist (have .keep files)
    await expect(fs.read(`${VFS_PATHS.agent.home}/.keep`)).resolves.toBe('');
    await expect(fs.read(`${VFS_PATHS.agent.scripts}/.keep`)).resolves.toBe('');
    await expect(fs.read(`${VFS_PATHS.agent.packages}/.keep`)).resolves.toBe(
      '',
    );
    await expect(fs.read(`${VFS_PATHS.runtime.cron}/.keep`)).resolves.toBe('');
  });

  test('creates agent intent registry', async () => {
    const fs = createOverlayFs();
    await bootstrapComputerVfs(fs);
    const content = await fs.read(VFS_PATHS.agent.intentRegistry);
    expect(content).toContain('Intent Hint Registry');
  });

  test('creates developer intent registry', async () => {
    const fs = createOverlayFs();
    await bootstrapComputerVfs(fs);
    const content = await fs.read(VFS_PATHS.developer.intentRegistry);
    expect(content).toContain('Intent Hint Registry');
  });

  test('writes developer instructions when provided', async () => {
    const fs = createOverlayFs();
    await bootstrapComputerVfs(fs, {
      constructName: 'TestBot',
      constructInstructions: 'Be helpful.',
    });
    const content = await fs.read(VFS_PATHS.developer.instructions);
    expect(content).toContain('TestBot');
    expect(content).toContain('Be helpful.');
  });

  test('creates runtime state files', async () => {
    const fs = createOverlayFs();
    await bootstrapComputerVfs(fs);
    const meminfo = await fs.read(VFS_PATHS.runtime.state.meminfo);
    expect(meminfo).toBe('{}');
  });

  test('is idempotent', async () => {
    const fs = createOverlayFs();
    await bootstrapComputerVfs(fs);
    await bootstrapComputerVfs(fs); // Second call should not fail
    const content = await fs.read(VFS_PATHS.agent.intentRegistry);
    expect(content).toContain('Intent Hint Registry');
  });
});
