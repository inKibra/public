import { describe, expect, test } from 'bun:test';
import { workflow } from './index';
import {
  createWorkflowScheduler,
  type WorkflowCronSchedule,
} from './scheduler';
import type {
  WorkflowJobQueue,
  WorkflowScheduleDefinition,
} from './worker-bullmq';

describe('workflow scheduler', () => {
  test('maps workflow definition to queue schedule', async () => {
    const upserts: WorkflowScheduleDefinition[] = [];
    const removals: string[] = [];

    const queue: WorkflowJobQueue = {
      scheduleExecution: async () => 'job',
      scheduleStart: async () => 'job-start',
      upsertSchedule: async (schedule) => {
        upserts.push(schedule);
      },
      removeSchedule: async (id) => {
        removals.push(id);
      },
      promoteJob: async () => true,
      setGlobalConcurrency: async () => {},
    };

    const wf = workflow({ name: 'daily-email', version: 'v2' }, async () => {
      return { ok: true };
    });

    const scheduler = createWorkflowScheduler(queue);

    const schedule: WorkflowCronSchedule = {
      id: 'daily-email-schedule',
      workflow: wf,
      input: { tenant: 'acme' },
      pattern: '0 9 * * *',
      tz: 'America/New_York',
      misfirePolicy: 'skip_to_latest',
    };

    await scheduler.upsert(schedule);
    await scheduler.remove(schedule.id);

    expect(upserts.length).toBe(1);
    expect(upserts[0]?.workflowName).toBe('daily-email');
    expect(upserts[0]?.workflowVersion).toBe('v2');
    expect(removals).toEqual(['daily-email-schedule']);
  });
});
