import { describe, expect, test } from 'bun:test';
import { workflow } from '../../index';
import { createDragonflyWorkflowTestSystem } from '../fixtures/workflow-system';
import { waitUntil } from '../utils/wait-until';

const runIntegration = process.env.WORKFLOW_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('dragonfly worker recovery integration', () => {
  test('continues delayed sleep workflow after worker restart', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      const workflowName = `dragonfly-recovery-${Date.now()}`;
      const demoWorkflow = workflow(
        { name: workflowName },
        async ({ step }) => {
          await step.sleep('restart-window-sleep', 250);
          return { recovered: true };
        },
      );

      const instance = await system.runtime.startWorkflow(demoWorkflow, {
        id: 'restart-1',
      });

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'waiting';
        },
        { timeoutMs: 12000 },
      );

      await system.worker.stop();

      await new Promise((resolve) => setTimeout(resolve, 400));

      const paused = await system.storage.getInstance(instance.id);
      expect(paused?.status).toBe('waiting');

      await system.worker.start();

      await waitUntil(
        async () => {
          const latest = await system.storage.getInstance(instance.id);
          return latest?.status === 'completed';
        },
        { timeoutMs: 12000 },
      );

      const completed = await system.storage.getInstance(instance.id);
      expect(completed?.snapshot).toEqual({ recovered: true });
    } finally {
      await system.stop();
    }
  }, 45000);
});
