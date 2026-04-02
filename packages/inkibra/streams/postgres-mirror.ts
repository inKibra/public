import {
  type CollectionSchema,
  type Driver,
  defineCollection,
  type ModelBase,
} from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import { Filter } from '@inkibra/observable-cache';
import type { PersistedStreamEvent } from './types';

export const STREAM_EVENT_TYPE = 'STREAM_EVENT';
export const DEFAULT_STREAMS_COLLECTION = 'streams';

type Stored<T> = T & ModelBase;

function discriminatorByType<TModel extends { type: string }>(
  typename: string,
) {
  return (data: unknown): data is Stored<TModel> =>
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === typename;
}

export const streamsRuntimeCollection = defineCollection(
  DEFAULT_STREAMS_COLLECTION,
)
  .addModel<
    typeof STREAM_EVENT_TYPE,
    Stored<PersistedStreamEvent>,
    readonly ['streamKey', 'seq', 'created']
  >(STREAM_EVENT_TYPE, {
    version: 1,
    valueIndexes: ['streamKey', 'seq', 'created'] as const,
    discriminator: discriminatorByType<PersistedStreamEvent>(STREAM_EVENT_TYPE),
  })
  .build();

export const streamsRuntimeTable = streamsRuntimeCollection.table;

export function createStreamsCollectionSchema(
  collectionName: string,
): CollectionSchema {
  return {
    name: collectionName,
    dals: [
      {
        type: STREAM_EVENT_TYPE,
        valueIndexes: ['streamKey', 'seq', 'created'],
      },
    ],
  };
}

export async function initializeStreamsCollection(
  logger: Logger,
  driver: Driver,
  collectionName: string,
  options?: {
    createIfNotExists?: boolean;
    strict?: boolean;
  },
): Promise<void> {
  await driver.ensureCollection(
    logger,
    createStreamsCollectionSchema(collectionName),
    {
      createIfNotExists: options?.createIfNotExists ?? false,
      strict: options?.strict ?? true,
    },
  );
}

export async function appendPersistedEvent(
  logger: Logger,
  driver: Driver,
  collectionName: string,
  event: PersistedStreamEvent,
): Promise<void> {
  const result = await driver.insert(logger, collectionName, event);
  if (result.isErr()) {
    throw result.error;
  }
}

export async function readPersistedEventsAfter(
  logger: Logger,
  driver: Driver,
  collectionName: string,
  streamKey: string,
  afterSeq: number,
  limit: number,
): Promise<PersistedStreamEvent[]> {
  const pageSize = Math.max(limit * 2, 250);
  let offset = 0;
  const matched: PersistedStreamEvent[] = [];

  while (matched.length < limit) {
    const result = await driver.find<PersistedStreamEvent>(
      logger,
      collectionName,
      STREAM_EVENT_TYPE,
      {
        filter: {
          streamKey: {
            operator: Filter.Operators.EQUAL,
            value: streamKey,
          },
        },
        limit: pageSize,
        offset,
        orderBy: {
          field: 'created',
          direction: 'ASC',
        },
      },
    );

    if (result.isErr()) {
      throw result.error;
    }

    const rows = result.value.value;
    if (rows.length === 0) {
      break;
    }

    for (const item of rows) {
      if (item.seq > afterSeq) {
        matched.push(item);
      }
    }

    if (rows.length < pageSize) {
      break;
    }

    offset += rows.length;
  }

  matched.sort((a, b) => a.seq - b.seq);
  return matched.slice(0, limit);
}

export async function readLatestPersistedSeq(
  logger: Logger,
  driver: Driver,
  collectionName: string,
  streamKey: string,
): Promise<number | null> {
  const latest = await readLatestPersistedEvent(
    logger,
    driver,
    collectionName,
    streamKey,
  );

  return latest?.seq ?? null;
}

export async function readLatestPersistedEvent(
  logger: Logger,
  driver: Driver,
  collectionName: string,
  streamKey: string,
): Promise<PersistedStreamEvent | null> {
  const result = await driver.find<PersistedStreamEvent>(
    logger,
    collectionName,
    STREAM_EVENT_TYPE,
    {
      filter: {
        streamKey: {
          operator: Filter.Operators.EQUAL,
          value: streamKey,
        },
      },
      limit: 1,
      orderBy: {
        field: 'created',
        direction: 'DESC',
      },
    },
  );

  if (result.isErr()) {
    throw result.error;
  }

  return result.value.value[0] ?? null;
}
