import type {
  ActorCheckpointRecord,
  ActorCheckpointStore,
  ActorId,
  ActorLeaseRecord,
  ActorLeaseStore,
} from './types';

type ActorRedisLike = {
  get: (key: string) => Promise<string | null>;
  eval: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<unknown>;
};

export function createRedisActorLeaseStore(
  redis: ActorRedisLike,
  options: { prefix?: string } = {},
): ActorLeaseStore {
  const prefix = options.prefix ?? 'actor';

  function leaseKey(actorId: ActorId): string {
    return `${prefix}:lease:${actorId}`;
  }

  function epochKey(actorId: ActorId): string {
    return `${prefix}:lease-epoch:${actorId}`;
  }

  return {
    async acquire({ actorId, ownerId, leaseMs, now }) {
      const nowMs = new Date(now).getTime();
      const result = await redis.eval(
        `
local key = KEYS[1]
local epoch_key = KEYS[2]
local actor_id = ARGV[1]
local owner_id = ARGV[2]
local now_ms = tonumber(ARGV[3])
local lease_ms = tonumber(ARGV[4])
local expires_at = ARGV[5]

local raw = redis.call('GET', key)
local persisted_epoch = tonumber(redis.call('GET', epoch_key) or '0')
local next_epoch = persisted_epoch + 1
if raw then
  local decoded = cjson.decode(raw)
  local current_expiry = tonumber(decoded["leaseExpiresAtMs"] or "0")
  if current_expiry > now_ms then
    return nil
  end
  local current_epoch = tonumber(decoded["ownerEpoch"] or "0")
  if current_epoch >= next_epoch then
    next_epoch = current_epoch + 1
  end
end

local record = {
  actorId = actor_id,
  ownerId = owner_id,
  ownerEpoch = next_epoch,
  leaseExpiresAt = expires_at,
  leaseExpiresAtMs = now_ms + lease_ms
}
redis.call('SET', key, cjson.encode(record), 'PX', lease_ms)
redis.call('SET', epoch_key, tostring(next_epoch))
return cjson.encode(record)
        `,
        2,
        leaseKey(actorId),
        epochKey(actorId),
        actorId,
        ownerId,
        String(nowMs),
        String(leaseMs),
        new Date(nowMs + leaseMs).toISOString(),
      );

      if (!result) {
        return null;
      }

      const parsed = JSON.parse(String(result)) as ActorLeaseRecord & {
        leaseExpiresAtMs?: number;
      };
      delete parsed.leaseExpiresAtMs;
      return parsed;
    },

    async renew({ actorId, ownerId, ownerEpoch, leaseMs, now }) {
      const nowMs = new Date(now).getTime();
      const result = await redis.eval(
        `
local key = KEYS[1]
local owner_id = ARGV[1]
local owner_epoch = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local lease_ms = tonumber(ARGV[4])
local expires_at = ARGV[5]

local raw = redis.call('GET', key)
if not raw then
  return nil
end

local decoded = cjson.decode(raw)
if decoded["ownerId"] ~= owner_id or tonumber(decoded["ownerEpoch"]) ~= owner_epoch then
  return nil
end

decoded["leaseExpiresAt"] = expires_at
decoded["leaseExpiresAtMs"] = now_ms + lease_ms
redis.call('SET', key, cjson.encode(decoded), 'PX', lease_ms)
return cjson.encode(decoded)
        `,
        1,
        leaseKey(actorId),
        ownerId,
        String(ownerEpoch),
        String(nowMs),
        String(leaseMs),
        new Date(nowMs + leaseMs).toISOString(),
      );

      if (!result) {
        return null;
      }

      const parsed = JSON.parse(String(result)) as ActorLeaseRecord & {
        leaseExpiresAtMs?: number;
      };
      delete parsed.leaseExpiresAtMs;
      return parsed;
    },

    async release({ actorId, ownerId, ownerEpoch }) {
      await redis.eval(
        `
local key = KEYS[1]
local epoch_key = KEYS[2]
local owner_id = ARGV[1]
local owner_epoch = tonumber(ARGV[2])

local raw = redis.call('GET', key)
if not raw then
  return 0
end

local decoded = cjson.decode(raw)
if decoded["ownerId"] ~= owner_id or tonumber(decoded["ownerEpoch"]) ~= owner_epoch then
  return 0
end

redis.call('SET', epoch_key, tostring(owner_epoch))
redis.call('DEL', key)
return 1
        `,
        2,
        leaseKey(actorId),
        epochKey(actorId),
        ownerId,
        String(ownerEpoch),
      );
    },

    async current(actorId) {
      const raw = await redis.get(leaseKey(actorId));
      if (!raw) {
        return undefined;
      }

      const parsed = JSON.parse(raw) as ActorLeaseRecord & {
        leaseExpiresAtMs?: number;
      };
      delete parsed.leaseExpiresAtMs;
      return parsed;
    },
  };
}

export function createRedisActorCheckpointStore<TCheckpoint>(
  redis: ActorRedisLike,
  options: { prefix?: string } = {},
): ActorCheckpointStore<TCheckpoint> {
  const prefix = options.prefix ?? 'actor';

  function checkpointKey(actorId: ActorId): string {
    return `${prefix}:checkpoint:${actorId}`;
  }

  return {
    async load(actorId) {
      const raw = await redis.get(checkpointKey(actorId));
      if (!raw) {
        return undefined;
      }

      return JSON.parse(raw) as ActorCheckpointRecord<TCheckpoint>;
    },

    async save(record) {
      await redis.eval(
        `
local key = KEYS[1]
local incoming = cjson.decode(ARGV[1])
local raw = redis.call('GET', key)

if raw then
  local current = cjson.decode(raw)
  if tonumber(current["ownerEpoch"]) > tonumber(incoming["ownerEpoch"]) then
    return 0
  end

  if tonumber(current["ownerEpoch"]) == tonumber(incoming["ownerEpoch"]) then
    local current_committed = current["committedCursor"] or ""
    local incoming_committed = incoming["committedCursor"] or ""
    if current["phase"] == "committed" and incoming["phase"] == "prepared" and current_committed == incoming_committed then
      return 0
    end
  end
end

redis.call('SET', key, ARGV[1])
return 1
        `,
        1,
        checkpointKey(record.actorId),
        JSON.stringify(record),
      );
    },
  };
}
