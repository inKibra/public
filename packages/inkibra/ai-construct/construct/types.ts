/**
 * Construct Types
 *
 * Core type definitions for the ai-construct runtime.
 */

import type { AIDeps, OverlayFs } from '@inkibra/ai-flow';
import type { ComputerConfig } from '@inkibra/ai-sandbox-computer';
import type { Driver } from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import type OpenAI from 'openai';
import type { ImpulsePool } from '../impulse/pool';
import type { ImpulsePoolConfig, ImpulseProfileMap } from '../impulse/types';
import type { HypnoReviewState } from '../nap/flow';
import type { ResponseLifecycleDropReason } from '../response-lifecycle';
import type {
  SchedulerConsideration,
  SchedulerDecision,
  SchedulerDecisionMetrics,
} from '../scheduler/event-types';
import type { ContextPressureConfig } from '../vfs/context-pressure';

/** Configuration for a single declared lane pattern. Same-lane responses are always allowed. */
export type LaneDefinition<TDeclaredLanePattern extends string = string> = {
  /** Additional declared lane patterns this lane may respond to. Omit = self only. */
  can_respond_to?: TDeclaredLanePattern[];
};

/** Lane definitions provided at construct creation time. */
export type LaneDefinitions<TDeclaredLanePattern extends string = string> =
  Record<TDeclaredLanePattern, LaneDefinition<TDeclaredLanePattern>>;
/** Expand a declared lane pattern like `agent:*` into its concrete runtime lane space. */
export type ConcreteLaneName<TDeclaredLanePattern extends string = string> =
  TDeclaredLanePattern extends `${infer Prefix}:*`
    ? `${Prefix}:${string}`
    : TDeclaredLanePattern;

/** Default lanes: conversation is self-only; heartbeat may respond into conversation. */
export const DEFAULT_CONSTRUCT_LANES = {
  conversation: {},
  heartbeat: { can_respond_to: ['conversation'] },
} as const satisfies LaneDefinitions;

export type DefaultConstructLaneName = keyof typeof DEFAULT_CONSTRUCT_LANES;
export type ConstructPulseSource = 'developer' | 'user' | 'runtime';

export type PerceptionRole = 'user' | 'system';
export type PerceptionSource =
  | 'user_message'
  | 'system_event'
  | 'self_reminder'
  | 'time_passed';

/**
 * A perception is any normalized event that enters the construct's awareness.
 *
 * Lanes are always explicit and concrete at runtime. Provenance remains available
 * via `source`/`event`, but rendering and routing no longer depend on divergent
 * perception shapes.
 */
export type Perception<
  TLaneName extends string = string,
  TSystemEventName extends string = string,
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
> = {
  lane: TLaneName;
  role: PerceptionRole;
  source: PerceptionSource;
  content: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
  event?: TSystemEventName;
  receivedAt?: Date;
  createdAt?: Date;
  elapsed?: string;
  profile?: TImpulseProfileName;
  pool?: TImpulsePoolName;
};

export type StageAiSettings = {
  model?: string;
  verbosity?: OpenAI.Responses.ResponseTextConfig['verbosity'];
  reasoningEffort?: OpenAI.ReasoningEffort;
  reasoningSummary?: OpenAI.Reasoning['summary'];
  serviceTier?: OpenAI.Responses.ResponseCreateParams['service_tier'];
  maxOutputTokens?: OpenAI.Responses.ResponseCreateParams['max_output_tokens'];
};

export type ResponseEvalMode = 'on' | 'advisory-only' | 'off';

export type WebSearchSettings = StageAiSettings & {
  enabled?: boolean;
  searchContextSize?: 'low' | 'medium' | 'high';
};

export type ImpulseThinkToolsSettings = {
  bash?: boolean;
  execute?: boolean;
  webSearch?: WebSearchSettings;
};

export type NapCommitToolsSettings = {
  bash?: boolean;
  /**
   * Maximum number of tool calls before switching to toolChoice='none' to force
   * text output and terminate the commit stage. Defaults to 20.
   */
  maxToolCalls?: number;
};

export type StageConfig = Partial<{
  /**
   * @deprecated response/decide is removed; scheduler is now the only arbiter.
   * Kept temporarily for backward compat with existing config wiring.
   */
  'response/decide': StageAiSettings;
  'response/generate': StageAiSettings;
  'response/evalDraft': StageAiSettings;
  'response/evalRepeat': StageAiSettings;
  'response/evalTone': StageAiSettings;
  'impulse/think': StageAiSettings & { tools?: ImpulseThinkToolsSettings };
  /** @deprecated Merged into `impulse/think`; kept for config fallback only. */
  'impulse/schedule': StageAiSettings;
  'nap/analyze': StageAiSettings;
  'nap/propose': StageAiSettings;
  'nap/commit': StageAiSettings & { tools?: NapCommitToolsSettings };
  'scheduler/decide': StageAiSettings;
}>;

/**
 * Configuration for creating a construct.
 */
export type ConstructConfig<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TDeclaredLanePattern extends string = string,
> = {
  /** Unique identifier for this construct instance */
  id: string;

  /** Storage adapter for construct VFS persistence */
  storage: ConstructStorage;

  /** AI dependencies (OpenAI client, logger) - required */
  deps: AIDeps;

  /** Impulse pool configuration */
  impulsePool?: Partial<ImpulsePoolConfig>;

  /** Lane definitions declared at construct creation time. */
  lanes: LaneDefinitions<TDeclaredLanePattern>;

  /** Per-profile scheduling and prompt defaults. */
  impulseProfiles: ImpulseProfileMap<TImpulseProfileName, TImpulsePoolName>;

  /** Queue file for paths to pin on next nap */
  nextNapPinQueuePath?: string;

  /** Queue file for host-provided imprint directives for next nap */
  nextNapImprintQueuePath?: string;

  /** Default model for AI processing (default: 'moonshotai/kimi-k2.5') */
  model?: string;

  /** Per-stage AI settings (takes precedence over `model`) */
  stageConfig?: StageConfig;

  /** Response draft evaluation mode. */
  responseEvalMode?: ResponseEvalMode;

  /** System prompt prefix for impulse processing */
  systemPrompt?: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Context pressure configuration */
  contextPressure?: Partial<ContextPressureConfig>;

  /** Command computer configuration — commands, bindings, modules, ai SDK */
  computerConfig: ComputerConfig;

  /**
   * Developer-registered intent hints for auto-preview matching.
   * Written to /developer/intents/registry.toml at construct init (read-only to agent).
   * Agent can add its own intents to /agent/intents/registry.toml via commands.
   */
  intents?: Array<{ intent: string; hint: string; command: string }>;

  /** Scheduler runtime policy */
  scheduler?: {
    autoStartPolling?: boolean;
  };
};

/**
 * Current state of the construct (for inspection).
 */
export type ConstructState = {
  id: string;
  storage: string;
  isRunning: boolean;
  activeImpulses: number;
  queuedPerceptions: number;
  scheduledResponses: number;
};

export type FileConstructStorage = {
  kind: 'file';
  baseDir: string;
};

export type DalConstructStorage = {
  kind: 'dal';
  driver: Driver;
  logger?: Logger;
  collection?: string;
};

export type ConstructStorage = FileConstructStorage | DalConstructStorage;

export type ConstructRuntimeState = {
  activeImpulses: number;
  scheduledResponses: number;
  activeResponses: number;
  /** Whether a scheduler poll() is in-flight */
  schedulerPolling?: boolean;
  /**
   * @deprecated Use schedulerPolling. Kept for backward compat during migration.
   * True when schedulerPolling || scheduledResponses > 0 || activeResponses > 0.
   */
  schedulerBusy: boolean;
  oldestActiveImpulseAgeMs?: number;
  activeImpulseIds?: string[];
};

/**
 * A read-only view of a Construct instance.
 * Exposes only state-inspection methods — no mutation operations
 * (no ingest, rate, steer, flush, start, stop, etc.).
 * Used by snapshot routes to safely borrow a construct reference
 * from the actor runtime without risking side effects.
 */
export interface ReadonlyConstructView {
  readonly id: string;
  getState(): Promise<ConstructState>;
  getRuntimeState(): Promise<ConstructRuntimeState>;
  getVfs(): OverlayFs;
  getImpulsePool(): ImpulsePool;
  isHypnoActive(): boolean;
  getHypnoStage(): string | null;
  getHypnoReviewState(): HypnoReviewState | null;
}

export type ResponseThinkingStage =
  | 'response/decide'
  | 'response/generate'
  | 'response/evalDraft'
  | 'response/evalRepeat'
  | 'response/evalTone'
  | 'scheduler/decide';

/**
 * A response generated by the construct.
 */
export type ConstructResponse<TLaneName extends string = string> = {
  content: string;
  generatedAt: Date;
  scheduledBy?: string; // Impulse ID that scheduled this response
  sourceLane: TLaneName;
  targetLane: TLaneName;
  metadata?: Record<string, unknown>;
};

/**
 * Callback for when the construct generates a response.
 */
export type ResponseCallback<TLaneName extends string = string> = {
  bivarianceHack: (
    response: ConstructResponse<TLaneName>,
  ) => void | Promise<void>;
}['bivarianceHack'];
/**
 * Event types emitted by the construct for debugging/monitoring.
 */
export type ConstructEvent<
  TLaneName extends string = string,
  TSystemEventName extends string = string,
> =
  | {
      type: 'impulse:started';
      impulseId: string;
      perception: Perception<TLaneName, TSystemEventName>;
    }
  | { type: 'impulse:completed'; impulseId: string; durationMs: number }
  | { type: 'impulse:thinking'; impulseId: string; delta: string }
  | {
      type: 'impulse:tool';
      impulseId: string;
      tool: string;
      command: string;
      output: string;
    }
  | { type: 'impulse:error'; impulseId: string; error: Error }
  | {
      type: 'response:schedule_requested';
      scheduledBy: string;
      intent: string;
      urgency: import('../impulse/types').ImpulseUrgency;
      waitForIdleTargets?: Array<{ kind: 'pool' | 'profile'; name: string }>;
    }
  | {
      type: 'response:scheduled';
      responseId: string;
      scheduledBy: string;
      intent: string;
      urgency: import('../impulse/types').ImpulseUrgency;
      waitForIdleTargets?: Array<{ kind: 'pool' | 'profile'; name: string }>;
    }
  | {
      type: 'scheduler:considered';
      consideration: SchedulerConsideration;
    }
  | {
      type: 'scheduler:decided';
      decision: SchedulerDecision;
      metrics?: SchedulerDecisionMetrics;
    }
  | {
      type: 'response:batch_started';
      respondTo: string[];
      dropped: string[];
    }
  | {
      type: 'response:batch_completed';
      respondTo: string[];
      disposition: 'executed' | 'dropped';
      durationMs: number;
    }
  | {
      /**
       * @deprecated Prefer scheduler:decided for new code.
       */
      type: 'response:decided';
      responseId: string;
      decision: 'respond' | 'wait' | 'drop';
      reason: string;
    }
  | { type: 'response:selected'; responseId: string }
  | { type: 'response:executing'; responseId: string }
  | {
      type: 'response:thinking';
      responseId: string;
      stage: ResponseThinkingStage;
      delta: string;
    }
  | { type: 'response:delta'; responseId: string; delta: string }
  | {
      type: 'response:cleared';
      responseId: string;
      clearedByResponseId: string;
    }
  | {
      type: 'response:dropped';
      responseId: string;
      reason: ResponseLifecycleDropReason;
      error?: string;
    }
  | { type: 'response:delivered'; responseId: string; draftText?: string }
  | {
      type: 'transcript:entry';
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: string;
      factId?: string;
      kind: 'chat' | 'decision' | 'tool' | 'hypno-review';
      /** Lane that produced this transcript entry */
      lane?: TLaneName;
    }
  | {
      type: 'perception:queued';
      perception: Perception<TLaneName, TSystemEventName>;
    }
  | {
      type: 'source-fact:reflected';
      factId: string;
      factType:
        | 'user_message'
        | 'impulse'
        | 'system_event'
        | 'self_reminder'
        | 'time_passed'
        | 'mailbox_idle'
        | 'rate_response'
        | 'steer_directive';
      journal: 'lane-log' | 'source-events';
      reflectedAt: string;
      traceId?: string;
      processingStrategy: 'impulse' | 'none';
    }
  | { type: 'nap:started' }
  | { type: 'nap:analysis'; content: string }
  | { type: 'nap:tool'; command: string; output: string }
  | { type: 'nap:completed'; durationMs: number }
  | { type: 'nap:error'; error: Error }
  | {
      type: 'feedback:rated';
      rating: string;
      annotation?: string;
      opId?: string;
      traceId?: string;
    }
  | {
      type: 'steering:directive';
      directive: string;
      opId?: string;
      traceId?: string;
    }
  | { type: 'compaction:started' }
  | { type: 'compaction:completed'; durationMs: number }
  | { type: 'hypno:started' }
  | { type: 'hypno:stage-change'; stage: string }
  | { type: 'hypno:draft-chunk'; stage: string; text: string; delta: string }
  | { type: 'hypno:draft-ready'; stage: string; draft: string }
  | { type: 'hypno:review-chunk'; stage: string; text: string; delta: string }
  | { type: 'hypno:review-reply'; stage: string; reply: string; plan: string }
  | { type: 'hypno:plan-updated'; stage: string; plan: string }
  | { type: 'hypno:accept-warning'; message: string }
  | { type: 'hypno:completed'; durationMs: number }
  | { type: 'hypno:cancelled' }
  | { type: 'hypno:error'; error: Error };

/**
 * Callback for construct events (debugging/monitoring).
 */
export type EventCallback<
  TLaneName extends string = string,
  TSystemEventName extends string = string,
> = {
  bivarianceHack: (event: ConstructEvent<TLaneName, TSystemEventName>) => void;
}['bivarianceHack'];
