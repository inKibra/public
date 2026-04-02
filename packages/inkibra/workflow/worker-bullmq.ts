/**
 * BullMQ-based worker for processing workflow jobs
 *
 * Jobs are the coordination primitive - they drive workflow execution.
 */

import type { Logger } from '@inkibra/logger';
import { type Job, Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { getWorkflow } from './registry';
import type { WorkflowRuntime } from './runtime';
import type { JsonValue } from './types';

export type WorkflowExecuteJobData = {
  instanceId: string;
  workflowName: string;
  workflowVersion: string;
  action: 'execute';
};

export type WorkflowStartJobData = {
  workflowName: string;
  workflowVersion: string;
  input: JsonValue;
  action: 'start';
  trigger?: 'manual' | 'schedule';
  scheduleId?: string;
};

export type WorkflowJobData = WorkflowExecuteJobData | WorkflowStartJobData;

export type WorkflowJobResult = {
  success: boolean;
  instanceId?: string;
  startedInstanceId?: string;
  completedAt: string;
};

export type WorkflowWorkerOptions = {
  redis: Redis;
  queueName?: string;
  concurrency?: number;
  executeJobName?: string;
  startJobName?: string;
};

export type WorkflowScheduleDefinition = {
  id: string;
  workflowName: string;
  workflowVersion: string;
  input: JsonValue;
  pattern?: string;
  everyMs?: number;
  tz?: string;
  misfirePolicy?: 'skip_to_latest';
};

export type WorkflowJobQueue = {
  scheduleExecution: (
    instanceId: string,
    workflowName: string,
    workflowVersion: string,
    delayMs?: number,
  ) => Promise<string>;
  scheduleStart: (
    workflowName: string,
    workflowVersion: string,
    input: JsonValue,
    delayMs?: number,
  ) => Promise<string>;
  upsertSchedule: (schedule: WorkflowScheduleDefinition) => Promise<void>;
  removeSchedule: (id: string) => Promise<void>;
  promoteJob: (jobId: string) => Promise<boolean>;
  setGlobalConcurrency: (maxActive: number) => Promise<void>;
};

export type WorkflowWorker = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
  queue: WorkflowJobQueue;
};

/**
 * Create a BullMQ-based workflow worker
 */
export function createBullMQWorker(
  runtime: WorkflowRuntime,
  logger: Logger,
  options: WorkflowWorkerOptions,
): WorkflowWorker {
  const {
    redis,
    queueName = 'workflow-jobs',
    concurrency = 10,
    executeJobName = 'execute',
    startJobName = 'start',
  } = options;

  const workerLogger = logger.child({ component: 'workflow-worker-bullmq' });

  // Create queue for scheduling jobs
  const queue = new Queue<WorkflowJobData, WorkflowJobResult>(queueName, {
    connection: redis,
  });

  // Create worker for processing jobs
  let worker: Worker<WorkflowJobData, WorkflowJobResult> | null = null;

  /**
   * Process a workflow job - this is the entry point for workflow execution
   */
  async function processJob(
    job: Job<WorkflowJobData, WorkflowJobResult>,
  ): Promise<WorkflowJobResult> {
    if (job.data.action === 'start') {
      const { workflowName, workflowVersion, input } = job.data;
      const workflow = getWorkflow(workflowName, workflowVersion);
      if (!workflow) {
        throw new Error(
          `Workflow ${workflowName}:${workflowVersion} not found in registry`,
        );
      }

      const instance =
        workflow.kind === 'function'
          ? await runtime.startWorkflow(workflow, input)
          : await runtime.startWorkflow(workflow, input);

      workerLogger.info('Workflow instance started from start job', {
        workflowName,
        workflowVersion,
        startedInstanceId: instance.id,
      });

      return {
        success: true,
        startedInstanceId: instance.id,
        completedAt: new Date().toISOString(),
      };
    }

    const { instanceId, workflowName, workflowVersion } = job.data;

    try {
      // Get workflow definition from registry
      const workflow = getWorkflow(workflowName, workflowVersion);
      if (!workflow) {
        throw new Error(
          `Workflow ${workflowName}:${workflowVersion} not found in registry`,
        );
      }

      // Execute the next stage/tick of the workflow
      await runtime.executeWorkflowStage(workflow, instanceId);

      return {
        success: true,
        instanceId,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      workerLogger.error('Failed to process workflow job', {
        error,
        instanceId,
        workflowName,
        workflowVersion,
      });
      throw error;
    }
  }

  return {
    start: async () => {
      if (worker) {
        workerLogger.warn('Worker already running');
        return;
      }

      workerLogger.info('Starting workflow worker', {
        queueName,
        concurrency,
      });

      worker = new Worker<WorkflowJobData, WorkflowJobResult>(
        queueName,
        processJob,
        {
          connection: redis,
          concurrency,
        },
      );

      worker.on('completed', (job: Job<WorkflowJobData, WorkflowJobResult>) => {
        workerLogger.debug('Job completed', { jobId: job.id });
      });

      worker.on(
        'failed',
        (
          job: Job<WorkflowJobData, WorkflowJobResult> | undefined,
          error: Error,
        ) => {
          workerLogger.error('Job failed', { jobId: job?.id, error });
        },
      );
    },

    stop: async () => {
      if (!worker) {
        workerLogger.warn('Worker not running');
        return;
      }

      workerLogger.info('Stopping workflow worker');

      await worker.close();
      worker = null;
    },

    isRunning: () => worker !== null,

    queue: {
      /**
       * Schedule workflow execution (with optional delay for sleep)
       */
      scheduleExecution: async (
        instanceId: string,
        workflowName: string,
        workflowVersion: string,
        delayMs?: number,
      ): Promise<string> => {
        const jobData: WorkflowExecuteJobData = {
          instanceId,
          workflowName,
          workflowVersion,
          action: 'execute',
        };

        const isImmediate = delayMs === undefined || delayMs <= 0;
        const primaryJobId = `exec-${instanceId}`;
        const followupJobId = `exec-next-${instanceId}`;
        let jobId = isImmediate
          ? primaryJobId
          : `${instanceId}-execute-${Date.now()}-${crypto.randomUUID()}`;

        if (isImmediate) {
          const primary = await queue.getJob(primaryJobId);
          if (primary) {
            const primaryState = await primary.getState();

            if (isQueuedOrRunningState(primaryState)) {
              // Primary execute job already pending; dedupe repeated wake calls.
              if (primaryState !== 'active') {
                return primaryJobId;
              }

              // Primary is actively running. Queue one follow-up execute job so
              // stage transitions emitted during the current tick are not lost.
              const followup = await queue.getJob(followupJobId);
              if (followup) {
                const followupState = await followup.getState();
                if (isQueuedOrRunningState(followupState)) {
                  return followupJobId;
                }
                await followup.remove().catch(() => {});
              }

              jobId = followupJobId;
            } else {
              // Terminal/unknown primary job; clear stale state so the next
              // immediate execution can be enqueued under the primary id.
              await primary.remove().catch(() => {});
              jobId = primaryJobId;
            }
          }
        }

        try {
          await queue.add(executeJobName, jobData, {
            delay: delayMs,
            jobId,
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
            removeOnComplete: 500,
            removeOnFail: 500,
          });
        } catch (error) {
          if (isImmediate && isDuplicateJobIdError(error)) {
            return jobId;
          }

          throw error;
        }

        return jobId;
      },

      /**
       * Schedule workflow start (with optional delay)
       */
      scheduleStart: async (
        workflowName: string,
        workflowVersion: string,
        input: JsonValue,
        delayMs?: number,
      ): Promise<string> => {
        const jobData: WorkflowStartJobData = {
          action: 'start',
          workflowName,
          workflowVersion,
          input,
          trigger: 'manual',
        };

        const jobId = `${workflowName}-${workflowVersion}-start-${Date.now()}-${crypto.randomUUID()}`;
        await queue.add(startJobName, jobData, {
          delay: delayMs,
          jobId,
        });

        return jobId;
      },

      /**
       * Upsert a recurring workflow schedule.
       * misfirePolicy currently supports only skip_to_latest.
       */
      upsertSchedule: async (schedule: WorkflowScheduleDefinition) => {
        const {
          id,
          workflowName,
          workflowVersion,
          input,
          pattern,
          everyMs,
          tz,
          misfirePolicy = 'skip_to_latest',
        } = schedule;

        if (misfirePolicy !== 'skip_to_latest') {
          throw new Error(
            `Unsupported misfire policy: ${misfirePolicy}. Supported: skip_to_latest`,
          );
        }

        if (!pattern && !everyMs) {
          throw new Error('Schedule must provide either pattern or everyMs');
        }

        if (pattern && everyMs) {
          throw new Error(
            'Schedule must provide only one of pattern or everyMs',
          );
        }

        const repeat = pattern
          ? { pattern, tz }
          : {
              every: everyMs,
            };

        await queue.upsertJobScheduler(id, repeat, {
          name: startJobName,
          data: {
            action: 'start',
            workflowName,
            workflowVersion,
            input,
            trigger: 'schedule',
            scheduleId: id,
          } satisfies WorkflowStartJobData,
          opts: {
            removeOnComplete: 500,
            removeOnFail: 500,
          },
        });
      },

      removeSchedule: async (id: string) => {
        await queue.removeJobScheduler(id);
      },

      /**
       * Update an existing job to run immediately (for event arrival)
       */
      promoteJob: async (jobId: string) => {
        try {
          const job = await queue.getJob(jobId);
          if (!job) {
            return false;
          }

          const state = await job.getState();
          if (state === 'delayed') {
            await job.promote();
            workerLogger.info('Promoted delayed job to run immediately', {
              jobId,
            });
            return true;
          }

          if (isQueuedOrRunningState(state)) {
            return true;
          }

          return false;
        } catch (error) {
          workerLogger.warn('Failed to promote job', { jobId, error });
          return false;
        }
      },

      setGlobalConcurrency: async (maxActive: number) => {
        await queue.setGlobalConcurrency(maxActive);
      },
    },
  };
}

function isDuplicateJobIdError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('JobId') && error.message.includes('exists');
}

function isQueuedOrRunningState(state: string): boolean {
  return (
    state === 'waiting' ||
    state === 'active' ||
    state === 'delayed' ||
    state === 'prioritized' ||
    state === 'waiting-children'
  );
}
