import { describe, expect, test } from 'bun:test';
import {
  createOverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
  textPrimitive,
} from '@inkibra/ai-flow/testing';
import initLogger from '@inkibra/logger';
import { getLogWeekDir } from '../vfs/layout';
import { runNapFlow } from './flow';

function createNapCommitScenarioWithSummary() {
  return createAiFlowScenario({
    stream: [
      {
        primitives: [
          textPrimitive(
            JSON.stringify({
              summary:
                'The lane handled a burst of user impulses and preserved the recent interaction context.',
              highlights: [
                'Twenty user-driven impulse entries were compacted into the lane history.',
                'No construct responses were recorded in this rotated segment.',
              ],
            }),
          ),
        ],
      },
      { primitives: [textPrimitive('Lane analysis draft.')] },
      { primitives: [textPrimitive('Lane proposal draft.')] },
      {
        primitives: [
          {
            kind: 'tool_call' as const,
            name: 'complete_nap_commit',
            arguments: { summary: 'judgment-heavy edits complete' },
          },
        ],
      },
      { primitives: [textPrimitive('Nap log body')] },
    ],
    strict: true,
  });
}

function createNapDirectWriteScenario() {
  return createAiFlowScenario({
    stream: [
      { primitives: [textPrimitive('Lane analysis draft.')] },
      { primitives: [textPrimitive('Lane proposal draft.')] },
      {
        primitives: [
          {
            kind: 'tool_call' as const,
            name: 'write',
            arguments: {
              path: '/agent/home/PRINCIPLES.md',
              content: '# Updated principles',
            },
          },
        ],
      },
      {
        primitives: [
          {
            kind: 'tool_call' as const,
            name: 'complete_nap_commit',
            arguments: { summary: 'updated principles directly' },
          },
        ],
      },
      { primitives: [textPrimitive('Nap log body')] },
    ],
    strict: true,
  });
}

function createNapCommitScenarioWithDirectWrite() {
  return createAiFlowScenario({
    stream: [
      { primitives: [textPrimitive('Lane analysis draft.')] },
      { primitives: [textPrimitive('Lane proposal draft.')] },
      {
        primitives: [
          {
            kind: 'tool_call' as const,
            name: 'write',
            arguments: {
              path: '/agent/home/nap-direct.md',
              content: 'direct edit',
            },
          },
          {
            kind: 'tool_call' as const,
            name: 'complete_nap_commit',
            arguments: { summary: 'direct edits complete' },
          },
        ],
      },
      { primitives: [textPrimitive('Nap log body')] },
    ],
    strict: true,
  });
}

function createNapDirectOpenScenario() {
  return createAiFlowScenario({
    stream: [
      { primitives: [textPrimitive('Lane analysis draft.')] },
      { primitives: [textPrimitive('Lane proposal draft.')] },
      {
        primitives: [
          {
            kind: 'tool_call' as const,
            name: 'open',
            arguments: {
              path: '/agent/home/PRINCIPLES.md',
            },
          },
        ],
      },
      {
        primitives: [
          {
            kind: 'tool_call' as const,
            name: 'complete_nap_commit',
            arguments: { summary: 'reviewed principles' },
          },
        ],
      },
      { primitives: [textPrimitive('Nap log body')] },
    ],
    strict: true,
  });
}

describe('runNapFlow', () => {
  test('rotates and compacts managed logs before commit stage', async () => {
    const vfs = createOverlayFs();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const weekDir = getLogWeekDir(now);
    const currentLogPath = `${weekDir}/${day}-0.conversation.log`;
    const rotatedLogPath = `${weekDir}/${day}-1.conversation.log`;
    const createdAt = new Date(now.getTime() - 30 * 60_000).toISOString();
    const entries = Array.from({ length: 20 }, (_, index) => {
      const ts = new Date(now.getTime() - (20 - index) * 60_000).toISOString();
      return `[${ts}] impulse-${index}\nfrom: user\nentry ${index}`;
    }).join('\n---\n');

    await vfs.write(
      currentLogPath,
      serializeContextFile(
        {
          id: currentLogPath,
          tags: [],
          created: createdAt,
          updated: createdAt,
          log_type: 'conversation',
          date: day,
          entry_count: 20,
        },
        entries,
      ),
    );

    const { deps, inspector } = createAiFlowTestDeps({
      logger: initLogger('nap-flow-auto-rotation-test'),
      scenario: createNapCommitScenarioWithSummary(),
    });

    await runNapFlow(
      vfs,
      deps,
      {},
      {
        stages: {
          analyze: { model: 'moonshotai/kimi-k2.5' },
          propose: { model: 'moonshotai/kimi-k2.5' },
          commit: { model: 'moonshotai/kimi-k2.5' },
        },
      },
    );

    // Old file: keeps entries + gains compacted frontmatter from summarize stage
    const compacted = parseContextFile(await vfs.read(currentLogPath));
    expect(compacted.content.split(/\n---\n/).filter(Boolean)).toHaveLength(20);
    expect(compacted.meta.summary).toBe(
      'The lane handled a burst of user impulses and preserved the recent interaction context.',
    );
    expect(compacted.meta.highlights).toEqual([
      'Twenty user-driven impulse entries were compacted into the lane history.',
      'No construct responses were recorded in this rotated segment.',
    ]);
    expect(compacted.meta.entry_count).toBe(20);
    expect(compacted.meta.compacted_at).toBeDefined();

    // New file: empty, ready for future writes
    const rotated = parseContextFile(await vfs.read(rotatedLogPath));
    expect(rotated.meta.entry_count).toBe(0);
    expect(rotated.content.trim()).toBe('');

    expect(inspector.streamCallCount()).toBe(5);
    inspector.assertConsumed();
  });

  test('commit stage direct commands persist VFS edits', async () => {
    const vfs = createOverlayFs();
    const { deps, inspector } = createAiFlowTestDeps({
      logger: initLogger('nap-flow-direct-tool-test'),
      scenario: createNapCommitScenarioWithDirectWrite(),
    });

    await runNapFlow(
      vfs,
      deps,
      {},
      {
        stages: {
          analyze: { model: 'moonshotai/kimi-k2.5' },
          propose: { model: 'moonshotai/kimi-k2.5' },
          commit: { model: 'moonshotai/kimi-k2.5' },
        },
      },
    );

    expect(await vfs.read('/agent/home/nap-direct.md')).toBe('direct edit');
    expect(inspector.streamCallCount()).toBe(4);
    inspector.assertConsumed();
  });
});

test('direct open tool keeps summary durable and file contents next-turn only', async () => {
  const vfs = createOverlayFs({
    mount: {
      '/agent/home/PRINCIPLES.md': '# Original principles',
    },
  });
  const { deps, inspector } = createAiFlowTestDeps({
    logger: initLogger('nap-flow-direct-open-test'),
    scenario: createNapDirectOpenScenario(),
  });

  await runNapFlow(
    vfs,
    deps,
    {},
    {
      stages: {
        analyze: { model: 'moonshotai/kimi-k2.5' },
        propose: { model: 'moonshotai/kimi-k2.5' },
        commit: { model: 'moonshotai/kimi-k2.5' },
      },
    },
  );

  const requests = inspector.streamRequests() as Array<{
    input?: Array<Record<string, unknown>>;
  }>;
  const secondCommitInput = requests[3]?.input ?? [];
  const secondOutputs = secondCommitInput
    .filter((item) => item.type === 'function_call_output')
    .map((item) => item.output);
  expect(
    secondOutputs.some(
      (output) =>
        typeof output === 'string' &&
        output.includes('Opened /agent/home/PRINCIPLES.md') &&
        output.includes('sha256='),
    ),
  ).toBe(true);
  expect(
    secondOutputs.some(
      (output) =>
        typeof output === 'string' && output.includes('# Original principles'),
    ),
  ).toBe(true);

  const finalCommitInput = requests[4]?.input ?? [];
  const finalOutputs = finalCommitInput
    .filter((item) => item.type === 'function_call_output')
    .map((item) => item.output);
  expect(
    finalOutputs.some(
      (output) =>
        typeof output === 'string' &&
        output.includes('Opened /agent/home/PRINCIPLES.md'),
    ),
  ).toBe(true);
  expect(
    finalOutputs.some(
      (output) =>
        typeof output === 'string' && output.includes('# Original principles'),
    ),
  ).toBe(false);

  expect(inspector.streamCallCount()).toBe(5);
  inspector.assertConsumed();
});

test('commit-stage direct command tools persist file edits', async () => {
  const vfs = createOverlayFs({
    mount: {
      '/agent/home/PRINCIPLES.md': '# Original principles',
    },
  });
  const { deps, inspector } = createAiFlowTestDeps({
    logger: initLogger('nap-flow-direct-command-test'),
    scenario: createNapDirectWriteScenario(),
  });

  await runNapFlow(
    vfs,
    deps,
    {},
    {
      stages: {
        analyze: { model: 'moonshotai/kimi-k2.5' },
        propose: { model: 'moonshotai/kimi-k2.5' },
        commit: { model: 'moonshotai/kimi-k2.5' },
      },
    },
  );

  expect(await vfs.read('/agent/home/PRINCIPLES.md')).toBe(
    '# Updated principles',
  );
  expect(inspector.streamCallCount()).toBe(5);
  inspector.assertConsumed();
});
