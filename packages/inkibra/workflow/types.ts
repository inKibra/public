/**
 * Type definitions for the @inkibra/workflow system
 */

// JSON-safe type constraint
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Snapshot type ensures only JSON-serializable data crosses stage boundaries
 */
export type Snapshot<T extends JsonValue> = T;

/**
 * Stage function signature
 */
export type StageFunction<TSnapshot extends JsonValue, TResult> = {
  bivarianceHack(
    snapshot: Snapshot<TSnapshot>,
    runtime?: RuntimeContext<TSnapshot>,
  ): Promise<TResult>;
}['bivarianceHack'];

/**
 * Stage return types
 */
export type StageTransition<TSnapshot extends JsonValue> = {
  snapshot: Snapshot<TSnapshot>;
  next: string;
};

export type SleepResult<TSnapshot extends JsonValue> = {
  type: 'sleep';
  duration: string | number; // ISO duration string or milliseconds
  snapshot: Snapshot<TSnapshot>;
  next: string;
};

export type CompleteResult<TResult extends JsonValue = JsonValue> = {
  type: 'complete';
  result: TResult;
};

export type FailureResult<TData extends JsonValue = JsonValue> = {
  type: 'failure';
  reason: string;
  data?: TData;
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
};

export type WaitForResult<TSnapshot extends JsonValue> = {
  type: 'waitFor';
  tokens: string[];
  mode: 'any' | 'all';
  snapshot: Snapshot<TSnapshot>;
  timeout?: SleepResult<TSnapshot>;
};

export type StageResult<TSnapshot extends JsonValue> =
  | StageTransition<TSnapshot>
  | SleepResult<TSnapshot>
  | CompleteResult
  | FailureResult
  | WaitForResult<TSnapshot>;

/**
 * Event definition types
 */
export type EventCaptureFunction<TSnapshot extends JsonValue> = {
  bivarianceHack(snapshot: Snapshot<TSnapshot>): string;
}['bivarianceHack'];

export type EventDefinition<TSnapshot extends JsonValue> = {
  capture: EventCaptureFunction<TSnapshot>;
  emit: (
    params: { payload: JsonValue; token?: string } & JsonObject,
  ) => Promise<void>;
  received: () => Array<{ timestamp: string; payload: JsonValue }>;
};

export type EventsMap<TSnapshot extends JsonValue = JsonValue> = {
  [eventName: string]: EventDefinition<TSnapshot>;
};

export type WorkflowEventsConfig<TSnapshot extends JsonValue = JsonValue> = {
  [eventName: string]: EventCaptureFunction<TSnapshot>;
};

/**
 * Runtime context available to stage functions
 */
export type RuntimeContext<_TSnapshot extends JsonValue> = {
  events: EventsMap<_TSnapshot>;
  storage: {
    get: (key: string) => Promise<JsonValue | undefined>;
    set: (key: string, value: JsonValue) => Promise<void>;
  };
  trace: {
    add: (event: { type: string; data: JsonValue }) => void;
  };
  effects: {
    now: () => string;
    randomUUID: () => string;
    workflowInstanceId?: () => string;
    assertLeaseActive?: () => Promise<void>;
  };
};

/**
 * Workflow definition types
 */
export type StageDefinition<TSnapshot extends JsonValue> = {
  execute: StageFunction<TSnapshot, StageResult<TSnapshot>>;
};

export type StagesMap<TSnapshot extends JsonValue = JsonValue> = {
  [stageName: string]: StageDefinition<TSnapshot>;
};

export type WorkflowOptions<TSnapshot extends JsonValue = JsonValue> = {
  events?: WorkflowEventsConfig<TSnapshot>;
  version?: string;
};

export type WorkflowKind = 'stage' | 'function';

export type StepRunOptions = {
  name: string;
  resource?: string;
  maxActive?: number;
};

export type StepWaitResult = {
  timedOut: boolean;
  token?: string;
};

export type StepWaitOptions = {
  name: string;
  tokens: string[];
  timeout?: string | number;
};

export type StepApi = {
  run: <TResult extends JsonValue>(
    options: StepRunOptions,
    fn: () => Promise<TResult>,
  ) => Promise<TResult>;
  sleep: (name: string, duration: string | number) => Promise<void>;
  waitForAny: (options: StepWaitOptions) => Promise<StepWaitResult>;
  waitForAll: (options: StepWaitOptions) => Promise<StepWaitResult>;
};

export type FunctionWorkflowEvents<TInput extends JsonValue> = {
  [eventName: string]: EventCaptureFunction<TInput>;
};

export type EmptyFunctionWorkflowEvents<TInput extends JsonValue> = Record<
  never,
  EventCaptureFunction<TInput>
>;

export type FunctionEventApiFor<TInput extends JsonValue> = {
  token: (snapshot: TInput) => string;
  emit: (params: { token: string; payload: JsonValue }) => Promise<void>;
};

export type FunctionEventsApi<
  TInput extends JsonValue,
  TEvents extends FunctionWorkflowEvents<TInput>,
> = {
  [EventName in keyof TEvents]: FunctionEventApiFor<TInput>;
};

export type FunctionWorkflowContext<
  TInput extends JsonValue,
  TEvents extends FunctionWorkflowEvents<TInput>,
> = {
  input: TInput;
  step: StepApi;
  events: FunctionEventsApi<TInput, TEvents>;
};

export type FunctionWorkflowHandler<
  TInput extends JsonValue,
  TEvents extends FunctionWorkflowEvents<TInput>,
  TResult extends JsonValue,
> = {
  bivarianceHack(
    context: FunctionWorkflowContext<TInput, TEvents>,
  ): Promise<TResult>;
}['bivarianceHack'];

export type FunctionWorkflowSpec<
  TInput extends JsonValue = JsonValue,
  TEvents extends
    FunctionWorkflowEvents<TInput> = EmptyFunctionWorkflowEvents<TInput>,
> = {
  name: string;
  version?: string;
  events?: TEvents;
};

export type StageWorkflowDefinition<TSnapshot extends JsonValue> = {
  kind: 'stage';
  name: string;
  version: string;
  start: (input: JsonValue) => Promise<WorkflowInstance<TSnapshot>>;
  events: EventsMap<TSnapshot>;
  stages: StagesMap<TSnapshot>;
};

export type FunctionWorkflowDefinition<
  TInput extends JsonValue,
  TEvents extends
    FunctionWorkflowEvents<TInput> = EmptyFunctionWorkflowEvents<TInput>,
  TResult extends JsonValue = JsonValue,
> = {
  kind: 'function';
  name: string;
  version: string;
  start: (input: JsonValue) => Promise<WorkflowInstance<JsonValue>>;
  events?: TEvents;
  handler: FunctionWorkflowHandler<TInput, TEvents, TResult>;
};

export type AnyStageWorkflowDefinition = StageWorkflowDefinition<JsonValue>;

export type AnyFunctionWorkflowDefinition = FunctionWorkflowDefinition<
  JsonValue,
  FunctionWorkflowEvents<JsonValue>,
  JsonValue
>;

export type AnyWorkflowDefinition =
  | AnyStageWorkflowDefinition
  | AnyFunctionWorkflowDefinition;

export type WorkflowDefinition<
  TInput extends JsonValue,
  TSnapshot extends JsonValue = TInput,
  TEvents extends
    FunctionWorkflowEvents<TInput> = EmptyFunctionWorkflowEvents<TInput>,
  TResult extends JsonValue = JsonValue,
> =
  | StageWorkflowDefinition<TSnapshot>
  | FunctionWorkflowDefinition<TInput, TEvents, TResult>;

export type WorkflowInput<TWorkflow extends AnyWorkflowDefinition> =
  TWorkflow extends FunctionWorkflowDefinition<
    infer TInput,
    infer _TEvents,
    infer _TResult
  >
    ? TInput
    : TWorkflow extends StageWorkflowDefinition<infer TSnapshot>
      ? TSnapshot
      : never;

export type WorkflowSnapshot<TWorkflow extends AnyWorkflowDefinition> =
  TWorkflow extends StageWorkflowDefinition<infer TSnapshot>
    ? TSnapshot
    : JsonValue;

/**
 * Workflow instance types
 */
export type WorkflowStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowInstance<TSnapshot extends JsonValue> = {
  id: string;
  workflowName: string;
  version: string;
  status: WorkflowStatus;
  definitionKind?: WorkflowKind;
  currentStage: string;
  snapshot: Snapshot<TSnapshot>;
  input?: JsonValue;
  eventTokens: string[];
  waitMode?: 'any' | 'all';
  waitingStepKey?: string;
  waitTimeoutAt?: string;
  timeoutJobId?: string; // BullMQ job ID for waitFor timeout
  waitTimeoutNext?: string; // Stage to transition to when waitFor timeout fires
  contextData?: Record<string, JsonValue>;
  created: string;
  modified: string;
  lock?: {
    executionId: string;
    leaseExpiresAt: string;
  };
};

/**
 * Event and timer storage types
 */
export type WorkflowEventType =
  | 'started'
  | 'stage_completed'
  | 'sleep_scheduled'
  | 'event_received'
  | 'completed'
  | 'failed'
  | 'function_step_completed'
  | 'function_sleep_scheduled'
  | 'function_sleep_completed'
  | 'function_waiting'
  | 'function_wait_resolved';

export type WorkflowEvent = {
  id: string;
  type: 'workflow_event';
  instanceId: string;
  eventType: WorkflowEventType;
  stageName?: string;
  payload: JsonValue;
  timestamp: string;
};

/**
 * Storage interface
 */
export type WorkflowStorage = {
  getInstance: (
    instanceId: string,
  ) => Promise<WorkflowInstance<JsonValue> | null>;
  saveInstance: (
    instance: WorkflowInstance<JsonValue>,
  ) => Promise<WorkflowInstance<JsonValue>>;
  updateInstance: (
    instanceId: string,
    updates: Partial<WorkflowInstance<JsonValue>>,
    cas?: unknown,
  ) => Promise<WorkflowInstance<JsonValue>>;
  lockInstance: (
    instanceId: string,
    executionId: string,
    leaseDurationMs: number,
  ) => Promise<WorkflowInstance<JsonValue> | null>;
  heartbeatLock: (
    instanceId: string,
    executionId: string,
    leaseDurationMs: number,
  ) => Promise<boolean>;
  unlockInstance: (instanceId: string, executionId: string) => Promise<void>;

  saveEvent: (event: Omit<WorkflowEvent, 'id'>) => Promise<WorkflowEvent>;
  getEvents: (
    instanceId: string,
    eventType?: WorkflowEventType,
  ) => Promise<WorkflowEvent[]>;

  findInstancesByToken: (
    token: string,
  ) => Promise<WorkflowInstance<JsonValue>[]>;
};
