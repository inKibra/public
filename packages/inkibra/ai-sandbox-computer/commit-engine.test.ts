import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { commitPreview } from './commit-engine';
import { createComputer } from './create-computer';
import type { ImpulseFlowContext } from './preview-exec-tool';

function requirePreviewSelection(ctx: ImpulseFlowContext) {
  const execId = ctx.previewExecOrder?.[0];
  if (!execId) throw new Error('expected preview exec id');
  const selectedPreview = ctx.previewExecRuns?.[execId] ?? null;
  if (!selectedPreview) throw new Error('expected selected preview');
  return { execId, selectedPreview };
}

describe('commitPreview', () => {
  test('commit writes persist to real VFS', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);

    // Preview: write a file
    const ctx: ImpulseFlowContext = {};
    await computer.tool.execute(
      'await command("write", "/agent/home/test.md", "from preview")',
      ctx,
      undefined,
    );

    // Preview did NOT affect real VFS
    await expect(fs.read('/agent/home/test.md')).rejects.toThrow();

    // Resolve decision
    const { execId, selectedPreview } = requirePreviewSelection(ctx);
    const decision = {
      impulseId: 'impulse-1',
      thinking: 'test',
      urgency: 'normal',
      selectedPreview,
    };

    expect(decision.selectedPreview).toBe(selectedPreview);
    expect(execId).toBeDefined();

    // Commit: same code runs against real VFS
    const result = await commitPreview(selectedPreview, {
      registry: computer.registry,
      overlayFs: fs,
    });

    expect(result.error).toBeUndefined();

    // NOW the real VFS has the file
    const content = await fs.read('/agent/home/test.md');
    expect(content).toBe('from preview');
  });

  test('commit captures draft responses', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);

    const ctx: ImpulseFlowContext = {};
    await computer.tool.execute(
      'plan_response({ text: "Hello!", importance: "normal" })',
      ctx,
      undefined,
    );

    const { selectedPreview } = requirePreviewSelection(ctx);
    const result = await commitPreview(selectedPreview, {
      registry: computer.registry,
      overlayFs: fs,
    });

    expect(result.responsePlans).toHaveLength(1);
    expect(result.responsePlans[0]?.text).toBe('Hello!');
  });

  test('commit error does not crash', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);

    const ctx: ImpulseFlowContext = {};
    await computer.tool.execute(
      'await command("read", "/nonexistent.md")',
      ctx,
      undefined,
    );

    const { selectedPreview } = requirePreviewSelection(ctx);
    const result = await commitPreview(selectedPreview, {
      registry: computer.registry,
      overlayFs: fs,
    });

    expect(result.error).toBeDefined();
  });

  test('full lifecycle: preview → decide → commit', async () => {
    const fs = createOverlayFs();
    await fs.write('/agent/home/goals.md', 'Run a 5k');
    const computer = createComputer(fs);

    // Step 1: AI previews code
    const ctx: ImpulseFlowContext = {};
    const previewResult = await computer.tool.execute(
      `
      const goals = await command('read', '/agent/home/goals.md');
      await command('write', '/agent/home/state/plan.json',
        JSON.stringify({ goal: goals, started: true }));
      plan_response({ text: 'Got your goal: ' + goals + '. Let\\'s do this!', importance: 'normal' });
      `,
      ctx,
      undefined,
    );
    expect(previewResult.success).toBe(true);

    // Step 2: AI decides
    const { selectedPreview } = requirePreviewSelection(ctx);
    const decision = {
      impulseId: 'impulse-42',
      thinking: 'User set a goal, acknowledge',
      urgency: 'normal',
      selectedPreview,
    };
    expect(decision.selectedPreview).not.toBeNull();

    // Verify preview didn't commit
    await expect(fs.read('/agent/home/state/plan.json')).rejects.toThrow();

    // Step 3: Scheduler commits
    const commitResult = await commitPreview(selectedPreview, {
      registry: computer.registry,
      overlayFs: fs,
    });
    expect(commitResult.error).toBeUndefined();
    expect(commitResult.responsePlans[0]?.text).toContain('Run a 5k');

    // NOW real state is updated
    const plan = JSON.parse(await fs.read('/agent/home/state/plan.json'));
    expect(plan.goal).toBe('Run a 5k');
    expect(plan.started).toBe(true);
  });
  test('commit rejects forbidden cross-lane targets even if preview skipped policy validation', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);

    const ctx: ImpulseFlowContext = {};
    await computer.tool.execute(
      'plan_response({ text: "Background update", lane: "heartbeat" })',
      ctx,
      undefined,
    );

    const { selectedPreview } = requirePreviewSelection(ctx);
    const result = await commitPreview(selectedPreview, {
      registry: computer.registry,
      overlayFs: fs,
      hostContext: {
        responsePlanPolicy: {
          sourceLane: 'conversation',
          declaredLanes: ['conversation', 'heartbeat'],
          crossLaneTargets: [],
        },
      },
    });

    expect(result.error).toContain('is not allowed');
    expect(result.responsePlans).toHaveLength(0);
  });
});
