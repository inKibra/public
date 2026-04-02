import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { createComputer } from './create-computer';
import { defineCommand } from './define-command';
import type { ImpulseFlowContext } from './preview-exec-tool';

describe('createComputer', () => {
  test('creates a computer with all built-in commands', () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);

    expect(computer.registry.has('read')).toBe(true);
    expect(computer.registry.has('write')).toBe(true);
    expect(computer.registry.has('edit')).toBe(true);
    expect(computer.registry.has('list')).toBe(true);
    expect(computer.registry.has('search')).toBe(true);
    expect(computer.registry.has('find')).toBe(true);
    expect(computer.registry.has('stat')).toBe(true);
    expect(computer.registry.has('remove')).toBe(true);
    expect(computer.registry.has('mkdir')).toBe(true);
    expect(computer.registry.has('open')).toBe(true);
    expect(computer.registry.has('pinned')).toBe(true);
    expect(computer.registry.has('pin')).toBe(true);
    expect(computer.registry.has('unpin')).toBe(true);
    expect(computer.registry.has('status')).toBe(true);
    expect(computer.registry.has('cron')).toBe(true);
  });

  test('can restrict built-in commands for a narrower computer surface', () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs, {
      builtIns: {
        fileOperations: true,
        contextManagement: true,
        cron: false,
        packageManager: false,
      },
    });

    expect(computer.registry.has('read')).toBe(true);
    expect(computer.registry.has('open')).toBe(true);
    expect(computer.registry.has('cron')).toBe(false);
    expect(computer.registry.has('pm')).toBe(false);
  });

  test('registers developer commands', () => {
    const fs = createOverlayFs();
    const deploy = defineCommand({
      name: 'deploy',
      description: 'Deploy program',
      args: { id: { type: 'string', position: 0, required: true } },
      async fn(parsed) {
        return { deployed: parsed.id };
      },
      render(r) {
        return `Deployed ${r.deployed}`;
      },
    });

    const computer = createComputer(fs, { commands: [deploy] });
    expect(computer.registry.has('deploy')).toBe(true);
  });

  test('preview_exec tool is configured', () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    expect(computer.tool.name).toBe('preview_exec');
    expect(computer.tool.kind).toBe('custom');
  });

  test('end-to-end: preview → decision → resolve', async () => {
    const fs = createOverlayFs();
    await fs.write('/agent/home/goals.md', 'Lose 10lbs');
    const computer = createComputer(fs);

    // Simulate impulse: AI writes code
    const ctx: ImpulseFlowContext = {};
    const result = await computer.tool.execute(
      `
      const goals = await command('read', '/agent/home/goals.md');
      await command('write', '/agent/home/state/progress.json',
        JSON.stringify({ goal: goals, week: 1 }));
      plan_response({ text: 'Got it, tracking your goal!', importance: 'normal' });
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    expect(ctx.previewExecOrder).toHaveLength(1);

    // AI produces structured output selecting this preview
    const execId = ctx.previewExecOrder![0]!;
    const decision = {
      impulseId: 'impulse-1',
      thinking: 'User set a goal, track it',
      urgency: 'normal',
      selectedPreview: ctx.previewExecRuns?.[execId] ?? null,
    };

    expect(decision.selectedPreview).not.toBeNull();
    expect(decision.selectedPreview!.responsePlans[0]!.text).toBe(
      'Got it, tracking your goal!',
    );
    expect(decision.urgency).toBe('normal');

    // Preview did NOT affect real VFS
    await expect(fs.read('/agent/home/state/progress.json')).rejects.toThrow();
  });
});
