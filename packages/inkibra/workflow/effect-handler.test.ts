import { describe, expect, test } from 'bun:test';
import { Logger } from '@inkibra/logger';
import { stub } from '@inkibra/test-support/stub';
import { createWorkflowEffectHandler } from './effect-handler';
import { clearRegistry, registerWorkflow } from './registry';
import type { WorkflowRuntime } from './runtime';
import type {
  JsonValue,
  StageWorkflowDefinition,
  WorkflowInstance,
} from './types';

function createMockRuntime() {
  const started: Array<{
    workflow: string;
    input: JsonValue;
    instanceId?: string;
  }> = [];

  const runtime = stub<WorkflowRuntime>({
    startWorkflow: async (
      workflow: { name: string; version: string },
      input: JsonValue,
      options?: { instanceId?: string },
    ) => {
      started.push({
        workflow: workflow.name,
        input,
        instanceId: options?.instanceId,
      });
      return stub<WorkflowInstance<JsonValue>>({
        id: options?.instanceId ?? 'mock-id',
        workflowName: workflow.name,
        version: workflow.version,
        status: 'running' as const,
        currentStage: 'start',
        snapshot: { stage: 'start', data: input },
        eventTokens: [],
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });
    },
  });

  return { runtime, started };
}

function createTestWorkflow(
  name: string,
  version = '1.0.0',
): StageWorkflowDefinition<JsonValue> {
  return {
    kind: 'stage',
    name,
    version,
    stages: {
      start: {
        execute: async () => ({ type: 'complete' as const, result: {} }),
      },
    },
    events: {},
    start: async () => {
      throw new Error('Not used in tests');
    },
  };
}

const logger = Logger.createLogger('test', {}, 'fatal');

describe('createWorkflowEffectHandler', () => {
  test('starts a registered workflow', async () => {
    clearRegistry();
    const wf = createTestWorkflow('charge-card');
    registerWorkflow(wf);

    const { runtime, started } = createMockRuntime();
    const handler = createWorkflowEffectHandler({ runtime, logger });

    await handler({
      kind: 'workflow.start',
      payload: {
        workflow: 'charge-card',
        input: { amount: 49.99 },
      },
    });

    expect(started).toHaveLength(1);
    expect(started[0]!.workflow).toBe('charge-card');
    expect(started[0]!.input).toEqual({ amount: 49.99 });
  });

  test('passes instanceId for idempotency', async () => {
    clearRegistry();
    const wf = createTestWorkflow('send-email');
    registerWorkflow(wf);

    const { runtime, started } = createMockRuntime();
    const handler = createWorkflowEffectHandler({ runtime, logger });

    await handler({
      kind: 'workflow.start',
      payload: {
        workflow: 'send-email',
        input: { to: 'user@example.com' },
        instanceId: 'idempotent-123',
      },
    });

    expect(started[0]!.instanceId).toBe('idempotent-123');
  });

  test('warns on missing workflow name', async () => {
    const { runtime } = createMockRuntime();
    const handler = createWorkflowEffectHandler({ runtime, logger });

    // Should not throw (fire-and-forget)
    await handler({
      kind: 'workflow.start',
      payload: {},
    });
  });

  test('warns on unknown workflow', async () => {
    clearRegistry();
    const { runtime, started } = createMockRuntime();
    const handler = createWorkflowEffectHandler({ runtime, logger });

    await handler({
      kind: 'workflow.start',
      payload: {
        workflow: 'nonexistent',
        input: {},
      },
    });

    expect(started).toHaveLength(0);
  });

  test('does not throw when runtime.startWorkflow fails', async () => {
    clearRegistry();
    const wf = createTestWorkflow('failing-workflow');
    registerWorkflow(wf);

    const runtime = stub<WorkflowRuntime>({
      startWorkflow: async () => {
        throw new Error('DB connection lost');
      },
    });

    const handler = createWorkflowEffectHandler({ runtime, logger });

    // Should not throw
    await handler({
      kind: 'workflow.start',
      payload: {
        workflow: 'failing-workflow',
        input: {},
      },
    });
  });

  test('uses custom version', async () => {
    clearRegistry();
    const wf = createTestWorkflow('versioned-wf', '2.0.0');
    registerWorkflow(wf);

    const { runtime, started } = createMockRuntime();
    const handler = createWorkflowEffectHandler({ runtime, logger });

    await handler({
      kind: 'workflow.start',
      payload: {
        workflow: 'versioned-wf',
        version: '2.0.0',
        input: {},
      },
    });

    expect(started).toHaveLength(1);
  });
});
