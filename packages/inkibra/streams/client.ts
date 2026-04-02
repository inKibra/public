import type { Driver } from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import { decodeCursor, encodeCursor } from './cursor';
import {
  appendPersistedEvent,
  initializeStreamsCollection,
  readLatestPersistedEvent,
  readLatestPersistedSeq,
  readPersistedEventsAfter,
} from './postgres-mirror';
import type {
  CreateStreamsClientOptions,
  PersistedStreamEvent,
  StreamAppendArgs,
  StreamArgs,
  StreamCursor,
  StreamDefaults,
  StreamItem,
  StreamMessage,
  StreamReadArgs,
  StreamsClient,
} from './types';

type RedisStreamEntry = [id: string, fields: string[]];
type CursorReason = 'cursor_trimmed' | 'redis_unavailable' | 'gap_detected';

function compareRedisIds(a: string, b: string): number {
  const [aMs = 0, aSeq = 0] = a.split('-').map((x) => Number(x));
  const [bMs = 0, bSeq = 0] = b.split('-').map((x) => Number(x));
  if (aMs !== bMs) {
    return aMs - bMs;
  }
  return aSeq - bSeq;
}

const DEFAULTS: Required<Pick<StreamDefaults, 'durability' | 'readMode'>> & {
  retention: { maxAgeMs: number; maxLen: number };
  redisPrefix: string;
} = {
  durability: 'buffered',
  readMode: 'redis_with_pg_fallback',
  retention: {
    maxAgeMs: 60 * 60 * 1000,
    maxLen: 100_000,
  },
  redisPrefix: 'inkibra:streams',
};

const FLOOR_AND_INCR_SEQ_LUA = [
  "local current = tonumber(redis.call('GET', KEYS[1]) or '0')",
  'local floor = tonumber(ARGV[1]) or 0',
  'local bumped = 0',
  'if current < floor then',
  "  redis.call('SET', KEYS[1], floor)",
  '  bumped = 1',
  'end',
  "local next = redis.call('INCR', KEYS[1])",
  'return {next, bumped}',
].join('\n');

export async function createStreamsClient(
  options: CreateStreamsClientOptions,
): Promise<StreamsClient> {
  const logger = options.logger.child({ component: 'streams-client' });
  const redis = options.redis;
  const writeRedis =
    typeof redis.duplicate === 'function' ? redis.duplicate() : redis;
  const driver = options.driver;
  const collectionName = options.collectionName ?? 'streams';
  const persistedSeqFloors = new Map<string, number>();
  const persistedSeqFloorLoads = new Map<string, Promise<number>>();

  async function getPersistedSeqFloor(streamKey: string): Promise<number> {
    const cached = persistedSeqFloors.get(streamKey);
    if (cached !== undefined) {
      return cached;
    }

    const inFlight = persistedSeqFloorLoads.get(streamKey);
    if (inFlight) {
      return inFlight;
    }

    const load = (async () => {
      if (!driver) {
        return 0;
      }

      try {
        const latestSeq = await readLatestPersistedSeq(
          logger,
          driver,
          collectionName,
          streamKey,
        );
        return latestSeq ?? 0;
      } catch (error) {
        logger.warn('Failed to load latest persisted stream sequence', {
          streamKey,
          error,
        });
        return 0;
      }
    })();

    persistedSeqFloorLoads.set(streamKey, load);
    const floor = await load;
    persistedSeqFloorLoads.delete(streamKey);
    persistedSeqFloors.set(streamKey, floor);
    return floor;
  }

  if (driver) {
    const isDev = process.env.NODE_ENV === 'development';
    await initializeStreamsCollection(logger, driver, collectionName, {
      createIfNotExists:
        options.ensureCollectionOptions?.createIfNotExists ?? isDev,
      strict: options.ensureCollectionOptions?.strict ?? true,
    });
  }

  const client: StreamsClient = {
    append: async <TEvents extends object, K extends keyof TEvents & string>(
      args: StreamAppendArgs<TEvents, K>,
    ): Promise<{ cursor: StreamCursor }> => {
      const appendStartedAt = Date.now();
      const resolved = resolveSettings(
        options.defaults,
        options.streams,
        args.streamKey,
      );
      const durability = args.durability ?? resolved.durability;
      const nowIso = new Date().toISOString();
      const seqKey = redisSeqKey(resolved.redisPrefix, args.streamKey);
      let seq: number;
      const reserveStartedAt = Date.now();
      if (driver && durability === 'strict') {
        const persistedFloor = await getPersistedSeqFloor(args.streamKey);
        const evalResult = await writeRedis.eval(
          FLOOR_AND_INCR_SEQ_LUA,
          1,
          seqKey,
          String(persistedFloor),
        );
        const [nextSeqRaw, bumpedRaw] = Array.isArray(evalResult)
          ? evalResult
          : [evalResult, 0];
        seq = Number(nextSeqRaw);
        if (!Number.isFinite(seq) || seq <= 0) {
          throw new Error('Failed to reserve Redis stream sequence');
        }

        if (Number(bumpedRaw) === 1) {
          logger.warn('Resynced Redis stream sequence to persisted floor', {
            streamKey: args.streamKey,
            persistedFloor,
            nextSeq: seq,
          });
        }
        persistedSeqFloors.set(args.streamKey, Math.max(persistedFloor, seq));
      } else {
        seq = await writeRedis.incr(seqKey);
      }
      const reserveElapsedMs = Date.now() - reserveStartedAt;
      const xaddStartedAt = Date.now();
      const redisId = await writeRedis.xadd(
        redisStreamKey(resolved.redisPrefix, args.streamKey),
        'MAXLEN',
        '~',
        String(args.retention?.maxLen ?? resolved.retention.maxLen),
        '*',
        'seq',
        String(seq),
        'event',
        String(args.event),
        'data',
        JSON.stringify(args.data),
        'ts',
        nowIso,
        'idempotencyKey',
        args.idempotencyKey ?? '',
      );

      if (redisId === null) {
        throw new Error('Failed to append stream event to Redis');
      }
      const xaddElapsedMs = Date.now() - xaddStartedAt;

      const cursor = encodeCursor({
        streamKey: args.streamKey,
        seq,
        redisId,
      });

      const trimAgeMs = args.retention?.maxAgeMs ?? resolved.retention.maxAgeMs;
      if (trimAgeMs > 0) {
        const minId = `${Date.now() - trimAgeMs}-0`;
        void writeRedis
          .xtrim(
            redisStreamKey(resolved.redisPrefix, args.streamKey),
            'MINID',
            '~',
            minId,
          )
          .catch((error: unknown) => {
            logger.warn('Failed to trim stream by age', {
              streamKey: args.streamKey,
              minId,
              error,
            });
          });
      }

      if (driver && durability !== 'volatile') {
        const persisted: PersistedStreamEvent = {
          id: persistedEventId(args.streamKey, seq),
          type: 'STREAM_EVENT',
          version: 1,
          streamKey: args.streamKey,
          seq,
          redisId,
          event: String(args.event),
          dataJson: JSON.stringify(args.data),
          ts: nowIso,
          idempotencyKey: args.idempotencyKey,
          created: nowIso,
          modified: nowIso,
        };

        if (durability === 'strict') {
          await appendPersistedEvent(logger, driver, collectionName, persisted);
        } else {
          void appendPersistedEvent(
            logger,
            driver,
            collectionName,
            persisted,
          ).catch((error) => {
            logger.error('Buffered stream mirror failed', {
              streamKey: args.streamKey,
              seq,
              error,
            });
          });
        }
      }

      const totalElapsedMs = Date.now() - appendStartedAt;
      if (totalElapsedMs > 1000) {
        logger.warn('Slow streams.append', {
          streamKey: args.streamKey,
          event: String(args.event),
          totalElapsedMs,
          reserveElapsedMs,
          xaddElapsedMs,
        });
      }

      return { cursor };
    },

    latestCursor: async ({ streamKey }: { streamKey: string }) => {
      const resolved = resolveSettings(
        options.defaults,
        options.streams,
        streamKey,
      );
      const redisKey = redisStreamKey(resolved.redisPrefix, streamKey);

      try {
        const latestEntry = await writeRedis.xrevrange(
          redisKey,
          '+',
          '-',
          'COUNT',
          1,
        );
        const decoded = decodeRedisEntries(latestEntry as RedisStreamEntry[]);
        const latest = decoded[0];
        if (latest) {
          return encodeCursor({
            streamKey,
            seq: latest.seq,
            redisId: latest.redisId,
          });
        }
      } catch (error) {
        logger.warn('Failed to read latest cursor from Redis', {
          streamKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (driver) {
        try {
          const latestPersisted = await readLatestPersistedEvent(
            logger,
            driver,
            collectionName,
            streamKey,
          );
          if (latestPersisted) {
            return encodeCursor({
              streamKey,
              seq: latestPersisted.seq,
              redisId: latestPersisted.redisId,
            });
          }
        } catch (error) {
          logger.warn('Failed to read latest cursor from Postgres', {
            streamKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return encodeCursor({
        streamKey,
        seq: 0,
        redisId: '0-0',
      });
    },

    read: async <TEvents extends object>(
      args: StreamReadArgs,
    ): Promise<{
      items: Array<StreamMessage<TEvents>>;
      nextCursor?: StreamCursor;
    }> => {
      const resolved = resolveSettings(
        options.defaults,
        options.streams,
        args.streamKey,
      );
      const readMode = args.readMode ?? resolved.readMode;
      const limit = args.limit ?? 100;
      const redisKey = redisStreamKey(resolved.redisPrefix, args.streamKey);
      const cursorState = decodeCursor(args.cursor ?? '');
      const afterSeq =
        cursorState && cursorState.streamKey === args.streamKey
          ? cursorState.seq
          : 0;

      if (readMode !== 'pg_only') {
        try {
          const redisCursor =
            cursorState && cursorState.streamKey === args.streamKey
              ? cursorState.redisId
              : '0-0';
          const entries = decodeXreadResponse(
            await redis.xread(
              'COUNT',
              String(limit),
              'STREAMS',
              redisKey,
              redisCursor,
            ),
          );

          const items = entries.map((entry) => {
            const cursor = encodeCursor({
              streamKey: args.streamKey,
              seq: entry.seq,
              redisId: entry.redisId,
            });
            return {
              event: entry.event,
              data: entry.data as TEvents[keyof TEvents],
              cursor,
              ts: entry.ts,
            } as StreamMessage<TEvents>;
          });

          return {
            items,
            nextCursor: items[items.length - 1]?.cursor,
          };
        } catch {
          if (readMode !== 'redis_with_pg_fallback' || !driver) {
            throw new Error('Failed to read stream from Redis');
          }
        }
      }

      if (!driver) {
        return { items: [] };
      }

      const persisted = await readPersistedEventsAfter(
        logger,
        driver,
        collectionName,
        args.streamKey,
        afterSeq,
        limit,
      );
      const items = persisted.map((item) => {
        const cursor = encodeCursor({
          streamKey: args.streamKey,
          seq: item.seq,
          redisId: item.redisId,
        });

        return {
          event: item.event,
          data: safeParseJson(item.dataJson) as TEvents[keyof TEvents],
          cursor,
          ts: item.ts,
        } as StreamMessage<TEvents>;
      });

      return {
        items,
        nextCursor: items[items.length - 1]?.cursor,
      };
    },

    stream: async function* <TEvents extends object>(
      args: StreamArgs,
    ): AsyncGenerator<StreamItem<TEvents>, void, unknown> {
      const resolved = resolveSettings(
        options.defaults,
        options.streams,
        args.streamKey,
      );
      const readMode = args.readMode ?? resolved.readMode;
      const limit = args.limit ?? 200;
      const blockMs = args.blockMs ?? 10_000;
      const redisKey = redisStreamKey(resolved.redisPrefix, args.streamKey);

      let cursorState = decodeCursor(args.cursor ?? '');
      if (cursorState && cursorState.streamKey !== args.streamKey) {
        logger.warn('Ignoring cursor with mismatched stream key', {
          expected: args.streamKey,
          got: cursorState.streamKey,
        });
        cursorState = null;
      }

      let lastSeq = cursorState?.seq ?? 0;
      let redisCursor = cursorState?.redisId ?? '0-0';
      const streamRedis =
        typeof redis.duplicate === 'function' ? redis.duplicate() : redis;
      const ownsStreamRedis = streamRedis !== redis;

      try {
        if (readMode !== 'pg_only') {
          try {
            let fallbackReason: CursorReason | undefined;
            let latestRedisEntry:
              | ReturnType<typeof decodeRedisEntries>[number]
              | undefined;

            if (cursorState) {
              const firstEntry = await streamRedis.xrange(
                redisKey,
                '-',
                '+',
                'COUNT',
                1,
              );
              const firstDecoded = decodeRedisEntries(firstEntry)[0];
              const latestEntry = await streamRedis.xrevrange(
                redisKey,
                '+',
                '-',
                'COUNT',
                1,
              );
              latestRedisEntry = decodeRedisEntries(latestEntry)[0];
              if (firstDecoded && firstDecoded.seq > cursorState.seq + 1) {
                fallbackReason = 'cursor_trimmed';
              } else if (
                latestRedisEntry &&
                latestRedisEntry.seq < cursorState.seq
              ) {
                fallbackReason = 'gap_detected';
              } else if (
                latestRedisEntry &&
                compareRedisIds(latestRedisEntry.redisId, cursorState.redisId) <
                  0
              ) {
                fallbackReason = 'gap_detected';
              } else if (!latestRedisEntry && cursorState.seq > 0) {
                fallbackReason = 'gap_detected';
              }
            }

            if (!fallbackReason) {
              yield {
                type: 'cursor',
                status: {
                  cursor: encodeCursor({
                    streamKey: args.streamKey,
                    seq: lastSeq,
                    redisId: redisCursor,
                  }),
                  phase: 'replay',
                  source: 'redis',
                },
              };

              while (true) {
                const result = await streamRedis.xread(
                  'COUNT',
                  String(limit),
                  'STREAMS',
                  redisKey,
                  redisCursor,
                );
                const entries = decodeXreadResponse(result);
                if (entries.length === 0) {
                  break;
                }

                for (const entry of entries) {
                  lastSeq = entry.seq;
                  redisCursor = entry.redisId;
                  const cursor = encodeCursor({
                    streamKey: args.streamKey,
                    seq: entry.seq,
                    redisId: entry.redisId,
                  });
                  yield {
                    type: 'event',
                    item: {
                      event: entry.event,
                      data: entry.data as TEvents[keyof TEvents],
                      cursor,
                      ts: entry.ts,
                    } as StreamMessage<TEvents>,
                  };
                }
              }

              yield {
                type: 'cursor',
                status: {
                  cursor: encodeCursor({
                    streamKey: args.streamKey,
                    seq: lastSeq,
                    redisId: redisCursor,
                  }),
                  phase: 'live',
                  source: 'redis',
                },
              };

              while (true) {
                if (args.signal?.aborted) return;
                const result = await streamRedis.xread(
                  'COUNT',
                  String(limit),
                  'BLOCK',
                  String(blockMs),
                  'STREAMS',
                  redisKey,
                  redisCursor,
                );
                const entries = decodeXreadResponse(result);
                if (entries.length === 0) {
                  if (readMode === 'redis_with_pg_fallback' && driver) {
                    const latestEntry = decodeRedisEntries(
                      await streamRedis.xrevrange(
                        redisKey,
                        '+',
                        '-',
                        'COUNT',
                        1,
                      ),
                    )[0];
                    if (
                      latestEntry &&
                      (latestEntry.seq < lastSeq ||
                        compareRedisIds(latestEntry.redisId, redisCursor) < 0)
                    ) {
                      yield* replayFromPostgres<TEvents>(
                        logger,
                        driver,
                        collectionName,
                        args.streamKey,
                        lastSeq,
                        'gap_detected',
                      );

                      const latestPersisted = await readLatestPersistedEvent(
                        logger,
                        driver,
                        collectionName,
                        args.streamKey,
                      );
                      lastSeq = Math.max(
                        latestPersisted?.seq ?? 0,
                        latestEntry.seq,
                      );
                      redisCursor = latestEntry.redisId;
                      yield {
                        type: 'cursor',
                        status: {
                          cursor: encodeCursor({
                            streamKey: args.streamKey,
                            seq: lastSeq,
                            redisId: redisCursor,
                          }),
                          phase: 'live',
                          source: 'redis',
                          recovered: true,
                          reason: 'gap_detected',
                        },
                      };
                    }
                  }
                  continue;
                }

                for (const entry of entries) {
                  lastSeq = entry.seq;
                  redisCursor = entry.redisId;
                  const cursor = encodeCursor({
                    streamKey: args.streamKey,
                    seq: entry.seq,
                    redisId: entry.redisId,
                  });
                  yield {
                    type: 'event',
                    item: {
                      event: entry.event,
                      data: entry.data as TEvents[keyof TEvents],
                      cursor,
                      ts: entry.ts,
                    } as StreamMessage<TEvents>,
                  };
                }
              }
            }

            if (
              fallbackReason &&
              readMode === 'redis_with_pg_fallback' &&
              driver
            ) {
              yield* replayFromPostgres<TEvents>(
                logger,
                driver,
                collectionName,
                args.streamKey,
                lastSeq,
                fallbackReason,
              );

              if (
                fallbackReason === 'cursor_trimmed' ||
                fallbackReason === 'gap_detected'
              ) {
                const latestPersisted = await readLatestPersistedEvent(
                  logger,
                  driver,
                  collectionName,
                  args.streamKey,
                );

                const recoveredSeq = Math.max(
                  latestPersisted?.seq ?? 0,
                  latestRedisEntry?.seq ?? 0,
                );

                if (recoveredSeq > 0) {
                  lastSeq = recoveredSeq;
                }

                if (latestRedisEntry) {
                  redisCursor = latestRedisEntry.redisId;
                } else if (latestPersisted) {
                  redisCursor = latestPersisted.redisId;
                } else {
                  redisCursor = '0-0';
                }
                yield {
                  type: 'cursor',
                  status: {
                    cursor: encodeCursor({
                      streamKey: args.streamKey,
                      seq: lastSeq,
                      redisId: redisCursor,
                    }),
                    phase: 'live',
                    source: 'redis',
                    recovered: true,
                    reason: fallbackReason,
                  },
                };

                while (true) {
                  if (args.signal?.aborted) return;
                  const result = await streamRedis.xread(
                    'COUNT',
                    String(limit),
                    'BLOCK',
                    String(blockMs),
                    'STREAMS',
                    redisKey,
                    redisCursor,
                  );
                  const entries = decodeXreadResponse(result);
                  if (entries.length === 0) {
                    const latestEntry = decodeRedisEntries(
                      await streamRedis.xrevrange(
                        redisKey,
                        '+',
                        '-',
                        'COUNT',
                        1,
                      ),
                    )[0];
                    if (
                      latestEntry &&
                      (latestEntry.seq < lastSeq ||
                        compareRedisIds(latestEntry.redisId, redisCursor) < 0)
                    ) {
                      yield* replayFromPostgres<TEvents>(
                        logger,
                        driver,
                        collectionName,
                        args.streamKey,
                        lastSeq,
                        'gap_detected',
                      );

                      const latestPersisted = await readLatestPersistedEvent(
                        logger,
                        driver,
                        collectionName,
                        args.streamKey,
                      );
                      lastSeq = Math.max(
                        latestPersisted?.seq ?? 0,
                        latestEntry.seq,
                      );
                      redisCursor = latestEntry.redisId;
                      yield {
                        type: 'cursor',
                        status: {
                          cursor: encodeCursor({
                            streamKey: args.streamKey,
                            seq: lastSeq,
                            redisId: redisCursor,
                          }),
                          phase: 'live',
                          source: 'redis',
                          recovered: true,
                          reason: 'gap_detected',
                        },
                      };
                    }
                    continue;
                  }

                  for (const entry of entries) {
                    lastSeq = entry.seq;
                    redisCursor = entry.redisId;
                    const cursor = encodeCursor({
                      streamKey: args.streamKey,
                      seq: entry.seq,
                      redisId: entry.redisId,
                    });
                    yield {
                      type: 'event',
                      item: {
                        event: entry.event,
                        data: entry.data as TEvents[keyof TEvents],
                        cursor,
                        ts: entry.ts,
                      } as StreamMessage<TEvents>,
                    };
                  }
                }
              }

              return;
            }

            if (fallbackReason) {
              throw new Error('Redis cursor no longer available');
            }
          } catch (error) {
            if (readMode !== 'redis_with_pg_fallback' || !driver) {
              throw error;
            }

            yield* replayFromPostgres<TEvents>(
              logger,
              driver,
              collectionName,
              args.streamKey,
              lastSeq,
              'redis_unavailable',
            );
            return;
          }
        }

        if (!driver) {
          throw new Error(
            'Postgres fallback requested but no driver was configured',
          );
        }

        yield* replayFromPostgres<TEvents>(
          logger,
          driver,
          collectionName,
          args.streamKey,
          lastSeq,
        );
      } finally {
        if (ownsStreamRedis) {
          streamRedis.disconnect();
        }
      }
    },
  };

  return client;
}

function resolveSettings(
  defaults: StreamDefaults | undefined,
  streamSettings: CreateStreamsClientOptions['streams'] | undefined,
  streamKey: string,
) {
  const override = streamSettings?.[streamKey];
  return {
    durability:
      override?.durability ?? defaults?.durability ?? DEFAULTS.durability,
    readMode: defaults?.readMode ?? DEFAULTS.readMode,
    retention: {
      maxAgeMs:
        override?.retention?.maxAgeMs ??
        defaults?.retention?.maxAgeMs ??
        DEFAULTS.retention.maxAgeMs,
      maxLen:
        override?.retention?.maxLen ??
        defaults?.retention?.maxLen ??
        DEFAULTS.retention.maxLen,
    },
    redisPrefix: defaults?.redisPrefix ?? DEFAULTS.redisPrefix,
  };
}

function redisStreamKey(prefix: string, streamKey: string): string {
  return `${prefix}:stream:${streamKey}`;
}

function redisSeqKey(prefix: string, streamKey: string): string {
  return `${prefix}:seq:${streamKey}`;
}

function persistedEventId(streamKey: string, seq: number): string {
  return `${streamKey}:${seq}`;
}

async function* replayFromPostgres<TEvents extends object>(
  logger: Logger,
  driver: Driver,
  collectionName: string,
  streamKey: string,
  initialSeq: number,
  reason?: 'cursor_trimmed' | 'redis_unavailable' | 'gap_detected',
): AsyncGenerator<StreamItem<TEvents>, void, unknown> {
  let afterSeq = initialSeq;
  let afterRedisId = '0-0';

  yield {
    type: 'cursor',
    status: {
      cursor: encodeCursor({
        streamKey,
        seq: afterSeq,
        redisId: afterRedisId,
      }),
      phase: 'replay',
      source: 'postgres',
      recovered: reason !== undefined,
      reason,
    },
  };

  while (true) {
    const items = await readPersistedEventsAfter(
      logger,
      driver,
      collectionName,
      streamKey,
      afterSeq,
      500,
    );
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const cursor = encodeCursor({
        streamKey,
        seq: item.seq,
        redisId: item.redisId,
      });
      let parsedData: unknown;
      parsedData = safeParseJson(item.dataJson);

      yield {
        type: 'event',
        item: {
          event: item.event,
          data: parsedData as TEvents[keyof TEvents],
          cursor,
          ts: item.ts,
        } as StreamMessage<TEvents>,
      };
      afterSeq = item.seq;
      afterRedisId = item.redisId;
    }
  }

  yield {
    type: 'cursor',
    status: {
      cursor: encodeCursor({
        streamKey,
        seq: afterSeq,
        redisId: afterRedisId,
      }),
      phase: 'live',
      source: 'postgres',
      recovered: reason !== undefined,
      reason,
    },
  };
}

function decodeXreadResponse(raw: unknown): Array<{
  redisId: string;
  seq: number;
  event: string;
  data: unknown;
  ts: string;
}> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const first = raw[0];
  if (!Array.isArray(first) || first.length < 2 || !Array.isArray(first[1])) {
    return [];
  }

  return decodeRedisEntries(first[1] as RedisStreamEntry[]);
}

function decodeRedisEntries(entries: RedisStreamEntry[]): Array<{
  redisId: string;
  seq: number;
  event: string;
  data: unknown;
  ts: string;
}> {
  const decoded: Array<{
    redisId: string;
    seq: number;
    event: string;
    data: unknown;
    ts: string;
  }> = [];

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }
    const [redisId, fieldsArray] = entry;
    const fields = toFieldRecord(fieldsArray);
    const seq = Number(fields.seq ?? 0);
    const event = fields.event ?? '';
    const ts = fields.ts ?? new Date().toISOString();
    const dataJson = fields.data ?? 'null';
    const parsedData = safeParseJson(dataJson);

    decoded.push({
      redisId,
      seq,
      event,
      data: parsedData,
      ts,
    });
  }

  return decoded;
}

function toFieldRecord(values: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i];
    const value = values[i + 1];
    if (key !== undefined && value !== undefined) {
      record[key] = value;
    }
  }
  return record;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
