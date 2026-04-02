/**
 * Scheduler Event Types
 *
 * Types emitted as construct events by the scheduler.
 * Kept in a separate file (no imports from construct/types) to break the
 * mutual construct/types ↔ scheduler/types circular reference.
 */

/**
 * What the AI scheduler is waiting for before re-entering the decision.
 *
 * - `impulse`: wait for a specific impulse to complete
 * - `any_impulse`: wait for any currently-active impulse to complete
 */
export type SchedulerWaitCondition =
  | { kind: 'impulse'; impulseId: string }
  | { kind: 'any_impulse' };

/**
 * The scheduler's batch decision output.
 *
 * - `wait`: nothing happens this poll, everything stays queued.
 *   The optional `waitUntil` tells the scheduler what condition to wait
 *   for before re-entering the AI decision. When that condition fires
 *   (impulse completes), the scheduler re-runs with updated state.
 * - `act`: respond to the selected batch and drop the listed ones.
 *   Remaining scheduled responses stay queued for future polls.
 *
 * When the scheduler selects multiple responses in `respondTo`, the
 * response stage must cover all of them in one output. If responses do
 * not belong together, the scheduler must not batch them.
 *
 * `respondTo` order is semantic priority order — the response stage
 * should address earlier intents with stronger priority.
 */
export type SchedulerDecision =
  | {
      action: 'wait';
      reason: string;
      /**
       * What the AI is waiting for. When this condition is met, the
       * scheduler re-enters the AI decision immediately rather than waiting
       * for the next poll tick.
       */
      waitUntil?: SchedulerWaitCondition;
    }
  | {
      action: 'act';
      /** Ordered response IDs to generate for. All must be covered. */
      respondTo: string[];
      /** Response IDs to drop/supersede (terminal). */
      drop: string[];
      reason: string;
    };

/**
 * Per-decision timing and gate instrumentation.
 */
export type SchedulerDecisionMetrics = {
  /** How long the pre-AI gate delayed (0 if no siblings, 0 if urgent bypass) */
  gateDelayMs: number;
  /** Why the gate did or did not delay */
  gateReason: 'sibling_impulses' | 'none' | 'urgent_bypass';
  /** How long the AI model call took */
  aiDecisionMs: number;
  /** What the AI decided */
  aiDecision: 'act' | 'wait';
  /** What the AI is waiting for (only when aiDecision=wait) */
  aiWaitUntil?: SchedulerWaitCondition;
  /**
   * How many consecutive AI 'wait' decisions before this cycle resolved
   * (0 on first decision of a cycle)
   */
  aiWaitCount: number;
  /** Total time from gate start to decision (gate + all AI calls + wait resolves) */
  totalSchedulerMs: number;
};

/**
 * Consideration context emitted before a scheduler decision.
 */
export type SchedulerConsideration = {
  /** All scheduled response IDs that were ready */
  readyIds: string[];
  /** All scheduled response IDs that were blocked */
  blockedIds: string[];
  /** Active impulse IDs at time of decision */
  activeImpulseIds: string[];
  /** Always true — AI always runs once gate clears */
  usedAi: boolean;
  /** How long the pre-AI gate delayed (ms) */
  gateDelayMs: number;
  /** Why the gate did or did not delay */
  gateReason: 'sibling_impulses' | 'none' | 'urgent_bypass';
};
