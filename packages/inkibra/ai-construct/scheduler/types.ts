/**
 * Scheduler Types
 *
 * Type definitions for the response scheduling system.
 *
 * The scheduler is the only post-impulse arbiter. It decides:
 * - wait: hold everything, something interesting is in flight
 * - act: respond to a batch of scheduled responses now, optionally dropping others
 *
 * The response stage then takes the selected batch and produces one plain-text
 * output covering all selected intents.
 */

import type { AIDeps } from '@inkibra/ai-flow';
import type { StageAiSettings } from '../construct/types';
import type {
  Impulse,
  ImpulseId,
  ImpulseUrgency,
  WaitForIdleTarget,
} from '../impulse/types';

// Re-export event types (kept in a cycle-free file)
export type {
  SchedulerConsideration,
  SchedulerDecision,
  SchedulerDecisionMetrics,
  SchedulerWaitCondition,
} from './event-types';

/**
 * A response that has been scheduled by an impulse.
 */
export type ScheduledResponse = {
  /** Unique identifier for this scheduled response */
  id: string;

  /** Which impulse scheduled this response */
  scheduledBy: ImpulseId;

  /** When the response was scheduled */
  scheduledAt: Date;

  /** Semantic urgency from the impulse stage. */
  urgency: ImpulseUrgency;

  /** Which pools/profiles must be idle before executing */
  waitForIdleTargets?: WaitForIdleTarget[];

  /** What the response should address */
  intent: string;
};

// ---------------------------------------------------------------------------
// Scheduler Decision
// ---------------------------------------------------------------------------

/**
 * State of the response scheduler.
 */
export type SchedulerState = {
  /** Responses waiting to be executed */
  scheduled: ScheduledResponse[];

  /** IDs of currently processing impulses */
  inProgressImpulses: ImpulseId[];

  /** Active impulses with triggers */
  activeImpulses: Impulse[];

  /** Responses currently executing */
  activeResponses: string[];

  /** Whether a poll() is currently in-flight */
  polling?: boolean;

  /**
   * Whether scheduler is currently running execution logic.
   * @deprecated Use `polling` instead. Kept for backward compat with
   * live projection / actor-runtime checks during migration.
   */
  schedulerBusy: boolean;

  /** When the last response was executed */
  lastExecutedAt?: Date;

  /** Whether the scheduler is currently running */
  isRunning: boolean;
};

/**
 * Configuration for the response scheduler.
 */
export type SchedulerConfig = {
  /** Whether to preview in-progress impulses when generating responses */
  previewInProgress: boolean;

  /** Minimum delay between responses (ms) */
  minDelayBetweenResponses: number;

  /** How often to poll for ready responses (ms) */
  pollInterval: number;

  /** Fallback model used when a stage config does not provide one */
  defaultModel?: string;

  /** Optional per-stage AI settings for scheduler decisions */
  decisionStage?: StageAiSettings;

  /** Optional system prompt for scheduler decisions */
  decisionPrompt?: string;

  /** Minimum interval between decision calls (ms) */
  decisionMinInterval: number;

  /** AI deps for scheduler decision model */
  decisionDeps?: AIDeps;

  /**
   * Pre-AI gate: sibling impulse window.
   * Impulses that started within this many ms of the scheduling impulse
   * are considered "siblings" — if any are still running, the gate delays.
   * (ms, default 2000)
   */
  siblingImpulseWindowMs: number;

  /**
   * Pre-AI gate: max delay before proceeding regardless.
   * Even if sibling impulses are still running, proceed after this many ms.
   * (ms, default 3000)
   */
  maxGateDelayMs: number;

  /**
   * Max time to wait for an AI waitUntil condition before proceeding anyway.
   * (ms, default 10000)
   */
  maxAiWaitMs: number;
};

/**
 * Default scheduler configuration.
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  defaultModel: 'moonshotai/kimi-k2.5',
  previewInProgress: true,
  minDelayBetweenResponses: 500,
  pollInterval: 100,
  decisionMinInterval: 500,
  siblingImpulseWindowMs: 2000,
  maxGateDelayMs: 3000,
  maxAiWaitMs: 10000,
};

// ---------------------------------------------------------------------------
// Response Execution
// ---------------------------------------------------------------------------

/**
 * Result of executing a batch of scheduled responses.
 *
 * In the new batch model the response stage produces one combined output
 * covering all selected intents.
 */
export type BatchResponseExecutionResult = {
  /** IDs of the selected scheduled responses this batch covered */
  respondedTo: string[];
  /** Combined plain-text content (split into messages at delivery) */
  content: string;
  generatedAt: Date;
  durationMs: number;
  disposition: 'executed' | 'dropped';
};

/**
 * Result of executing a scheduled response (single).
 * @deprecated Prefer BatchResponseExecutionResult for new code.
 */
export type ResponseExecutionResult = {
  responseId: string;
  content: string;
  generatedAt: Date;
  clearedResponses: string[];
  durationMs: number;
  disposition: 'executed' | 'deferred' | 'dropped';
};
