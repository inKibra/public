import { describe, expect, test } from 'bun:test';
import Redis from 'ioredis';
import { createRedisWorkflowConcurrencyManager, workflow } from '../../index';
import { createDragonflyWorkflowTestSystem } from '../fixtures/workflow-system';
import { waitUntil } from '../utils/wait-until';

const runIntegration = process.env.WORKFLOW_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

function createIntegrationRedisConnection(): Redis {
  const host = process.env.WORKFLOW_DRAGONFLY_HOST;
  const portValue = process.env.WORKFLOW_DRAGONFLY_PORT;
  if (!host || !portValue) {
    throw new Error(
      'WORKFLOW_DRAGONFLY_HOST/PORT are required for integration tests',
    );
  }

  return new Redis({
    host,
    port: Number.parseInt(portValue, 10),
    maxRetriesPerRequest: null,
  });
}

describeIntegration('dragonfly concurrency integration', () => {
  test('enforces queue global concurrency across executions', async () => {
    const system = await createDragonflyWorkflowTestSystem();

    try {
      await system.worker.queue.setGlobalConcurrency(1);

      let active = 0;
      let maxActive = 0;

      const workflowName = `dragonfly-global-concurrency-${Date.now()}`;
      const demoWorkflow = workflow(
        { name: workflowName },
        async ({ step }) => {
          await step.run({ name: 'slow-work' }, async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            try {
              await new Promise((resolve) => setTimeout(resolve, 120));
              return { ok: true };
            } finally {
              active -= 1;
            }
          });

          return { done: true };
        },
      );

      for (let i = 0; i < 5; i += 1) {
        await system.worker.queue.scheduleStart(
          demoWorkflow.name,
          demoWorkflow.version,
          {
            id: `global-${i}`,
          },
        );
      }

      await waitUntil(
        async () => {
          const instances =
            await system.storage.listInstancesByWorkflowName(workflowName);
          return (
            instances.length >= 5 &&
            instances.every((instance) => instance.status === 'completed')
          );
        },
        { timeoutMs: 30000, intervalMs: 50 },
      );

      expect(maxActive).toBe(1);
    } finally {
      await system.stop();
    }
  }, 60000);

  test('enforces workflow-level active execution cap', async () => {
    const redis = createIntegrationRedisConnection();

    try {
      const workflowName = `dragonfly-workflow-cap-${Date.now()}`;
      const manager = createRedisWorkflowConcurrencyManager(redis, {
        prefix: `workflow-concurrency-${workflowName}`,
      });

      const system = await createDragonflyWorkflowTestSystem({
        runtimeOptions: {
          concurrency: {
            manager,
            workflows: {
              [workflowName]: 1,
            },
            retryDelayMs: 25,
            leaseMs: 5000,
          },
        },
      });
      try {
        let active = 0;
        let maxActive = 0;

        const demoWorkflow = workflow(
          { name: workflowName },
          async ({ step }) => {
            await step.run({ name: 'slow-step' }, async () => {
              active += 1;
              maxActive = Math.max(maxActive, active);
              try {
                await new Promise((resolve) => setTimeout(resolve, 120));
                return { ok: true };
              } finally {
                active -= 1;
              }
            });

            return { done: true };
          },
        );

        for (let i = 0; i < 4; i += 1) {
          await system.worker.queue.scheduleStart(
            demoWorkflow.name,
            demoWorkflow.version,
            {
              id: `workflow-cap-${i}`,
            },
          );
        }

        await waitUntil(
          async () => {
            const instances =
              await system.storage.listInstancesByWorkflowName(workflowName);
            return (
              instances.length >= 4 &&
              instances.every((instance) => instance.status === 'completed')
            );
          },
          { timeoutMs: 30000, intervalMs: 50 },
        );

        expect(maxActive).toBe(1);
      } finally {
        await system.stop();
      }
    } finally {
      await redis.quit();
    }
  }, 60000);

  test('enforces resource-level cap across workflow types', async () => {
    const redis = createIntegrationRedisConnection();

    try {
      const capNamespace = `resource-cap-${Date.now()}`;
      const manager = createRedisWorkflowConcurrencyManager(redis, {
        prefix: `workflow-concurrency-${capNamespace}`,
      });

      const system = await createDragonflyWorkflowTestSystem({
        runtimeOptions: {
          concurrency: {
            manager,
            resources: {
              'send-email': 1,
            },
            retryDelayMs: 20,
            leaseMs: 5000,
          },
        },
      });
      try {
        let active = 0;
        let maxActive = 0;

        const workflowAName = `dragonfly-resource-a-${Date.now()}`;
        const workflowBName = `dragonfly-resource-b-${Date.now()}`;

        const workflowA = workflow(
          { name: workflowAName },
          async ({ step }) => {
            await step.run(
              { name: 'send-a', resource: 'send-email' },
              async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                try {
                  await new Promise((resolve) => setTimeout(resolve, 90));
                  return { ok: true };
                } finally {
                  active -= 1;
                }
              },
            );

            return { done: true };
          },
        );

        const workflowB = workflow(
          { name: workflowBName },
          async ({ step }) => {
            await step.run(
              { name: 'send-b', resource: 'send-email' },
              async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                try {
                  await new Promise((resolve) => setTimeout(resolve, 90));
                  return { ok: true };
                } finally {
                  active -= 1;
                }
              },
            );

            return { done: true };
          },
        );

        await system.worker.queue.scheduleStart(
          workflowA.name,
          workflowA.version,
          {
            id: 'a-1',
          },
        );
        await system.worker.queue.scheduleStart(
          workflowB.name,
          workflowB.version,
          {
            id: 'b-1',
          },
        );
        await system.worker.queue.scheduleStart(
          workflowA.name,
          workflowA.version,
          {
            id: 'a-2',
          },
        );
        await system.worker.queue.scheduleStart(
          workflowB.name,
          workflowB.version,
          {
            id: 'b-2',
          },
        );

        await waitUntil(
          async () => {
            const instancesA =
              await system.storage.listInstancesByWorkflowName(workflowAName);
            const instancesB =
              await system.storage.listInstancesByWorkflowName(workflowBName);
            const all = [...instancesA, ...instancesB];
            return (
              all.length >= 4 &&
              all.every((instance) => instance.status === 'completed')
            );
          },
          { timeoutMs: 30000, intervalMs: 50 },
        );

        expect(maxActive).toBe(1);
      } finally {
        await system.stop();
      }
    } finally {
      await redis.quit();
    }
  }, 60000);
});
