import { describe, expect, test } from 'bun:test';
import initLogger from '@inkibra/logger';
import { createJobQueueSpy } from './__tests__/fixtures/job-queue-spy';
import { createPgliteWorkflowStorageFixture } from './__tests__/fixtures/pglite-workflow-storage';
import { InMemoryWorkflowConcurrencyManager } from './concurrency';
import { event, workflow } from './index';
import { createWorkflowRuntime } from './runtime';
import type { WorkflowStorage } from './types';

function wrapStorageWithHeartbeatOverride(
  base: WorkflowStorage,
  heartbeat: WorkflowStorage['heartbeatLock'],
): WorkflowStorage {
  return {
    getInstance: (instanceId) => base.getInstance(instanceId),
    saveInstance: (instance) => base.saveInstance(instance),
    updateInstance: (instanceId, updates, cas) =>
      base.updateInstance(instanceId, updates, cas),
    lockInstance: (instanceId, executionId, leaseDurationMs) =>
      base.lockInstance(instanceId, executionId, leaseDurationMs),
    heartbeatLock: (instanceId, executionId, leaseDurationMs) =>
      heartbeat(instanceId, executionId, leaseDurationMs),
    unlockInstance: (instanceId, executionId) =>
      base.unlockInstance(instanceId, executionId),
    saveEvent: (eventInput) => base.saveEvent(eventInput),
    getEvents: (instanceId, eventType) => base.getEvents(instanceId, eventType),
    findInstancesByToken: (token) => base.findInstancesByToken(token),
  };
}

describe('function workflow runtime', () => {
  test('replays step.run result after sleep', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-function-test',
    );

    try {
      const logger = initLogger('workflow-runtime-function-test');
      const queueSpy = createJobQueueSpy();
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      let computeCount = 0;
      const fnWorkflow = workflow(
        { name: 'replay-step-run' },
        async ({ step }) => {
          const value = await step.run({ name: 'compute' }, async () => {
            computeCount += 1;
            return 42;
          });

          await step.sleep('pause', 0);

          return { value };
        },
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        initial: true,
      });

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);
      let current = await storageFixture.storage.getInstance(instance.id);
      expect(current?.status).toBe('waiting');

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);
      current = await storageFixture.storage.getInstance(instance.id);
      expect(current?.status).toBe('completed');
      expect(computeCount).toBe(1);
    } finally {
      await storageFixture.stop();
    }
  });

  test('reuses deterministic workflow instance ids', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-deterministic-instance-test',
    );

    try {
      const logger = initLogger('workflow-runtime-deterministic-instance-test');
      const queueSpy = createJobQueueSpy();
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const fnWorkflow = workflow(
        { name: 'deterministic-instance' },
        async () => ({ ok: true }),
      );

      const first = await runtime.startWorkflow(
        fnWorkflow,
        { initial: true },
        { instanceId: 'construct-scheduler:abc' },
      );
      const second = await runtime.startWorkflow(
        fnWorkflow,
        { initial: true },
        { instanceId: 'construct-scheduler:abc' },
      );

      expect(first.id).toBe('construct-scheduler:abc');
      expect(second.id).toBe('construct-scheduler:abc');
      expect(queueSpy.scheduled).toHaveLength(1);
    } finally {
      await storageFixture.stop();
    }
  });

  test('enforces step resource concurrency limits', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-concurrency-test',
    );

    try {
      const logger = initLogger('workflow-runtime-concurrency-test');
      const queueSpy = createJobQueueSpy();
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
        {
          concurrency: {
            manager: new InMemoryWorkflowConcurrencyManager(),
            resources: {
              'send-email': 1,
            },
            retryDelayMs: 10,
          },
        },
      );

      let executions = 0;
      const fnWorkflow = workflow(
        { name: 'send-email-workflow' },
        async ({ step }) => {
          await step.run({ name: 'send', resource: 'send-email' }, async () => {
            executions += 1;
            await new Promise((resolve) => setTimeout(resolve, 25));
            return { sent: true };
          });

          return { ok: true };
        },
      );

      const one = await runtime.startWorkflow(fnWorkflow, {
        id: 'one',
      });
      const two = await runtime.startWorkflow(fnWorkflow, {
        id: 'two',
      });

      queueSpy.scheduled.length = 0;

      const first = runtime.executeWorkflowStage(fnWorkflow, one.id);
      await new Promise((resolve) => setTimeout(resolve, 1));
      await runtime.executeWorkflowStage(fnWorkflow, two.id);
      await first;

      const deferredRetry = queueSpy.scheduled.some(
        (entry) => entry.delayMs === 10,
      );
      expect(deferredRetry).toBe(true);

      for (let i = 0; i < 4; i += 1) {
        const instanceOne = await storageFixture.storage.getInstance(one.id);
        const instanceTwo = await storageFixture.storage.getInstance(two.id);

        if (instanceOne?.status !== 'completed') {
          await runtime.executeWorkflowStage(fnWorkflow, one.id);
        }

        if (instanceTwo?.status !== 'completed') {
          await runtime.executeWorkflowStage(fnWorkflow, two.id);
        }
      }

      expect((await storageFixture.storage.getInstance(one.id))?.status).toBe(
        'completed',
      );
      expect((await storageFixture.storage.getInstance(two.id))?.status).toBe(
        'completed',
      );
      expect(executions).toBe(2);
    } finally {
      await storageFixture.stop();
    }
  });

  test('schedules immediate execution when timeout job cannot be promoted', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-wait-promote-fallback-test',
    );

    try {
      const logger = initLogger('workflow-runtime-wait-promote-fallback-test');
      const queueSpy = createJobQueueSpy({
        promoteResult: false,
      });
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const fnWorkflow = workflow<
        { id: string },
        { signal: (snapshot: { id: string }) => string },
        { done: boolean }
      >(
        {
          name: 'wait-promote-fallback',
          events: {
            signal: event<{ id: string }>(
              (snapshot) => `signal:${snapshot.id}`,
            ),
          },
        },
        async ({ input, step, events }) => {
          await step.waitForAny({
            name: 'wait-signal',
            tokens: [events.signal.token(input)],
            timeout: 5_000,
          });

          return { done: true };
        },
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        id: 'promote-fallback-1',
      });

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);

      const waiting = await storageFixture.storage.getInstance(instance.id);
      expect(waiting?.status).toBe('waiting');
      expect(waiting?.timeoutJobId).toBeDefined();
      if (!waiting?.timeoutJobId) {
        return;
      }

      queueSpy.scheduled.length = 0;

      await runtime.emitEvent({
        workflowName: fnWorkflow.name,
        eventName: 'signal',
        token: 'signal:promote-fallback-1',
        payload: { ok: true },
      });

      expect(queueSpy.promoted).toContain(waiting.timeoutJobId);
      expect(queueSpy.scheduled.length).toBe(1);
      expect(queueSpy.scheduled[0]?.instanceId).toBe(instance.id);
      expect(queueSpy.scheduled[0]?.delayMs).toBe(0);
    } finally {
      await storageFixture.stop();
    }
  });

  test('does not schedule immediate execution when timeout promote succeeds', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-wait-promote-success-test',
    );

    try {
      const logger = initLogger('workflow-runtime-wait-promote-success-test');
      const queueSpy = createJobQueueSpy({
        promoteResult: true,
      });
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const fnWorkflow = workflow<
        { id: string },
        { signal: (snapshot: { id: string }) => string },
        { done: boolean }
      >(
        {
          name: 'wait-promote-success',
          events: {
            signal: event<{ id: string }>(
              (snapshot) => `signal:${snapshot.id}`,
            ),
          },
        },
        async ({ input, step, events }) => {
          await step.waitForAny({
            name: 'wait-signal',
            tokens: [events.signal.token(input)],
            timeout: 5_000,
          });

          return { done: true };
        },
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        id: 'promote-success-1',
      });

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);

      const waiting = await storageFixture.storage.getInstance(instance.id);
      expect(waiting?.status).toBe('waiting');
      expect(waiting?.timeoutJobId).toBeDefined();
      if (!waiting?.timeoutJobId) {
        return;
      }

      queueSpy.scheduled.length = 0;

      await runtime.emitEvent({
        workflowName: fnWorkflow.name,
        eventName: 'signal',
        token: 'signal:promote-success-1',
        payload: { ok: true },
      });

      expect(queueSpy.promoted).toContain(waiting.timeoutJobId);
      expect(queueSpy.scheduled.length).toBe(0);
    } finally {
      await storageFixture.stop();
    }
  });

  test('ensureWorkflowExecution promotes timeout job when present', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-ensure-execution-promote-test',
    );

    try {
      const logger = initLogger(
        'workflow-runtime-ensure-execution-promote-test',
      );
      const queueSpy = createJobQueueSpy({
        promoteResult: true,
      });
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const fnWorkflow = workflow<
        { id: string },
        { signal: (snapshot: { id: string }) => string },
        { done: boolean }
      >(
        {
          name: 'ensure-execution-promote',
          events: {
            signal: event<{ id: string }>(
              (snapshot) => `signal:${snapshot.id}`,
            ),
          },
        },
        async ({ input, step, events }) => {
          await step.waitForAny({
            name: 'wait-signal',
            tokens: [events.signal.token(input)],
            timeout: 5_000,
          });

          return { done: true };
        },
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        id: 'ensure-promote-1',
      });

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);

      const waiting = await storageFixture.storage.getInstance(instance.id);
      expect(waiting?.status).toBe('waiting');
      expect(waiting?.timeoutJobId).toBeDefined();
      if (!waiting?.timeoutJobId || !runtime.ensureWorkflowExecution) {
        return;
      }

      queueSpy.scheduled.length = 0;

      const ensured = await runtime.ensureWorkflowExecution({
        instanceId: instance.id,
        workflowName: fnWorkflow.name,
      });

      expect(queueSpy.promoted).toContain(waiting.timeoutJobId);
      expect(queueSpy.scheduled.length).toBe(0);
      expect(ensured.status).toBe('promoted');
    } finally {
      await storageFixture.stop();
    }
  });

  test('ensureWorkflowExecution schedules immediate when timeout promote fails', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-ensure-execution-schedule-test',
    );

    try {
      const logger = initLogger(
        'workflow-runtime-ensure-execution-schedule-test',
      );
      const queueSpy = createJobQueueSpy({
        promoteResult: false,
      });
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const fnWorkflow = workflow<
        { id: string },
        { signal: (snapshot: { id: string }) => string },
        { done: boolean }
      >(
        {
          name: 'ensure-execution-schedule',
          events: {
            signal: event<{ id: string }>(
              (snapshot) => `signal:${snapshot.id}`,
            ),
          },
        },
        async ({ input, step, events }) => {
          await step.waitForAny({
            name: 'wait-signal',
            tokens: [events.signal.token(input)],
            timeout: 5_000,
          });

          return { done: true };
        },
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        id: 'ensure-schedule-1',
      });

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);

      const waiting = await storageFixture.storage.getInstance(instance.id);
      expect(waiting?.status).toBe('waiting');
      expect(waiting?.timeoutJobId).toBeDefined();
      if (!waiting?.timeoutJobId || !runtime.ensureWorkflowExecution) {
        return;
      }

      queueSpy.scheduled.length = 0;

      const ensured = await runtime.ensureWorkflowExecution({
        instanceId: instance.id,
        workflowName: fnWorkflow.name,
      });

      expect(queueSpy.promoted).toContain(waiting.timeoutJobId);
      expect(queueSpy.scheduled.length).toBe(1);
      expect(queueSpy.scheduled[0]?.instanceId).toBe(instance.id);
      expect(queueSpy.scheduled[0]?.delayMs).toBe(0);
      expect(ensured.status).toBe('scheduled');
    } finally {
      await storageFixture.stop();
    }
  });

  test('does not persist stage result after workflow lock lease is lost mid-execution', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-lease-loss-no-persist-test',
    );

    try {
      const logger = initLogger('workflow-runtime-lease-loss-no-persist-test');
      const queueSpy = createJobQueueSpy();

      let heartbeatCount = 0;
      const storage = wrapStorageWithHeartbeatOverride(
        storageFixture.storage,
        async (instanceId, executionId, leaseDurationMs) => {
          heartbeatCount += 1;
          if (heartbeatCount === 1) {
            return storageFixture.storage.heartbeatLock(
              instanceId,
              executionId,
              leaseDurationMs,
            );
          }
          return false;
        },
      );

      const runtime = createWorkflowRuntime(storage, logger, queueSpy.queue);

      const fnWorkflow = workflow(
        { name: 'lease-loss-no-persist' },
        async () => ({ ok: true }),
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        id: 'lease-loss-no-persist-1',
      });

      expect(
        runtime.executeWorkflowStage(fnWorkflow, instance.id),
      ).rejects.toThrow(`Workflow lease lost for instance ${instance.id}`);

      const current = await storageFixture.storage.getInstance(instance.id);
      expect(current?.status).toBe('running');

      const completedEvents = (
        await storageFixture.storage.getEvents(instance.id, 'completed')
      ).length;
      expect(completedEvents).toBe(0);
    } finally {
      await storageFixture.stop();
    }
  });

  test('old execution cannot fence-overwrite state after competing lock owner advances instance', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-lease-loss-fence-overwrite-test',
    );

    try {
      const logger = initLogger(
        'workflow-runtime-lease-loss-fence-overwrite-test',
      );
      const queueSpy = createJobQueueSpy();

      let firstExecutionId: string | undefined;
      let firstExecutionHeartbeatCount = 0;

      const storage = wrapStorageWithHeartbeatOverride(
        storageFixture.storage,
        async (instanceId, executionId, leaseDurationMs) => {
          if (!firstExecutionId) {
            firstExecutionId = executionId;
          }

          if (executionId === firstExecutionId) {
            firstExecutionHeartbeatCount += 1;
            if (firstExecutionHeartbeatCount === 1) {
              return storageFixture.storage.heartbeatLock(
                instanceId,
                executionId,
                leaseDurationMs,
              );
            }
            return false;
          }

          return storageFixture.storage.heartbeatLock(
            instanceId,
            executionId,
            leaseDurationMs,
          );
        },
      );

      const runtime = createWorkflowRuntime(storage, logger, queueSpy.queue);

      const fnWorkflow = workflow(
        { name: 'lease-loss-fence-overwrite' },
        async () => ({ ok: true }),
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        id: 'lease-loss-fence-overwrite-1',
      });

      expect(
        runtime.executeWorkflowStage(fnWorkflow, instance.id),
      ).rejects.toThrow(`Workflow lease lost for instance ${instance.id}`);

      const afterLeaseLoss = await storageFixture.storage.getInstance(
        instance.id,
      );
      expect(afterLeaseLoss?.status).toBe('running');

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);

      const completed = await storageFixture.storage.getInstance(instance.id);
      expect(completed?.status).toBe('completed');

      const completedEvents = await storageFixture.storage.getEvents(
        instance.id,
        'completed',
      );
      expect(completedEvents.length).toBe(1);
    } finally {
      await storageFixture.stop();
    }
  });

  test('throttles lock contention retries per workflow instance', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-lock-contention-throttle-test',
    );

    try {
      const logger = initLogger(
        'workflow-runtime-lock-contention-throttle-test',
      );
      const queueSpy = createJobQueueSpy();
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
        {
          lockContentionRetryMinIntervalMs: 250,
        },
      );

      const fnWorkflow = workflow(
        { name: 'lock-contention-throttle' },
        async () => ({ ok: true }),
      );

      const instance = await runtime.startWorkflow(fnWorkflow, {
        id: 'lock-contention-1',
      });

      queueSpy.scheduled.length = 0;

      const locked = await storageFixture.storage.lockInstance(
        instance.id,
        'foreign-exec',
        30_000,
      );
      expect(locked).not.toBeNull();

      await runtime.executeWorkflowStage(fnWorkflow, instance.id);
      await runtime.executeWorkflowStage(fnWorkflow, instance.id);

      expect(queueSpy.scheduled.length).toBe(1);
      expect(queueSpy.scheduled[0]?.instanceId).toBe(instance.id);

      await storageFixture.storage.unlockInstance(instance.id, 'foreign-exec');
    } finally {
      await storageFixture.stop();
    }
  });
});
