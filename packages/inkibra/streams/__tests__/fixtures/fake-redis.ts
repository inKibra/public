import type { Redis } from 'ioredis';

/**
 * Narrow in-memory Redis test double for stream-level unit tests.
 *
 * Do not expand this fixture to cover durable runtime, actor, BullMQ, lease,
 * timer, or replay semantics. Those paths should be validated with real Redis
 * behavior via Dragonfly/testcontainers in integration tests.
 */
type StreamEntry = {
  id: string;
  fields: Record<string, string>;
};

function compareRedisIds(a: string, b: string): number {
  const [aMs = 0, aSeq = 0] = a.split('-').map((x) => Number(x));
  const [bMs = 0, bSeq = 0] = b.split('-').map((x) => Number(x));
  if (aMs !== bMs) {
    return aMs - bMs;
  }
  return aSeq - bSeq;
}

function parseFieldPairs(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i];
    const value = values[i + 1];
    if (key !== undefined && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * @deprecated Prefer Dragonfly/testcontainers for behavioral tests that care
 * about durability, leases, wakeups, BullMQ, or actor/runtime correctness.
 * Keep this only for narrow stream/mailbox unit tests.
 */
export class FakeRedis {
  private streams = new Map<string, StreamEntry[]>();
  private counters = new Map<string, number>();
  private idCounter = 1;
  private failReads = false;

  setFailReads(value: boolean): void {
    this.failReads = value;
  }

  async incr(key: string | Buffer): Promise<number> {
    const normalizedKey = normalizeRedisValue(key);
    const value = (this.counters.get(normalizedKey) ?? 0) + 1;
    this.counters.set(normalizedKey, value);
    return value;
  }

  async incrby(key: string | Buffer, increment: number): Promise<number> {
    const normalizedKey = normalizeRedisValue(key);
    const value = (this.counters.get(normalizedKey) ?? 0) + increment;
    this.counters.set(normalizedKey, value);
    return value;
  }

  call: Redis['call'] = async (command: string, ...args: unknown[]) => {
    if (command.toUpperCase() !== 'SET') {
      throw new Error(`Unsupported FakeRedis call: ${command}`);
    }

    const normalizedArgs = normalizeRedisCallArgs(args);
    const [key, valueRaw, option] = normalizedArgs;
    if (!key || valueRaw === undefined) {
      throw new Error('Unexpected SET shape in FakeRedis');
    }

    const value = Number(valueRaw);
    if (!Number.isFinite(value)) {
      throw new Error('SET value must be numeric in FakeRedis');
    }

    if (!option) {
      this.counters.set(key, value);
      return 'OK';
    }

    if (option.toUpperCase() === 'GT') {
      const current = this.counters.get(key) ?? 0;
      if (value > current) {
        this.counters.set(key, value);
        return 'OK';
      }
      return null;
    }

    throw new Error(`Unsupported SET option in FakeRedis: ${option}`);
  };

  eval: Redis['eval'] = async (
    _script: string | Buffer,
    numKeys: string | number,
    ...args: unknown[]
  ) => {
    if (Number(numKeys) !== 1) {
      throw new Error('Unexpected eval key count in FakeRedis');
    }

    const normalizedArgs = normalizeRedisCallArgs(args);
    const [key, floorRaw] = normalizedArgs;
    if (!key) {
      throw new Error('Missing key for FakeRedis eval');
    }

    const floor = Number(floorRaw ?? '0');
    if (!Number.isFinite(floor)) {
      throw new Error('Invalid floor for FakeRedis eval');
    }

    const current = this.counters.get(key) ?? 0;
    let bumped = 0;
    if (current < floor) {
      this.counters.set(key, floor);
      bumped = 1;
    }

    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return [next, bumped];
  };

  resetCounters(): void {
    this.counters.clear();
  }

  xadd: Redis['xadd'] = async (
    streamKey: string | Buffer,
    ...args: unknown[]
  ) => {
    const normalizedStreamKey = normalizeRedisValue(streamKey);
    const [maxLenToken, approxToken, maxLenRaw, autoId, ...fields] =
      normalizeRedisCallArgs(args);
    if (maxLenToken !== 'MAXLEN' || approxToken !== '~' || autoId !== '*') {
      throw new Error('Unexpected xadd shape in FakeRedis');
    }

    const maxLen = Number(maxLenRaw);
    const id = `${Date.now()}-${this.idCounter++}`;
    const entry: StreamEntry = {
      id,
      fields: parseFieldPairs(fields),
    };

    const existing = this.streams.get(normalizedStreamKey) ?? [];
    existing.push(entry);

    if (Number.isFinite(maxLen) && maxLen > 0 && existing.length > maxLen) {
      const overflow = existing.length - maxLen;
      existing.splice(0, overflow);
    }

    this.streams.set(normalizedStreamKey, existing);
    return id;
  };

  xtrim: Redis['xtrim'] = async (
    streamKey: string | Buffer,
    ...args: unknown[]
  ) => {
    const normalizedStreamKey = normalizeRedisValue(streamKey);
    const [mode, approxToken, value] = normalizeRedisCallArgs(args);
    if (!value) {
      throw new Error('Unexpected xtrim shape in FakeRedis');
    }
    const entries = this.streams.get(normalizedStreamKey) ?? [];
    if (entries.length === 0) {
      return 0;
    }

    if (mode === 'MINID' && approxToken === '~') {
      const before = entries.length;
      const kept = entries.filter(
        (entry) => compareRedisIds(entry.id, value) >= 0,
      );
      this.streams.set(normalizedStreamKey, kept);
      return before - kept.length;
    }

    throw new Error('Unexpected xtrim shape in FakeRedis');
  };

  xrange: Redis['xrange'] = async (
    streamKey: string | Buffer,
    ...args: unknown[]
  ) => {
    const normalizedStreamKey = normalizeRedisValue(streamKey);
    const [_start, _end, countToken, countRaw] = normalizeRedisCallArgs(args);
    const entries = this.streams.get(normalizedStreamKey) ?? [];
    const count =
      countToken === 'COUNT' && countRaw ? Number(countRaw) : entries.length;
    return entries
      .slice(0, count)
      .map((entry) => [entry.id, flattenFields(entry.fields)]);
  };

  xrevrange: Redis['xrevrange'] = async (
    streamKey: string | Buffer,
    ...args: unknown[]
  ) => {
    const normalizedStreamKey = normalizeRedisValue(streamKey);
    const [_end, _start, countToken, countRaw] = normalizeRedisCallArgs(args);
    const entries = this.streams.get(normalizedStreamKey) ?? [];
    const count =
      countToken === 'COUNT' && countRaw ? Number(countRaw) : entries.length;
    return [...entries]
      .reverse()
      .slice(0, count)
      .map((entry) => [entry.id, flattenFields(entry.fields)]);
  };

  xread: Redis['xread'] = async (...args: unknown[]) => {
    if (this.failReads) {
      throw new Error('Injected xread failure');
    }

    const normalizedArgs = normalizeRedisCallArgs(args);
    let index = 0;
    let count = Number.POSITIVE_INFINITY;

    while (index < normalizedArgs.length) {
      const token = normalizedArgs[index];
      if (token === 'COUNT') {
        count = Number(normalizedArgs[index + 1]);
        index += 2;
        continue;
      }
      if (token === 'BLOCK') {
        index += 2;
        continue;
      }
      if (token === 'STREAMS') {
        const streamKey = normalizedArgs[index + 1];
        const afterId = normalizedArgs[index + 2];
        if (!streamKey || !afterId) {
          return null;
        }

        const entries = this.streams.get(streamKey) ?? [];
        const filtered = entries.filter(
          (entry) => compareRedisIds(entry.id, afterId) > 0,
        );
        const selected = filtered.slice(
          0,
          Number.isFinite(count) ? count : filtered.length,
        );
        if (selected.length === 0) {
          return null;
        }

        return [
          [
            streamKey,
            selected.map((entry) => [entry.id, flattenFields(entry.fields)]),
          ],
        ];
      }
      break;
    }

    return null;
  };

  streamKeyEntries(streamKey: string): Array<[string, Record<string, string>]> {
    return (this.streams.get(streamKey) ?? []).map((entry) => [
      entry.id,
      entry.fields,
    ]);
  }
}

function normalizeRedisCallArgs(args: unknown[]): string[] {
  const [first] = args;
  const rawArgs = Array.isArray(first) ? first : args;
  return rawArgs.map(normalizeRedisValue);
}

function normalizeRedisValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (value instanceof Buffer) {
    return value.toString();
  }

  throw new Error('Unsupported FakeRedis call shape');
}

function flattenFields(fields: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    out.push(key, value);
  }
  return out;
}
