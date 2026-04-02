import {
  type CollectionSchema,
  type Driver,
  defineCollection,
  type EnsureCollectionOptions,
  type TypedObjectBase,
} from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import { Filter } from '@inkibra/observable-cache';
import type {
  JsonValue,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowInstance,
  WorkflowStorage,
} from './types';

export const WORKFLOW_COLLECTION = 'workflow_runtime';
export const WORKFLOW_INSTANCE_TYPE = 'WORKFLOW_INSTANCE';
export const WORKFLOW_EVENT_TYPE = 'WORKFLOW_EVENT';

type WorkflowInstanceDocument = TypedObjectBase & {
  type: typeof WORKFLOW_INSTANCE_TYPE;
  workflowName: string;
  status: WorkflowInstance<JsonValue>['status'];
  eventTokens: string[];
  workflow: WorkflowInstance<JsonValue>;
};

type WorkflowEventDocument = TypedObjectBase & {
  type: typeof WORKFLOW_EVENT_TYPE;
  instanceId: string;
  eventType: WorkflowEventType;
  stageName?: string;
  payload: JsonValue;
  timestamp: string;
};

export const workflowRuntimeCollectionSchema: CollectionSchema = {
  name: WORKFLOW_COLLECTION,
  dals: [
    {
      type: WORKFLOW_INSTANCE_TYPE,
      valueIndexes: ['workflowName', 'status'],
      arrayIndexes: ['eventTokens'],
    },
    {
      type: WORKFLOW_EVENT_TYPE,
      valueIndexes: ['instanceId', 'eventType', 'timestamp'],
    },
  ],
};

type WorkflowInstanceCollectionModel = Pick<
  WorkflowInstanceDocument,
  'id' | 'type' | 'workflowName' | 'status' | 'eventTokens'
> & { version: number; created: string; modified: string };

type WorkflowEventCollectionModel = Pick<
  WorkflowEventDocument,
  'id' | 'type' | 'instanceId' | 'eventType' | 'timestamp'
> & { version: number; created: string; modified: string };

export const workflowRuntimeCollection = defineCollection(WORKFLOW_COLLECTION)
  .addModel<
    typeof WORKFLOW_INSTANCE_TYPE,
    WorkflowInstanceCollectionModel,
    readonly ['workflowName', 'status'],
    readonly ['eventTokens']
  >(WORKFLOW_INSTANCE_TYPE, {
    version: 1,
    valueIndexes: ['workflowName', 'status'] as const,
    arrayIndexes: ['eventTokens'] as const,
    discriminator: (data): data is WorkflowInstanceCollectionModel =>
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: unknown }).type === WORKFLOW_INSTANCE_TYPE,
  })
  .addModel<
    typeof WORKFLOW_EVENT_TYPE,
    WorkflowEventCollectionModel,
    readonly ['instanceId', 'eventType', 'timestamp']
  >(WORKFLOW_EVENT_TYPE, {
    version: 1,
    valueIndexes: ['instanceId', 'eventType', 'timestamp'] as const,
    discriminator: (data): data is WorkflowEventCollectionModel =>
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: unknown }).type === WORKFLOW_EVENT_TYPE,
  })
  .build();

export const workflowRuntimeTable = workflowRuntimeCollection.table;

type DalWorkflowStorageOptions = {
  ensureCollectionOptions?: EnsureCollectionOptions;
};

export class DalWorkflowStorage implements WorkflowStorage {
  constructor(
    private readonly driver: Driver,
    private readonly logger: Logger,
    private readonly options: DalWorkflowStorageOptions = {},
  ) {
    this.logger = logger.child({ component: 'workflow-storage-dal' });
  }

  async initialize(): Promise<void> {
    const isDev = process.env.NODE_ENV === 'development';
    await this.driver.ensureCollection(
      this.logger,
      workflowRuntimeCollectionSchema,
      {
        createIfNotExists:
          this.options.ensureCollectionOptions?.createIfNotExists ?? isDev,
        strict: this.options.ensureCollectionOptions?.strict ?? true,
      },
    );
  }

  async getInstance(
    instanceId: string,
  ): Promise<WorkflowInstance<JsonValue> | null> {
    const result = await this.driver.get<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      instanceId,
    );

    if (result.isErr()) {
      throw new Error(`Failed to get workflow instance: ${instanceId}`);
    }

    const document = result.value.value?.value;
    if (!document || document.type !== WORKFLOW_INSTANCE_TYPE) {
      return null;
    }

    return decodeInstance(document.workflow);
  }

  async saveInstance(
    instance: WorkflowInstance<JsonValue>,
  ): Promise<WorkflowInstance<JsonValue>> {
    const document = encodeInstance(instance);
    const result = await this.driver.insert<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      document,
    );

    if (result.isErr()) {
      throw new Error(`Failed to save workflow instance: ${instance.id}`);
    }

    return instance;
  }

  async updateInstance(
    instanceId: string,
    updates: Partial<WorkflowInstance<JsonValue>>,
    _cas?: unknown,
  ): Promise<WorkflowInstance<JsonValue>> {
    const getResult = await this.driver.get<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      instanceId,
    );

    if (getResult.isErr()) {
      throw new Error(`Failed to fetch workflow instance: ${instanceId}`);
    }

    const existing = getResult.value.value;
    if (!existing?.value || existing.value.type !== WORKFLOW_INSTANCE_TYPE) {
      throw new Error(`Workflow instance not found: ${instanceId}`);
    }

    const merged: WorkflowInstance<JsonValue> = {
      ...existing.value.workflow,
      ...updates,
      modified: new Date().toISOString(),
    };

    const replaceResult = await this.driver.replace<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      existing.cas,
      encodeInstance(merged),
    );

    if (replaceResult.isErr()) {
      throw new Error(`Failed to update workflow instance: ${instanceId}`);
    }

    return merged;
  }

  async lockInstance(
    instanceId: string,
    executionId: string,
    leaseDurationMs: number,
  ): Promise<WorkflowInstance<JsonValue> | null> {
    const getResult = await this.driver.get<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      instanceId,
    );

    if (getResult.isErr()) {
      throw new Error(`Failed to get workflow instance lock: ${instanceId}`);
    }

    const entry = getResult.value.value;
    if (!entry?.value || entry.value.type !== WORKFLOW_INSTANCE_TYPE) {
      return null;
    }

    const instance = decodeInstance(entry.value.workflow);
    const lockExpiresAt = instance.lock
      ? new Date(instance.lock.leaseExpiresAt).getTime()
      : 0;
    const now = Date.now();

    if (instance.lock && lockExpiresAt > now) {
      return null;
    }

    const lockedInstance: WorkflowInstance<JsonValue> = {
      ...instance,
      lock: {
        executionId,
        leaseExpiresAt: new Date(now + leaseDurationMs).toISOString(),
      },
      modified: new Date().toISOString(),
    };

    const replaceResult = await this.driver.replace<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      entry.cas,
      encodeInstance(lockedInstance),
    );

    if (replaceResult.isErr()) {
      return null;
    }

    return lockedInstance;
  }

  async heartbeatLock(
    instanceId: string,
    executionId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const getResult = await this.driver.get<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      instanceId,
    );

    if (getResult.isErr()) {
      throw new Error(`Failed to heartbeat workflow instance: ${instanceId}`);
    }

    const entry = getResult.value.value;
    if (!entry?.value || entry.value.type !== WORKFLOW_INSTANCE_TYPE) {
      return false;
    }

    const instance = decodeInstance(entry.value.workflow);
    if (!instance.lock || instance.lock.executionId !== executionId) {
      return false;
    }

    const updated: WorkflowInstance<JsonValue> = {
      ...instance,
      lock: {
        executionId,
        leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString(),
      },
      modified: new Date().toISOString(),
    };

    const replaceResult = await this.driver.replace<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      entry.cas,
      encodeInstance(updated),
    );

    return !replaceResult.isErr();
  }

  async unlockInstance(instanceId: string, executionId: string): Promise<void> {
    const getResult = await this.driver.get<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      instanceId,
    );

    if (getResult.isErr()) {
      throw new Error(`Failed to unlock workflow instance: ${instanceId}`);
    }

    const entry = getResult.value.value;
    if (!entry?.value || entry.value.type !== WORKFLOW_INSTANCE_TYPE) {
      return;
    }

    const current = decodeInstance(entry.value.workflow);
    if (!current.lock || current.lock.executionId !== executionId) {
      return;
    }

    const updated: WorkflowInstance<JsonValue> = {
      ...current,
      lock: undefined,
      modified: new Date().toISOString(),
    };

    const replaceResult = await this.driver.replace<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      entry.cas,
      encodeInstance(updated),
    );

    if (replaceResult.isErr()) {
      throw new Error(`Failed to unlock workflow instance: ${instanceId}`);
    }
  }

  async saveEvent(event: Omit<WorkflowEvent, 'id'>): Promise<WorkflowEvent> {
    const id = crypto.randomUUID();
    const document: WorkflowEventDocument = {
      id,
      type: WORKFLOW_EVENT_TYPE,
      instanceId: event.instanceId,
      eventType: event.eventType,
      stageName: event.stageName,
      payload: event.payload,
      timestamp: event.timestamp,
      created: event.timestamp,
      modified: event.timestamp,
      version: 1,
    };

    const result = await this.driver.insert<WorkflowEventDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      document,
    );

    if (result.isErr()) {
      throw new Error(`Failed to save workflow event for: ${event.instanceId}`);
    }

    return {
      id,
      ...event,
    };
  }

  async getEvents(
    instanceId: string,
    eventType?: WorkflowEventType,
  ): Promise<WorkflowEvent[]> {
    const result = await this.driver.find<WorkflowEventDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      WORKFLOW_EVENT_TYPE,
      {
        limit: 10000,
      },
    );

    if (result.isErr()) {
      throw new Error(`Failed to get workflow events for: ${instanceId}`);
    }

    return result.value.value
      .filter((entry: WorkflowEventDocument) => entry.instanceId === instanceId)
      .filter((entry: WorkflowEventDocument) =>
        eventType ? entry.eventType === eventType : true,
      )
      .sort((a: WorkflowEventDocument, b: WorkflowEventDocument) =>
        a.timestamp.localeCompare(b.timestamp),
      )
      .map((entry: WorkflowEventDocument) => ({
        id: entry.id,
        type: 'workflow_event',
        instanceId: entry.instanceId,
        eventType: entry.eventType,
        stageName: entry.stageName,
        payload: entry.payload,
        timestamp: entry.timestamp,
      }));
  }

  async findInstancesByToken(
    token: string,
  ): Promise<WorkflowInstance<JsonValue>[]> {
    const result = await this.driver.find<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      WORKFLOW_INSTANCE_TYPE,
      {
        filter: {
          status: {
            operator: Filter.Operators.IN,
            values: ['running', 'waiting'],
          },
          eventTokens: {
            operator: Filter.Operators.ANY_IN,
            values: [token],
          },
        },
        limit: 10000,
      },
    );

    if (result.isErr()) {
      throw new Error(`Failed to find instances by token: ${token}`);
    }

    return result.value.value
      .map((entry: WorkflowInstanceDocument) => decodeInstance(entry.workflow))
      .filter((instance: WorkflowInstance<JsonValue>) =>
        instance.eventTokens.includes(token),
      );
  }

  async listInstancesByWorkflowName(
    workflowName: string,
  ): Promise<WorkflowInstance<JsonValue>[]> {
    const result = await this.driver.find<WorkflowInstanceDocument>(
      this.logger,
      WORKFLOW_COLLECTION,
      WORKFLOW_INSTANCE_TYPE,
      {
        limit: 10000,
      },
    );

    if (result.isErr()) {
      throw new Error(`Failed to list instances for workflow: ${workflowName}`);
    }

    return result.value.value
      .map((entry: WorkflowInstanceDocument) => decodeInstance(entry.workflow))
      .filter(
        (instance: WorkflowInstance<JsonValue>) =>
          instance.workflowName === workflowName,
      );
  }
}

function encodeInstance(
  workflow: WorkflowInstance<JsonValue>,
): WorkflowInstanceDocument {
  return {
    id: workflow.id,
    type: WORKFLOW_INSTANCE_TYPE,
    workflowName: workflow.workflowName,
    status: workflow.status,
    eventTokens: workflow.eventTokens ?? [],
    workflow,
    created: workflow.created,
    modified: workflow.modified,
    version: 1,
  };
}

function decodeInstance(
  workflow: WorkflowInstance<JsonValue>,
): WorkflowInstance<JsonValue> {
  return {
    ...workflow,
    eventTokens: workflow.eventTokens ?? [],
    contextData: workflow.contextData ?? {},
  };
}
