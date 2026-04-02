/**
 * Impulse Pool
 *
 * Manages concurrent impulse processing with configurable limits.
 */

import type { Perception } from '../construct/types';
import {
  CORE_IMPULSE_PROFILE_NAME,
  IMPULSE_POOL_NAME,
  systemEventImpulseProfile,
} from './keys';
import type {
  Impulse,
  ImpulseId,
  ImpulsePoolConfig,
  ImpulseProfileConfig,
  ImpulseType,
} from './types';
import { DEFAULT_IMPULSE_POOL_CONFIG } from './types';

/**
 * Generates a unique impulse ID.
 *
 * NOTE: The module-level counter is only used as a fallback.
 * Each ImpulsePool has its own counter to avoid ID collisions
 * across construct instances and server restarts.
 */
let impulseCounter = 0;
export function generateImpulseId(): ImpulseId {
  return `impulse-${++impulseCounter}`;
}

/**
 * Reset the module-level impulse counter (for testing).
 */
export function resetImpulseCounter(value = 0): void {
  impulseCounter = value;
}

/**
 * Parse the numeric suffix from an impulse ID (e.g. "impulse-42" → 42).
 * Returns 0 if the ID doesn't match the expected format.
 */
export function parseImpulseIdCounter(id: string): number {
  const match = id.match(/^impulse-(\d+)$/);
  return match ? parseInt(match[1]!, 10) : 0;
}

/**
 * Determines the impulse type for a perception.
 */
export function getImpulseType(perception: Perception): ImpulseType {
  return perception.role === 'user'
    ? IMPULSE_POOL_NAME.CONVERSATION
    : IMPULSE_POOL_NAME.BACKGROUND;
}

export function getDefaultImpulseProfile(perception: Perception): string {
  const explicit = perception.profile?.trim();
  if (explicit) {
    return explicit;
  }

  switch (perception.source) {
    case 'user_message':
      return CORE_IMPULSE_PROFILE_NAME.CONVERSATION_USER_MESSAGE;
    case 'time_passed':
      return CORE_IMPULSE_PROFILE_NAME.SYSTEM_TIME_PASSED;
    case 'system_event':
      return perception.event
        ? systemEventImpulseProfile(perception.event)
        : CORE_IMPULSE_PROFILE_NAME.BACKGROUND_DEFAULT;
    case 'self_reminder':
      return CORE_IMPULSE_PROFILE_NAME.SYSTEM_SELF_REMINDER;
  }
}

/**
 * Callback when an impulse is ready to be processed.
 */
export type OnImpulseReady = (impulse: Impulse) => void | Promise<void>;

/**
 * The impulse pool manages concurrent impulse processing.
 */
export class ImpulsePool {
  private config: ImpulsePoolConfig;
  private active: Map<ImpulseId, Impulse> = new Map();
  private queued: Array<{
    perception: Perception;
    pool: string;
    profile: string;
    lane: string;
    resolve: (impulse: Impulse) => void;
  }> = [];
  private onReady?: OnImpulseReady;
  private localCounter: number;

  constructor(config: Partial<ImpulsePoolConfig> = {}) {
    this.config = { ...DEFAULT_IMPULSE_POOL_CONFIG, ...config };
    this.config.perPool = {
      ...(DEFAULT_IMPULSE_POOL_CONFIG.perPool ?? {}),
      ...(config.perPool ?? {}),
    };
    this.localCounter = config.initialCounter ?? 0;
  }

  /**
   * Generate a unique impulse ID scoped to this pool instance.
   */
  private nextImpulseId(): ImpulseId {
    return `impulse-${++this.localCounter}`;
  }

  /**
   * Set the counter to at least the given value (used when restoring from VFS).
   */
  ensureCounterAtLeast(value: number): void {
    if (value > this.localCounter) {
      this.localCounter = value;
    }
  }

  /**
   * Set the callback for when an impulse is ready.
   */
  setOnReady(callback: OnImpulseReady): void {
    this.onReady = callback;
  }

  /**
   * Get current counts by type.
   */
  getCounts(): {
    conversation: number;
    background: number;
    internal: number;
    total: number;
    byPool: Record<string, number>;
  } {
    const counts = {
      conversation: 0,
      background: 0,
      internal: 0,
      total: 0,
      byPool: {} as Record<string, number>,
    };
    for (const impulse of this.active.values()) {
      if (impulse.type === IMPULSE_POOL_NAME.CONVERSATION) {
        counts.conversation += 1;
      } else if (impulse.type === IMPULSE_POOL_NAME.BACKGROUND) {
        counts.background += 1;
      } else if (impulse.type === IMPULSE_POOL_NAME.INTERNAL) {
        counts.internal += 1;
      }
      counts.byPool[impulse.pool] = (counts.byPool[impulse.pool] ?? 0) + 1;
      counts.total++;
    }
    return counts;
  }

  /**
   * Check if there's capacity for a new impulse of the given type.
   */
  hasCapacity(type: ImpulseType): boolean {
    const counts = this.getCounts();
    const configuredPoolMax = this.config.perPool?.[type];
    const legacyPoolMax =
      type === IMPULSE_POOL_NAME.CONVERSATION
        ? this.config.perType.conversation
        : type === IMPULSE_POOL_NAME.BACKGROUND
          ? this.config.perType.background
          : type === IMPULSE_POOL_NAME.INTERNAL
            ? this.config.perType.internal
            : this.config.perType.background;
    const poolMax = configuredPoolMax ?? legacyPoolMax;

    return (
      counts.total < this.config.globalMax &&
      (counts.byPool[type] ?? 0) < poolMax
    );
  }

  /**
   * Acquire a slot for a new impulse.
   * Returns immediately if capacity available, otherwise queues.
   */
  async acquire(
    perception: Perception,
    options?: {
      poolName?: string;
      profileName?: string;
      profileConfig?: ImpulseProfileConfig;
      lane?: string;
    },
  ): Promise<Impulse> {
    const type =
      options?.poolName ??
      options?.profileConfig?.pool ??
      getImpulseType(perception);
    const profile =
      options?.profileName ?? getDefaultImpulseProfile(perception);
    const lane = options?.lane ?? type;

    if (this.hasCapacity(type)) {
      return this.createAndActivate(perception, type, profile, lane);
    }

    // Handle overflow based on config
    switch (this.config.overflow) {
      case 'drop-oldest':
        this.dropOldest(type);
        return this.createAndActivate(perception, type, profile, lane);

      case 'drop-newest':
        // Drop this perception (return a cancelled impulse)
        return this.createCancelled(perception, type, profile, lane);

      case 'queue':
      default:
        // Queue and wait
        return new Promise((resolve) => {
          this.queued.push({ perception, resolve, profile, pool: type, lane });
        });
    }
  }

  /**
   * Create and activate an impulse.
   */
  private createAndActivate(
    perception: Perception,
    type: ImpulseType,
    profile: string,
    lane: string,
  ): Impulse {
    const impulse: Impulse = {
      id: this.nextImpulseId(),
      type,
      lane,
      profile,
      pool: type,
      triggeredBy: perception,
      startedAt: new Date(),
      attention: 1.0,
      status: 'processing',
    };

    this.active.set(impulse.id, impulse);

    // Reduce attention of other impulses of same type
    this.reduceAttention(type, impulse.id);

    // Notify callback
    if (this.onReady) {
      void this.onReady(impulse);
    }

    return impulse;
  }

  /**
   * Create a cancelled impulse (for drop-newest overflow).
   */
  private createCancelled(
    perception: Perception,
    type: ImpulseType,
    profile: string,
    lane: string,
  ): Impulse {
    return {
      id: this.nextImpulseId(),
      type,
      lane,
      profile,
      pool: type,
      triggeredBy: perception,
      startedAt: new Date(),
      attention: 0,
      status: 'abandoned',
      completedAt: new Date(),
    };
  }

  /**
   * Drop the oldest impulse of the given type.
   */
  private dropOldest(type: ImpulseType): void {
    let oldest: Impulse | null = null;
    let oldestTime = Infinity;

    for (const impulse of this.active.values()) {
      if (impulse.type === type && impulse.startedAt.getTime() < oldestTime) {
        oldest = impulse;
        oldestTime = impulse.startedAt.getTime();
      }
    }

    if (oldest) {
      oldest.status = 'abandoned';
      oldest.completedAt = new Date();
      this.active.delete(oldest.id);
    }
  }

  /**
   * Reduce attention of other impulses when a new one starts.
   */
  private reduceAttention(type: ImpulseType, excludeId: ImpulseId): void {
    for (const impulse of this.active.values()) {
      if (impulse.type === type && impulse.id !== excludeId) {
        impulse.attention *= this.config.attentionDecayOnSupersede;

        // Abandon if attention too low
        if (impulse.attention < this.config.minAttentionToComplete) {
          impulse.status = 'abandoned';
          impulse.completedAt = new Date();
        }
      }
    }
  }

  /**
   * Release an impulse slot (when impulse completes).
   */
  release(
    impulseId: ImpulseId,
    status: 'completed' | 'abandoned' = 'completed',
  ): void {
    const impulse = this.active.get(impulseId);
    if (impulse) {
      impulse.status = status;
      impulse.completedAt = new Date();
      this.active.delete(impulseId);
    }

    // Process queued items
    this.processQueue();
  }

  /**
   * Process queued perceptions if capacity available.
   */
  private processQueue(): void {
    while (this.queued.length > 0) {
      const next = this.queued[0]!;
      const type = next.pool;

      if (this.hasCapacity(type)) {
        this.queued.shift();
        const impulse = this.createAndActivate(
          next.perception,
          type,
          next.profile,
          next.lane,
        );
        next.resolve(impulse);
      } else {
        // No capacity, stop processing
        break;
      }
    }
  }

  /**
   * Get an active impulse by ID.
   */
  get(impulseId: ImpulseId): Impulse | undefined {
    return this.active.get(impulseId);
  }

  /**
   * Get all active impulses.
   */
  getActive(): Impulse[] {
    return Array.from(this.active.values());
  }

  /**
   * Get all active impulses of a specific type.
   */
  getActiveByType(type: ImpulseType): Impulse[] {
    return this.getActiveByPool(type);
  }

  getActiveByPool(pool: string): Impulse[] {
    return this.getActive().filter((i) => i.pool === pool);
  }

  getActiveByProfile(profile: string): Impulse[] {
    return this.getActive().filter((i) => i.profile === profile);
  }

  /**
   * Check if there are any active conversation impulses.
   */
  hasActiveConversation(): boolean {
    return this.getActiveByType(IMPULSE_POOL_NAME.CONVERSATION).length > 0;
  }

  /**
   * Get the number of queued perceptions.
   */
  getQueuedCount(): number {
    return this.queued.length;
  }

  /**
   * Update the attention of a specific impulse.
   */
  updateAttention(impulseId: ImpulseId, attention: number): void {
    const impulse = this.active.get(impulseId);
    if (impulse) {
      impulse.attention = Math.max(0, Math.min(1, attention));

      if (impulse.attention < this.config.minAttentionToComplete) {
        impulse.status = 'abandoned';
        impulse.completedAt = new Date();
      }
    }
  }

  /**
   * Get pool state for inspection.
   */
  getState(): {
    active: Impulse[];
    queuedCount: number;
    counts: {
      conversation: number;
      background: number;
      internal: number;
      total: number;
      byPool: Record<string, number>;
    };
    config: ImpulsePoolConfig;
  } {
    return {
      active: this.getActive(),
      queuedCount: this.queued.length,
      counts: this.getCounts(),
      config: this.config,
    };
  }
}

/**
 * Create an impulse pool.
 */
export function createImpulsePool(
  config: Partial<ImpulsePoolConfig> = {},
): ImpulsePool {
  return new ImpulsePool(config);
}
