import type { JsonValue, WorkflowDefinition } from './types';
import type { WorkflowJobQueue } from './worker-bullmq';

export type WorkflowCronSchedule = {
  id: string;
  workflow: WorkflowDefinition<JsonValue, JsonValue>;
  input: JsonValue;
  pattern?: string;
  everyMs?: number;
  tz?: string;
  misfirePolicy?: 'skip_to_latest';
};

export type WorkflowScheduler = {
  upsert: (schedule: WorkflowCronSchedule) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export function createWorkflowScheduler(
  jobQueue: WorkflowJobQueue,
): WorkflowScheduler {
  return {
    upsert: async (schedule: WorkflowCronSchedule) => {
      await jobQueue.upsertSchedule({
        id: schedule.id,
        workflowName: schedule.workflow.name,
        workflowVersion: schedule.workflow.version,
        input: schedule.input,
        pattern: schedule.pattern,
        everyMs: schedule.everyMs,
        tz: schedule.tz,
        misfirePolicy: schedule.misfirePolicy ?? 'skip_to_latest',
      });
    },
    remove: async (id: string) => {
      await jobQueue.removeSchedule(id);
    },
  };
}
