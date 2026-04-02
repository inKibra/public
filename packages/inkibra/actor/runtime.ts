import type { StreamCursor } from '@inkibra/streams';
import type {
  ActorClock,
  ActorHostStatus,
  ActorId,
  MailboxActorContext,
  MailboxActorRuntime,
  MailboxActorRuntimeOptions,
} from './types';

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_WAKE_RETRY_MS = 250;

type HostState<TCheckpoint> = {
  actorId: ActorId;
  ownerId: string;
  ownerEpoch: number;
  status: ActorHostStatus;
  lastActiveAt: number;
  checkpoint: TCheckpoint;
  nudgeResolvers: Set<() => void>;
  stopping: boolean;
};

function isLeaseLostError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith('Actor lease lost for ')
  );
}

function createClock(clock?: Partial<ActorClock>): ActorClock {
  return {
    now: clock?.now ?? (() => new Date().toISOString()),
    setTimeout: clock?.setTimeout ?? setTimeout,
    clearTimeout: clock?.clearTimeout ?? clearTimeout,
    setInterval: clock?.setInterval ?? setInterval,
    clearInterval: clock?.clearInterval ?? clearInterval,
  };
}

export function createMailboxActorRuntime<TCheckpoint>(
  options: MailboxActorRuntimeOptions<TCheckpoint>,
): MailboxActorRuntime {
  const hosts = new Map<ActorId, HostState<TCheckpoint>>();
  const starting = new Map<ActorId, Promise<void>>();
  const wakeRetries = new Map<ActorId, ReturnType<typeof setTimeout>>();
  const runtimeLogger = options.logger.child({ component: 'mailbox-actor' });
  const clock = createClock(options.clock);
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const wakeRetryMs = options.wakeRetryMs ?? DEFAULT_WAKE_RETRY_MS;
  let shutdownRequested = false;

  function resolveNudges(host: HostState<TCheckpoint>): void {
    for (const resolve of host.nudgeResolvers) {
      resolve();
    }
    host.nudgeResolvers.clear();
  }

  function wakeHost(host: HostState<TCheckpoint>): void {
    host.lastActiveAt = Date.now();
    resolveNudges(host);
  }

  async function assertLeaseActive(
    host: HostState<TCheckpoint>,
  ): Promise<void> {
    const current = await options.leaseStore.current(host.actorId);
    if (
      !current ||
      current.ownerId !== host.ownerId ||
      current.ownerEpoch !== host.ownerEpoch
    ) {
      host.status = 'closing';
      host.stopping = true;
      throw new Error(`Actor lease lost for ${host.actorId}`);
    }
  }

  async function saveCheckpoint(args: {
    host: HostState<TCheckpoint>;
    phase: 'prepared' | 'committed';
    processedCursor?: StreamCursor;
    committedCursor?: StreamCursor;
  }): Promise<void> {
    await assertLeaseActive(args.host);
    await options.checkpointStore.save({
      actorId: args.host.actorId,
      ownerEpoch: args.host.ownerEpoch,
      phase: args.phase,
      processedCursor: args.processedCursor,
      committedCursor: args.committedCursor,
      checkpoint: args.host.checkpoint,
      updatedAt: clock.now(),
    });
    await options.onFrontierAdvanced?.({
      actorId: args.host.actorId,
      processedCursor: args.processedCursor,
      committedCursor: args.committedCursor,
      phase: args.phase,
    });
  }

  async function waitForNudgeOrPoll(
    host: HostState<TCheckpoint>,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = clock.setTimeout(() => {
        host.nudgeResolvers.delete(done);
        resolve();
      }, pollIntervalMs);

      const done = () => {
        clock.clearTimeout(timer);
        resolve();
      };

      host.nudgeResolvers.add(done);
    });
  }

  async function maybeEvictForCapacity(): Promise<boolean> {
    if (hosts.size < options.maxResidentActors) {
      return true;
    }

    const evictable = [...hosts.values()]
      .filter((host) => host.status === 'idle' && !host.stopping)
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt)[0];
    if (!evictable) {
      return false;
    }

    evictable.status = 'evicting';
    evictable.stopping = true;
    wakeHost(evictable);

    // Wait for the evicted host to finish cleanup and release its lease
    // before allowing a new host to start.
    const evictingPromise = starting.get(evictable.actorId);
    if (evictingPromise) {
      await evictingPromise.catch(() => {});
    }
    return true;
  }

  async function runHost(actorId: ActorId): Promise<void> {
    const ownerId = crypto.randomUUID();
    const lease = await options.leaseStore.acquire({
      actorId,
      ownerId,
      leaseMs,
      now: clock.now(),
    });
    if (!lease) {
      scheduleRetry(actorId);
      return;
    }

    const checkpointRecord = await options.checkpointStore.load(actorId);
    let committedCursor = checkpointRecord?.committedCursor;
    const checkpoint =
      checkpointRecord?.checkpoint ??
      (await options.definition.createInitialCheckpoint(actorId));

    const host: HostState<TCheckpoint> = {
      actorId,
      ownerId,
      ownerEpoch: lease.ownerEpoch,
      status: 'starting',
      lastActiveAt: Date.now(),
      checkpoint,
      nudgeResolvers: new Set(),
      stopping: false,
    };
    hosts.set(actorId, host);

    const mailbox = options.definition.getMailboxBinding(actorId);
    if (committedCursor) {
      await mailbox.mailbox.commit({
        mailboxKey: mailbox.mailboxKey,
        consumerKey: mailbox.consumerKey,
        cursor: committedCursor,
      });
    }
    const actorLogger = runtimeLogger.child({
      component: 'mailbox-actor-instance',
      actorId,
      actorName: options.definition.name,
      ownerEpoch: host.ownerEpoch,
    });
    const ctx: MailboxActorContext<TCheckpoint> = {
      actorId,
      logger: actorLogger,
      mailbox,
      ownerId,
      ownerEpoch: host.ownerEpoch,
      checkpoint: host.checkpoint,
      updateCheckpoint: (next) => {
        host.checkpoint = next;
        ctx.checkpoint = next;
      },
      assertLeaseActive: async () => {
        await assertLeaseActive(host);
      },
    };

    const renewInterval = clock.setInterval(
      async () => {
        if (host.stopping) {
          return;
        }

        const renewed = await options.leaseStore.renew({
          actorId,
          ownerId,
          ownerEpoch: host.ownerEpoch,
          leaseMs,
          now: clock.now(),
        });
        if (!renewed) {
          host.status = 'closing';
          host.stopping = true;
          wakeHost(host);
        }
      },
      Math.max(1_000, Math.floor(leaseMs / 3)),
    );

    // Track the processed frontier separately from the committed frontier.
    // processedCursor can run ahead of committedCursor when deferCommit=true.
    // On crash recovery with phase='prepared', reset to committedCursor so
    // un-committed messages are replayed (this is the deferCommit contract).
    let processedCursor =
      checkpointRecord?.phase === 'prepared'
        ? committedCursor
        : (checkpointRecord?.processedCursor ?? committedCursor);

    try {
      await options.definition.onStart?.(ctx);
      host.status = 'active';

      while (!shutdownRequested && !host.stopping) {
        await assertLeaseActive(host);
        const readCursor = processedCursor ?? committedCursor;
        const { messages, nextCursor } = await mailbox.mailbox.peekBatch({
          mailboxKey: mailbox.mailboxKey,
          cursor: readCursor,
          limit: mailbox.batchSize,
        });

        if (messages.length > 0) {
          host.status = 'active';
          const result = await options.definition.processMessages({
            ctx,
            messages,
            nextCursor,
          });
          if (result.checkpoint !== undefined) {
            ctx.updateCheckpoint(result.checkpoint);
          }
          host.lastActiveAt = Date.now();

          if (nextCursor) {
            if (result.deferCommit) {
              // Advance only the processed frontier. Do NOT advance the
              // durable mailbox cursor yet.
              processedCursor = nextCursor;
              await saveCheckpoint({
                host,
                phase: 'prepared',
                processedCursor: nextCursor,
                committedCursor,
              });
            } else {
              // Immediate commit — old behavior
              await saveCheckpoint({
                host,
                phase: 'prepared',
                processedCursor: nextCursor,
                committedCursor,
              });
              await mailbox.mailbox.commit({
                mailboxKey: mailbox.mailboxKey,
                consumerKey: mailbox.consumerKey,
                cursor: nextCursor,
              });
              committedCursor = nextCursor;
              processedCursor = nextCursor;
              await saveCheckpoint({
                host,
                phase: 'committed',
                processedCursor: nextCursor,
                committedCursor: nextCursor,
              });
            }
          } else if (result.didWork) {
            await saveCheckpoint({
              host,
              phase: 'committed',
              processedCursor,
              committedCursor,
            });
          }

          if (result.close) {
            host.stopping = true;
          }
          continue;
        }

        const idleResult = await options.definition.processIdle?.(ctx);
        if (idleResult) {
          if (idleResult.checkpoint !== undefined) {
            ctx.updateCheckpoint(idleResult.checkpoint);
          }
          if (idleResult.didWork || idleResult.keepAlive) {
            host.status = 'active';
            host.lastActiveAt = Date.now();
          }

          // Advance the durable frontier when processIdle says so.
          if (
            idleResult.commitProcessedCursor &&
            processedCursor &&
            processedCursor !== committedCursor
          ) {
            await mailbox.mailbox.commit({
              mailboxKey: mailbox.mailboxKey,
              consumerKey: mailbox.consumerKey,
              cursor: processedCursor,
            });
            committedCursor = processedCursor;
            await saveCheckpoint({
              host,
              phase: 'committed',
              processedCursor,
              committedCursor: processedCursor,
            });
          } else if (idleResult.didWork) {
            await saveCheckpoint({
              host,
              phase: 'committed',
              processedCursor,
              committedCursor,
            });
          }

          if (idleResult.didWork || idleResult.commitProcessedCursor) {
            if (idleResult.close) {
              host.stopping = true;
            }
            continue;
          }
          if (idleResult.close) {
            host.stopping = true;
            continue;
          }
        }

        if (Date.now() - host.lastActiveAt >= options.idleTtlMs) {
          host.status = 'closing';
          host.stopping = true;
          continue;
        }

        host.status = 'idle';
        await waitForNudgeOrPoll(host);
      }
    } catch (error) {
      if (!isLeaseLostError(error)) {
        throw error;
      }
    } finally {
      clock.clearInterval(renewInterval);
      host.status = 'closing';
      resolveNudges(host);
      try {
        await options.definition.onStop?.(ctx);
      } finally {
        await options.leaseStore.release({
          actorId,
          ownerId,
          ownerEpoch: host.ownerEpoch,
        });
        hosts.delete(actorId);
      }
    }
  }

  function scheduleRetry(actorId: ActorId): void {
    if (wakeRetries.has(actorId) || shutdownRequested) {
      return;
    }

    const timer = clock.setTimeout(() => {
      wakeRetries.delete(actorId);
      void ensureRunning(actorId);
    }, wakeRetryMs);
    wakeRetries.set(actorId, timer);
  }

  async function ensureRunning(actorId: ActorId): Promise<void> {
    const existing = hosts.get(actorId);
    if (existing) {
      wakeHost(existing);
      return;
    }

    const inFlight = starting.get(actorId);
    if (inFlight) {
      return inFlight;
    }

    const capacityAvailable = await maybeEvictForCapacity();
    if (!capacityAvailable) {
      scheduleRetry(actorId);
      return;
    }

    // After awaiting eviction, check if shutdown was requested during the wait.
    if (shutdownRequested) {
      return;
    }

    const startPromise = runHost(actorId).finally(() => {
      if (starting.get(actorId) === startPromise) {
        starting.delete(actorId);
      }
    });
    starting.set(actorId, startPromise);
    return startPromise;
  }

  return {
    ensureRunning,
    nudge(actorId) {
      const host = hosts.get(actorId);
      if (host) {
        wakeHost(host);
        return;
      }
      void ensureRunning(actorId);
    },
    async shutdown() {
      shutdownRequested = true;
      for (const timer of wakeRetries.values()) {
        clock.clearTimeout(timer);
      }
      wakeRetries.clear();
      for (const host of hosts.values()) {
        host.stopping = true;
        wakeHost(host);
      }
      await Promise.all([...starting.values()]);
    },
    getHostStatus(actorId) {
      return hosts.get(actorId)?.status;
    },
    getHostInfo(actorId) {
      const host = hosts.get(actorId);
      if (!host) {
        return undefined;
      }
      return {
        actorId: host.actorId,
        status: host.status,
        lastActiveAt: new Date(host.lastActiveAt).toISOString(),
      };
    },
    listHosts() {
      return [...hosts.values()].map((host) => ({
        actorId: host.actorId,
        status: host.status,
      }));
    },
  };
}
