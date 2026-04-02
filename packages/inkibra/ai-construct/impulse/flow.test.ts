import { describe, expect, test } from 'bun:test';
import { createOverlayFs, serializeContextFile } from '@inkibra/ai-flow';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
  jsonPrimitive,
} from '@inkibra/ai-flow/testing';
import {
  createComputer,
  type ImpulseFlowContext,
} from '@inkibra/ai-sandbox-computer';
import initLogger from '@inkibra/logger';
import { VFS_PATHS } from '../vfs/layout';
import { createImpulseComputerFlow } from './flow';
import type { Impulse } from './types';

describe('createImpulseComputerFlow think context', () => {
  test('includes perception and default lane policy in actual think request input', async () => {
    const vfs = createOverlayFs();
    const soulPath = `${VFS_PATHS.core.root}/SOUL.md`;
    const weekDir = `${VFS_PATHS.logs.root}/2026/W11`;
    const oldLogPath = `${weekDir}/2026-03-15-0.conversation.log`;
    const currentLogPath = `${weekDir}/2026-03-16-0.conversation.log`;

    await vfs.write(
      soulPath,
      serializeContextFile(
        {
          id: 'soul',
          tags: [],
          created: '2026-03-16T12:00:00.000Z',
          updated: '2026-03-16T12:00:00.000Z',
          title: 'Soul',
        },
        '# SOUL\n\nfull soul body',
      ),
    );
    await vfs.write(
      oldLogPath,
      serializeContextFile(
        {
          id: 'old-log',
          tags: [],
          created: '2026-03-15T09:00:00.000Z',
          updated: '2026-03-15T09:00:00.000Z',
          summary: 'older compacted summary',
        },
        '',
      ),
    );
    await vfs.write(
      currentLogPath,
      serializeContextFile(
        {
          id: 'current-log',
          tags: [],
          created: '2026-03-16T09:05:00.000Z',
          updated: '2026-03-16T09:05:00.000Z',
          log_type: 'conversation',
        },
        `[2026-03-16T09:05:00.000Z] impulse-1\nfrom: user\ntrigger: "hello"\n\ncurrent full log entry`,
      ),
    );
    await vfs.write(
      '/runtime/handles/context-dirs.yaml',
      ['directories:', '  - /agent/home/', '  - /logs/'].join('\n'),
    );
    await vfs.write(
      '/agent/home/CONTEXT.yaml',
      [
        'stages:',
        '  impulse:',
        '    renderer:',
        '      type: verbatim',
        '    pins:',
        '      - path: SOUL.md',
      ].join('\n'),
    );
    await vfs.write(
      '/logs/CONTEXT.yaml',
      [
        'stages:',
        '  impulse:',
        '    renderer:',
        '      type: timeline',
        '      min_items: 1',
        '    selector:',
        '      strategy: all',
      ].join('\n'),
    );
    await writeOpenedState(vfs, [
      {
        path: VFS_PATHS.core.root,
        type: 'directory',
        mode: 'frontmatter',
      },
      {
        path: soulPath,
        type: 'file',
        mode: 'full',
      },
      {
        path: weekDir,
        type: 'directory',
        mode: 'frontmatter',
      },
      {
        path: currentLogPath,
        type: 'file',
        mode: 'full',
      },
    ]);

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            jsonPrimitive({
              thinking: 'fine',
              urgency: 'none',
              intent: null,
              execId: 'prev_test_context_1',
            }),
          ],
        },
        {
          primitives: [
            jsonPrimitive({
              thinking: 'fine',
              urgency: 'none',
              intent: null,
              execId: 'prev_test_context_2',
            }),
          ],
        },
      ],
      strict: false,
    });
    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-construct-impulse-flow-context-test'),
      scenario,
    });

    const computer = createComputer(vfs, {});
    const flow = createImpulseComputerFlow(vfs, computer, {
      stages: {
        think: { model: 'test-model' },
      },
    });
    const run = flow
      .onStep('think', async ({ step }) => {
        if (step.kind === 'reasoning' || step.kind === 'tool') {
          return step.next();
        }
        if (step.kind === 'output') {
          return step.output.accept((output, ctx) => ({
            ctx: { ...ctx, decision: output },
          }));
        }
        throw new Error(
          `Unexpected step kind: ${String((step as { kind: unknown }).kind)}`,
        );
      })
      .start({
        flow: {
          impulse: {
            id: 'impulse-ctx-1',
            type: 'conversation',
            lane: 'conversation',
            profile: 'default',
            pool: 'conversation',
            triggeredBy: {
              lane: 'conversation',
              role: 'user',
              source: 'user_message',
              content: 'hello there',
              occurredAt: new Date('2026-03-16T12:00:00.000Z'),
              receivedAt: new Date('2026-03-16T12:00:00.000Z'),
            },
            startedAt: new Date('2026-03-16T12:00:00.000Z'),
            attention: 1,
            status: 'processing',
          },
          decision: null,
        },
        firstStage: 'think',
        deps: testDeps.deps,
      });

    await run.complete();

    const requests = testDeps.inspector.streamRequests() as Array<{
      input?: Array<{ content?: string }>;
    }>;
    const serialized = JSON.stringify(requests[0]?.input ?? []);

    expect(serialized).toContain('hello there');
    expect(serialized).toContain('## Response Lane Policy');
    expect(serialized).toContain('Current lane: conversation');
  });
  test('includes lane response policy in the actual think request input', async () => {
    const vfs = createOverlayFs();
    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            jsonPrimitive({
              thinking: 'fine',
              urgency: 'none',
              intent: null,
              execId: 'prev_test_policy_1',
            }),
          ],
        },
        {
          primitives: [
            jsonPrimitive({
              thinking: 'fine',
              urgency: 'none',
              intent: null,
              execId: 'prev_test_policy_2',
            }),
          ],
        },
      ],
      strict: false,
    });
    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-construct-impulse-flow-lane-policy-test'),
      scenario,
    });

    const computer = createComputer(vfs, {});
    const flow = createImpulseComputerFlow(vfs, computer, {
      stages: {
        think: { model: 'test-model' },
      },
      responsePlanPolicy: {
        sourceLane: 'heartbeat',
        declaredLanes: ['conversation', 'heartbeat'],
        crossLaneTargets: ['conversation'],
      },
    });

    const run = flow
      .onStep('think', async ({ step }) => {
        if (step.kind === 'reasoning' || step.kind === 'tool') {
          return step.next();
        }
        if (step.kind === 'output') {
          return step.output.accept((output, ctx) => ({
            ctx: { ...ctx, decision: output },
          }));
        }
        throw new Error(
          `Unexpected step kind: ${String((step as { kind: unknown }).kind)}`,
        );
      })
      .start({
        flow: {
          impulse: {
            id: 'impulse-lane-policy-1',
            type: 'conversation',
            lane: 'heartbeat',
            profile: 'default',
            pool: 'background',
            triggeredBy: {
              lane: 'heartbeat',
              role: 'system',
              source: 'system_event',
              event: 'heartbeat',
              content: 'heartbeat',
              occurredAt: new Date('2026-03-16T12:00:00.000Z'),
              metadata: {},
            },
            startedAt: new Date('2026-03-16T12:00:00.000Z'),
            attention: 1,
            status: 'processing',
          },
          decision: null,
        },
        firstStage: 'think',
        deps: testDeps.deps,
      });

    await run.complete();

    const requests = testDeps.inspector.streamRequests() as Array<{
      input?: Array<{ content?: string }>;
    }>;
    const serialized = JSON.stringify(requests[0]?.input ?? []);

    expect(serialized).toContain('## Response Lane Policy');
    expect(serialized).toContain('Current lane: heartbeat');
    expect(serialized).toContain('Allowed cross-lane targets from this lane:');
    expect(serialized).toContain('conversation');
  });

  test('prefers per-run response policy over config policy in think request input', async () => {
    const vfs = createOverlayFs();
    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            jsonPrimitive({
              thinking: 'fine',
              urgency: 'none',
              intent: null,
              execId: 'prev_test_policy_ctx_1',
            }),
          ],
        },
        {
          primitives: [
            jsonPrimitive({
              thinking: 'fine',
              urgency: 'none',
              intent: null,
              execId: 'prev_test_policy_ctx_2',
            }),
          ],
        },
      ],
      strict: false,
    });
    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-construct-impulse-flow-run-policy-test'),
      scenario,
    });

    const computer = createComputer(vfs, {});
    const flow = createImpulseComputerFlow(vfs, computer, {
      stages: {
        think: { model: 'test-model' },
      },
      responsePlanPolicy: {
        sourceLane: 'heartbeat',
        declaredLanes: ['conversation', 'heartbeat'],
        crossLaneTargets: ['conversation'],
      },
    });

    const run = flow
      .onStep('think', async ({ step }) => {
        if (step.kind === 'reasoning' || step.kind === 'tool') {
          return step.next();
        }
        if (step.kind === 'output') {
          return step.output.accept((output, ctx) => ({
            ctx: { ...ctx, decision: output },
          }));
        }
        throw new Error(
          `Unexpected step kind: ${String((step as { kind: unknown }).kind)}`,
        );
      })
      .start({
        flow: {
          impulse: createConversationImpulse('hello there'),
          decision: null,
          responsePlanPolicy: {
            sourceLane: 'agent:frontend',
            declaredLanes: ['conversation', 'heartbeat', 'agent:*'],
            crossLaneTargets: ['conversation', 'agent:*'],
          },
        },
        firstStage: 'think',
        deps: testDeps.deps,
      });

    await run.complete();

    const requests = testDeps.inspector.streamRequests() as Array<{
      input?: Array<{ content?: string }>;
    }>;
    const serialized = JSON.stringify(requests[0]?.input ?? []);

    expect(serialized).toContain('Current lane: agent:frontend');
    expect(serialized).toContain('agent:*');
    expect(serialized).not.toContain('Current lane: heartbeat');
  });

  test('requests required tool use until a successful preview exists', async () => {
    const vfs = createOverlayFs();
    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            jsonPrimitive({
              thinking: 'skip',
              urgency: 'none',
              intent: null,
              execId: null,
            }),
          ],
        },
      ],
      strict: false,
    });
    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-construct-impulse-flow-tool-choice-required-test'),
      scenario,
    });

    const computer = createComputer(vfs, {});
    const flow = createImpulseComputerFlow(vfs, computer, {
      stages: {
        think: { model: 'test-model' },
      },
    });

    await flow
      .onStep('think', async ({ step }) => {
        if (step.kind === 'reasoning' || step.kind === 'tool') {
          return step.next();
        }
        if (step.kind === 'output') {
          return step.output.accept((output, ctx) => ({
            ctx: { ...ctx, decision: output },
          }));
        }
        throw new Error(
          `Unexpected step kind: ${String((step as { kind: unknown }).kind)}`,
        );
      })
      .start({
        flow: {
          impulse: createConversationImpulse('hello there'),
          decision: null,
        },
        firstStage: 'think',
        deps: testDeps.deps,
      })
      .complete();

    const requests = testDeps.inspector.streamRequests() as Array<{
      tool_choice?: string;
    }>;
    expect(requests[0]?.tool_choice).toBe('required');
  });

  test('relaxes tool use once a successful preview already exists', async () => {
    const vfs = createOverlayFs();
    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            jsonPrimitive({
              thinking: 'reuse preview',
              urgency: 'none',
              intent: null,
              execId: 'placeholder',
            }),
          ],
        },
      ],
      strict: false,
    });
    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-construct-impulse-flow-tool-choice-auto-test'),
      scenario,
    });

    const computer = createComputer(vfs, {});
    const previewCtx: ImpulseFlowContext = {};
    const preview = await computer.tool.execute(
      'console.log("ready")',
      previewCtx,
      undefined,
    );
    expect(preview.success).toBe(true);
    const previewExecId = previewCtx.previewExecOrder?.[0];
    expect(previewExecId).toBeDefined();

    const flow = createImpulseComputerFlow(vfs, computer, {
      stages: {
        think: { model: 'test-model' },
      },
    });

    await flow
      .onStep('think', async ({ step }) => {
        if (step.kind === 'reasoning' || step.kind === 'tool') {
          return step.next();
        }
        if (step.kind === 'output') {
          return step.output.accept((output, ctx) => ({
            ctx: { ...ctx, decision: output },
          }));
        }
        throw new Error(
          `Unexpected step kind: ${String((step as { kind: unknown }).kind)}`,
        );
      })
      .start({
        flow: {
          impulse: createConversationImpulse('reuse the preview'),
          decision: null,
          previewExecRuns: previewCtx.previewExecRuns,
          previewExecOrder: previewCtx.previewExecOrder,
        },
        firstStage: 'think',
        deps: testDeps.deps,
      })
      .complete();

    const requests = testDeps.inspector.streamRequests() as Array<{
      tool_choice?: string;
    }>;
    expect(requests[0]?.tool_choice).toBe('auto');
  });
});

function createConversationImpulse(content: string): Impulse {
  return {
    id: 'impulse-test-1',
    type: 'conversation',
    lane: 'conversation',
    profile: 'default',
    pool: 'conversation',
    triggeredBy: {
      lane: 'conversation',
      role: 'user',
      source: 'user_message',
      content,
      occurredAt: new Date('2026-03-16T12:00:00.000Z'),
      receivedAt: new Date('2026-03-16T12:00:00.000Z'),
    },
    startedAt: new Date('2026-03-16T12:00:00.000Z'),
    attention: 1,
    status: 'processing' as const,
  };
}

async function writeOpenedState(
  vfs: ReturnType<typeof createOverlayFs>,
  files: Array<{
    path: string;
    type: 'file' | 'directory';
    mode?: 'full' | 'frontmatter';
  }>,
) {
  await vfs.write(
    VFS_PATHS.handles.opened,
    serializeContextFile(
      {
        id: 'opened-files',
        tags: [],
        created: '2026-03-16T12:00:00.000Z',
        updated: '2026-03-16T12:00:00.000Z',
        context_bytes: 0,
        context_tokens: 0,
        files: files.map((entry) => ({
          ...entry,
          opened_at: '2026-03-16T12:00:00.000Z',
          size_bytes: 0,
        })),
        ai_pins: [],
        recently_closed: [],
      },
      '',
    ),
  );
}
