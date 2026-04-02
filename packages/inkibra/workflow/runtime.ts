/**
 * Workflow runtime engine for executing stages and managing workflow state
 */

import type { Logger } from '@inkibra/logger';
import type {
  ConcurrencyLease,
  ConcurrencyScope,
  WorkflowConcurrencyManager,
} from './concurrency';
import type {
  AnyFunctionWorkflowDefinition,
  AnyStageWorkflowDefinition,
  AnyWorkflowDefinition,
  EventsMap,
  FunctionEventsApi,
  FunctionWorkflowDefinition,
  FunctionWorkflowEvents,
  JsonValue,
  RuntimeContext,
  StageResult,
  StageWorkflowDefinition,
  StepApi,
  StepRunOptions,
  StepWaitOptions,
  StepWaitResult,
  WorkflowInstance,
  WorkflowStorage,
} from './types';

export type JobQueue = {
  scheduleExecution: (
    instanceId: string,
    workflowName: string,
    workflowVersion: string,
    delayMs?: number,
  ) => Promise<string>;
  promoteJob: (jobId: string) => Promise<boolean>;
};

export type ConcurrencyLimitConfig = {
  maxActive: number;
};

export type WorkflowRuntimeConcurrencyOptions = {
  manager: WorkflowConcurrencyManager;
  leaseMs?: number;
  retryDelayMs?: number;
  workflows?: Record<string, number | ConcurrencyLimitConfig>;
  resources?: Record<string, number | ConcurrencyLimitConfig>;
};

export type WorkflowRuntimeOptions = {
  concurrency?: WorkflowRuntimeConcurrencyOptions;
  lockLeaseMs?: number;
  lockContentionRetryMinIntervalMs?: number;
};

export type WorkflowEventDispatchResult = {
  matchedInstances: number;
  resumedInstances: number;
  promotedInstances: number;
  scheduledInstances: number;
  failedInstances: number;
};

export type WorkflowExecutionEnsureResult =
  | {
      status: 'scheduled';
      instanceId: string;
      instanceStatus: WorkflowInstance<JsonValue>['status'];
      jobId: string;
    }
  | {
      status: 'promoted';
      instanceId: string;
      instanceStatus: WorkflowInstance<JsonValue>['status'];
      jobId: string;
    }
  | {
      status: 'skipped';
      instanceId: string;
      instanceStatus?: WorkflowInstance<JsonValue>['status'];
      reason:
        | 'instance_not_found'
        | 'workflow_name_mismatch'
        | 'terminal_status';
    };

export type WorkflowRuntime = {
  startWorkflow: {
    <TSnapshot extends JsonValue>(
      workflow: StageWorkflowDefinition<TSnapshot>,
      input: TSnapshot,
      options?: { instanceId?: string },
    ): Promise<WorkflowInstance<TSnapshot>>;
    <
      TInput extends JsonValue,
      TEvents extends FunctionWorkflowEvents<TInput>,
      TResult extends JsonValue,
    >(
      workflow: FunctionWorkflowDefinition<TInput, TEvents, TResult>,
      input: TInput,
      options?: { instanceId?: string },
    ): Promise<WorkflowInstance<JsonValue>>;
  };

  executeWorkflowStage: {
    (workflow: AnyWorkflowDefinition, instanceId: string): Promise<void>;
    <TSnapshot extends JsonValue>(
      workflow: StageWorkflowDefinition<TSnapshot>,
      instanceId: string,
    ): Promise<void>;
    <
      TInput extends JsonValue,
      TEvents extends FunctionWorkflowEvents<TInput>,
      TResult extends JsonValue,
    >(
      workflow: FunctionWorkflowDefinition<TInput, TEvents, TResult>,
      instanceId: string,
    ): Promise<void>;
  };

  emitEvent: (params: {
    workflowName: string;
    eventName: string;
    token: string;
    payload: JsonValue;
  }) => Promise<void>;

  emitEventAndReport?: (params: {
    workflowName: string;
    eventName: string;
    token: string;
    payload: JsonValue;
  }) => Promise<WorkflowEventDispatchResult>;

  ensureWorkflowExecution?: (params: {
    instanceId: string;
    workflowName: string;
    workflowVersion?: string;
  }) => Promise<WorkflowExecutionEnsureResult>;

  listWorkflowInstancesByToken?: (params: {
    workflowName: string;
    token: string;
    statuses?: WorkflowInstance<JsonValue>['status'][];
  }) => Promise<WorkflowInstance<JsonValue>[]>;

  cancelWorkflowInstance?: (params: {
    instanceId: string;
    reason?: string;
  }) => Promise<boolean>;

  getWorkflowInstance?: (
    instanceId: string,
  ) => Promise<WorkflowInstance<JsonValue> | null>;
};

class FunctionExecutionYield extends Error {
  constructor(readonly reason: 'sleep' | 'wait' | 'concurrency') {
    super(`Function workflow yielded: ${reason}`);
  }
}

class WorkflowLeaseLostError extends Error {
  constructor(readonly instanceId: string) {
    super(`Workflow lease lost for instance ${instanceId}`);
  }
}

export function createWorkflowRuntime(
  storage: WorkflowStorage,
  logger: Logger,
  jobQueue: JobQueue,
  options: WorkflowRuntimeOptions = {},
): WorkflowRuntime {
  const runtimeLogger = logger.child({ component: 'workflow-runtime' });
  const concurrencyOptions = options.concurrency;
  const lockLeaseMs = options.lockLeaseMs ?? 30000;
  const lockContentionRetryMinIntervalMs =
    options.lockContentionRetryMinIntervalMs ?? 5000;
  const lockRetryScheduledAtByInstance = new Map<string, number>();

  /**
   * Start a new workflow instance
   */
  async function startWorkflow<TSnapshot extends JsonValue>(
    workflow: StageWorkflowDefinition<TSnapshot>,
    input: TSnapshot,
    options?: { instanceId?: string },
  ): Promise<WorkflowInstance<TSnapshot>>;
  async function startWorkflow<
    TInput extends JsonValue,
    TEvents extends FunctionWorkflowEvents<TInput>,
    TResult extends JsonValue,
  >(
    workflow: FunctionWorkflowDefinition<TInput, TEvents, TResult>,
    input: TInput,
    options?: { instanceId?: string },
  ): Promise<WorkflowInstance<JsonValue>>;
  async function startWorkflow(
    workflow: AnyWorkflowDefinition,
    input: JsonValue,
    options?: { instanceId?: string },
  ): Promise<WorkflowInstance<JsonValue>> {
    const instanceId = options?.instanceId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const definitionKind = workflow.kind;

    const existing = await storage.getInstance(instanceId);
    if (existing) {
      if (existing.workflowName !== workflow.name) {
        throw new Error(
          `Workflow instance id ${instanceId} already belongs to workflow ${existing.workflowName}`,
        );
      }
      // Allow restart of terminal (failed/cancelled) workflow instances by
      // resetting them to a fresh running state with the new input.
      if (existing.status === 'failed' || existing.status === 'cancelled') {
        runtimeLogger.info('Restarting terminal workflow instance', {
          instanceId,
          previousStatus: existing.status,
          workflowName: workflow.name,
        });
        const snapshot: JsonValue = definitionKind === 'stage' ? input : {};
        return await storage.updateInstance(instanceId, {
          status: 'running',
          currentStage: definitionKind === 'stage' ? 'start' : '__function__',
          snapshot,
          input,
          eventTokens: [],
          contextData: {},
          modified: now,
          lock: undefined,
          waitMode: undefined,
          waitingStepKey: undefined,
          waitTimeoutAt: undefined,
          waitTimeoutNext: undefined,
          timeoutJobId: undefined,
        });
      }
      return existing;
    }

    // Create initial instance
    const snapshot: JsonValue = workflow.kind === 'stage' ? input : {};

    const instance: WorkflowInstance<JsonValue> = {
      id: instanceId,
      workflowName: workflow.name,
      version: workflow.version,
      status: 'running',
      definitionKind,
      currentStage: definitionKind === 'stage' ? 'start' : '__function__',
      snapshot,
      input,
      eventTokens: [],
      contextData: {},
      created: now,
      modified: now,
    };

    let savedInstance: WorkflowInstance<JsonValue>;
    try {
      savedInstance = await storage.saveInstance(instance);
    } catch (error) {
      const duplicate = await storage.getInstance(instanceId);
      if (duplicate && duplicate.workflowName === workflow.name) {
        return duplicate;
      }
      throw error;
    }

    // Log start event
    await storage.saveEvent({
      type: 'workflow_event',
      instanceId,
      eventType: 'started',
      payload: { input, definitionKind },
      timestamp: now,
    });

    runtimeLogger.info('Workflow started', {
      instanceId,
      workflowName: workflow.name,
      definitionKind,
    });

    await jobQueue.scheduleExecution(
      instanceId,
      workflow.name,
      workflow.version,
      0,
    );
    runtimeLogger.info('Scheduled first workflow execution', { instanceId });

    return savedInstance;
  }

  /**
   * Execute the current stage/tick of a workflow instance
   * This is called by the worker when a job runs
   */
  async function executeWorkflowStage<TSnapshot extends JsonValue>(
    workflow: StageWorkflowDefinition<TSnapshot>,
    instanceId: string,
  ): Promise<void>;
  async function executeWorkflowStage(
    workflow: AnyWorkflowDefinition,
    instanceId: string,
  ): Promise<void>;
  async function executeWorkflowStage<
    TInput extends JsonValue,
    TEvents extends FunctionWorkflowEvents<TInput>,
    TResult extends JsonValue,
  >(
    workflow: FunctionWorkflowDefinition<TInput, TEvents, TResult>,
    instanceId: string,
  ): Promise<void>;
  async function executeWorkflowStage(
    workflow: AnyWorkflowDefinition,
    instanceId: string,
  ): Promise<void> {
    const instance = await storage.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    if (instance.status === 'completed' || instance.status === 'failed') {
      runtimeLogger.warn('Attempted to execute completed or failed workflow', {
        instanceId,
        status: instance.status,
      });
      return;
    }

    if (instance.status === 'cancelled') {
      runtimeLogger.debug('Skipped execution for cancelled workflow', {
        instanceId,
      });
      return;
    }

    // Try to acquire lock
    const executionId = crypto.randomUUID();
    const locked = await storage.lockInstance(
      instanceId,
      executionId,
      lockLeaseMs,
    );
    if (!locked) {
      const nowMs = Date.now();
      const lastRetryScheduledAt =
        lockRetryScheduledAtByInstance.get(instanceId);
      const withinRetryThrottleWindow =
        typeof lastRetryScheduledAt === 'number' &&
        nowMs - lastRetryScheduledAt < lockContentionRetryMinIntervalMs;

      const contentionLog = withinRetryThrottleWindow
        ? runtimeLogger.debug.bind(runtimeLogger)
        : runtimeLogger.warn.bind(runtimeLogger);

      contentionLog('Failed to acquire lock for workflow execution', {
        instanceId,
        retryThrottleWindowMs: lockContentionRetryMinIntervalMs,
        contentionThrottled: withinRetryThrottleWindow,
      });

      try {
        await scheduleRetryAfterLockContention(workflow, instanceId);
      } catch (error) {
        runtimeLogger.warn('Failed to schedule retry after lock contention', {
          instanceId,
          error,
        });
      }

      return;
    }

    lockRetryScheduledAtByInstance.delete(instanceId);

    let lockLeaseLost = false;
    const assertExecutionLeaseActive = async (): Promise<void> => {
      if (lockLeaseLost) {
        throw new WorkflowLeaseLostError(instanceId);
      }

      const stillOwned = await storage.heartbeatLock(
        instanceId,
        executionId,
        lockLeaseMs,
      );
      if (!stillOwned) {
        lockLeaseLost = true;
        throw new WorkflowLeaseLostError(instanceId);
      }
    };

    const workflowLease = await acquireWorkflowExecutionLease(workflow);
    if (!workflowLease) {
      runtimeLogger.info('Workflow execution deferred by concurrency policy', {
        instanceId,
        workflowName: workflow.name,
      });
      try {
        await scheduleRetry(workflow, instanceId);
      } finally {
        await storage.unlockInstance(instanceId, executionId);
      }
      return;
    }

    const lockHeartbeatMs = Math.max(1000, Math.floor(lockLeaseMs / 3));
    const lockHeartbeat = setInterval(() => {
      void storage
        .heartbeatLock(instanceId, executionId, lockLeaseMs)
        .then((ok) => {
          if (!ok) {
            lockLeaseLost = true;
            runtimeLogger.warn('Failed to heartbeat workflow lock', {
              instanceId,
              executionId,
            });
          }
        })
        .catch((error) => {
          lockLeaseLost = true;
          runtimeLogger.warn('Workflow lock heartbeat errored', {
            instanceId,
            executionId,
            error,
          });
        });
    }, lockHeartbeatMs);

    let workflowLeaseHeartbeat: ReturnType<typeof setInterval> | undefined;
    if (concurrencyOptions && workflowLease.scopes.length > 0) {
      const leaseMs = concurrencyOptions.leaseMs ?? 30000;
      const heartbeatMs = Math.max(1000, Math.floor(leaseMs / 3));
      workflowLeaseHeartbeat = setInterval(() => {
        void workflowLease.heartbeat();
      }, heartbeatMs);
    }

    try {
      await assertExecutionLeaseActive();

      if (workflow.kind === 'function') {
        await executeFunctionWorkflow(
          workflow,
          locked,
          assertExecutionLeaseActive,
        );
      } else {
        await executeStage(workflow, locked, assertExecutionLeaseActive);
      }
    } finally {
      clearInterval(lockHeartbeat);
      if (workflowLeaseHeartbeat) {
        clearInterval(workflowLeaseHeartbeat);
      }
      await workflowLease.release();
      await storage.unlockInstance(instanceId, executionId);
    }
  }

  /**
   * Emit an event to waiting workflows
   */
  async function dispatchEvent(params: {
    workflowName: string;
    eventName: string;
    token: string;
    payload: JsonValue;
  }): Promise<WorkflowEventDispatchResult> {
    const { workflowName, eventName, token, payload } = params;

    // Find workflows waiting for this token
    const instances = await storage.findInstancesByToken(token);

    const result: WorkflowEventDispatchResult = {
      matchedInstances: 0,
      resumedInstances: 0,
      promotedInstances: 0,
      scheduledInstances: 0,
      failedInstances: 0,
    };

    runtimeLogger.info('Emitting event to waiting workflows', {
      workflowName,
      eventName,
      token,
      instanceCount: instances.length,
    });

    // Resume each waiting workflow
    for (const instance of instances) {
      try {
        if (instance.workflowName !== workflowName) {
          continue;
        }

        result.matchedInstances += 1;

        // Record event
        await storage.saveEvent({
          type: 'workflow_event',
          instanceId: instance.id,
          eventType: 'event_received',
          payload: { workflowName, eventName, token, payload },
          timestamp: new Date().toISOString(),
        });

        const hasToken = instance.eventTokens.includes(token);
        if (!hasToken) {
          continue;
        }

        const waitMode = instance.waitMode ?? 'all';
        const updatedTokens =
          waitMode === 'all'
            ? instance.eventTokens.filter((t) => t !== token)
            : [];

        const shouldResume =
          waitMode === 'all' ? updatedTokens.length === 0 : true;

        await storage.updateInstance(instance.id, {
          eventTokens: shouldResume ? [] : updatedTokens,
          status: shouldResume ? 'running' : 'waiting',
          timeoutJobId: shouldResume ? undefined : instance.timeoutJobId,
          waitMode: shouldResume ? undefined : waitMode,
          waitingStepKey: shouldResume ? undefined : instance.waitingStepKey,
          waitTimeoutAt: shouldResume ? undefined : instance.waitTimeoutAt,
          waitTimeoutNext: shouldResume ? undefined : instance.waitTimeoutNext,
        });

        if (shouldResume && instance.definitionKind === 'function') {
          await storage.saveEvent({
            type: 'workflow_event',
            instanceId: instance.id,
            eventType: 'function_wait_resolved',
            payload: {
              stepName: instance.waitingStepKey ?? null,
              token,
              timedOut: false,
            },
            timestamp: new Date().toISOString(),
          });
        }

        // Resume workflow
        if (shouldResume) {
          result.resumedInstances += 1;
          let resumedByPromote = false;
          if (instance.timeoutJobId) {
            try {
              resumedByPromote = await jobQueue.promoteJob(
                instance.timeoutJobId,
              );
            } catch (error) {
              runtimeLogger.warn(
                'Failed to promote timeout job; falling back to immediate schedule',
                {
                  instanceId: instance.id,
                  jobId: instance.timeoutJobId,
                  error,
                },
              );
            }

            if (resumedByPromote) {
              result.promotedInstances += 1;
              runtimeLogger.info('Promoted timeout job to run immediately', {
                instanceId: instance.id,
                jobId: instance.timeoutJobId,
              });
            }
          }

          if (!resumedByPromote) {
            // Timeout job was missing/non-runnable (or absent); schedule immediate execution.
            await jobQueue.scheduleExecution(
              instance.id,
              instance.workflowName,
              instance.version,
              0,
            );
            result.scheduledInstances += 1;
            runtimeLogger.info('Scheduled immediate execution via job queue', {
              instanceId: instance.id,
              timeoutJobId: instance.timeoutJobId,
            });
          }
        }
      } catch (error) {
        result.failedInstances += 1;
        runtimeLogger.error('Failed to process event for instance', {
          instanceId: instance.id,
          error,
        });
      }
    }

    return result;
  }

  async function emitEvent(params: {
    workflowName: string;
    eventName: string;
    token: string;
    payload: JsonValue;
  }): Promise<void> {
    await dispatchEvent(params);
  }

  async function emitEventAndReport(params: {
    workflowName: string;
    eventName: string;
    token: string;
    payload: JsonValue;
  }): Promise<WorkflowEventDispatchResult> {
    return dispatchEvent(params);
  }

  async function ensureWorkflowExecution(params: {
    instanceId: string;
    workflowName: string;
    workflowVersion?: string;
  }): Promise<WorkflowExecutionEnsureResult> {
    const { instanceId, workflowName, workflowVersion } = params;
    const instance = await storage.getInstance(instanceId);

    if (!instance) {
      return {
        status: 'skipped',
        instanceId,
        reason: 'instance_not_found',
      };
    }

    if (instance.workflowName !== workflowName) {
      return {
        status: 'skipped',
        instanceId,
        instanceStatus: instance.status,
        reason: 'workflow_name_mismatch',
      };
    }

    if (
      instance.status === 'completed' ||
      instance.status === 'failed' ||
      instance.status === 'cancelled'
    ) {
      return {
        status: 'skipped',
        instanceId,
        instanceStatus: instance.status,
        reason: 'terminal_status',
      };
    }

    if (instance.status === 'waiting' && instance.timeoutJobId) {
      try {
        const promoted = await jobQueue.promoteJob(instance.timeoutJobId);
        if (promoted) {
          return {
            status: 'promoted',
            instanceId,
            instanceStatus: instance.status,
            jobId: instance.timeoutJobId,
          };
        }
      } catch (error) {
        runtimeLogger.warn(
          'Failed to promote timeout job while ensuring workflow execution',
          {
            instanceId,
            jobId: instance.timeoutJobId,
            error,
          },
        );
      }
    }

    const jobId = await jobQueue.scheduleExecution(
      instance.id,
      instance.workflowName,
      workflowVersion ?? instance.version,
      0,
    );

    return {
      status: 'scheduled',
      instanceId,
      instanceStatus: instance.status,
      jobId,
    };
  }

  async function getWorkflowInstance(
    instanceId: string,
  ): Promise<WorkflowInstance<JsonValue> | null> {
    const instance = await storage.getInstance(instanceId);
    if (!instance) {
      return null;
    }
    return instance;
  }

  async function listWorkflowInstancesByToken(params: {
    workflowName: string;
    token: string;
    statuses?: WorkflowInstance<JsonValue>['status'][];
  }): Promise<WorkflowInstance<JsonValue>[]> {
    const instances = await storage.findInstancesByToken(params.token);
    const statuses = params.statuses;

    return instances.filter((instance) => {
      if (instance.workflowName !== params.workflowName) {
        return false;
      }

      if (!statuses || statuses.length === 0) {
        return true;
      }

      return statuses.includes(instance.status);
    });
  }

  async function cancelWorkflowInstance(params: {
    instanceId: string;
    reason?: string;
  }): Promise<boolean> {
    const instance = await storage.getInstance(params.instanceId);
    if (!instance) {
      return false;
    }

    if (
      instance.status === 'completed' ||
      instance.status === 'failed' ||
      instance.status === 'cancelled'
    ) {
      return false;
    }

    await storage.updateInstance(params.instanceId, {
      status: 'cancelled',
      eventTokens: [],
      waitMode: undefined,
      waitingStepKey: undefined,
      waitTimeoutAt: undefined,
      waitTimeoutNext: undefined,
      timeoutJobId: undefined,
      lock: undefined,
      modified: new Date().toISOString(),
    });

    runtimeLogger.info('Cancelled workflow instance', {
      instanceId: params.instanceId,
      workflowName: instance.workflowName,
      reason: params.reason,
    });

    return true;
  }

  /**
   * Execute a stage-based workflow stage
   */
  async function executeStage(
    workflow: AnyStageWorkflowDefinition,
    instance: WorkflowInstance<JsonValue>,
    assertLeaseActive?: () => Promise<void>,
  ): Promise<void> {
    const { id: instanceId, currentStage, snapshot } = instance;

    const saveEvent = async (
      event: Omit<Parameters<typeof storage.saveEvent>[0], 'id'>,
    ) => {
      if (assertLeaseActive) {
        await assertLeaseActive();
      }

      return storage.saveEvent(event);
    };

    const updateInstance = async (
      updates: Partial<WorkflowInstance<JsonValue>>,
    ): Promise<WorkflowInstance<JsonValue>> => {
      if (assertLeaseActive) {
        await assertLeaseActive();
      }

      return storage.updateInstance(instanceId, updates);
    };

    const stageLogger = runtimeLogger.child({
      component: 'workflow-stage',
      instanceId,
      stageName: currentStage,
    });

    const stageDefinition = workflow.stages[currentStage];
    if (!stageDefinition) {
      throw new Error(
        `Stage ${currentStage} not found in workflow ${workflow.name}`,
      );
    }

    stageLogger.info('Executing stage');

    const contextData: Record<string, JsonValue> = {
      ...(instance.contextData ?? {}),
    };
    let contextDirty = false;

    const receivedEvents = await storage.getEvents(
      instanceId,
      'event_received',
    );
    const stageEventsByName = new Map<
      string,
      Array<{ timestamp: string; payload: JsonValue }>
    >();

    for (const event of receivedEvents) {
      const payload = asObject(event.payload);
      const eventName = payload?.eventName;
      if (typeof eventName !== 'string') {
        continue;
      }

      const eventPayload = payload?.payload;
      if (eventPayload === undefined) {
        continue;
      }

      const existing = stageEventsByName.get(eventName) ?? [];
      existing.push({ timestamp: event.timestamp, payload: eventPayload });
      stageEventsByName.set(eventName, existing);
    }

    // Build runtime context
    const events: EventsMap<JsonValue> = {};
    for (const [eventName, eventDef] of Object.entries(workflow.events)) {
      events[eventName] = {
        capture: eventDef.capture,
        emit: async (emitParams: { payload: JsonValue; token?: string }) => {
          const token = emitParams.token ?? eventDef.capture(snapshot);
          await emitEvent({
            workflowName: workflow.name,
            eventName,
            token,
            payload: emitParams.payload,
          });
        },
        received: () => {
          return stageEventsByName.get(eventName) ?? [];
        },
      };
    }

    const runtime: RuntimeContext<JsonValue> = {
      events,
      storage: {
        get: async (key: string) => {
          return contextData[key];
        },
        set: async (key: string, value: JsonValue) => {
          contextData[key] = value;
          contextDirty = true;
        },
      },
      trace: {
        add: (event: { type: string; data: JsonValue }) => {
          stageLogger.debug('Trace event', { event });
        },
      },
      effects: {
        now: () => new Date().toISOString(),
        randomUUID: () => crypto.randomUUID(),
        workflowInstanceId: () => instanceId,
        assertLeaseActive,
      },
    };

    // Check if this is a timeout-triggered re-execution of a waiting stage.
    // Mirror the function-workflow timeout guard at lines 1131-1160.
    if (
      instance.status === 'waiting' &&
      instance.waitTimeoutAt &&
      instance.waitTimeoutNext &&
      Date.now() >= new Date(instance.waitTimeoutAt).getTime()
    ) {
      stageLogger.info('Wait timeout expired, transitioning to timeout stage', {
        timeoutNext: instance.waitTimeoutNext,
      });

      await saveEvent({
        type: 'workflow_event',
        instanceId,
        eventType: 'stage_completed',
        stageName: currentStage,
        payload: { timedOut: true, next: instance.waitTimeoutNext },
        timestamp: new Date().toISOString(),
      });

      await updateInstance({
        status: 'running',
        currentStage: instance.waitTimeoutNext,
        eventTokens: [],
        waitMode: undefined,
        waitTimeoutAt: undefined,
        waitTimeoutNext: undefined,
        timeoutJobId: undefined,
        contextData,
        modified: new Date().toISOString(),
      });

      await jobQueue.scheduleExecution(
        instanceId,
        workflow.name,
        workflow.version,
        0,
      );
      return;
    }

    // Execute stage
    let result: StageResult<JsonValue>;
    try {
      result = await stageDefinition.execute(snapshot, runtime);
    } catch (error) {
      stageLogger.error('Stage execution failed', { error });

      // Mark as failed
      await updateInstance({
        status: 'failed',
        contextData,
        modified: new Date().toISOString(),
      });

      await saveEvent({
        type: 'workflow_event',
        instanceId,
        eventType: 'failed',
        stageName: currentStage,
        payload: { error: String(error) },
        timestamp: new Date().toISOString(),
      });

      throw error;
    }

    // Handle result
    if (assertLeaseActive) {
      await assertLeaseActive();
    }

    await handleStageResult(
      workflow,
      instance,
      result,
      contextDirty ? contextData : (instance.contextData ?? {}),
      assertLeaseActive,
    );
  }

  /**
   * Execute a function-style workflow tick with durable step replay.
   */
  async function executeFunctionWorkflow(
    workflow: AnyFunctionWorkflowDefinition,
    instance: WorkflowInstance<JsonValue>,
    assertLeaseActive?: () => Promise<void>,
  ): Promise<void> {
    const { id: instanceId } = instance;
    const stageLogger = runtimeLogger.child({
      component: 'workflow-function',
      instanceId,
      workflowName: workflow.name,
      mode: 'function',
    });

    const history = await storage.getEvents(instanceId);

    const saveEvent = async (
      event: Omit<Parameters<typeof storage.saveEvent>[0], 'id'>,
    ) => {
      if (assertLeaseActive) {
        await assertLeaseActive();
      }

      return storage.saveEvent(event);
    };

    const updateInstance = async (
      updates: Partial<WorkflowInstance<JsonValue>>,
    ): Promise<WorkflowInstance<JsonValue>> => {
      if (assertLeaseActive) {
        await assertLeaseActive();
      }

      return storage.updateInstance(instanceId, updates);
    };
    const completedSteps = new Map<string, JsonValue>();
    const completedSleeps = new Set<string>();
    const sleepSchedule = new Map<string, { dueAt: string }>();
    const resolvedWaits = new Map<string, StepWaitResult>();

    for (const event of history) {
      const payload = asObject(event.payload);
      if (!payload) {
        continue;
      }

      if (event.eventType === 'function_step_completed') {
        if (typeof payload.stepName === 'string') {
          if (payload.result !== undefined) {
            completedSteps.set(payload.stepName, payload.result);
          }
        }
        continue;
      }

      if (event.eventType === 'function_sleep_scheduled') {
        if (
          typeof payload.stepName === 'string' &&
          typeof payload.dueAt === 'string'
        ) {
          sleepSchedule.set(payload.stepName, { dueAt: payload.dueAt });
        }
        continue;
      }

      if (event.eventType === 'function_sleep_completed') {
        if (typeof payload.stepName === 'string') {
          completedSleeps.add(payload.stepName);
        }
        continue;
      }

      if (event.eventType === 'function_wait_resolved') {
        if (typeof payload.stepName === 'string') {
          resolvedWaits.set(payload.stepName, {
            timedOut: payload.timedOut === true,
            token:
              typeof payload.token === 'string' ? payload.token : undefined,
          });
        }
      }
    }

    let mutableInstance = instance;

    const step: StepApi = {
      run: async <TResult extends JsonValue>(
        options: StepRunOptions,
        fn: () => Promise<TResult>,
      ): Promise<TResult> => {
        const { name, resource } = options;

        if (completedSteps.has(name)) {
          return completedSteps.get(name) as TResult;
        }

        let resourceLease: ConcurrencyLease | null = null;
        if (resource) {
          resourceLease = await acquireResourceExecutionLease(
            resource,
            options.maxActive,
          );
          if (!resourceLease) {
            await scheduleRetry(workflow, instanceId);
            throw new FunctionExecutionYield('concurrency');
          }
        }

        try {
          const result = await fn();

          await saveEvent({
            type: 'workflow_event',
            instanceId,
            eventType: 'function_step_completed',
            payload: { stepName: name, result },
            timestamp: new Date().toISOString(),
          });

          completedSteps.set(name, result);
          return result;
        } finally {
          if (resourceLease) {
            await resourceLease.release();
          }
        }
      },

      sleep: async (name: string, duration: string | number): Promise<void> => {
        if (completedSleeps.has(name)) {
          return;
        }

        const scheduled = sleepSchedule.get(name);

        if (!scheduled) {
          const durationMs =
            typeof duration === 'number' ? duration : parseDuration(duration);
          const dueAt = new Date(Date.now() + durationMs).toISOString();

          let timeoutJobId: string | undefined;
          timeoutJobId = await jobQueue.scheduleExecution(
            instanceId,
            workflow.name,
            workflow.version,
            durationMs,
          );

          mutableInstance = await updateInstance({
            status: 'waiting',
            waitMode: 'all',
            waitingStepKey: name,
            waitTimeoutAt: dueAt,
            timeoutJobId,
            eventTokens: [],
          });

          await saveEvent({
            type: 'workflow_event',
            instanceId,
            eventType: 'function_sleep_scheduled',
            payload: { stepName: name, dueAt, duration },
            timestamp: new Date().toISOString(),
          });

          throw new FunctionExecutionYield('sleep');
        }

        if (Date.now() < new Date(scheduled.dueAt).getTime()) {
          throw new FunctionExecutionYield('sleep');
        }

        await saveEvent({
          type: 'workflow_event',
          instanceId,
          eventType: 'function_sleep_completed',
          payload: { stepName: name },
          timestamp: new Date().toISOString(),
        });

        mutableInstance = await updateInstance({
          status: 'running',
          waitMode: undefined,
          waitingStepKey: undefined,
          waitTimeoutAt: undefined,
          timeoutJobId: undefined,
          eventTokens: [],
        });

        completedSleeps.add(name);
      },

      waitForAny: async (options: StepWaitOptions): Promise<StepWaitResult> => {
        return waitForTokens('any', options);
      },

      waitForAll: async (options: StepWaitOptions): Promise<StepWaitResult> => {
        return waitForTokens('all', options);
      },
    };

    const waitForTokens = async (
      mode: 'any' | 'all',
      options: StepWaitOptions,
    ): Promise<StepWaitResult> => {
      const { name, tokens, timeout } = options;

      if (resolvedWaits.has(name)) {
        return resolvedWaits.get(name) as StepWaitResult;
      }

      if (
        mutableInstance.status === 'waiting' &&
        mutableInstance.waitingStepKey &&
        mutableInstance.waitingStepKey !== name
      ) {
        throw new Error(
          `Workflow is currently waiting on ${mutableInstance.waitingStepKey}, but replay requested ${name}`,
        );
      }

      if (
        mutableInstance.status === 'waiting' &&
        mutableInstance.waitingStepKey === name
      ) {
        const timedOut =
          mutableInstance.waitTimeoutAt !== undefined &&
          Date.now() >= new Date(mutableInstance.waitTimeoutAt).getTime() &&
          mutableInstance.eventTokens.length > 0;

        if (timedOut) {
          const waitResult: StepWaitResult = { timedOut: true };

          await saveEvent({
            type: 'workflow_event',
            instanceId,
            eventType: 'function_wait_resolved',
            payload: { stepName: name, timedOut: true },
            timestamp: new Date().toISOString(),
          });

          mutableInstance = await updateInstance({
            status: 'running',
            eventTokens: [],
            waitMode: undefined,
            waitingStepKey: undefined,
            waitTimeoutAt: undefined,
            timeoutJobId: undefined,
          });

          resolvedWaits.set(name, waitResult);
          return waitResult;
        }

        throw new FunctionExecutionYield('wait');
      }

      let timeoutJobId: string | undefined;
      let waitTimeoutAt: string | undefined;

      if (timeout !== undefined) {
        const timeoutMs =
          typeof timeout === 'number' ? timeout : parseDuration(timeout);
        waitTimeoutAt = new Date(Date.now() + timeoutMs).toISOString();

        timeoutJobId = await jobQueue.scheduleExecution(
          instanceId,
          workflow.name,
          workflow.version,
          timeoutMs,
        );
      }

      mutableInstance = await updateInstance({
        status: 'waiting',
        eventTokens: tokens,
        waitMode: mode,
        waitingStepKey: name,
        waitTimeoutAt,
        timeoutJobId,
      });

      await saveEvent({
        type: 'workflow_event',
        instanceId,
        eventType: 'function_waiting',
        payload: {
          stepName: name,
          mode,
          tokens,
          timeout: waitTimeoutAt ?? null,
        },
        timestamp: new Date().toISOString(),
      });

      throw new FunctionExecutionYield('wait');
    };

    const functionEvents = workflow.events;
    const events: FunctionEventsApi<
      JsonValue,
      FunctionWorkflowEvents<JsonValue>
    > = {};

    if (functionEvents) {
      for (const eventName in functionEvents) {
        const capture = functionEvents[eventName];
        if (!capture) {
          continue;
        }

        const name = eventName;
        events[eventName] = {
          token: (snapshot: JsonValue) => capture(snapshot),
          emit: async ({ token, payload }) => {
            await emitEvent({
              workflowName: workflow.name,
              eventName: name,
              token,
              payload,
            });
          },
        };
      }
    }

    try {
      const inputSource = mutableInstance.input ?? mutableInstance.snapshot;
      if (inputSource === undefined) {
        throw new Error('Function workflow input is missing');
      }

      const input = inputSource;
      const result = await workflow.handler({
        input,
        step,
        events,
      });

      await updateInstance({
        status: 'completed',
        snapshot: result,
        eventTokens: [],
        waitMode: undefined,
        waitingStepKey: undefined,
        waitTimeoutAt: undefined,
        timeoutJobId: undefined,
      });

      await saveEvent({
        type: 'workflow_event',
        instanceId,
        eventType: 'completed',
        payload: result,
        timestamp: new Date().toISOString(),
      });

      stageLogger.info('Function workflow completed');
    } catch (error) {
      if (error instanceof FunctionExecutionYield) {
        stageLogger.debug('Function workflow yielded', {
          reason: error.reason,
        });
        return;
      }

      await updateInstance({
        status: 'failed',
      });

      await saveEvent({
        type: 'workflow_event',
        instanceId,
        eventType: 'failed',
        payload: { error: String(error) },
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  }

  /**
   * Handle the result of a stage execution
   */
  async function handleStageResult(
    workflow: AnyStageWorkflowDefinition,
    instance: WorkflowInstance<JsonValue>,
    result: StageResult<JsonValue>,
    contextData: Record<string, JsonValue>,
    assertLeaseActive?: () => Promise<void>,
  ): Promise<void> {
    const { id: instanceId } = instance;
    const now = new Date().toISOString();

    const saveEvent = async (
      event: Omit<Parameters<typeof storage.saveEvent>[0], 'id'>,
    ) => {
      if (assertLeaseActive) {
        await assertLeaseActive();
      }

      return storage.saveEvent(event);
    };

    const updateInstance = async (
      updates: Partial<WorkflowInstance<JsonValue>>,
    ): Promise<WorkflowInstance<JsonValue>> => {
      if (assertLeaseActive) {
        await assertLeaseActive();
      }

      return storage.updateInstance(instanceId, updates);
    };

    if (!('type' in result)) {
      await updateInstance({
        currentStage: result.next,
        snapshot: result.snapshot,
        contextData,
        modified: now,
      });

      await saveEvent({
        type: 'workflow_event',
        instanceId,
        eventType: 'stage_completed',
        stageName: result.next,
        payload: result.snapshot,
        timestamp: now,
      });

      await jobQueue.scheduleExecution(
        instanceId,
        workflow.name,
        workflow.version,
        0,
      );
      return;
    }

    switch (result.type) {
      case 'complete': {
        await updateInstance({
          status: 'completed',
          contextData,
          modified: now,
        });

        await saveEvent({
          type: 'workflow_event',
          instanceId,
          eventType: 'completed',
          payload: result.result,
          timestamp: now,
        });

        runtimeLogger.info('Workflow completed', { instanceId });
        return;
      }

      case 'failure': {
        await updateInstance({
          status: 'failed',
          contextData,
          modified: now,
        });

        await saveEvent({
          type: 'workflow_event',
          instanceId,
          eventType: 'failed',
          payload: {
            reason: result.reason,
            data: result.data ?? null,
          },
          timestamp: now,
        });

        runtimeLogger.info('Workflow failed', {
          instanceId,
          reason: result.reason,
        });
        return;
      }

      case 'sleep': {
        const durationMs =
          typeof result.duration === 'number'
            ? result.duration
            : parseDuration(result.duration);

        const dueAt = new Date(Date.now() + durationMs).toISOString();

        await updateInstance({
          currentStage: result.next,
          snapshot: result.snapshot,
          contextData,
          modified: now,
        });

        await saveEvent({
          type: 'workflow_event',
          instanceId,
          eventType: 'sleep_scheduled',
          stageName: result.next,
          payload: { dueAt, duration: result.duration },
          timestamp: now,
        });

        await jobQueue.scheduleExecution(
          instanceId,
          workflow.name,
          workflow.version,
          durationMs,
        );
        runtimeLogger.info('Sleep scheduled via job queue', {
          instanceId,
          dueAt,
          delayMs: durationMs,
        });
        return;
      }

      case 'waitFor': {
        let timeoutJobId: string | undefined;
        let waitTimeoutAt: string | undefined;

        if (result.timeout) {
          const durationMs =
            typeof result.timeout.duration === 'number'
              ? result.timeout.duration
              : parseDuration(result.timeout.duration);

          waitTimeoutAt = new Date(Date.now() + durationMs).toISOString();

          timeoutJobId = await jobQueue.scheduleExecution(
            instanceId,
            workflow.name,
            workflow.version,
            durationMs,
          );
          runtimeLogger.info('Timeout scheduled via job queue', {
            instanceId,
            dueAt: waitTimeoutAt,
            delayMs: durationMs,
            timeoutJobId,
          });
        }

        await updateInstance({
          status: 'waiting',
          eventTokens: result.tokens,
          waitMode: result.mode,
          waitTimeoutAt,
          waitTimeoutNext: result.timeout?.next,
          snapshot: result.snapshot,
          contextData,
          timeoutJobId,
          modified: now,
        });

        runtimeLogger.info('Waiting for events', {
          instanceId,
          tokens: result.tokens,
          mode: result.mode,
        });
        return;
      }
    }
  }

  async function scheduleRetry(
    workflow: { name: string; version: string },
    instanceId: string,
    delayMs?: number,
  ): Promise<void> {
    const retryDelayMs = delayMs ?? concurrencyOptions?.retryDelayMs ?? 1000;

    await jobQueue.scheduleExecution(
      instanceId,
      workflow.name,
      workflow.version,
      retryDelayMs,
    );
  }

  async function scheduleRetryAfterLockContention(
    workflow: { name: string; version: string },
    instanceId: string,
  ): Promise<void> {
    const now = Date.now();
    const lastScheduledAt = lockRetryScheduledAtByInstance.get(instanceId);

    if (
      typeof lastScheduledAt === 'number' &&
      now - lastScheduledAt < lockContentionRetryMinIntervalMs
    ) {
      runtimeLogger.debug(
        'Skipped lock contention retry; retry already pending',
        {
          instanceId,
          minIntervalMs: lockContentionRetryMinIntervalMs,
          elapsedMs: now - lastScheduledAt,
        },
      );
      return;
    }

    await scheduleRetry(workflow, instanceId);
    lockRetryScheduledAtByInstance.set(instanceId, now);
  }

  async function acquireWorkflowExecutionLease(workflow: {
    name: string;
  }): Promise<ConcurrencyLease | null> {
    if (!concurrencyOptions) {
      return createNoopLease();
    }

    const maxActive = resolveMaxActive(
      concurrencyOptions.workflows?.[workflow.name],
      undefined,
    );

    if (!maxActive || maxActive <= 0) {
      return createNoopLease();
    }

    const scopes: ConcurrencyScope[] = [
      {
        kind: 'workflow',
        key: workflow.name,
        maxActive,
      },
    ];

    return concurrencyOptions.manager.acquire(
      scopes,
      concurrencyOptions.leaseMs ?? 30000,
    );
  }

  async function acquireResourceExecutionLease(
    resource: string,
    defaultMaxActive: number | undefined,
  ): Promise<ConcurrencyLease | null> {
    if (!concurrencyOptions) {
      return createNoopLease();
    }

    const maxActive = resolveMaxActive(
      concurrencyOptions.resources?.[resource],
      defaultMaxActive,
    );

    if (!maxActive || maxActive <= 0) {
      return createNoopLease();
    }

    const scopes: ConcurrencyScope[] = [
      {
        kind: 'resource',
        key: resource,
        maxActive,
      },
    ];

    return concurrencyOptions.manager.acquire(
      scopes,
      concurrencyOptions.leaseMs ?? 30000,
    );
  }

  return {
    startWorkflow,
    executeWorkflowStage,
    emitEvent,
    emitEventAndReport,
    ensureWorkflowExecution,
    listWorkflowInstancesByToken,
    cancelWorkflowInstance,
    getWorkflowInstance,
  };
}

function asObject(
  value: JsonValue,
): Record<string, JsonValue | undefined> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, JsonValue | undefined>;
}

function createNoopLease(): ConcurrencyLease {
  return {
    scopes: [],
    heartbeat: async () => {},
    release: async () => {},
  };
}

function resolveMaxActive(
  configured: number | ConcurrencyLimitConfig | undefined,
  fallback: number | undefined,
): number | undefined {
  if (typeof configured === 'number') {
    return configured;
  }

  if (configured && typeof configured.maxActive === 'number') {
    return configured.maxActive;
  }

  return fallback;
}

/**
 * Parse duration string to milliseconds.
 * Supports "7 days", "2 hours", "30 minutes", or numeric strings.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(day|hour|minute|second)s?$/i);
  if (match) {
    const value = Number.parseInt(match[1] ?? '0', 10);
    const unit = match[2]?.toLowerCase();

    switch (unit) {
      case 'day':
        return value * 24 * 60 * 60 * 1000;
      case 'hour':
        return value * 60 * 60 * 1000;
      case 'minute':
        return value * 60 * 1000;
      case 'second':
        return value * 1000;
    }
  }

  return Number.parseInt(duration, 10);
}
