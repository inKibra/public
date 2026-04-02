import type { Logger } from '@inkibra/logger';
import type { WorkflowRuntime } from './runtime';
import type {
  WorkflowJobQueue,
  WorkflowWorker,
  WorkflowWorkerOptions,
} from './worker-bullmq';
import { createBullMQWorker } from './worker-bullmq';

export type WorkflowQueueOptions = WorkflowWorkerOptions;

export type WorkflowQueue = WorkflowWorker;

export type WorkflowQueueControls = {
  queue: WorkflowJobQueue;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
};

export function createWorkflowQueue(
  runtime: WorkflowRuntime,
  logger: Logger,
  options: WorkflowQueueOptions,
): WorkflowQueueControls {
  const worker = createBullMQWorker(runtime, logger, options);
  return {
    queue: worker.queue,
    start: worker.start,
    stop: worker.stop,
    isRunning: worker.isRunning,
  };
}
