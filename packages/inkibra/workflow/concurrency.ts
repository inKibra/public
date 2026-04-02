import type Redis from 'ioredis';

export type ConcurrencyScope = {
  kind: 'workflow' | 'resource';
  key: string;
  maxActive: number;
};

export type ConcurrencyLease = {
  release: () => Promise<void>;
  heartbeat: () => Promise<void>;
  scopes: ConcurrencyScope[];
};

export type WorkflowConcurrencyManager = {
  acquire: (
    scopes: ConcurrencyScope[],
    leaseMs: number,
  ) => Promise<ConcurrencyLease | null>;
};

export class InMemoryWorkflowConcurrencyManager
  implements WorkflowConcurrencyManager
{
  private readonly counts = new Map<string, number>();

  async acquire(
    scopes: ConcurrencyScope[],
    _leaseMs: number,
  ): Promise<ConcurrencyLease | null> {
    if (scopes.length === 0) {
      return {
        scopes,
        release: async () => {},
        heartbeat: async () => {},
      };
    }

    const sorted = [...scopes].sort((a, b) => {
      const left = `${a.kind}:${a.key}`;
      const right = `${b.kind}:${b.key}`;
      return left.localeCompare(right);
    });

    for (const scope of sorted) {
      const key = `${scope.kind}:${scope.key}`;
      const current = this.counts.get(key) ?? 0;
      if (current >= scope.maxActive) {
        return null;
      }
    }

    for (const scope of sorted) {
      const key = `${scope.kind}:${scope.key}`;
      const current = this.counts.get(key) ?? 0;
      this.counts.set(key, current + 1);
    }

    let released = false;

    return {
      scopes: sorted,
      heartbeat: async () => {},
      release: async () => {
        if (released) {
          return;
        }
        released = true;

        for (const scope of sorted) {
          const key = `${scope.kind}:${scope.key}`;
          const current = this.counts.get(key) ?? 0;
          const next = current - 1;
          if (next <= 0) {
            this.counts.delete(key);
          } else {
            this.counts.set(key, next);
          }
        }
      },
    };
  }
}

export function createRedisWorkflowConcurrencyManager(
  redis: Redis,
  options: {
    prefix?: string;
  } = {},
): WorkflowConcurrencyManager {
  const prefix = options.prefix ?? 'workflow:concurrency';

  async function acquireOne(
    scope: ConcurrencyScope,
    leaseMs: number,
  ): Promise<boolean> {
    const key = `${prefix}:${scope.kind}:${scope.key}`;
    const result = await redis.eval(
      `
local key = KEYS[1]
local max_active = tonumber(ARGV[1])
local lease_ms = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key) or '0')
if current >= max_active then
  return 0
end

local next_value = redis.call('INCR', key)
redis.call('PEXPIRE', key, lease_ms)

return next_value
      `,
      1,
      key,
      String(scope.maxActive),
      String(leaseMs),
    );

    return Number(result) > 0;
  }

  async function releaseOne(scope: ConcurrencyScope): Promise<void> {
    const key = `${prefix}:${scope.kind}:${scope.key}`;
    await redis.eval(
      `
local key = KEYS[1]

if redis.call('EXISTS', key) == 0 then
  return 0
end

local next_value = tonumber(redis.call('DECR', key))
if next_value <= 0 then
  redis.call('DEL', key)
  return 0
end

return next_value
      `,
      1,
      key,
    );
  }

  async function heartbeatOne(
    scope: ConcurrencyScope,
    leaseMs: number,
  ): Promise<void> {
    const key = `${prefix}:${scope.kind}:${scope.key}`;
    await redis.eval(
      `
local key = KEYS[1]
local lease_ms = tonumber(ARGV[1])

if redis.call('EXISTS', key) == 1 then
  redis.call('PEXPIRE', key, lease_ms)
  return 1
end

return 0
      `,
      1,
      key,
      String(leaseMs),
    );
  }

  return {
    acquire: async (
      scopes: ConcurrencyScope[],
      leaseMs: number,
    ): Promise<ConcurrencyLease | null> => {
      if (scopes.length === 0) {
        return {
          scopes,
          release: async () => {},
          heartbeat: async () => {},
        };
      }

      const sorted = [...scopes].sort((a, b) => {
        const left = `${a.kind}:${a.key}`;
        const right = `${b.kind}:${b.key}`;
        return left.localeCompare(right);
      });

      const acquired: ConcurrencyScope[] = [];

      for (const scope of sorted) {
        const ok = await acquireOne(scope, leaseMs);
        if (!ok) {
          for (const held of acquired.reverse()) {
            await releaseOne(held);
          }
          return null;
        }
        acquired.push(scope);
      }

      let released = false;

      return {
        scopes: sorted,
        heartbeat: async () => {
          if (released) {
            return;
          }
          for (const scope of sorted) {
            await heartbeatOne(scope, leaseMs);
          }
        },
        release: async () => {
          if (released) {
            return;
          }
          released = true;
          for (const scope of [...sorted].reverse()) {
            await releaseOne(scope);
          }
        },
      };
    },
  };
}
