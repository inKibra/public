import { describe, expect, test } from 'bun:test';
import initLogger from '@inkibra/logger';
import { createWorkflowRuntime } from '@inkibra/workflow';
import { createJobQueueSpy } from '../../workflow/__tests__/fixtures/job-queue-spy';
import type {
  JsonValue,
  WorkflowEvent,
  WorkflowInstance,
  WorkflowStorage,
} from '../../workflow/types';
import {
  type ConstructSchedulerDueWork,
  createConstructSchedulerEventToken,
  createConstructSchedulerWorkflow,
} from './workflow';

describe('construct scheduler workflow', () => {
  test('wakes on schedule update and appends due work', async () => {
    const logger = initLogger('construct-scheduler-workflow-test');
    const queueSpy = createJobQueueSpy({ promoteResult: true });
    const storage = createInMemoryWorkflowStorage();
    const runtime = createWorkflowRuntime(storage, logger, queueSpy.queue);

    let nextDue: ConstructSchedulerDueWork | null = null;
    const appended: ConstructSchedulerDueWork[] = [];
    const ensured: string[] = [];

    const workflow = createConstructSchedulerWorkflow({
      loadNextDue: async () => nextDue,
      appendDueWork: async (_constructId, due) => {
        appended.push(due);
        nextDue = null;
      },
      ensureConstructRunning: async (constructId) => {
        ensured.push(constructId);
      },
    });

    const instance = await runtime.startWorkflow(workflow, {
      constructId: 'construct-1',
    });

    await runtime.executeWorkflowStage(workflow, instance.id);
    expect((await storage.getInstance(instance.id))?.status).toBe('waiting');

    nextDue = {
      kind: 'reminder',
      dueAt: new Date(Date.now() - 1000).toISOString(),
      reminderId: 'heartbeat.md',
      path: '/runtime/cron/heartbeat.md',
      reminder: {
        path: '/runtime/cron/heartbeat.md',
        content: 'Internal heartbeat wakeup. Managed by runtime.',
        meta: { type: 'heartbeat', status: 'pending' },
      },
    };

    await runtime.emitEvent({
      workflowName: workflow.name,
      eventName: 'scheduleUpdated',
      token: createConstructSchedulerEventToken('construct-1'),
      payload: { reason: 'heartbeat-updated' },
    });

    await runtime.executeWorkflowStage(workflow, instance.id);

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      kind: 'reminder',
      reminder: { meta: { type: 'heartbeat' } },
    });
    expect(ensured).toEqual(['construct-1']);
    expect((await storage.getInstance(instance.id))?.status).toBe('waiting');
  });
});

function createInMemoryWorkflowStorage(): WorkflowStorage {
  const instances = new Map<string, WorkflowInstance<JsonValue>>();
  const events: WorkflowEvent[] = [];

  return {
    async getInstance(instanceId) {
      return instances.get(instanceId) ?? null;
    },
    async saveInstance(instance) {
      instances.set(instance.id, structuredClone(instance));
      return structuredClone(instance);
    },
    async updateInstance(instanceId, updates) {
      const current = instances.get(instanceId);
      if (!current) {
        throw new Error(`Missing workflow instance ${instanceId}`);
      }
      const next = {
        ...current,
        ...updates,
      } as WorkflowInstance<JsonValue>;
      instances.set(instanceId, structuredClone(next));
      return structuredClone(next);
    },
    async lockInstance(instanceId, executionId, leaseDurationMs) {
      const current = instances.get(instanceId);
      if (!current || current.lock) {
        return null;
      }
      const next = {
        ...current,
        lock: {
          executionId,
          leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString(),
        },
      } as WorkflowInstance<JsonValue>;
      instances.set(instanceId, structuredClone(next));
      return structuredClone(next);
    },
    async heartbeatLock(instanceId, executionId, leaseDurationMs) {
      const current = instances.get(instanceId);
      if (!current?.lock || current.lock.executionId !== executionId) {
        return false;
      }
      current.lock = {
        executionId,
        leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString(),
      };
      instances.set(instanceId, structuredClone(current));
      return true;
    },
    async unlockInstance(instanceId, executionId) {
      const current = instances.get(instanceId);
      if (!current?.lock || current.lock.executionId !== executionId) {
        return;
      }
      const next = { ...current };
      delete next.lock;
      instances.set(instanceId, structuredClone(next));
    },
    async saveEvent(event) {
      const saved: WorkflowEvent = {
        id: crypto.randomUUID(),
        ...event,
      };
      events.push(saved);
      return structuredClone(saved);
    },
    async getEvents(instanceId, eventType) {
      return events.filter(
        (event) =>
          event.instanceId === instanceId &&
          (eventType ? event.eventType === eventType : true),
      );
    },
    async findInstancesByToken(token) {
      return Array.from(instances.values()).filter((instance) =>
        instance.eventTokens.includes(token),
      );
    },
  };
}
