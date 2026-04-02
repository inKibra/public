import type { JobQueue } from '../../runtime';

export function createJobQueueSpy(options?: {
  promoteResult?: boolean | ((jobId: string) => boolean | Promise<boolean>);
}) {
  const scheduled: Array<{
    instanceId: string;
    workflowName: string;
    workflowVersion: string;
    delayMs?: number;
    jobId: string;
  }> = [];
  const promoted: string[] = [];

  const queue: JobQueue = {
    scheduleExecution: async (
      instanceId,
      workflowName,
      workflowVersion,
      delayMs,
    ) => {
      const jobId = `${instanceId}:${Date.now()}:${crypto.randomUUID()}`;
      scheduled.push({
        instanceId,
        workflowName,
        workflowVersion,
        delayMs,
        jobId,
      });
      return jobId;
    },
    promoteJob: async (jobId) => {
      promoted.push(jobId);
      const configured = options?.promoteResult;
      if (typeof configured === 'function') {
        return await configured(jobId);
      }

      return configured ?? true;
    },
  };

  return {
    queue,
    scheduled,
    promoted,
  };
}
