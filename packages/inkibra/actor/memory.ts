import type {
  ActorCheckpointRecord,
  ActorCheckpointStore,
  ActorId,
  ActorLeaseRecord,
  ActorLeaseStore,
} from './types';

export function createInMemoryActorLeaseStore(): ActorLeaseStore {
  const leases = new Map<ActorId, ActorLeaseRecord>();
  const epochByActor = new Map<ActorId, number>();

  return {
    async acquire({ actorId, ownerId, leaseMs, now }) {
      const existing = leases.get(actorId);
      if (
        existing &&
        new Date(existing.leaseExpiresAt).getTime() > new Date(now).getTime()
      ) {
        return null;
      }

      const nextEpoch = (epochByActor.get(actorId) ?? 0) + 1;
      epochByActor.set(actorId, nextEpoch);
      const record: ActorLeaseRecord = {
        actorId,
        ownerId,
        ownerEpoch: nextEpoch,
        leaseExpiresAt: new Date(
          new Date(now).getTime() + leaseMs,
        ).toISOString(),
      };
      leases.set(actorId, record);
      return record;
    },

    async renew({ actorId, ownerId, ownerEpoch, leaseMs, now }) {
      const existing = leases.get(actorId);
      if (
        !existing ||
        existing.ownerId !== ownerId ||
        existing.ownerEpoch !== ownerEpoch
      ) {
        return null;
      }

      const record: ActorLeaseRecord = {
        ...existing,
        leaseExpiresAt: new Date(
          new Date(now).getTime() + leaseMs,
        ).toISOString(),
      };
      leases.set(actorId, record);
      return record;
    },

    async release({ actorId, ownerId, ownerEpoch }) {
      const existing = leases.get(actorId);
      if (
        existing &&
        existing.ownerId === ownerId &&
        existing.ownerEpoch === ownerEpoch
      ) {
        leases.delete(actorId);
      }
    },

    async current(actorId) {
      return leases.get(actorId);
    },
  };
}

export function createInMemoryActorCheckpointStore<
  TCheckpoint,
>(): ActorCheckpointStore<TCheckpoint> {
  const records = new Map<ActorId, ActorCheckpointRecord<TCheckpoint>>();

  return {
    async load(actorId) {
      return records.get(actorId);
    },
    async save(record) {
      records.set(record.actorId, record);
    },
  };
}
