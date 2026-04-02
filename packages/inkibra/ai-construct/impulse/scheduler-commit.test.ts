import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import {
  type CommandRegistry,
  createComputer,
  type ImpulseFlowContext,
} from '@inkibra/ai-sandbox-computer';
import { stub } from '@inkibra/test-support/stub';
import { resolveImpulseDecision } from './impulse-decision';
import {
  commitSingleImpulse,
  generateOrderingCandidates,
} from './scheduler-commit';

describe('commitSingleImpulse', () => {
  test('commits selected preview to real VFS', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    await computer.tool.execute(
      'await command("write", "/agent/home/test.md", "committed!")',
      ctx,
      undefined,
    );

    const decision = resolveImpulseDecision(
      'imp-1',
      {
        thinking: 'test',
        intent: null,
        urgency: 'normal',
        execId: ctx.previewExecOrder![0]!,
      },
      ctx,
    );

    const result = await commitSingleImpulse(decision, {
      registry: computer.registry,
      overlayFs: fs,
    });

    expect(result.committed).toBe(true);
    expect(await fs.read('/agent/home/test.md')).toBe('committed!');
  });

  test('returns committed=false for null execId', async () => {
    const result = await commitSingleImpulse(
      {
        impulseId: 'imp-1',
        thinking: 'just observing',
        urgency: 'none',
        selectedPreview: null,
      },
      {
        registry: stub<CommandRegistry>(),
        overlayFs: createOverlayFs(),
      },
    );

    expect(result.committed).toBe(false);
    expect(result.responsePlans).toEqual([]);
  });

  test('rejects failed preview selections', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const preview = await computer.tool.execute(
      'throw new Error("boom")',
      ctx,
      undefined,
    );
    expect(preview.success).toBe(false);

    expect(() =>
      resolveImpulseDecision(
        'imp-failed',
        {
          thinking: 'retry needed',
          intent: null,
          urgency: 'normal',
          execId: ctx.previewExecOrder![0]!,
        },
        ctx,
      ),
    ).toThrow('refers to a failed preview_exec');
  });

  test('captures draft responses on commit', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    await computer.tool.execute(
      'plan_response({ text: "Done!", importance: "normal" })',
      ctx,
      undefined,
    );

    const decision = resolveImpulseDecision(
      'imp-1',
      {
        thinking: 'done',
        intent: null,
        urgency: 'normal',
        execId: ctx.previewExecOrder![0]!,
      },
      ctx,
    );

    const result = await commitSingleImpulse(decision, {
      registry: computer.registry,
      overlayFs: fs,
    });

    expect(result.committed).toBe(true);
    expect(result.responsePlans[0]!.text).toBe('Done!');
  });
});

describe('generateOrderingCandidates', () => {
  test('returns empty for single impulse', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    await computer.tool.execute(
      'await command("write", "/a.md", "a")',
      ctx,
      undefined,
    );

    const decision = resolveImpulseDecision(
      'imp-1',
      {
        thinking: 'a',
        intent: null,
        urgency: 'normal',
        execId: ctx.previewExecOrder![0]!,
      },
      ctx,
    );

    const candidates = await generateOrderingCandidates([decision], {
      registry: computer.registry,
      overlayFs: fs,
    });

    expect(candidates).toHaveLength(0);
  });

  test('generates 2 candidates for 2 concurrent impulses', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);

    // Impulse A
    const ctxA: ImpulseFlowContext = {};
    await computer.tool.execute(
      'await command("write", "/a.md", "from A")',
      ctxA,
      undefined,
    );
    const decisionA = resolveImpulseDecision(
      'imp-a',
      {
        thinking: 'a',
        intent: null,
        urgency: 'normal',
        execId: ctxA.previewExecOrder![0]!,
      },
      ctxA,
    );

    // Impulse B
    const ctxB: ImpulseFlowContext = {};
    await computer.tool.execute(
      'await command("write", "/b.md", "from B")',
      ctxB,
      undefined,
    );
    const decisionB = resolveImpulseDecision(
      'imp-b',
      {
        thinking: 'b',
        intent: null,
        urgency: 'normal',
        execId: ctxB.previewExecOrder![0]!,
      },
      ctxB,
    );

    const candidates = await generateOrderingCandidates(
      [decisionA, decisionB],
      { registry: computer.registry, overlayFs: fs },
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.impulseOrder).toEqual(['imp-a', 'imp-b']);
    expect(candidates[1]!.impulseOrder).toEqual(['imp-b', 'imp-a']);
  });
});
