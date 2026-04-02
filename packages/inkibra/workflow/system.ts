import type { Logger } from '@inkibra/logger';
import type Redis from 'ioredis';
import {
  createWorkflowQueue,
  type WorkflowQueueControls,
  type WorkflowQueueOptions,
} from './queue';
import {
  createWorkflowRuntime,
  type JobQueue,
  type WorkflowRuntime,
  type WorkflowRuntimeOptions,
} from './runtime';
import { createWorkflowScheduler, type WorkflowScheduler } from './scheduler';
import type { WorkflowStorage } from './types';

export type CreateWorkflowSystemOptions = {
  storage: WorkflowStorage;
  logger: Logger;
  redis: Redis;
  queueName?: string;
  workerConcurrency?: number;
  executeJobName?: string;
  startJobName?: string;
  startWorker?: boolean;
  runtimeOptions?: WorkflowRuntimeOptions;
};

export type WorkflowSystem = {
  storage: WorkflowStorage;
  runtime: WorkflowRuntime;
  queue: WorkflowQueueControls['queue'];
  scheduler: WorkflowScheduler;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
};

export async function createWorkflowSystem(
  options: CreateWorkflowSystemOptions,
): Promise<WorkflowSystem> {
  const {
    storage,
    logger,
    redis,
    queueName = 'workflow-jobs',
    workerConcurrency = 10,
    executeJobName,
    startJobName,
    startWorker = true,
    runtimeOptions,
  } = options;

  let queueDelegate: WorkflowQueueControls['queue'] | undefined;
  const queueProxy: JobQueue = {
    scheduleExecution: async (...args) => {
      if (!queueDelegate) {
        throw new Error('Workflow queue not initialized');
      }

      return queueDelegate.scheduleExecution(...args);
    },
    promoteJob: async (...args) => {
      if (!queueDelegate) {
        throw new Error('Workflow queue not initialized');
      }

      return queueDelegate.promoteJob(...args);
    },
  };

  const runtime = createWorkflowRuntime(
    storage,
    logger,
    queueProxy,
    runtimeOptions,
  );

  const queueOptions: WorkflowQueueOptions = {
    redis,
    queueName,
    concurrency: workerConcurrency,
    executeJobName,
    startJobName,
  };
  const workflowQueue = createWorkflowQueue(runtime, logger, queueOptions);
  queueDelegate = workflowQueue.queue;

  if (startWorker) {
    await workflowQueue.start();
  }

  return {
    storage,
    runtime,
    queue: workflowQueue.queue,
    scheduler: createWorkflowScheduler(workflowQueue.queue),
    start: workflowQueue.start,
    stop: workflowQueue.stop,
    isRunning: workflowQueue.isRunning,
  };
}
