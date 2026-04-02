/**
 * @inkibra/workflow - Typesafe, explicit, resumable workflow system
 *
 * Core API for defining and executing durable workflows with:
 * - Explicit stage boundaries
 * - Type-safe JSON-only snapshots
 * - Event-driven coordination
 * - Persistence via DAL collections
 */

import { registerWorkflow as regWorkflow } from './registry';
import type {
  CompleteResult,
  EmptyFunctionWorkflowEvents,
  EventCaptureFunction,
  EventsMap,
  FailureResult,
  FunctionWorkflowDefinition,
  FunctionWorkflowEvents,
  FunctionWorkflowHandler,
  JsonValue,
  SleepResult,
  Snapshot,
  StageDefinition,
  StageFunction,
  StageResult,
  StagesMap,
  StageWorkflowDefinition,
  WaitForResult,
  WorkflowOptions,
} from './types';

export type {
  ConcurrencyLease,
  ConcurrencyScope,
  WorkflowConcurrencyManager,
} from './concurrency';
export {
  createRedisWorkflowConcurrencyManager,
  InMemoryWorkflowConcurrencyManager,
} from './concurrency';
export type {
  WorkflowQueue,
  WorkflowQueueControls,
  WorkflowQueueOptions,
} from './queue';
export { createWorkflowQueue } from './queue';
export { clearRegistry, getWorkflow, registerWorkflow } from './registry';
export type {
  JobQueue,
  WorkflowEventDispatchResult,
  WorkflowExecutionEnsureResult,
  WorkflowRuntime,
  WorkflowRuntimeConcurrencyOptions,
  WorkflowRuntimeOptions,
} from './runtime';
export { createWorkflowRuntime } from './runtime';
export type { WorkflowCronSchedule, WorkflowScheduler } from './scheduler';
export { createWorkflowScheduler } from './scheduler';
export {
  DalWorkflowStorage,
  WORKFLOW_COLLECTION,
  WORKFLOW_EVENT_TYPE,
  WORKFLOW_INSTANCE_TYPE,
  workflowRuntimeCollection,
  workflowRuntimeCollectionSchema,
  workflowRuntimeTable,
} from './storage-dal';
export type {
  CreateWorkflowSystemOptions,
  WorkflowSystem,
} from './system';
export { createWorkflowSystem } from './system';
export * from './types';
export type { WorkflowJobQueue, WorkflowWorker } from './worker-bullmq';
export { createBullMQWorker } from './worker-bullmq';

/**
 * Define a workflow stage function
 */
export function stage<TSnapshot extends JsonValue>(
  fn: StageFunction<TSnapshot, StageResult<TSnapshot>>,
): StageDefinition<TSnapshot> {
  return {
    execute: fn,
  };
}

/**
 * Schedule a sleep/delay before continuing to next stage
 */
export function sleep<TSnapshot extends JsonValue>(
  duration: string | number,
  options: { snapshot: Snapshot<TSnapshot>; next: string },
): SleepResult<TSnapshot> {
  return {
    type: 'sleep',
    duration,
    snapshot: options.snapshot,
    next: options.next,
  };
}

/**
 * Mark workflow as completed with result
 */
export function complete<TResult extends JsonValue = JsonValue>(options: {
  result: TResult;
}): CompleteResult<TResult> {
  return {
    type: 'complete',
    result: options.result,
  };
}

/**
 * Mark workflow as failed with optional retry
 */
export function failure<TData extends JsonValue = JsonValue>(options: {
  reason: string;
  data?: TData;
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
}): FailureResult<TData> {
  return {
    type: 'failure',
    reason: options.reason,
    data: options.data,
    retry: options.retry,
  };
}

/**
 * Wait for a single event token
 */
export function waitFor<TSnapshot extends JsonValue>(options: {
  token: string;
  snapshot: Snapshot<TSnapshot>;
  timeout?: SleepResult<TSnapshot>;
}): WaitForResult<TSnapshot> {
  return {
    type: 'waitFor',
    tokens: [options.token],
    mode: 'any',
    snapshot: options.snapshot,
    timeout: options.timeout,
  };
}

/**
 * Wait for any of multiple events
 */
waitFor.any = <TSnapshot extends JsonValue>(
  tokens: string[],
  options: {
    snapshot: Snapshot<TSnapshot>;
    timeout?: SleepResult<TSnapshot>;
  },
): WaitForResult<TSnapshot> => ({
  type: 'waitFor',
  tokens,
  mode: 'any',
  snapshot: options.snapshot,
  timeout: options.timeout,
});

/**
 * Wait for all of multiple events
 */
waitFor.all = <TSnapshot extends JsonValue>(
  tokens: string[],
  options: {
    snapshot: Snapshot<TSnapshot>;
    timeout?: SleepResult<TSnapshot>;
  },
): WaitForResult<TSnapshot> => ({
  type: 'waitFor',
  tokens,
  mode: 'all',
  snapshot: options.snapshot,
  timeout: options.timeout,
});

/**
 * Create an event definition with typed capture function
 */
export function withCapture<TSnapshot extends JsonValue>(
  captureFunction: EventCaptureFunction<TSnapshot>,
): EventCaptureFunction<TSnapshot> {
  return captureFunction;
}

/**
 * Create an event capture definition for function workflows
 */
export function event<TSnapshot extends JsonValue>(
  captureFunction: EventCaptureFunction<TSnapshot>,
): EventCaptureFunction<TSnapshot> {
  return captureFunction;
}

/**
 * Define a function-style workflow (OpenWorkflow-style DX)
 */
export function workflow<
  TInput extends JsonValue,
  TResult extends JsonValue = JsonValue,
>(
  spec: { name: string; version?: string },
  handler: FunctionWorkflowHandler<
    TInput,
    EmptyFunctionWorkflowEvents<TInput>,
    TResult
  >,
): FunctionWorkflowDefinition<
  TInput,
  EmptyFunctionWorkflowEvents<TInput>,
  TResult
>;

export function workflow<
  TInput extends JsonValue,
  TEvents extends FunctionWorkflowEvents<TInput>,
  TResult extends JsonValue = JsonValue,
>(
  spec: { name: string; version?: string; events: TEvents },
  handler: FunctionWorkflowHandler<TInput, TEvents, TResult>,
): FunctionWorkflowDefinition<TInput, TEvents, TResult>;

export function workflow<
  TInput extends JsonValue,
  TEvents extends FunctionWorkflowEvents<TInput>,
  TResult extends JsonValue = JsonValue,
>(
  spec: { name: string; version?: string; events?: TEvents },
  handler: FunctionWorkflowHandler<TInput, TEvents, TResult>,
): FunctionWorkflowDefinition<TInput, TEvents, TResult> {
  const definition: FunctionWorkflowDefinition<TInput, TEvents, TResult> = {
    kind: 'function',
    name: spec.name,
    version: spec.version ?? '1.0.0',
    events: spec.events,
    handler,
    start: async () => {
      throw new Error(
        'Workflow start() must be called from initialized workflow runtime',
      );
    },
  };

  regWorkflow(definition);

  return definition;
}

/**
 * Define a workflow with stages and optional events
 */
export function defineWorkflow<TSnapshot extends JsonValue>(
  name: string,
  options: WorkflowOptions<TSnapshot>,
  stages: StagesMap<TSnapshot>,
): StageWorkflowDefinition<TSnapshot>;

export function defineWorkflow<TSnapshot extends JsonValue>(
  name: string,
  stages: StagesMap<TSnapshot>,
): StageWorkflowDefinition<TSnapshot>;

export function defineWorkflow<TSnapshot extends JsonValue>(
  name: string,
  optionsOrStages: WorkflowOptions<TSnapshot> | StagesMap<TSnapshot>,
  maybeStages?: StagesMap<TSnapshot>,
): StageWorkflowDefinition<TSnapshot> {
  // Determine if first param after name is options or stages
  const hasOptions =
    maybeStages !== undefined ||
    'events' in optionsOrStages ||
    'version' in optionsOrStages;
  const options = hasOptions
    ? (optionsOrStages as WorkflowOptions<TSnapshot>)
    : undefined;
  const stages =
    hasOptions && maybeStages
      ? maybeStages
      : (optionsOrStages as StagesMap<TSnapshot>);

  const version = options?.version ?? '1.0.0';
  const eventsConfig = options?.events ?? {};

  // Create event definitions (will be bound to runtime in runtime.ts)
  const events: EventsMap<TSnapshot> = {};

  for (const [eventName, captureFunction] of Object.entries(eventsConfig)) {
    if (!captureFunction) {
      continue;
    }

    events[eventName] = {
      capture: captureFunction,
      emit: async () => {
        throw new Error(
          `Event ${eventName} emit() must be called from initialized workflow`,
        );
      },
      received: () => {
        throw new Error(
          `Event ${eventName} received() must be called from stage runtime context`,
        );
      },
    };
  }

  const workflow: StageWorkflowDefinition<TSnapshot> = {
    kind: 'stage',
    name,
    version,
    stages,
    events,
    start: async () => {
      throw new Error(
        'Workflow start() must be called from initialized workflow runtime',
      );
    },
  };

  // Auto-register workflow for retrieval during execution
  regWorkflow(workflow);

  return workflow;
}
