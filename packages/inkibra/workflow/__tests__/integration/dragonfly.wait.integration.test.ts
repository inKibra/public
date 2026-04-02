import { describe, expect, test } from 'bun:test';
import { event, workflow } from '../../index';
import { createDragonflyWorkflowTestSystem } from '../fixtures/workflow-system';
import { waitUntil } from '../utils/wait-until';

const runIntegration = process.env.WORKFLOW_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('dragonfly wait integration', () => {
  test('waitForAll stays waiting until all tokens arrive', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-wait-all-${Date.now()}`;
      const demoWorkflow = workflow<
        { id: string },
        {
          approved: (snapshot: { id: string }) => string;
          billed: (snapshot: { id: string }) => string;
        }
      >(
        {
          name: workflowName,
          events: {
            approved: event<{ id: string }>(
              (snapshot) => `approval:${snapshot.id}`,
            ),
            billed: event<{ id: string }>(
              (snapshot) => `billing:${snapshot.id}`,
            ),
          },
        },
        async ({ input, step, events }) => {
          const wait = await step.waitForAll({
            name: 'wait-for-all-events',
            tokens: [events.approved.token(input), events.billed.token(input)],
            timeout: '10 seconds',
          });

          return {
            timedOut: wait.timedOut,
          };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'wf-all-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return (
            latest?.status === 'waiting' &&
            latest.eventTokens.length === 2 &&
            latest.waitMode === 'all'
          );
        },
        { timeoutMs: 12000 },
      );

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'approved',
        token: 'approval:wf-all-1',
        payload: { ok: true },
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return (
            latest?.status === 'waiting' && latest.eventTokens.length === 1
          );
        },
        { timeoutMs: 12000 },
      );

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'billed',
        token: 'billing:wf-all-1',
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
      expect(completed?.snapshot).toEqual({ timedOut: false });
    } finally {
      await system.stop();
    }
  }, 45000);

  test('ignores matching token when workflowName does not match', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-guard-${Date.now()}`;
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
            name: 'wait-with-guard',
            tokens: [events.signal.token(input)],
            timeout: '15 seconds',
          });

          return {
            timedOut: wait.timedOut,
          };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'guard-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'waiting';
        },
        { timeoutMs: 12000 },
      );

      await system.runtime.emitEvent({
        workflowName: 'not-the-right-workflow',
        eventName: 'signal',
        token: 'signal:guard-1',
        payload: { ignored: true },
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      const stillWaiting = await system.storage.getInstance(instance.id);
      expect(stillWaiting?.status).toBe('waiting');

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'signal',
        token: 'signal:guard-1',
        payload: { accepted: true },
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'completed';
        },
        { timeoutMs: 12000 },
      );

      const completed = await system.storage.getInstance(instance.id);
      expect(completed?.snapshot).toEqual({ timedOut: false });
    } finally {
      await system.stop();
    }
  }, 45000);

  test('event arriving before timeout resolves as non-timeout', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-race-${Date.now()}`;
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
            name: 'wait-race',
            tokens: [events.signal.token(input)],
            timeout: 500,
          });

          return {
            timedOut: wait.timedOut,
          };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'race-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'waiting';
        },
        { timeoutMs: 12000 },
      );

      await new Promise((resolve) => setTimeout(resolve, 60));

      await system.runtime.emitEvent({
        workflowName,
        eventName: 'signal',
        token: 'signal:race-1',
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
      expect(completed?.snapshot).toEqual({ timedOut: false });

      const resolvedEvents = await system.storage.getEvents(
        instance.id,
        'function_wait_resolved',
      );

      const hasTimedOutResolution = resolvedEvents.some((entry) => {
        if (typeof entry.payload !== 'object' || entry.payload === null) {
          return false;
        }

        return 'timedOut' in entry.payload && entry.payload.timedOut === true;
      });

      expect(hasTimedOutResolution).toBe(false);
    } finally {
      await system.stop();
    }
  }, 45000);
});
