import { describe, expect, test } from 'bun:test';
import { event, workflow } from '../../index';
import { createDragonflyWorkflowTestSystem } from '../fixtures/workflow-system';
import { waitUntil } from '../utils/wait-until';

const runIntegration = process.env.WORKFLOW_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('dragonfly worker integration', () => {
  test('processes scheduleStart and delayed sleep jobs end-to-end', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-sleep-${Date.now()}`;
      const demoWorkflow = workflow<{ id: string }>(
        { name: workflowName },
        async ({ step }) => {
          await step.run({ name: 'prepare' }, async () => ({ ok: true }));
          await step.sleep('short-pause', 50);
          return { status: 'done' };
        },
      );

      await system.worker.queue.scheduleStart(
        demoWorkflow.name,
        demoWorkflow.version,
        { id: 'a1' },
      );

      await waitUntil(
        async () => {
          const instances =
            await system.storage.listInstancesByWorkflowName(workflowName);

          return instances.some(
            (instance) => instance.workflowName === workflowName,
          );
        },
        { timeoutMs: 10000 },
      );

      const instance = (
        await system.storage.listInstancesByWorkflowName(workflowName)
      ).at(0);

      expect(instance).toBeDefined();

      await waitUntil(
        async () => {
          const latest = instance
            ? await system.storage.getInstance(instance.id)
            : null;
          return latest?.status === 'completed';
        },
        { timeoutMs: 10000 },
      );

      const completed = instance
        ? await system.storage.getInstance(instance.id)
        : null;

      expect(completed?.status).toBe('completed');
      expect(completed?.snapshot).toEqual({ status: 'done' });
    } finally {
      await system.stop();
    }
  }, 30000);

  test('resumes waiting workflow immediately when event arrives', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-event-${Date.now()}`;
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
          const signalEvent = events.signal;
          if (!signalEvent) {
            throw new Error('signal event is missing');
          }

          const signal = await step.waitForAny({
            name: 'wait-signal',
            tokens: [signalEvent.token(input)],
            timeout: '30 seconds',
          });

          return {
            timedOut: signal.timedOut,
          };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'evt-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'waiting';
        },
        { timeoutMs: 10000 },
      );

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'signal',
        token: 'signal:evt-1',
        payload: { ok: true },
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'completed';
        },
        { timeoutMs: 10000 },
      );

      const completed = await system.storage.getInstance(instance.id);
      expect(completed?.snapshot).toEqual({ timedOut: false });
    } finally {
      await system.stop();
    }
  }, 30000);

  test('resolves wait timeout when no event is emitted', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-timeout-${Date.now()}`;
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
          const signalEvent = events.signal;
          if (!signalEvent) {
            throw new Error('signal event is missing');
          }

          const signal = await step.waitForAny({
            name: 'wait-signal-timeout',
            tokens: [signalEvent.token(input)],
            timeout: 80,
          });

          return {
            timedOut: signal.timedOut,
          };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'evt-timeout',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'completed';
        },
        { timeoutMs: 10000 },
      );

      const completed = await system.storage.getInstance(instance.id);
      expect(completed?.snapshot).toEqual({ timedOut: true });
    } finally {
      await system.stop();
    }
  }, 30000);
});
