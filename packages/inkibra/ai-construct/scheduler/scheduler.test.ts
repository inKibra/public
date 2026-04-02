import { describe, expect, test } from 'bun:test';
import { createOverlayFs, serializeContextFile } from '@inkibra/ai-flow';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
  jsonPrimitive,
} from '@inkibra/ai-flow/testing';
import initLogger from '@inkibra/logger';
import { stub } from '@inkibra/test-support/stub';
import type { ImpulsePool } from '../impulse/pool';
import { VFS_PATHS } from '../vfs/layout';
import { ResponseScheduler } from './scheduler';

describe('ResponseScheduler decision normalization', () => {
  test('filters invalid act decisions to ready responses only', () => {
    const scheduler = stub<{ normalizeBatchDecisionOutput: Function }>(
      new ResponseScheduler(
        createOverlayFs(),
        stub<ImpulsePool>(createImpulsePoolStub()),
      ),
    );

    const normalized = scheduler.normalizeBatchDecisionOutput(
      {
        action: 'act',
        respondTo: ['response-1', 'missing'],
        drop: ['response-1', 'response-2', 'missing'],
        reason: '  batch these  ',
      },
      [{ id: 'response-1' }, { id: 'response-2' }],
    );

    expect(normalized).toEqual({
      action: 'act',
      respondTo: ['response-1'],
      drop: ['response-2', 'missing'],
      reason: 'batch these',
    });
  });

  test('normalizes waitUntil impulse decisions', () => {
    const scheduler = stub<{ normalizeBatchDecisionOutput: Function }>(
      new ResponseScheduler(
        createOverlayFs(),
        stub<ImpulsePool>(createImpulsePoolStub()),
      ),
    );

    const normalized = scheduler.normalizeBatchDecisionOutput(
      {
        action: 'wait',
        reason: '  wait for sibling  ',
        waitUntil: { kind: 'impulse', impulseId: ' impulse-7 ' },
      },
      [],
    );

    expect(normalized).toEqual({
      action: 'wait',
      reason: 'wait for sibling',
      waitUntil: { kind: 'impulse', impulseId: 'impulse-7' },
    });
  });

  test('runDecisionModel sees recent log text and returns structured JSON', async () => {
    const vfs = createOverlayFs();
    const logPath = `${VFS_PATHS.logs.root}/2026/W11/2026-03-16-0.internal.log`;
    const recentIso = new Date(Date.now() - 5 * 60_000).toISOString();

    await vfs.write(
      logPath,
      serializeContextFile(
        {
          id: 'recent-log',
          tags: [],
          created: recentIso,
          updated: recentIso,
          log_type: 'internal',
        },
        `[${recentIso}] impulse-2\nfrom: system\ntrigger: heartbeat\n\nbody text should appear`,
      ),
    );

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            jsonPrimitive({
              action: 'wait',
              reason: 'wait for active impulse',
              waitUntil: { kind: 'any_impulse' },
            }),
          ],
        },
      ],
    });
    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-construct-scheduler-context-test'),
      scenario,
    });

    const scheduler = stub<{ runDecisionModel: Function }>(
      new ResponseScheduler(vfs, stub<ImpulsePool>(createImpulsePoolStub()), {
        decisionDeps: testDeps.deps,
        decisionStage: {},
      }),
    );

    const decision = await scheduler.runDecisionModel({
      ready: [
        {
          id: 'response-1',
          scheduledBy: 'impulse-1',
          scheduledAt: new Date('2026-03-16T12:00:00.000Z'),
          urgency: 'normal',
          intent: 'reply helpfully',
        },
      ],
      blocked: [],
      activeImpulses: [
        {
          id: 'impulse-9',
          type: 'conversation',
          lane: 'conversation',
          profile: 'default',
          pool: 'conversation',
          triggeredBy: {
            type: 'USER_MESSAGE',
            messages: [
              {
                content: 'hello there',
                timestamp: new Date('2026-03-16T11:58:00.000Z'),
              },
            ],
            receivedAt: new Date('2026-03-16T11:58:00.000Z'),
          },
          startedAt: new Date('2026-03-16T11:58:00.000Z'),
          attention: 1,
          status: 'processing',
        },
      ],
    });

    expect(decision).toEqual({
      action: 'wait',
      reason: 'wait for active impulse',
      waitUntil: { kind: 'any_impulse' },
    });

    const requests = testDeps.inspector.streamRequests() as Array<{
      input?: Array<{ content?: string }>;
    }>;
    const serialized = JSON.stringify(requests[0]?.input ?? []);

    // Context now comes from resolveStageContext (declarative context system)
    expect(serialized).toContain('READY responses');
    expect(serialized).toContain('Active Impulses (in-flight)');
  });

  test('uses single-response shortcut without AI when one ready response exists', async () => {
    const vfs = createOverlayFs();
    const scheduler = new ResponseScheduler(
      vfs,
      stub<ImpulsePool>(createImpulsePoolStub()),
      {
        decisionDeps: createAiFlowTestDeps({
          logger: initLogger('ai-construct-scheduler-shortcut-test'),
          scenario: createAiFlowScenario({ stream: [] }),
        }).deps,
      },
    );

    let executedIds: string[] | undefined;
    scheduler.onExecuteBatch(async (responses: Array<{ id: string }>) => {
      executedIds = responses.map((response) => response.id);
      return {
        respondedTo: executedIds,
        content: 'ok',
        generatedAt: new Date(),
        durationMs: 1,
        disposition: 'executed' as const,
      };
    });

    scheduler.runDecisionModel = () => {
      throw new Error(
        'AI decision should not run for single-response shortcut',
      );
    };

    await scheduler.schedule({
      id: 'response-1',
      scheduledBy: 'impulse-1',
      intent: 'reply helpfully',
      urgency: 'normal',
    });

    const decision = await scheduler.poll();

    expect(decision).toEqual({
      action: 'act',
      respondTo: ['response-1'],
      drop: [],
      reason: 'single_response_shortcut',
    });
    expect(executedIds).toEqual(['response-1']);
  });
});

function createImpulsePoolStub() {
  return {
    getActive() {
      return [];
    },
    getActiveByPool() {
      return [];
    },
    getActiveByProfile() {
      return [];
    },
  };
}
