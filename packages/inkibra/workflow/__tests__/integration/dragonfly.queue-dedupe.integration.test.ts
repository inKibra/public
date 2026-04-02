import { describe, expect, test } from 'bun:test';
import { createDragonflyWorkflowTestSystem } from '../fixtures/workflow-system';

const runIntegration = process.env.WORKFLOW_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('dragonfly queue dedupe integration', () => {
  test('coalesces immediate execute jobs by instance id', async () => {
    const system = await createDragonflyWorkflowTestSystem({
      startWorker: false,
    });

    try {
      const ids = await Promise.all(
        Array.from({ length: 10 }, () =>
          system.worker.queue.scheduleExecution(
            'instance-a',
            'wf-a',
            '1.0.0',
            0,
          ),
        ),
      );

      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toBe('exec-instance-a');
    } finally {
      await system.stop();
    }
  }, 30000);
});
