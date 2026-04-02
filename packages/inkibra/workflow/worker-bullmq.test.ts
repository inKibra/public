import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Logger } from '@inkibra/logger';
import { stub } from '@inkibra/test-support/stub';
import type Redis from 'ioredis';
import type { WorkflowRuntime } from './runtime';

const bullmqState: {
  addCalls: Array<{
    name: string;
    data: unknown;
    opts?: Record<string, unknown>;
  }>;
  upsertScheduleCalls: Array<{
    id: string;
    repeat: unknown;
    job: {
      name: string;
      data: unknown;
      opts?: Record<string, unknown>;
    };
  }>;
} = {
  addCalls: [],
  upsertScheduleCalls: [],
};

mock.module('bullmq', () => {
  class Queue {
    async add(
      name: string,
      data: unknown,
      opts?: Record<string, unknown>,
    ): Promise<{ id: string }> {
      bullmqState.addCalls.push({
        name,
        data,
        opts,
      });

      return {
        id: String(opts?.jobId ?? `${name}:job`),
      };
    }

    async getJob(_jobId: string): Promise<null> {
      return null;
    }

    async upsertJobScheduler(
      id: string,
      repeat: unknown,
      job: {
        name: string;
        data: unknown;
        opts?: Record<string, unknown>;
      },
    ): Promise<void> {
      bullmqState.upsertScheduleCalls.push({ id, repeat, job });
    }

    async removeJobScheduler(_id: string): Promise<void> {}

    async setGlobalConcurrency(_maxActive: number): Promise<void> {}
  }

  class Worker {
    on(_event: string, _handler: unknown): void {}

    async close(): Promise<void> {}
  }

  return {
    Queue,
    Worker,
  };
});

const workerModulePromise = import('./worker-bullmq');

describe('bullmq worker intent names', () => {
  beforeEach(() => {
    bullmqState.addCalls = [];
    bullmqState.upsertScheduleCalls = [];
  });

  test('uses configured execution and start intent names', async () => {
    const { createBullMQWorker } = await workerModulePromise;

    const runtime = {} as WorkflowRuntime;
    const logger = createLoggerStub();
    const worker = createBullMQWorker(runtime, logger, {
      redis: stub<Redis>(),
      executeJobName: 'run_construct',
      startJobName: 'start_construct',
    });

    await worker.queue.scheduleExecution(
      'instance-1',
      'workflow-a',
      '1.0.0',
      0,
    );
    await worker.queue.scheduleStart('workflow-a', '1.0.0', {}, 0);
    await worker.queue.upsertSchedule({
      id: 'sched-1',
      workflowName: 'workflow-a',
      workflowVersion: '1.0.0',
      input: {},
      everyMs: 30_000,
    });

    expect(bullmqState.addCalls[0]?.name).toBe('run_construct');
    expect(bullmqState.addCalls[1]?.name).toBe('start_construct');
    expect(bullmqState.upsertScheduleCalls[0]?.job.name).toBe(
      'start_construct',
    );
  });
});

function createLoggerStub(): Logger {
  const logger: Partial<Logger> = {
    child: () => logger as Logger,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  };

  return stub<Logger>(logger);
}
