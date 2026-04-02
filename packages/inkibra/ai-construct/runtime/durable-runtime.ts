import {
  createRedisActorCheckpointStore,
  createRedisActorLeaseStore,
} from '@inkibra/actor';
import type { Driver, EnsureCollectionOptions } from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import {
  createMailboxClient,
  type MailboxCursorStore,
  type MailboxState,
  type MailboxStateStore,
} from '@inkibra/mailbox';
import type { StreamsClient } from '@inkibra/streams';
import {
  createWorkflowSystem,
  DalWorkflowStorage,
  type WorkflowRuntimeOptions,
} from '@inkibra/workflow';
import type Redis from 'ioredis';
import type { Construct } from '../construct/construct';
import type { ConstructConfig, ConstructEvent } from '../construct/types';
import type { SystemEventNameFromProfile } from '../impulse/keys';
import {
  computeNextReminderFireAt,
  loadPerceptionScheduleState,
} from '../scheduler/perception-schedule';
import {
  DEFAULT_HEARTBEAT_SHAPE,
  type PerceptionSchedulerConfig,
} from '../scheduler/perception-scheduler';
import {
  createConstructSchedulerEventToken,
  createConstructSchedulerWorkflow,
  createConstructSchedulerWorkflowInstanceId,
} from '../scheduler/workflow';
import { loadHeartbeatMeta, updateHeartbeatMeta } from '../vfs/heartbeat';
import { saveReminder } from '../vfs/reminders';
import { createActorRuntime } from './actor-runtime';
import { createScopedConstructMailboxKeyStrategy } from './keys';
import { buildHeartbeatSystemEventOp, buildSelfReminderOp } from './ops';
import type {
  ConstructActivityConfig,
  ConstructMailboxKeyContext,
  ConstructMailboxKeyStrategy,
  ConstructResponseLifecycleConfig,
  ConstructSourceFactConfig,
  DurableConstructRuntime,
} from './types';

const DEFAULT_NAMESPACE = 'construct-runtime';
const DEFAULT_MAILBOX_STREAM_PREFIX = 'construct-runtime-mailbox';
const DEFAULT_INGRESS_COMMIT_TIMEOUT_MS = 45_000;
const DEFAULT_INGRESS_COMMIT_POLL_MS = 50;
const DEFAULT_INGRESS_COMMIT_BUSY_EXTENSION_MS = 180_000;
const DEFAULT_MIN_HEARTBEAT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_INACTIVITY_STOP_DAYS = 30;

type RedisMailboxStores = {
  cursorStore: MailboxCursorStore;
  stateStore: MailboxStateStore;
  metaRedis: Redis | null;
};

type ConstructSchedulerService = {
  ensureStarted: (constructId: string) => Promise<void>;
  notifyScheduleUpdated: (
    constructId: string,
    reason?: string,
  ) => Promise<void>;
};

type NormalizedSchedulerConfig = {
  intervalMs: number;
  minHeartbeatMs: number;
  maxHeartbeatMs: number;
  inactivityStopDays: number;
  heartbeatShape: NonNullable<PerceptionSchedulerConfig['heartbeatShape']>;
  maxActiveReminders: number;
  shouldPause?: () => boolean | Promise<boolean>;
};

export type CreateDurableConstructRuntimeOptions<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
> = {
  logger: Logger;
  driver: Driver;
  redis: Redis;
  streams: StreamsClient;
  createConfig: (
    constructId: string,
  ) => Promise<
    ConstructConfig<TImpulseProfileName, TImpulsePoolName, TLaneName>
  >;
  activity?: ConstructActivityConfig;
  sourceFacts?: ConstructSourceFactConfig;
  responses?: ConstructResponseLifecycleConfig;
  onConstructOpened?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
  onConstructClosed?: (
    constructId: string,
    construct: Construct<TImpulseProfileName, TImpulsePoolName, TLaneName>,
  ) => Promise<void> | void;
  onFrontierAdvanced?: (args: {
    constructId: string;
    processedCursor?: string;
    committedCursor?: string;
    phase: 'prepared' | 'committed';
  }) => Promise<void> | void;
  ingress?: {
    commitTimeoutMs?: number;
    pollMs?: number;
    busyExtensionMs?: number;
  };
  durable?: {
    namespace?: string;
    mailboxStreamPrefix?: string;
    keyStrategy?: ConstructMailboxKeyStrategy;
    keyContext?: Omit<ConstructMailboxKeyContext, 'constructId'>;
    actor?: {
      maxResidentConstructs?: number;
      idleTtlMs?: number;
      leaseMs?: number;
      pollIntervalMs?: number;
      wakeRetryMs?: number;
    };
    workflow?: {
      queueName?: string;
      workerConcurrency?: number;
      executeJobName?: string;
      startJobName?: string;
      startWorker?: boolean;
      runtimeOptions?: WorkflowRuntimeOptions;
      ensureCollectionOptions?: EnsureCollectionOptions;
    };
  };
  scheduler?: {
    enabled?: boolean;
    config?: Partial<PerceptionSchedulerConfig>;
  };
};

export async function createDurableConstructRuntime<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
>(
  options: CreateDurableConstructRuntimeOptions<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName
  >,
): Promise<
  DurableConstructRuntime<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >
> {
  const runtimeLogger = options.logger.child({
    component: 'construct-durable-runtime',
  });
  const namespace = options.durable?.namespace ?? DEFAULT_NAMESPACE;
  const mailboxStreamPrefix =
    options.durable?.mailboxStreamPrefix ?? DEFAULT_MAILBOX_STREAM_PREFIX;
  const keyStrategy =
    options.durable?.keyStrategy ??
    createScopedConstructMailboxKeyStrategy({ fallbackNamespace: namespace });
  const keyContext = options.durable?.keyContext ?? { namespace };
  const stores = createRedisMailboxStores(options.redis, namespace);
  const mailbox = createMailboxClient({
    streams: options.streams,
    cursorStore: stores.cursorStore,
    stateStore: stores.stateStore,
    streamPrefix: mailboxStreamPrefix,
    quietPeriodMs: 500,
  });

  const workflowStorage = new DalWorkflowStorage(
    options.driver,
    runtimeLogger,
    {
      ensureCollectionOptions:
        options.durable?.workflow?.ensureCollectionOptions,
    },
  );
  await workflowStorage.initialize();
  const workflowRedis =
    typeof options.redis.duplicate === 'function'
      ? options.redis.duplicate({
          maxRetriesPerRequest: null,
          keyPrefix: undefined,
        } as Parameters<typeof options.redis.duplicate>[0])
      : options.redis;
  const workflowSystem = await createWorkflowSystem({
    storage: workflowStorage,
    logger: runtimeLogger,
    redis: workflowRedis,
    queueName:
      options.durable?.workflow?.queueName ?? `${namespace}-workflow-jobs`,
    workerConcurrency: options.durable?.workflow?.workerConcurrency,
    executeJobName: options.durable?.workflow?.executeJobName,
    startJobName: options.durable?.workflow?.startJobName,
    startWorker: options.durable?.workflow?.startWorker,
    runtimeOptions: options.durable?.workflow?.runtimeOptions,
  });

  const normalizedSchedulerConfig = normalizeSchedulerConfig(
    options.scheduler?.config,
  );
  const schedulerEnabled = options.scheduler?.enabled ?? true;
  let schedulerService: ConstructSchedulerService | undefined;
  const attachedSchedulerListeners = new WeakSet<Construct>();

  const runtime = createActorRuntime<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >({
    logger: runtimeLogger,
    createConfig: options.createConfig,
    activity: options.activity,
    sourceFacts: options.sourceFacts,
    responses: options.responses,
    onFrontierAdvanced: options.onFrontierAdvanced,
    durable: {
      mailbox,
      actor: {
        leaseStore: createRedisActorLeaseStore(options.redis, {
          prefix: `${namespace}:construct-actor`,
        }),
        checkpointStore: createRedisActorCheckpointStore(options.redis, {
          prefix: `${namespace}:construct-actor`,
        }),
        maxResidentConstructs: options.durable?.actor?.maxResidentConstructs,
        idleTtlMs: options.durable?.actor?.idleTtlMs,
        leaseMs: options.durable?.actor?.leaseMs,
        pollIntervalMs: options.durable?.actor?.pollIntervalMs,
        wakeRetryMs: options.durable?.actor?.wakeRetryMs,
      },
      keyStrategy,
      keyContext,
    },
    ingress: {
      commitTimeoutMs:
        options.ingress?.commitTimeoutMs ?? DEFAULT_INGRESS_COMMIT_TIMEOUT_MS,
      pollMs: options.ingress?.pollMs ?? DEFAULT_INGRESS_COMMIT_POLL_MS,
      busyExtensionMs:
        options.ingress?.busyExtensionMs ??
        DEFAULT_INGRESS_COMMIT_BUSY_EXTENSION_MS,
    },
    onConstructOpened: async (constructId, construct) => {
      if (schedulerEnabled && schedulerService) {
        await schedulerService.ensureStarted(constructId);
        await schedulerService.notifyScheduleUpdated(
          constructId,
          'construct-opened',
        );
        attachConstructSchedulerListener({
          constructId,
          construct,
          attached: attachedSchedulerListeners,
          onScheduleChanged: (reason) =>
            schedulerService?.notifyScheduleUpdated(constructId, reason) ??
            Promise.resolve(),
        });
      }
      if (options.onConstructOpened) {
        await options.onConstructOpened(constructId, construct);
      }
    },
    onConstructClosed: options.onConstructClosed,
  });

  if (schedulerEnabled) {
    schedulerService = createConstructSchedulerService({
      logger: runtimeLogger,
      workflowRuntime: workflowSystem.runtime,
      runtime,
      schedulerConfig: normalizedSchedulerConfig,
    });
  }

  return {
    ...runtime,
    notifyScheduleUpdated: schedulerService
      ? (constructId: string, reason?: string) =>
          schedulerService!.notifyScheduleUpdated(constructId, reason)
      : undefined,
    shutdown: async () => {
      await runtime.shutdown();
      await workflowSystem.stop();
      if (
        workflowRedis !== options.redis &&
        typeof workflowRedis.quit === 'function'
      ) {
        await workflowRedis.quit();
      }
      if (stores.metaRedis && typeof stores.metaRedis.quit === 'function') {
        await stores.metaRedis.quit();
      }
    },
  };
}

function createRedisMailboxStores(
  redis: Redis,
  keyPrefix: string,
): RedisMailboxStores {
  const metaRedis =
    typeof redis.duplicate === 'function' ? redis.duplicate() : redis;
  const cursorHashKey = `${keyPrefix}:mailbox:cursors`;
  const stateHashKey = `${keyPrefix}:mailbox:state`;

  const cursorStore: MailboxCursorStore = {
    async getCursor(mailboxKey, consumerKey) {
      const value = await metaRedis.hget(
        cursorHashKey,
        `${mailboxKey}::${consumerKey}`,
      );
      return value ?? undefined;
    },
    async setCursor(mailboxKey, consumerKey, cursor) {
      await metaRedis.hset(
        cursorHashKey,
        `${mailboxKey}::${consumerKey}`,
        cursor,
      );
    },
  };

  const stateStore: MailboxStateStore = {
    async getState(mailboxKey) {
      const raw = await metaRedis.hget(stateHashKey, mailboxKey);
      if (!raw) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(raw) as MailboxState;
        return parsed;
      } catch {
        return undefined;
      }
    },
    async setState(mailboxKey, state) {
      await metaRedis.hset(stateHashKey, mailboxKey, JSON.stringify(state));
    },
  };

  return {
    cursorStore,
    stateStore,
    metaRedis: metaRedis !== redis ? metaRedis : null,
  };
}

function normalizeSchedulerConfig(
  config: Partial<PerceptionSchedulerConfig> | undefined,
): NormalizedSchedulerConfig {
  return {
    intervalMs: config?.intervalMs ?? MINUTE_MS,
    minHeartbeatMs: config?.minHeartbeatMs ?? DEFAULT_MIN_HEARTBEAT_MS,
    maxHeartbeatMs: config?.maxHeartbeatMs ?? DEFAULT_MAX_HEARTBEAT_MS,
    inactivityStopDays:
      config?.inactivityStopDays ?? DEFAULT_INACTIVITY_STOP_DAYS,
    maxActiveReminders: config?.maxActiveReminders ?? 1,
    heartbeatShape: config?.heartbeatShape ?? DEFAULT_HEARTBEAT_SHAPE,
    shouldPause: config?.shouldPause,
  };
}

function attachConstructSchedulerListener(options: {
  constructId: string;
  construct: Construct;
  attached: WeakSet<Construct>;
  onScheduleChanged: (reason: string) => Promise<void>;
}): void {
  if (options.attached.has(options.construct)) {
    return;
  }
  options.attached.add(options.construct);

  options.construct.onEvent((event: ConstructEvent) => {
    if (
      event.type === 'source-fact:reflected' &&
      event.factType === 'user_message'
    ) {
      void options.onScheduleChanged('user-message-reflected');
      return;
    }
    if (event.type === 'response:delivered') {
      void options.onScheduleChanged('response-delivered');
    }
  });
}

function createConstructSchedulerService<
  TImpulseProfileName extends string,
  TImpulsePoolName extends string,
  TLaneName extends string,
  TSystemEventName extends string,
>(args: {
  logger: Logger;
  workflowRuntime: Awaited<ReturnType<typeof createWorkflowSystem>>['runtime'];
  runtime: Pick<
    DurableConstructRuntime<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
    'runtimeManager' | 'submit' | 'actorRuntime'
  >;
  schedulerConfig: NormalizedSchedulerConfig;
}): ConstructSchedulerService {
  const runtimeLogger = args.logger.child({
    component: 'construct-scheduler-service',
  });
  type RuntimeOp = Parameters<typeof args.runtime.submit>[1];
  const startingByConstruct = new Map<string, Promise<void>>();
  const workflow = createConstructSchedulerWorkflow({
    loadNextDue: async (constructId, now) => {
      const construct =
        await args.runtime.runtimeManager.getOrCreateReadonly(constructId);
      const vfs = construct.getVfs();
      const heartbeatMeta = await loadHeartbeatMeta(vfs);
      const state = await loadPerceptionScheduleState({
        vfs,
        now,
        heartbeatMeta,
        minHeartbeatMs: args.schedulerConfig.minHeartbeatMs,
        maxHeartbeatMs: args.schedulerConfig.maxHeartbeatMs,
        inactivityStopDays: args.schedulerConfig.inactivityStopDays,
        heartbeatShape: args.schedulerConfig.heartbeatShape,
      });
      await construct.flush();
      console.warn(
        `[DIAG:scheduler-workflow] loadNextDue constructId=${constructId} ` +
          `nextDue=${state.nextDue ? `${state.nextDue.kind}@${state.nextDue.dueAt}` : 'null'} ` +
          `heartbeatMeta=${JSON.stringify(await loadHeartbeatMeta(vfs))} now=${now.toISOString()}`,
      );
      return state.nextDue ?? null;
    },
    appendDueWork: async (constructId, due) => {
      const construct =
        await args.runtime.runtimeManager.getOrCreateReadonly(constructId);
      const vfs = construct.getVfs();
      if (due.reminder.meta.type === 'heartbeat') {
        const heartbeatRateMs =
          typeof due.reminder.meta.heartbeat_rate_ms === 'number'
            ? due.reminder.meta.heartbeat_rate_ms
            : undefined;
        const nextHeartbeatAt =
          (typeof due.reminder.meta.estimated_next_heartbeat_at === 'string' &&
          due.reminder.meta.estimated_next_heartbeat_at.length > 0
            ? due.reminder.meta.estimated_next_heartbeat_at
            : heartbeatRateMs
              ? new Date(Date.parse(due.dueAt) + heartbeatRateMs).toISOString()
              : '') || undefined;

        await updateHeartbeatMeta(vfs, {
          heartbeat_rate_ms: heartbeatRateMs,
          last_heartbeat_at: due.dueAt,
          estimated_next_heartbeat_at: nextHeartbeatAt ?? '',
        });
        await saveReminder(vfs, {
          ...due.reminder,
          meta: {
            ...due.reminder.meta,
            last_fired_at: due.dueAt,
            next_fire_at: nextHeartbeatAt ?? '',
            due_at: nextHeartbeatAt ?? '',
            estimated_next_heartbeat_at: nextHeartbeatAt ?? '',
            status: nextHeartbeatAt ? 'pending' : 'done',
          },
        });
        await construct.flush();
        await args.runtime.submit(
          constructId,
          buildHeartbeatSystemEventOp({
            constructId,
            dueAt: due.dueAt,
            payload: {
              heartbeat_rate_ms:
                typeof due.reminder.meta.heartbeat_rate_ms === 'number'
                  ? due.reminder.meta.heartbeat_rate_ms
                  : undefined,
              last_user_message_at:
                typeof due.reminder.meta.last_user_message_at === 'string'
                  ? due.reminder.meta.last_user_message_at
                  : undefined,
              last_response_at:
                typeof due.reminder.meta.last_response_at === 'string'
                  ? due.reminder.meta.last_response_at
                  : undefined,
            },
          }) as RuntimeOp,
        );
        return;
      }

      const next = await computeNextReminderFireAt({
        reminder: due.reminder,
        now: new Date(due.dueAt),
        vfs,
      });
      await saveReminder(vfs, {
        ...due.reminder,
        meta: {
          ...due.reminder.meta,
          last_fired_at: due.dueAt,
          next_fire_at: next?.toISOString(),
          status: next ? 'pending' : 'done',
        },
      });
      await construct.flush();
      await args.runtime.submit(
        constructId,
        buildSelfReminderOp({
          reminderId: due.reminderId,
          message: due.reminder.content.trim() || 'Reminder',
          dueAt: due.dueAt,
          context: {
            ...due.reminder.meta,
            next_fire_at: next?.toISOString(),
            last_fired_at: due.dueAt,
            status: next ? 'pending' : 'done',
          },
        }) as RuntimeOp,
      );
    },
    ensureConstructRunning: async (constructId) => {
      void args.runtime.actorRuntime.ensureRunning(constructId);
    },
  });

  const ensureStarted = async (constructId: string) => {
    const starting = startingByConstruct.get(constructId);
    if (starting) {
      console.warn(
        `[DIAG:scheduler-workflow] ensureStarted constructId=${constructId} already-starting`,
      );
      await starting;
      return;
    }

    // Register in dedup map before any async work to close the TOCTOU window
    // between getWorkflowInstance and startWorkflow.
    const instanceId = createConstructSchedulerWorkflowInstanceId(constructId);
    const startPromise = (async () => {
      const existing =
        await args.workflowRuntime.getWorkflowInstance?.(instanceId);
      if (
        existing &&
        existing.status !== 'failed' &&
        existing.status !== 'cancelled'
      ) {
        return;
      }
      if (existing) {
        console.warn(
          `[DIAG:scheduler-workflow] ensureStarted constructId=${constructId} ` +
            `restarting terminal workflow status=${existing.status}`,
        );
      }

      console.warn(
        `[DIAG:scheduler-workflow] ensureStarted constructId=${constructId} starting-new instanceId=${instanceId}`,
      );
      runtimeLogger.info('Starting construct scheduler workflow', {
        constructId,
      });
      await args.workflowRuntime.startWorkflow(
        workflow,
        { constructId },
        { instanceId },
      );
      console.warn(
        `[DIAG:scheduler-workflow] ensureStarted constructId=${constructId} workflow-started`,
      );
    })();
    startingByConstruct.set(constructId, startPromise);
    try {
      await startPromise;
    } finally {
      startingByConstruct.delete(constructId);
    }
  };

  const notifyScheduleUpdated = async (
    constructId: string,
    reason?: string,
  ) => {
    await ensureStarted(constructId);
    const instanceId = createConstructSchedulerWorkflowInstanceId(constructId);
    runtimeLogger.debug('Notifying construct scheduler workflow', {
      constructId,
      reason,
    });
    const dispatch = await args.workflowRuntime.emitEventAndReport?.({
      workflowName: workflow.name,
      eventName: 'scheduleUpdated',
      token: createConstructSchedulerEventToken(constructId),
      payload: { reason: reason ?? 'schedule-updated', constructId },
    });

    if (!dispatch || dispatch.matchedInstances === 0) {
      console.warn(
        `[DIAG:scheduler-workflow] notifyScheduleUpdated constructId=${constructId} ` +
          `matchedInstances=${dispatch?.matchedInstances ?? 'null'} calling-ensureWorkflowExecution`,
      );
      await args.workflowRuntime.ensureWorkflowExecution?.({
        instanceId,
        workflowName: workflow.name,
      });
    }
  };

  return {
    ensureStarted,
    notifyScheduleUpdated,
  };
}

const MINUTE_MS = 60 * 1000;
