import { event, workflow } from '@inkibra/workflow';
import type { PerceptionDueItem } from './perception-schedule';

export type ConstructSchedulerDueWork = PerceptionDueItem;

export type ConstructSchedulerWorkflowInput = {
  constructId: string;
};

export function createConstructSchedulerWorkflowInstanceId(
  constructId: string,
): string {
  return `construct-scheduler--${encodeURIComponent(constructId)}`;
}

export function createConstructSchedulerEventToken(
  constructId: string,
): string {
  return `construct-scheduler:${constructId}:schedule-updated`;
}

export function createConstructSchedulerWorkflow(deps: {
  workflowName?: string;
  loadNextDue: (
    constructId: string,
    now: Date,
  ) => Promise<ConstructSchedulerDueWork | null>;
  appendDueWork: (
    constructId: string,
    due: ConstructSchedulerDueWork,
  ) => Promise<void>;
  ensureConstructRunning: (constructId: string) => Promise<void>;
}) {
  return workflow<
    ConstructSchedulerWorkflowInput,
    { scheduleUpdated: (input: ConstructSchedulerWorkflowInput) => string },
    { waiting: true }
  >(
    {
      name: deps.workflowName ?? 'construct-scheduler',
      events: {
        scheduleUpdated: event<ConstructSchedulerWorkflowInput>((input) =>
          createConstructSchedulerEventToken(input.constructId),
        ),
      },
    },
    async ({ input, step, events }) => {
      let iteration = 0;

      while (true) {
        const due = await deps.loadNextDue(input.constructId, new Date());

        if (due && Date.parse(due.dueAt) <= Date.now()) {
          await step.run({ name: `append-due:${iteration}` }, async () => {
            await deps.appendDueWork(input.constructId, due);
            return {
              appended: due.kind,
              dueAt: due.dueAt,
            };
          });
          await step.run({ name: `ensure-running:${iteration}` }, async () => {
            await deps.ensureConstructRunning(input.constructId);
            return { constructId: input.constructId };
          });
          iteration += 1;
          continue;
        }

        const waitResult = await step.waitForAny({
          name: `wait-schedule:${iteration}`,
          tokens: [events.scheduleUpdated.token(input)],
          timeout: due
            ? Math.max(0, Date.parse(due.dueAt) - Date.now())
            : undefined,
        });

        if (waitResult.timedOut && due) {
          await step.run({ name: `append-due:${iteration}` }, async () => {
            await deps.appendDueWork(input.constructId, due);
            return {
              appended: due.kind,
              dueAt: due.dueAt,
            };
          });
          await step.run({ name: `ensure-running:${iteration}` }, async () => {
            await deps.ensureConstructRunning(input.constructId);
            return { constructId: input.constructId };
          });
        }

        iteration += 1;
      }
    },
  );
}
