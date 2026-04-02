/**
 * Impulse Types
 *
 * Type definitions for the impulse system.
 */

import type { Perception } from '../construct/types';
import { IMPULSE_POOL_NAME } from './keys';

/**
 * Types of impulses, determining which log they write to and how they're gated.
 */
export type ImpulseType = string;

export type ImpulseUrgency =
  | 'none'
  | 'defer'
  | 'low'
  | 'normal'
  | 'urgent'
  | 'now';

export type ImpulseDecisionOutput = {
  thinking: string;
  intent: string | null;
  urgency: ImpulseUrgency;
  /** Null means observation-only: no preview is committed. */
  execId: string | null;
};

export type WaitForIdleTarget<
  TPoolName extends string = string,
  TProfileName extends string = string,
> =
  | {
      kind: 'pool';
      name: TPoolName;
    }
  | {
      kind: 'profile';
      name: TProfileName;
    };

export type ImpulseProfileConfig<
  TPoolName extends string = string,
  TProfileName extends string = string,
> = {
  pool?: TPoolName;
  thinkPrompt?: string;
  schedulePrompt?: string;
  waitForIdleTargets?: WaitForIdleTarget<TPoolName, TProfileName>[];
  /**
   * @deprecated Use `computerConfig` on `ConstructConfig` instead.
   * Legacy code execution config for the old execute tool.
   * Ignored when computerConfig is provided.
   */
  codeExecution?: import('@inkibra/ai-flow/codemode/types').CodeExecutionConfig<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<
      string,
      import('@inkibra/ai-flow/codemode/types').CodeFunction<any, any, any>
    >
  >;
};

export type ImpulseProfileMap<
  TProfileName extends string = string,
  TPoolName extends string = string,
> = Record<TProfileName, ImpulseProfileConfig<TPoolName, TProfileName>>;

export function defineImpulseProfiles<
  const TProfiles extends ImpulseProfileMap<string, string>,
>(profiles: TProfiles): TProfiles {
  return profiles;
}

/**
 * Unique identifier for an impulse.
 */
export type ImpulseId = string;

/**
 * Status of an impulse in the pool.
 */
export type ImpulseStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'abandoned';

/**
 * An impulse represents the construct's internal reaction to a perception.
 */
export type Impulse<
  TProfileName extends string = string,
  TPoolName extends string = string,
> = {
  /** Unique identifier */
  id: ImpulseId;

  /** Type determines which log and pool slot */
  type: ImpulseType;

  /** Lane for context isolation, log routing, and scheduler grouping.
   * Defaults to impulse.type if not explicitly set. */
  lane: string;

  /** Profile controls prompts/tools/scheduling defaults */
  profile: TProfileName;

  /** Pool controls concurrency and wait-for-idle semantics */
  pool: TPoolName;

  /** The perception that triggered this impulse */
  triggeredBy: Perception;

  /** When the impulse started processing */
  startedAt: Date;

  /**
   * Attention level (0.0 - 1.0).
   * Reduced when superseded by newer perceptions.
   */
  attention: number;

  /** Current status */
  status: ImpulseStatus;

  /** When completed (if completed) */
  completedAt?: Date;
};

/**
 * Configuration for the impulse pool.
 */
export type ImpulsePoolConfig = {
  /** Maximum concurrent impulses across all types */
  globalMax: number;

  /** Per-type concurrency limits */
  perType: {
    [IMPULSE_POOL_NAME.CONVERSATION]: number;
    [IMPULSE_POOL_NAME.BACKGROUND]: number;
    [IMPULSE_POOL_NAME.INTERNAL]: number;
  };

  /** Optional per-pool concurrency limits for custom pools */
  perPool?: Record<string, number>;

  /** What to do when pool is full */
  overflow: 'queue' | 'drop-oldest' | 'drop-newest';

  /** Attention decay multiplier when a new perception supersedes */
  attentionDecayOnSupersede: number;

  /** Minimum attention level to complete (below this, abandon) */
  minAttentionToComplete: number;

  /**
   * Initial value for the per-pool impulse counter.
   * Set this from persisted state to avoid ID collisions across restarts.
   */
  initialCounter?: number;
};

/**
 * Default impulse pool configuration.
 */
export const DEFAULT_IMPULSE_POOL_CONFIG: ImpulsePoolConfig = {
  globalMax: 5,
  perType: {
    conversation: 2,
    background: 3,
    internal: 2,
  },
  perPool: {},
  overflow: 'queue',
  attentionDecayOnSupersede: 0.5,
  minAttentionToComplete: 0.1,
};

/**
 * An entry in an impulse log file.
 */
export type ImpulseLogEntry = {
  /** Timestamp of this entry */
  timestamp: Date;

  /** Which impulse wrote this */
  impulseId: ImpulseId;

  /** Human-readable source description */
  from: string;

  /** Impulse profile identifier */
  profile?: string;

  /** Impulse pool identifier */
  pool?: string;

  /** For background/internal: who is this about */
  regarding?: string;

  /** What triggered this impulse */
  trigger: string;

  /** The natural language thinking */
  thinking: string;

  /** Parsed action markers from the thinking */
  actions: ImpulseAction[];

  /** Tool usage during this impulse */
  toolHistory?: ToolUsage[];
};

/**
 * Tool usage entry.
 */
export type ToolUsage = {
  tool: string;
  command: string;
  output: string;
  timestamp: Date;
};

/**
 * Actions that can be performed within an impulse's thinking.
 */
export type ImpulseAction =
  | { type: 'open_file'; path: string }
  | { type: 'close_file'; path: string }
  | { type: 'write_file'; path: string; content: string }
  | {
      type: 'schedule_response';
      intent: string;
      urgency: ImpulseUrgency;
      waitForIdleTargets?: WaitForIdleTarget[];
    }
  | { type: 'spawn_subflow'; task: string }
  | { type: 'link_impulse'; targetId: ImpulseId; relationship: string };

/**
 * Result of running an impulse.
 */
export type ImpulseResult = {
  impulseId: ImpulseId;
  status: 'completed' | 'abandoned';
  logEntry: ImpulseLogEntry;
  computerResult: {
    selectedPreview:
      | import('@inkibra/ai-sandbox-computer').PreviewExecRecord
      | null;
    commitResult: import('./scheduler-commit').SchedulerCommitResult;
    responsePlans: import('@inkibra/ai-sandbox-computer').ResponsePlan[];
    urgency: ImpulseUrgency;
    thinking: string;
  };
  durationMs: number;
  /** Per-stage timing breakdown, filled by the runner for latency analysis. */
  timing?: {
    /** Time spent building context / rendering prompt (non-LLM, non-AI). */
    contextPrepMs: number;
    /** Approximate LLM streaming time = durationMs - contextPrepMs - overhead. */
    llmMs: number;
    /** Any other overhead within the runner (file ops, tool calls, log write). */
    otherMs: number;
  };
};
