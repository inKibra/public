import initLogger from '@inkibra/logger';
import {
  clearRegistry,
  createWorkflowSystem,
  type WorkflowRuntime,
  type WorkflowRuntimeOptions,
  type WorkflowScheduler,
  type WorkflowWorker,
} from '../../index';
import {
  connectToDragonfly,
  type DragonflyContainerHandle,
  startDragonflyContainer,
} from './dragonfly-container';
import { createPgliteWorkflowStorageFixture } from './pglite-workflow-storage';

export type DragonflyWorkflowTestSystem = {
  storage: Awaited<
    ReturnType<typeof createPgliteWorkflowStorageFixture>
  >['storage'];
  runtime: WorkflowRuntime;
  worker: WorkflowWorker;
  scheduler: WorkflowScheduler;
  stop: () => Promise<void>;
};

export async function createDragonflyWorkflowTestSystem(
  options: {
    runtimeOptions?: WorkflowRuntimeOptions;
    startWorker?: boolean;
  } = {},
): Promise<DragonflyWorkflowTestSystem> {
  clearRegistry();

  const logger = initLogger('workflow-dragonfly-integration-test');
  const storageFixture = await createPgliteWorkflowStorageFixture(
    'workflow-dragonfly-integration-storage',
  );
  let dragonfly: DragonflyContainerHandle;
  try {
    const host = process.env.WORKFLOW_DRAGONFLY_HOST;
    const portValue = process.env.WORKFLOW_DRAGONFLY_PORT;

    if (host && portValue) {
      const port = Number.parseInt(portValue, 10);
      dragonfly = await connectToDragonfly(host, port);
    } else {
      dragonfly = await startDragonflyContainer();
    }
  } catch (error) {
    await storageFixture.stop();
    throw error;
  }
  const queueName = `workflow-jobs-test-${Date.now()}-${crypto.randomUUID()}`;

  const system = await createWorkflowSystem({
    storage: storageFixture.storage,
    logger,
    redis: dragonfly.redis,
    queueName,
    workerConcurrency: 4,
    startWorker: options.startWorker ?? true,
    runtimeOptions: options.runtimeOptions,
  });

  return {
    storage: storageFixture.storage,
    runtime: system.runtime,
    worker: {
      start: system.start,
      stop: system.stop,
      isRunning: system.isRunning,
      queue: system.queue,
    } as WorkflowWorker,
    scheduler: system.scheduler,
    stop: async () => {
      await system.stop();
      await dragonfly.stop();
      await storageFixture.stop();
      clearRegistry();
    },
  };
}
