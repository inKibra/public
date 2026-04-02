import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { saveIntentHints } from './intent-hints';
import { runImpulse } from './run-impulse';
import type { ImpulseDecisionOutput } from './types';

describe('runImpulse', () => {
  test('full lifecycle without intent hints', async () => {
    const fs = createOverlayFs();

    const result = await runImpulse(
      { impulseId: 'imp-1', text: 'hello', type: 'user_message' },
      fs,
      { computer: {} },
      async ({ computer, flowContext }) => {
        // Simulate LLM: write a file and draft a response
        await computer.tool.execute(
          `
          await command('write', '/agent/home/notes.md', 'User said hello');
          plan_response({ text: 'Hey there!', importance: 'normal' });
          `,
          flowContext,
          undefined,
        );

        return {
          thinking: 'User greeted, respond warmly',
          intent: null,
          urgency: 'normal',
          execId: flowContext.previewExecOrder![0]!,
        } satisfies ImpulseDecisionOutput;
      },
    );

    expect(result.decision.urgency).toBe('normal');
    expect(result.commitResult.committed).toBe(true);
    expect(result.commitResult.responsePlans[0]!.text).toBe('Hey there!');
    // Real VFS should have the file
    expect(await fs.read('/agent/home/notes.md')).toBe('User said hello');
    expect(result.matchedIntents).toHaveLength(0);
  });

  test('lifecycle with intent hint matching', async () => {
    const fs = createOverlayFs();

    // Set up intent hints
    await saveIntentHints(fs, [
      {
        intent: 'check-status',
        hint: 'how are things going',
        command: 'read /agent/home/status.md',
      },
    ]);

    // Create the status file so the auto-preview can read it
    await fs.write('/agent/home/status.md', 'All good!');

    const result = await runImpulse(
      {
        impulseId: 'imp-2',
        text: 'how are things going today?',
        type: 'user_message',
      },
      fs,
      { computer: {} },
      async ({ flowContext, autoPreviewResults }) => {
        // LLM sees the auto-preview results
        expect(autoPreviewResults.length).toBeGreaterThanOrEqual(1);

        return {
          thinking: 'User asked about status, auto-preview had the answer',
          intent: null,
          urgency: 'normal',
          execId: flowContext.previewExecOrder![0]!,
        };
      },
    );

    expect(result.matchedIntents).toHaveLength(1);
    expect(result.matchedIntents[0]!.intent).toBe('check-status');
    expect(result.decision.selectedPreview).not.toBeNull();
  });

  test('preview commit can intentionally produce no response plans', async () => {
    const fs = createOverlayFs();

    const result = await runImpulse(
      { impulseId: 'imp-3', text: 'just checking in', type: 'system_event' },
      fs,
      { computer: {} },
      async ({ computer, flowContext }) => {
        await computer.tool.execute(
          'console.log("No response needed")',
          flowContext,
          undefined,
        );

        return {
          thinking: 'Nothing to do',
          intent: null,
          urgency: 'none',
          execId: flowContext.previewExecOrder![0]!,
        };
      },
    );

    expect(result.decision.selectedPreview).not.toBeNull();
    expect(result.commitResult.committed).toBe(true);
    expect(result.commitResult.responsePlans).toEqual([]);
  });

  test('preview_exec rejects forbidden cross-lane response plans before commit', async () => {
    const fs = createOverlayFs();

    const result = await runImpulse(
      {
        impulseId: 'imp-policy-1',
        text: 'background status',
        type: 'system_event',
      },
      fs,
      {
        computer: {},
        responsePlanPolicy: {
          sourceLane: 'heartbeat',
          declaredLanes: ['conversation', 'heartbeat'],
          crossLaneTargets: [],
        },
      },
      async ({ computer, flowContext }) => {
        expect(flowContext.responsePlanPolicy).toMatchObject({
          sourceLane: 'heartbeat',
          crossLaneTargets: [],
        });

        const preview = await computer.tool.execute(
          'plan_response({ text: "Cross-lane update", lane: "conversation" })',
          flowContext,
          undefined,
        );

        expect(preview.success).toBe(false);
        if (preview.success) {
          throw new Error('Preview unexpectedly succeeded.');
        }
        expect(preview.message).toContain('is not allowed');
        expect(flowContext.previewExecOrder).toHaveLength(1);

        return {
          thinking: 'Cross-lane response plan was rejected during preview.',
          intent: null,
          urgency: 'none',
          execId: null,
        } satisfies ImpulseDecisionOutput;
      },
    );

    expect(result.commitResult.committed).toBe(false);
    expect(result.commitResult.responsePlans).toEqual([]);
  });

  test('multiple preview_exec calls, LLM selects best', async () => {
    const fs = createOverlayFs();

    const result = await runImpulse(
      { impulseId: 'imp-4', text: 'plan workout', type: 'user_message' },
      fs,
      { computer: {} },
      async ({ computer, flowContext }) => {
        // First attempt
        await computer.tool.execute(
          'await command("write", "/agent/home/plan.md", "Plan v1")',
          flowContext,
          undefined,
        );

        // Second attempt (better)
        await computer.tool.execute(
          `
          await command("write", "/agent/home/plan.md", "Plan v2 - improved");
          plan_response({ text: "Here's your plan!", importance: "normal" });
          `,
          flowContext,
          undefined,
        );

        // Select the second preview
        return {
          thinking: 'Second plan was better',
          intent: null,
          urgency: 'normal',
          execId: flowContext.previewExecOrder![1]!,
        };
      },
    );

    expect(result.commitResult.committed).toBe(true);
    // The committed version should be v2
    expect(await fs.read('/agent/home/plan.md')).toBe('Plan v2 - improved');
  });
});
