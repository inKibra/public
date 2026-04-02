import { describe, expect, test } from 'bun:test';
import initLogger from '@inkibra/logger';
import { createJobQueueSpy } from './__tests__/fixtures/job-queue-spy';
import { createPgliteWorkflowStorageFixture } from './__tests__/fixtures/pglite-workflow-storage';
import { defineWorkflow, stage, waitFor, withCapture } from './index';
import { createWorkflowRuntime } from './runtime';

describe('stage workflow runtime', () => {
  test('executes one stage transition per tick', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-stage-tick-test',
    );

    try {
      const logger = initLogger('workflow-runtime-stage-tick-test');
      const queueSpy = createJobQueueSpy();
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const stageWorkflow = defineWorkflow<{ value: string }>('stage-tick', {
        start: stage(async (input) => ({
          snapshot: { value: input.value.toUpperCase() },
          next: 'finish',
        })),
        finish: stage(async (snapshot) => ({
          type: 'complete',
          result: { final: snapshot.value },
        })),
      });

      const instance = await runtime.startWorkflow(stageWorkflow, {
        value: 'hello',
      });

      queueSpy.scheduled.length = 0;

      await runtime.executeWorkflowStage(stageWorkflow, instance.id);

      const afterFirst = await storageFixture.storage.getInstance(instance.id);
      expect(afterFirst?.status).toBe('running');
      expect(afterFirst?.currentStage).toBe('finish');
      expect(queueSpy.scheduled.length).toBe(1);
      expect(queueSpy.scheduled[0]?.delayMs).toBe(0);

      await runtime.executeWorkflowStage(stageWorkflow, instance.id);

      const afterSecond = await storageFixture.storage.getInstance(instance.id);
      expect(afterSecond?.status).toBe('completed');
      expect(afterSecond?.snapshot).toEqual({ value: 'HELLO' });

      const completedEvents = await storageFixture.storage.getEvents(
        instance.id,
        'completed',
      );
      expect(completedEvents.at(-1)?.payload).toEqual({ final: 'HELLO' });
    } finally {
      await storageFixture.stop();
    }
  });

  test('persists stage runtime storage get/set across ticks', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-stage-storage-test',
    );

    try {
      const logger = initLogger('workflow-runtime-stage-storage-test');
      const queueSpy = createJobQueueSpy();
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const stageWorkflow = defineWorkflow<{ seed: number }>('stage-storage', {
        start: stage(async (input, ctx) => {
          await ctx?.storage.set('counter', input.seed + 1);
          return {
            snapshot: { seed: input.seed },
            next: 'finish',
          };
        }),
        finish: stage(async (_snapshot, ctx) => {
          const counter = await ctx?.storage.get('counter');
          return {
            type: 'complete',
            result: { counter: counter ?? null },
          };
        }),
      });

      const instance = await runtime.startWorkflow(stageWorkflow, { seed: 9 });
      await runtime.executeWorkflowStage(stageWorkflow, instance.id);
      await runtime.executeWorkflowStage(stageWorkflow, instance.id);

      const completed = await storageFixture.storage.getInstance(instance.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.snapshot).toEqual({ seed: 9 });
      expect(completed?.contextData?.counter).toBe(10);

      const completedEvents = await storageFixture.storage.getEvents(
        instance.id,
        'completed',
      );
      expect(completedEvents.at(-1)?.payload).toEqual({ counter: 10 });
    } finally {
      await storageFixture.stop();
    }
  });

  test('exposes received events in stage runtime context', async () => {
    const storageFixture = await createPgliteWorkflowStorageFixture(
      'workflow-runtime-stage-events-test',
    );

    try {
      const logger = initLogger('workflow-runtime-stage-events-test');
      const queueSpy = createJobQueueSpy();
      const runtime = createWorkflowRuntime(
        storageFixture.storage,
        logger,
        queueSpy.queue,
      );

      const stageWorkflow = defineWorkflow<{ id: string }>(
        'stage-events',
        {
          events: {
            signal: withCapture<{ id: string }>(
              (snapshot) => `signal:${snapshot.id}`,
            ),
          },
        },
        {
          start: stage(async (input, ctx) => {
            const signal = ctx?.events.signal;
            if (!signal) {
              throw new Error('signal event missing');
            }

            const seen = signal.received();
            if (seen.length > 0) {
              return {
                type: 'complete',
                result: { payload: seen[0]?.payload ?? null },
              };
            }

            return waitFor({
              token: signal.capture({ id: input.id }),
              snapshot: input,
            });
          }),
        },
      );

      const instance = await runtime.startWorkflow(stageWorkflow, {
        id: 'abc',
      });
      await runtime.executeWorkflowStage(stageWorkflow, instance.id);

      let waiting = await storageFixture.storage.getInstance(instance.id);
      expect(waiting?.status).toBe('waiting');

      await runtime.emitEvent({
        workflowName: stageWorkflow.name,
        eventName: 'signal',
        token: 'signal:abc',
        payload: { value: 7 },
      });

      waiting = await storageFixture.storage.getInstance(instance.id);
      expect(waiting?.status).toBe('running');

      await runtime.executeWorkflowStage(stageWorkflow, instance.id);

      const completed = await storageFixture.storage.getInstance(instance.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.snapshot).toEqual({ id: 'abc' });

      const completedEvents = await storageFixture.storage.getEvents(
        instance.id,
        'completed',
      );
      expect(completedEvents.at(-1)?.payload).toEqual({
        payload: { value: 7 },
      });
    } finally {
      await storageFixture.stop();
    }
  });
});
