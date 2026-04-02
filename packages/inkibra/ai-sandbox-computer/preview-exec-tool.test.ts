import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { contextManagementCommands } from './commands/context-management';
import { fileOperationCommands } from './commands/file-ops';
import { createPreviewEngine } from './preview-engine';
import type { ImpulseFlowContext } from './preview-exec-tool';
import { createPreviewExecTool } from './preview-exec-tool';
import { createCommandRegistry } from './registry';

function createTestTool() {
  const fs = createOverlayFs();
  const registry = createCommandRegistry();
  for (const cmd of [...fileOperationCommands, ...contextManagementCommands]) {
    registry.register(cmd);
  }
  const engine = createPreviewEngine({ registry, overlayFs: fs });
  const tool = createPreviewExecTool({ engine, registry });
  return { fs, registry, engine, tool };
}

function requirePreviewRuns(ctx: ImpulseFlowContext) {
  const runs = ctx.previewExecRuns;
  const order = ctx.previewExecOrder;
  if (!runs || !order) throw new Error('expected preview runs');
  return { runs, order };
}

describe('createPreviewExecTool', () => {
  test('has correct name and kind', () => {
    const { tool } = createTestTool();
    expect(tool.name).toBe('preview_exec');
    expect(tool.kind).toBe('custom');
  });

  test('parseInput always succeeds with raw string', () => {
    const { tool } = createTestTool();
    const result = tool.parseInput('console.log("hello")');
    expect(result).toEqual({ success: true, data: 'console.log("hello")' });
  });

  test('execute stores record in flow context', async () => {
    const { tool } = createTestTool();
    const ctx: ImpulseFlowContext = {};
    const result = await tool.execute('console.log("test")', ctx, undefined);

    expect(result.success).toBe(true);
    const { runs, order } = requirePreviewRuns(ctx);
    expect(Object.keys(runs)).toHaveLength(1);
    expect(order).toHaveLength(1);
  });

  test('multiple executes accumulate in flow context', async () => {
    const { tool } = createTestTool();
    const ctx: ImpulseFlowContext = {};
    await tool.execute('console.log("a")', ctx, undefined);
    await tool.execute('console.log("b")', ctx, undefined);

    const { runs, order } = requirePreviewRuns(ctx);
    expect(Object.keys(runs)).toHaveLength(2);
    expect(order).toHaveLength(2);
    expect(order[0]).not.toBe(order[1]);
  });

  test('render produces readable output with exec_id', async () => {
    const { tool } = createTestTool();
    const ctx: ImpulseFlowContext = {};
    const result = await tool.execute(
      'await command("write", "/test.md", "hello")',
      ctx,
      undefined,
    );

    if (!result.success) throw new Error('expected success');
    const rendered = tool.render(result.data);
    const renderedText =
      typeof rendered === 'string' ? rendered : rendered.renderedOutput;
    expect(renderedText).toContain(
      'Preview only — no effect unless this exec_id is later committed.',
    );
    expect(renderedText).toContain('[exec_id:');
    expect(renderedText).toContain('Wrote');
  });

  test('render includes response plans', async () => {
    const { tool } = createTestTool();
    const ctx: ImpulseFlowContext = {};
    const result = await tool.execute(
      'plan_response({ text: "Hello!", importance: "normal" })',
      ctx,
      undefined,
    );

    if (!result.success) throw new Error('expected success');
    const rendered = tool.render(result.data);
    const renderedText =
      typeof rendered === 'string' ? rendered : rendered.renderedOutput;
    expect(renderedText).toContain('Response plans:');
    expect(renderedText).toContain('[normal] Hello!');
  });

  test('supports VFS-backed sys/fs imports', async () => {
    const { tool } = createTestTool();
    const ctx: ImpulseFlowContext = {};
    const result = await tool.execute(
      `
      import fs from 'sys/fs';
      const before = await fs.promises.readFile('/agent/home/test.md', 'utf8').catch(() => 'missing');
      await fs.promises.writeFile('/agent/home/test.md', 'hello');
      const after = await fs.promises.readFile('/agent/home/test.md', 'utf8');
      console.log(before, after);
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.stdout).toContain('missing hello');
  });

  test('description states previews are speculative until committed', () => {
    const { tool } = createTestTool();
    expect(tool.description).toContain('Preview results have NO EFFECT');
    expect(tool.description).toContain('speculative and has no effect');
  });

  test('description points the model to context-loaded capability docs', () => {
    const { tool } = createTestTool();
    expect(tool.description).toContain("import fs from 'sys/fs'");
    expect(tool.description).toContain('loaded in context');
    expect(tool.description).toContain('plan_response');
  });

  test('error in preview returns success=false', async () => {
    const { tool } = createTestTool();
    const ctx: ImpulseFlowContext = {};
    const result = await tool.execute(
      'throw new Error("boom")',
      ctx,
      undefined,
    );
    expect(result.success).toBe(false);
    const { runs } = requirePreviewRuns(ctx);
    expect(Object.keys(runs)).toHaveLength(1);
  });

  test('render exposes opened file contents as ephemeral output', async () => {
    const { fs, tool } = createTestTool();
    await fs.write('/note.md', 'ephemeral body');
    const ctx: ImpulseFlowContext = {};
    const result = await tool.execute(
      `await command('open', '/note.md');`,
      ctx,
      undefined,
    );

    if (!result.success) throw new Error('expected success');
    const rendered = tool.render(result.data);
    expect(typeof rendered).toBe('object');
    if (typeof rendered === 'string') return;
    expect(rendered.renderedOutput).toContain('Opened /note.md');
    expect(rendered.renderedOutput).toContain('sha256=');
    expect(rendered.ephemeralOutput).toContain('ephemeral body');
  });
});
