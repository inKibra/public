import { describe, expect, test } from 'bun:test';
import { workflow } from '../../index';
import { createDragonflyWorkflowTestSystem } from '../fixtures/workflow-system';
import { waitUntil } from '../utils/wait-until';

const runIntegration = process.env.WORKFLOW_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('dragonfly scheduler integration', () => {
  test('upserts and removes recurring schedules', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-scheduler-${Date.now()}`;
      const scheduledWorkflow = workflow({ name: workflowName }, async () => {
        return { scheduled: true };
      });

      const scheduleId = `schedule-${Date.now()}`;

      await system.scheduler.upsert({
        id: scheduleId,
        workflow: scheduledWorkflow,
        input: { run: 'scheduled' },
        everyMs: 200,
        misfirePolicy: 'skip_to_latest',
      });

      await waitUntil(
        async () => {
          const instances =
            await system.storage.listInstancesByWorkflowName(workflowName);

          return instances.some(
            (instance) => instance.workflowName === workflowName,
          );
        },
        { timeoutMs: 12000, intervalMs: 50 },
      );

      await system.scheduler.remove(scheduleId);

      const matching =
        await system.storage.listInstancesByWorkflowName(workflowName);

      expect(matching.length).toBeGreaterThan(0);
    } finally {
      await system.stop();
    }
  }, 30000);

  test('remove schedule stops additional runs after grace window', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-scheduler-stop-${Date.now()}`;
      const scheduledWorkflow = workflow({ name: workflowName }, async () => {
        return { scheduled: true };
      });

      const scheduleId = `schedule-stop-${Date.now()}`;

      await system.scheduler.upsert({
        id: scheduleId,
        workflow: scheduledWorkflow,
        input: { run: 'scheduled' },
        everyMs: 150,
        misfirePolicy: 'skip_to_latest',
      });

      await waitUntil(
        async () => {
          const instances =
            await system.storage.listInstancesByWorkflowName(workflowName);
          return instances.length >= 2;
        },
        { timeoutMs: 15000, intervalMs: 50 },
      );

      await system.scheduler.remove(scheduleId);

      await new Promise((resolve) => setTimeout(resolve, 400));

      const baseline = (
        await system.storage.listInstancesByWorkflowName(workflowName)
      ).length;

      await new Promise((resolve) => setTimeout(resolve, 500));

      const finalCount = (
        await system.storage.listInstancesByWorkflowName(workflowName)
      ).length;

      expect(finalCount).toBe(baseline);
    } finally {
      await system.stop();
    }
  }, 45000);

  test('supports cron pattern schedules', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-scheduler-cron-${Date.now()}`;
      const scheduledWorkflow = workflow({ name: workflowName }, async () => {
        return { scheduled: true };
      });

      const scheduleId = `schedule-cron-${Date.now()}`;

      await system.scheduler.upsert({
        id: scheduleId,
        workflow: scheduledWorkflow,
        input: { run: 'cron' },
        pattern: '*/1 * * * * *',
        misfirePolicy: 'skip_to_latest',
      });

      await waitUntil(
        async () => {
          const instances =
            await system.storage.listInstancesByWorkflowName(workflowName);
          return instances.length >= 1;
        },
        { timeoutMs: 15000, intervalMs: 50 },
      );

      await system.scheduler.remove(scheduleId);

      const matching =
        await system.storage.listInstancesByWorkflowName(workflowName);
      expect(matching.length).toBeGreaterThan(0);
    } finally {
      await system.stop();
    }
  }, 45000);

  test('rejects invalid schedule definitions', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-scheduler-invalid-${Date.now()}`;
      const scheduledWorkflow = workflow({ name: workflowName }, async () => {
        return { scheduled: true };
      });

      await expect(
        system.scheduler.upsert({
          id: `schedule-invalid-both-${Date.now()}`,
          workflow: scheduledWorkflow,
          input: { run: 'invalid' },
          everyMs: 200,
          pattern: '*/1 * * * * *',
          misfirePolicy: 'skip_to_latest',
        }),
      ).rejects.toThrow();

      await expect(
        system.scheduler.upsert({
          id: `schedule-invalid-none-${Date.now()}`,
          workflow: scheduledWorkflow,
          input: { run: 'invalid' },
          misfirePolicy: 'skip_to_latest',
        }),
      ).rejects.toThrow();
    } finally {
      await system.stop();
    }
  }, 45000);
});
