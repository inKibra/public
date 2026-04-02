import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { contextManagementCommands } from './commands/context-management';
import { fileOperationCommands } from './commands/file-ops';
import { createPreviewEngine } from './preview-engine';
import { createCommandRegistry } from './registry';

function createTestEngine() {
  const fs = createOverlayFs();
  const registry = createCommandRegistry();
  for (const cmd of [...fileOperationCommands, ...contextManagementCommands]) {
    registry.register(cmd);
  }
  const engine = createPreviewEngine({ registry, overlayFs: fs });
  return { fs, registry, engine };
}

describe('PreviewEngine', () => {
  test('executes simple code and captures stdout', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview('console.log("hello world")');
    expect(record.stdout).toContain('hello world');
    expect(record.error).toBeUndefined();
    expect(record.execId).toMatch(/^prev_/);
  });

  test('captures command lifecycle output', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(`
      await command('write', '/test.md', 'hello from preview');
      await command('read', '/test.md');
    `);
    expect(record.stdout).toContain('Running command: write');
    expect(record.stdout).toContain('Running command: read');
    expect(record.stdout).toContain('hello from preview');
    expect(record.error).toBeUndefined();
  });

  test('preview writes do not affect real VFS', async () => {
    const { fs, engine } = createTestEngine();
    await engine.preview(`
      await command('write', '/preview-file.md', 'preview only');
    `);
    // Real VFS should not have the file
    await expect(fs.read('/preview-file.md')).rejects.toThrow();
  });

  test('captures plan_response calls', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(`
      plan_response({ text: 'Hello user!', importance: 'normal' });
      plan_response({ text: 'Follow-up', importance: 'low' });
    `);
    expect(record.responsePlans).toHaveLength(2);
    expect(record.responsePlans[0]!.text).toBe('Hello user!');
    expect(record.responsePlans[1]!.importance).toBe('low');
  });

  test('captures errors without crashing', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(`
      throw new Error('something went wrong');
    `);
    expect(record.error).toContain('something went wrong');
  });

  test('captures command errors in stdout', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(`
      try {
        await command('read', '/nonexistent.md');
      } catch (e) {
        console.log('caught: ' + e.message);
      }
    `);
    expect(record.stdout).toContain('Error in read');
    expect(record.stdout).toContain('caught:');
  });

  test('show() renders command results', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(`
      const result = await command('write', '/test.md', 'content');
      show(result);
    `);
    // show() on a write result should use the write command's render
    expect(record.stdout).toContain('Wrote');
    expect(record.stdout).toContain('/test.md');
  });

  test('show() renders plain values', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(`
      show({ key: 'value', count: 42 });
    `);
    expect(record.stdout).toContain('key');
    expect(record.stdout).toContain('42');
  });

  test('multiple previews produce unique execIds', async () => {
    const { engine } = createTestEngine();
    const r1 = await engine.preview('console.log("a")');
    const r2 = await engine.preview('console.log("b")');
    expect(r1.execId).not.toBe(r2.execId);
  });

  test('preview can read pre-existing VFS files', async () => {
    const { fs, engine } = createTestEngine();
    await fs.write('/existing.md', 'I exist');
    const record = await engine.preview(`
      const content = await command('read', '/existing.md');
      console.log('content: ' + content);
    `);
    expect(record.stdout).toContain('content: I exist');
    expect(record.error).toBeUndefined();
  });

  test('preview can chain read after write in same preview', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(`
      await command('write', '/chain.md', 'step 1');
      const v1 = await command('read', '/chain.md');
      await command('write', '/chain.md', v1 + ' → step 2');
      const v2 = await command('read', '/chain.md');
      console.log('final: ' + v2);
    `);
    expect(record.stdout).toContain('final: step 1 → step 2');
    expect(record.error).toBeUndefined();
  });
  test('rejects undeclared cross-lane targets when lane policy is provided', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(
      `plan_response({ text: 'Hello user!', lane: 'workspace:frontend' });`,
      {
        responsePlanPolicy: {
          sourceLane: 'heartbeat',
          declaredLanes: ['conversation', 'heartbeat'],
          crossLaneTargets: ['conversation'],
        },
      },
    );

    expect(record.error).toContain('is not declared');
    expect(record.responsePlans).toHaveLength(0);
  });

  test('normalizes explicit same-lane targets back to implicit delivery', async () => {
    const { engine } = createTestEngine();
    const record = await engine.preview(
      `plan_response({ text: 'Same lane', lane: 'heartbeat' });`,
      {
        responsePlanPolicy: {
          sourceLane: 'heartbeat',
          declaredLanes: ['conversation', 'heartbeat'],
          crossLaneTargets: ['conversation'],
        },
      },
    );

    expect(record.error).toBeUndefined();
    expect(record.responsePlans).toHaveLength(1);
    expect(record.responsePlans[0]?.lane).toBeUndefined();
  });
});

test('open keeps summary in stdout and file contents in ephemeral output', async () => {
  const { fs, engine } = createTestEngine();
  await fs.write('/notes.md', 'temporary contents');

  const record = await engine.preview(`
    await command('open', '/notes.md');
  `);

  expect(record.stdout).toContain('Opened /notes.md');
  expect(record.stdout).toContain('sha256=');
  expect(record.stdout).not.toContain('temporary contents');
  expect(record.ephemeralOutput).toContain('Opened document: /notes.md');
  expect(record.ephemeralOutput).toContain('temporary contents');
});
