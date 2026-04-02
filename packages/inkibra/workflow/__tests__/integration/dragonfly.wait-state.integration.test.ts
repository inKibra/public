import { describe, expect, test } from 'bun:test';
import { event, workflow } from '../../index';
import { createDragonflyWorkflowTestSystem } from '../fixtures/workflow-system';
import { waitUntil } from '../utils/wait-until';

const runIntegration = process.env.WORKFLOW_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('dragonfly wait state integration', () => {
  test('waitForAny clears wait metadata after event resume', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-wait-state-any-${Date.now()}`;
      const demoWorkflow = workflow<
        { id: string },
        { signal: (snapshot: { id: string }) => string }
      >(
        {
          name: workflowName,
          events: {
            signal: event<{ id: string }>(
              (snapshot) => `signal:${snapshot.id}`,
            ),
          },
        },
        async ({ input, step, events }) => {
          const wait = await step.waitForAny({
            name: 'wait-any-metadata',
            tokens: [events.signal.token(input)],
            timeout: 5000,
          });

          return { timedOut: wait.timedOut };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'state-any-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return (
            latest?.status === 'waiting' &&
            latest.waitMode === 'any' &&
            latest.waitingStepKey === 'wait-any-metadata' &&
            latest.eventTokens.length === 1
          );
        },
        { timeoutMs: 12000 },
      );

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'signal',
        token: 'signal:state-any-1',
        payload: { ok: true },
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'completed';
        },
        { timeoutMs: 12000 },
      );

      const completed = await system.storage.getInstance(instance.id);
      expect(completed?.eventTokens).toEqual([]);
      expect(completed?.waitMode).toBeUndefined();
      expect(completed?.waitingStepKey).toBeUndefined();
      expect(completed?.waitTimeoutAt).toBeUndefined();
      expect(completed?.timeoutJobId).toBeUndefined();
    } finally {
      await system.stop();
    }
  }, 45000);

  test('waitForAll keeps remaining token then clears metadata on final token', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-wait-state-all-${Date.now()}`;
      const demoWorkflow = workflow<
        { id: string },
        {
          one: (snapshot: { id: string }) => string;
          two: (snapshot: { id: string }) => string;
        }
      >(
        {
          name: workflowName,
          events: {
            one: event<{ id: string }>((snapshot) => `one:${snapshot.id}`),
            two: event<{ id: string }>((snapshot) => `two:${snapshot.id}`),
          },
        },
        async ({ input, step, events }) => {
          const wait = await step.waitForAll({
            name: 'wait-all-metadata',
            tokens: [events.one.token(input), events.two.token(input)],
            timeout: 5000,
          });

          return { timedOut: wait.timedOut };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'state-all-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return (
            latest?.status === 'waiting' &&
            latest.waitMode === 'all' &&
            latest.waitingStepKey === 'wait-all-metadata' &&
            latest.eventTokens.length === 2
          );
        },
        { timeoutMs: 12000 },
      );

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'one',
        token: 'one:state-all-1',
        payload: { ok: true },
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return (
            latest?.status === 'waiting' &&
            latest.waitMode === 'all' &&
            latest.eventTokens.length === 1 &&
            latest.eventTokens[0] === 'two:state-all-1'
          );
        },
        { timeoutMs: 12000 },
      );

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'two',
        token: 'two:state-all-1',
        payload: { ok: true },
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'completed';
        },
        { timeoutMs: 12000 },
      );

      const completed = await system.storage.getInstance(instance.id);
      expect(completed?.eventTokens).toEqual([]);
      expect(completed?.waitMode).toBeUndefined();
      expect(completed?.waitingStepKey).toBeUndefined();
      expect(completed?.waitTimeoutAt).toBeUndefined();
      expect(completed?.timeoutJobId).toBeUndefined();
    } finally {
      await system.stop();
    }
  }, 45000);

  test('wait timeout clears metadata before completion', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-wait-state-timeout-${Date.now()}`;
      const demoWorkflow = workflow<
        { id: string },
        { signal: (snapshot: { id: string }) => string }
      >(
        {
          name: workflowName,
          events: {
            signal: event<{ id: string }>(
              (snapshot) => `signal:${snapshot.id}`,
            ),
          },
        },
        async ({ input, step, events }) => {
          const wait = await step.waitForAny({
            name: 'wait-timeout-metadata',
            tokens: [events.signal.token(input)],
            timeout: 80,
          });

          return { timedOut: wait.timedOut };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'state-timeout-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'completed';
        },
        { timeoutMs: 12000 },
      );

      const completed = await system.storage.getInstance(instance.id);
      expect(completed?.snapshot).toEqual({ timedOut: true });
      expect(completed?.eventTokens).toEqual([]);
      expect(completed?.waitMode).toBeUndefined();
      expect(completed?.waitingStepKey).toBeUndefined();
      expect(completed?.waitTimeoutAt).toBeUndefined();
      expect(completed?.timeoutJobId).toBeUndefined();
    } finally {
      await system.stop();
    }
  }, 45000);
});
