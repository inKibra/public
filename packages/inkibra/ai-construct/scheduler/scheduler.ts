/**
 * Response Scheduler
 *
 * Manages scheduled responses and decides when to execute them.
 */

import {
  type AIDeps,
  createAiContext,
  createAiFlow,
  createAiOutput,
  createAiOutputStage,
  createAiPrompt,
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import type { ResponsePlan } from '@inkibra/ai-sandbox-computer';
import {
  getPerceptionDisplayContent,
  getPerceptionOrigin,
  truncatePerceptionContent,
} from '../construct/perception';
import type { Perception, StageAiSettings } from '../construct/types';
import type { ImpulsePool } from '../impulse/pool';
import type { Impulse, ImpulseUrgency } from '../impulse/types';
import { resolveStageContext } from '../vfs/context-system';
import { VFS_PATHS } from '../vfs/layout';
import type { PendingImpulseSubmission } from './preview-types';
import type {
  BatchResponseExecutionResult,
  ResponseExecutionResult,
  ScheduledResponse,
  SchedulerConfig,
  SchedulerConsideration,
  SchedulerDecision,
  SchedulerDecisionMetrics,
  SchedulerState,
  SchedulerWaitCondition,
} from './types';
import { DEFAULT_SCHEDULER_CONFIG } from './types';

const schedulerDecisionSchema = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      properties: {
        action: { const: 'wait' },
        reason: { type: 'string' },
        waitUntil: {
          oneOf: [
            {
              type: 'object',
              properties: { kind: { const: 'any_impulse' } },
              required: ['kind'],
            },
            {
              type: 'object',
              properties: {
                kind: { const: 'impulse' },
                impulseId: { type: 'string' },
              },
              required: ['kind', 'impulseId'],
            },
          ],
        },
      },
      required: ['action', 'reason'],
    },
    {
      type: 'object',
      properties: {
        action: { const: 'act' },
        respondTo: { type: 'array', items: { type: 'string' } },
        drop: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
      },
      required: ['action', 'respondTo', 'drop', 'reason'],
    },
  ],
} as const;

function isUrgentUrgency(urgency: ImpulseUrgency): boolean {
  return urgency === 'urgent' || urgency === 'now';
}

function shouldAutoWakeForUrgency(urgency: ImpulseUrgency): boolean {
  return urgency !== 'defer';
}

const DEFAULT_DECISION_PROMPT = `You are the response scheduler. You decide which scheduled responses to execute now, drop, or wait on.

Responses are NOT user-visible until executed. You can see active impulses and all scheduled responses.

Rules:
- You may batch multiple READY responses into one "respond" set if they naturally compose together.
- If responses do NOT belong together, only pick one. The rest stay queued.
- If an active impulse has interesting in-flight thinking worth waiting for, choose wait with waitUntil.
- If a scheduled response is stale, superseded, or irrelevant, drop it.
- Respond + drop can coexist in one decision. Wait is exclusive.
- The respondTo list is ordered by priority — the response stage will address earlier intents first.
- You may drop a single scheduled response if it should not produce a reply at all.

Return JSON only.

For act:
{
  "action": "act",
  "respondTo": ["id1", "id2"],
  "drop": ["id3"],
  "reason": "short explanation"
}

For wait:
{
  "action": "wait",
  "reason": "short explanation",
  "waitUntil": { "kind": "any_impulse" }
}

or:
{
  "action": "wait",
  "reason": "short explanation",
  "waitUntil": { "kind": "impulse", "impulseId": "impulse-123" }
}
`;

function validateSchedulerDecision(raw: string):
  | {
      success: true;
      data: SchedulerDecision;
      errors?: [];
    }
  | {
      success: false;
      errors: Array<{ message?: string; value?: unknown }>;
    } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      success: false,
      errors: [
        { message: error instanceof Error ? error.message : 'invalid JSON' },
      ],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      success: false,
      errors: [{ message: 'expected object', value: parsed }],
    };
  }

  const value = parsed as Record<string, unknown>;
  if (value.action === 'wait' && typeof value.reason === 'string') {
    const waitUntil = value.waitUntil as Record<string, unknown> | undefined;
    if (!waitUntil) {
      return { success: true, data: { action: 'wait', reason: value.reason } };
    }
    if (waitUntil.kind === 'any_impulse') {
      return {
        success: true,
        data: {
          action: 'wait',
          reason: value.reason,
          waitUntil: { kind: 'any_impulse' },
        },
      };
    }
    if (
      waitUntil.kind === 'impulse' &&
      typeof waitUntil.impulseId === 'string'
    ) {
      return {
        success: true,
        data: {
          action: 'wait',
          reason: value.reason,
          waitUntil: { kind: 'impulse', impulseId: waitUntil.impulseId },
        },
      };
    }
    return {
      success: false,
      errors: [{ message: 'invalid waitUntil', value: waitUntil }],
    };
  }

  if (
    value.action === 'act' &&
    typeof value.reason === 'string' &&
    Array.isArray(value.respondTo) &&
    Array.isArray(value.drop) &&
    value.respondTo.every((item) => typeof item === 'string') &&
    value.drop.every((item) => typeof item === 'string')
  ) {
    return {
      success: true,
      data: {
        action: 'act',
        respondTo: value.respondTo,
        drop: value.drop,
        reason: value.reason,
      },
    };
  }

  return {
    success: false,
    errors: [{ message: 'invalid scheduler decision payload', value: parsed }],
  };
}

/**
 * Callback for executing a single response.
 * @deprecated Prefer ExecuteBatchCallback for new code.
 */
export type ExecuteResponseCallback = (
  response: ScheduledResponse,
) => Promise<ResponseExecutionResult>;

/**
 * Callback for executing a batch of scheduled responses.
 * The response stage produces one combined output covering all selected intents.
 */
export type ExecuteBatchCallback = (
  responses: ScheduledResponse[],
) => Promise<BatchResponseExecutionResult>;

/**
 * Callback for scheduler decision events (for observability).
 */
export type SchedulerEventCallback = (event: {
  type: 'scheduler:considered' | 'scheduler:decided';
  consideration?: SchedulerConsideration;
  decision?: SchedulerDecision;
  metrics?: SchedulerDecisionMetrics;
}) => void;

/**
 * The response scheduler manages when responses should be executed.
 *
 * The scheduler is the only post-impulse arbiter. It decides:
 * - wait: hold everything, something interesting is in flight
 * - act: respond to a batch of scheduled responses now, optionally dropping others
 *
 * The response stage then takes the selected batch and produces one plain-text
 * output covering all selected intents in scheduler order (semantic priority).
 */
export class ResponseScheduler {
  private config: SchedulerConfig;
  private vfs: OverlayFs;
  private impulsePool: ImpulsePool;
  private decisionDeps?: AIDeps;
  private decisionStage: StageAiSettings;
  private decisionPrompt: string;
  private executeCallback?: ExecuteResponseCallback;
  private executeBatchCallback?: ExecuteBatchCallback;
  private eventCallback?: SchedulerEventCallback;
  private pollTimer?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private isExecuting = false; // Guard against concurrent poll executions
  private activeResponseIds = new Set<string>();
  private deferredUntilByResponseId = new Map<string, number>();
  private lastExecutedAt?: Date;
  private lastDecisionAt?: number;
  private lastDecisionSignature?: string;
  private lastDecisionResult?: SchedulerDecision;
  private mutationQueue = Promise.resolve();

  // Pre-AI gate state
  private gateEngagedAt?: number; // when gate first started delaying

  // AI waitUntil state
  private pendingWaitCondition?: SchedulerWaitCondition;
  private pendingWaitSince?: number; // when the wait was first issued
  private pendingWaitAiCount = 0; // consecutive AI waits in this cycle
  private pendingWaitCycleStart?: number; // when the current wait cycle started

  // Impulse start-time tracking for sibling detection
  private impulseStartTimeById = new Map<string, number>();

  // Preview-based impulse submissions (spec §20)
  private pendingImpulseSubmissions: PendingImpulseSubmission[] = [];
  private commitCallback?: (
    impulseId: string,
    responsePlans: ResponsePlan[],
    lane: string,
    targetLanes: string[],
  ) => Promise<void>;

  constructor(
    vfs: OverlayFs,
    impulsePool: ImpulsePool,
    config: Partial<SchedulerConfig> = {},
  ) {
    this.vfs = vfs;
    this.impulsePool = impulsePool;
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.decisionDeps = config.decisionDeps;
    this.decisionStage = {
      model:
        config.decisionStage?.model ??
        config.defaultModel ??
        'moonshotai/kimi-k2.5',
      ...config.decisionStage,
    };
    this.decisionPrompt = config.decisionPrompt ?? DEFAULT_DECISION_PROMPT;
  }

  /**
   * Set the callback for executing responses (single, legacy).
   * @deprecated Use onExecuteBatch instead.
   */
  onExecute(callback: ExecuteResponseCallback): void {
    this.executeCallback = callback;
  }

  /**
   * Set the callback for executing a batch of scheduled responses.
   */
  onExecuteBatch(callback: ExecuteBatchCallback): void {
    this.executeBatchCallback = callback;
  }

  /**
   * Set the callback for scheduler decision events (observability).
   */
  onEvent(callback: SchedulerEventCallback): void {
    this.eventCallback = callback;
  }

  /**
   * Notify the scheduler that an impulse has started.
   * Used for sibling-impulse detection in the pre-AI gate.
   */
  notifyImpulseStarted(impulseId: string): void {
    this.impulseStartTimeById.set(impulseId, Date.now());
  }

  /**
   * Notify the scheduler that an impulse has completed.
   * Triggers immediate re-evaluation if we are waiting for this impulse.
   */
  notifyImpulseCompleted(impulseId: string): void {
    // Don't clean up start-time immediately — keep it for a short while
    // so gate decisions based on recent siblings still work.
    setTimeout(() => {
      this.impulseStartTimeById.delete(impulseId);
    }, this.config.siblingImpulseWindowMs * 2);

    // If the AI issued a waitUntil for this impulse (or any_impulse),
    // wake up the scheduler immediately.
    if (!this.pendingWaitCondition) return;
    const cond = this.pendingWaitCondition;
    if (
      cond.kind === 'any_impulse' ||
      (cond.kind === 'impulse' && cond.impulseId === impulseId)
    ) {
      // Clear the wait condition so the next poll re-enters the AI decision
      this.pendingWaitCondition = undefined;
      // Trigger an immediate poll (outside the mutex — it will queue)
      void this.poll();
    }
  }

  /**
   * Start the scheduler polling loop.
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.pollInterval);
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Schedule a new response.
   */
  async schedule(
    response: Omit<ScheduledResponse, 'id' | 'scheduledAt'> & {
      id?: string;
      scheduledAt?: Date;
    },
  ): Promise<string> {
    return this.withMutationLock(async () => {
      const existing = await this.loadScheduled();
      const existingId = existing.find((entry) => entry.id === response.id)?.id;
      if (existingId) {
        return existingId;
      }

      const scheduled: ScheduledResponse = {
        ...response,
        id:
          response.id ??
          `response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        scheduledAt: response.scheduledAt ?? new Date(),
      };
      existing.push(scheduled);
      await this.saveScheduled(existing);

      return scheduled.id;
    });
  }

  /**
   * Set the callback for delivering committed plan_response proposals.
   * Called after the scheduler commits a preview.
   */
  onCommit(
    callback: (
      impulseId: string,
      responsePlans: ResponsePlan[],
      lane: string,
      targetLanes: string[],
    ) => Promise<void>,
  ): void {
    this.commitCallback = callback;
  }

  /**
   * Submit an impulse result to the scheduler (spec §20).
   * The scheduler decides when to commit the selected preview.
   * For observation-only impulses (no selectedPreview), the submission
   * is consumed immediately with no commit.
   */
  async submitImpulse(submission: PendingImpulseSubmission): Promise<void> {
    if (!submission.selectedPreview) {
      // Observation-only — nothing to commit
      return;
    }

    this.pendingImpulseSubmissions.push(submission);

    // For now (single-impulse fast path): commit immediately and deliver
    // TODO: When concurrent impulses are queued, generate ordering candidates
    // and run the scheduler LLM decision per spec §20.3-20.4
    await this.commitPendingSubmissions();
  }

  /**
   * Commit pending impulse submissions.
   *
   * Groups submissions by shared target lanes (connected components):
   * - Impulses sharing ANY target lane are grouped together
   * - Independent groups commit in parallel
   * - Single-impulse groups commit directly (fast path)
   * - Multi-impulse groups would queue for ordering candidates (future)
   */
  private async commitPendingSubmissions(): Promise<void> {
    const submissions = this.pendingImpulseSubmissions.splice(0);
    if (submissions.length === 0) return;

    // Group by shared target lanes using connected components
    const groups = groupByTargetLanes(submissions);

    // Process groups — independent groups run in parallel
    await Promise.all(
      groups.map(async (group) => {
        for (const submission of group) {
          this.decisionDeps?.logger.debug('Scheduler commitPendingSubmission', {
            impulseId: submission.impulseId,
            lane: submission.lane,
            targetLanes: submission.targetLanes,
            hasPreview: !!submission.selectedPreview,
            responsePlanCount:
              submission.selectedPreview?.responsePlans?.length ?? 0,
            hasCallback: !!this.commitCallback,
          });
          if (!submission.selectedPreview) continue;

          const responsePlans = submission.selectedPreview.responsePlans;
          if (this.commitCallback && responsePlans.length > 0) {
            try {
              await this.commitCallback(
                submission.impulseId,
                responsePlans,
                submission.lane,
                submission.targetLanes,
              );
            } catch (err) {
              this.decisionDeps?.logger.warn('Scheduler commit failed', {
                impulseId: submission.impulseId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }),
    );
  }

  /**
   * Poll for ready responses and execute them.
   *
   * The scheduler is the only post-impulse arbiter. It produces a batch
   * decision: wait, or act (respond to a batch + drop others).
   *
   * Flow:
   *   1. Check if pending AI waitUntil condition has cleared
   *   2. Run pre-AI gate (sibling impulse delay)
   *   3. Run AI decision
   *   4. If AI says wait+waitUntil, register condition and return
   *   5. If AI says act, execute batch
   */
  async poll(): Promise<SchedulerDecision | undefined> {
    if (!this.executeCallback && !this.executeBatchCallback) {
      return undefined;
    }

    return this.withMutationLock(async () => {
      if (this.isExecuting) {
        return undefined;
      }
      this.isExecuting = true;

      try {
        const scheduled = await this.loadScheduled();
        if (scheduled.length === 0) return undefined;

        const ready = scheduled.filter((r) => this.isReady(r));
        if (ready.length === 0) return undefined;
        if (
          !ready.some((response) => shouldAutoWakeForUrgency(response.urgency))
        ) {
          this.decisionDeps?.logger.debug(
            'Poll: only deferred responses ready; skipping auto-start',
          );
          return undefined;
        }

        this.decisionDeps?.logger.debug('Poll summary', {
          scheduledCount: scheduled.length,
          readyCount: ready.length,
          ready: ready.map((s) => ({
            id: s.id,
            intent: s.intent,
            urgency: s.urgency,
          })),
        });

        // ── Check pending AI waitUntil ─────────────────────────────────────
        if (this.pendingWaitCondition) {
          const waitElapsedMs =
            Date.now() - (this.pendingWaitSince ?? Date.now());
          const activeImpulses = this.impulsePool.getActive();
          const conditionMet = this.isWaitConditionMet(
            this.pendingWaitCondition,
            activeImpulses,
          );
          const timedOut = waitElapsedMs >= this.config.maxAiWaitMs;

          if (!conditionMet && !timedOut) {
            this.decisionDeps?.logger.debug('AI wait condition pending', {
              waitElapsedMs,
              waitUntil: this.pendingWaitCondition,
            });
            return undefined;
          }

          if (timedOut) {
            this.decisionDeps?.logger.warn('AI wait timed out — proceeding', {
              waitElapsedMs,
            });
          } else {
            this.decisionDeps?.logger.debug('AI wait condition met', {
              waitElapsedMs,
            });
          }
          this.pendingWaitCondition = undefined;
          this.pendingWaitSince = undefined;
          // Re-load scheduled — new responses may have arrived since wait started
          const refreshed = await this.loadScheduled();
          return this.executeDecisionCycle(refreshed);
        }

        return this.executeDecisionCycle(scheduled);
      } finally {
        this.isExecuting = false;
      }
    });
  }

  /**
   * Run the full gate → AI → execute cycle.
   */
  private async executeDecisionCycle(
    scheduled: ScheduledResponse[],
  ): Promise<SchedulerDecision | undefined> {
    const ready = scheduled.filter((r) => this.isReady(r));
    if (ready.length === 0) return undefined;
    if (!ready.some((response) => shouldAutoWakeForUrgency(response.urgency))) {
      this.decisionDeps?.logger.debug(
        'executeDecisionCycle: only deferred responses ready; skipping auto-start',
      );
      return undefined;
    }

    const cycleTotalStart = Date.now();

    // ── Pre-AI gate ────────────────────────────────────────────────────────
    const hasUrgent = ready.some((r) => isUrgentUrgency(r.urgency));
    let gateDelayMs = 0;
    let gateReason: SchedulerConsideration['gateReason'] = 'none';

    if (hasUrgent) {
      gateReason = 'urgent_bypass';
      this.decisionDeps?.logger.debug(
        'gate: urgent response present — bypassing',
      );
    } else {
      // Check if any sibling impulses are still running
      const { delayed, siblingIds } = await this.waitForGate(ready);
      gateDelayMs = delayed;
      if (gateDelayMs > 0) {
        gateReason = 'sibling_impulses';
        this.decisionDeps?.logger.debug('gate: delayed for sibling impulses', {
          gateDelayMs,
          siblingIds,
        });
      }
    }

    // Re-load after gate (new responses may have arrived during delay)
    const afterGate = await this.loadScheduled();
    const decision = await this.decideBatch(afterGate, {
      gateDelayMs,
      gateReason,
      cycleTotalStart,
    });
    return decision;
  }

  /**
   * Wait for sibling impulses to complete, up to maxGateDelayMs.
   * Returns how long we actually delayed.
   */
  private async waitForGate(
    ready: ScheduledResponse[],
  ): Promise<{ delayed: number; siblingIds: string[] }> {
    const gateStart = this.gateEngagedAt ?? Date.now();
    this.gateEngagedAt = gateStart;
    const pollInterval = 100;
    let delayed = 0;

    while (delayed < this.config.maxGateDelayMs) {
      const activeImpulses = this.impulsePool.getActive();
      if (activeImpulses.length === 0) break;

      // Find sibling impulse IDs — active impulses that started within
      // siblingImpulseWindowMs of any scheduling impulse's scheduled time
      const siblingIds = this.findSiblingImpulseIds(ready, activeImpulses);
      if (siblingIds.length === 0) break;

      // Still have siblings — wait a bit
      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
      delayed = Date.now() - gateStart;
    }

    this.gateEngagedAt = undefined;

    const activeImpulses = this.impulsePool.getActive();
    const remainingSiblings =
      delayed > 0 ? this.findSiblingImpulseIds(ready, activeImpulses) : [];

    return { delayed, siblingIds: remainingSiblings };
  }

  /**
   * Find active impulse IDs that are "siblings" of the scheduling impulses
   * (started within siblingImpulseWindowMs of a scheduled response's scheduling impulse).
   */
  private findSiblingImpulseIds(
    ready: ScheduledResponse[],
    activeImpulses: Impulse[],
  ): string[] {
    if (activeImpulses.length === 0) return [];

    // Get start times of the impulses that scheduled these responses
    const schedulingImpulseStartTimes: number[] = [];
    for (const r of ready) {
      const startTime = this.impulseStartTimeById.get(r.scheduledBy);
      if (startTime != null) {
        schedulingImpulseStartTimes.push(startTime);
      } else {
        // Fall back to scheduled time as proxy
        schedulingImpulseStartTimes.push(r.scheduledAt.getTime());
      }
    }

    if (schedulingImpulseStartTimes.length === 0) return [];

    const windowMs = this.config.siblingImpulseWindowMs;
    const siblings: string[] = [];

    for (const impulse of activeImpulses) {
      const impulseStart =
        this.impulseStartTimeById.get(impulse.id) ??
        impulse.startedAt.getTime();

      // Is this impulse within the window of any scheduling impulse?
      const isSibling = schedulingImpulseStartTimes.some(
        (schedulingStart) =>
          Math.abs(impulseStart - schedulingStart) <= windowMs,
      );

      if (isSibling) {
        siblings.push(impulse.id);
      }
    }

    return siblings;
  }

  /**
   * Check if an AI waitUntil condition is met.
   */
  private isWaitConditionMet(
    condition: SchedulerWaitCondition,
    activeImpulses: Impulse[],
  ): boolean {
    if (condition.kind === 'any_impulse') {
      // Met when there are fewer active impulses than when wait was issued.
      // We track this by comparing against the count at wait time.
      // Since we don't store that count, treat as met when activeImpulses is 0.
      return activeImpulses.length === 0;
    }
    if (condition.kind === 'impulse') {
      return !activeImpulses.some((i) => i.id === condition.impulseId);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Batch Decision Logic — AI Always
  // ---------------------------------------------------------------------------

  /**
   * Run the AI scheduler decision.
   *
   * The AI always runs — there is no procedural fast path for the decision
   * itself. The gate (waitForGate) handles the "wait for sibling impulses"
   * case before we get here.
   *
   * If no decisionDeps are configured (e.g. in unit tests), falls back to
   * "respond to all ready responses".
   */
  private async decideBatch(
    scheduled: ScheduledResponse[],
    meta: {
      gateDelayMs: number;
      gateReason: SchedulerConsideration['gateReason'];
      cycleTotalStart: number;
    },
  ): Promise<SchedulerDecision> {
    const ready = scheduled.filter((response) => this.isReady(response));
    const blocked = scheduled.filter((response) => !this.isReady(response));
    const activeImpulses = this.impulsePool.getActive();

    // Emit consideration event (before AI call)
    const consideration: SchedulerConsideration = {
      readyIds: ready.map((r) => r.id),
      blockedIds: blocked.map((r) => r.id),
      activeImpulseIds: activeImpulses.map((i) => i.id),
      usedAi: !!this.decisionDeps,
      gateDelayMs: meta.gateDelayMs,
      gateReason: meta.gateReason,
    };
    this.eventCallback?.({ type: 'scheduler:considered', consideration });

    if (ready.length === 0) {
      return { action: 'wait', reason: 'no ready responses' };
    }

    if (
      ready.length === 1 &&
      blocked.length === 0 &&
      activeImpulses.length === 0
    ) {
      const [single] = ready;
      if (!single) return { action: 'wait', reason: 'no ready responses' };
      const decision: SchedulerDecision = {
        action: 'act',
        respondTo: [single.id],
        drop: [],
        reason: 'single_response_shortcut',
      };
      const metrics: SchedulerDecisionMetrics = {
        gateDelayMs: meta.gateDelayMs,
        gateReason: meta.gateReason,
        aiDecisionMs: 0,
        aiDecision: 'act',
        aiWaitCount: this.pendingWaitAiCount,
        totalSchedulerMs: Date.now() - meta.cycleTotalStart,
      };
      this.pendingWaitAiCount = 0;
      this.pendingWaitCycleStart = undefined;
      this.lastDecisionResult = decision;
      this.lastDecisionAt = Date.now();
      this.lastDecisionSignature = this.buildDecisionSignature(
        ready,
        blocked,
        activeImpulses,
      );
      this.decisionDeps?.logger.debug(
        'decideBatch: using single_response_shortcut',
        {
          responseId: single.id,
          urgency: single.urgency,
        },
      );
      this.eventCallback?.({ type: 'scheduler:decided', decision, metrics });
      return this.executeDecision(decision, scheduled);
    }

    if (!this.decisionDeps) {
      // No AI deps — simple fallback: respond to all ready
      const decision: SchedulerDecision = {
        action: 'act',
        respondTo: ready.map((r) => r.id),
        drop: [],
        reason: 'no AI deps — responding to all ready responses',
      };
      const metrics: SchedulerDecisionMetrics = {
        gateDelayMs: meta.gateDelayMs,
        gateReason: meta.gateReason,
        aiDecisionMs: 0,
        aiDecision: 'act',
        aiWaitCount: this.pendingWaitAiCount,
        totalSchedulerMs: Date.now() - meta.cycleTotalStart,
      };
      this.pendingWaitAiCount = 0;
      this.pendingWaitCycleStart = undefined;
      this.eventCallback?.({ type: 'scheduler:decided', decision, metrics });
      return this.executeDecision(decision, scheduled);
    }

    // AI path — check signature cache to avoid redundant calls
    const signature = this.buildDecisionSignature(
      ready,
      blocked,
      activeImpulses,
    );
    const now = Date.now();

    if (
      this.lastDecisionSignature === signature &&
      this.lastDecisionAt &&
      now - this.lastDecisionAt < this.config.decisionMinInterval &&
      this.lastDecisionResult
    ) {
      this.decisionDeps?.logger.debug('decideBatch: using cached decision');
      const cached = this.lastDecisionResult;
      const metrics: SchedulerDecisionMetrics = {
        gateDelayMs: meta.gateDelayMs,
        gateReason: meta.gateReason,
        aiDecisionMs: 0,
        aiDecision: cached.action,
        aiWaitUntil: cached.action === 'wait' ? cached.waitUntil : undefined,
        aiWaitCount: this.pendingWaitAiCount,
        totalSchedulerMs: Date.now() - meta.cycleTotalStart,
      };
      this.eventCallback?.({
        type: 'scheduler:decided',
        decision: cached,
        metrics,
      });
      return this.executeDecision(cached, scheduled);
    }

    // Run AI model
    const aiStart = Date.now();
    const decisionOutput = await this.runDecisionModel({
      ready,
      blocked,
      activeImpulses,
    });
    const aiDecisionMs = Date.now() - aiStart;

    this.lastDecisionSignature = signature;
    this.lastDecisionAt = now;

    const parsed = this.normalizeBatchDecisionOutput(decisionOutput, ready);
    const decision = parsed ?? {
      // Parse failure fallback: respond to all ready
      action: 'act' as const,
      respondTo: ready.map((r) => r.id),
      drop: [],
      reason: 'AI parse failed — responding to all ready responses',
    };
    this.lastDecisionResult = decision;

    const metrics: SchedulerDecisionMetrics = {
      gateDelayMs: meta.gateDelayMs,
      gateReason: meta.gateReason,
      aiDecisionMs,
      aiDecision: decision.action,
      aiWaitUntil: decision.action === 'wait' ? decision.waitUntil : undefined,
      aiWaitCount: this.pendingWaitAiCount,
      totalSchedulerMs: Date.now() - meta.cycleTotalStart,
    };

    this.decisionDeps?.logger.info('Scheduler decision', {
      decision: decision.action,
      aiMs: aiDecisionMs,
      gateMs: meta.gateDelayMs,
      gateReason: meta.gateReason,
      ...(decision.action === 'act'
        ? { respondTo: decision.respondTo, drop: decision.drop }
        : { waitUntil: decision.waitUntil }),
    });
    // Structured AI vs non-AI breakdown for the scheduler decision phase
    const schedulerTotalMs = metrics.totalSchedulerMs;
    this.decisionDeps?.logger.info('Scheduler timing', {
      decision: decision.action,
      gateReason: meta.gateReason,
      totalMs: schedulerTotalMs,
      ai: { llm_decide_ms: aiDecisionMs },
      non_ai: {
        gate_ms: meta.gateDelayMs,
        overhead_ms: Math.max(
          0,
          schedulerTotalMs - aiDecisionMs - meta.gateDelayMs,
        ),
      },
      ai_total_ms: aiDecisionMs,
      non_ai_total_ms: schedulerTotalMs - aiDecisionMs,
      ai_pct:
        schedulerTotalMs > 0
          ? Math.round((aiDecisionMs / schedulerTotalMs) * 100)
          : 0,
    });

    this.eventCallback?.({ type: 'scheduler:decided', decision, metrics });

    if (decision.action === 'wait') {
      if (!this.pendingWaitCycleStart) {
        this.pendingWaitCycleStart = Date.now();
      }
      this.pendingWaitAiCount += 1;

      // Register waitUntil condition
      if (decision.waitUntil) {
        this.pendingWaitCondition = decision.waitUntil;
        this.pendingWaitSince = Date.now();
        this.decisionDeps?.logger.debug('decideBatch: AI wait registered', {
          waitUntil: decision.waitUntil,
        });
      }
      return decision;
    }

    // Act — reset wait tracking
    this.pendingWaitAiCount = 0;
    this.pendingWaitCycleStart = undefined;

    return this.executeDecision(decision, scheduled);
  }

  /**
   * Execute a batch act decision — run the response callback.
   */
  private async executeDecision(
    decision: SchedulerDecision,
    scheduled: ScheduledResponse[],
  ): Promise<SchedulerDecision> {
    if (decision.action === 'wait') return decision;

    const dropSet = new Set(decision.drop);
    if (dropSet.size > 0) {
      this.decisionDeps?.logger.info('Dropping responses', {
        count: dropSet.size,
        ids: [...dropSet],
      });
    }

    const selectedResponses = decision.respondTo
      .map((id) => scheduled.find((r) => r.id === id))
      .filter((r): r is ScheduledResponse => r != null);

    if (selectedResponses.length === 0) return decision;

    for (const r of selectedResponses) this.activeResponseIds.add(r.id);

    try {
      if (this.executeBatchCallback) {
        this.decisionDeps?.logger.info('Executing batch', {
          responseIds: selectedResponses.map((r) => r.id),
        });
        const executeStartMs = Date.now();
        const result = await this.executeBatchCallback(selectedResponses);
        const executeElapsedMs = Date.now() - executeStartMs;
        this.decisionDeps?.logger.info('Batch executed', {
          disposition: result.disposition,
          executeMs: executeElapsedMs,
        });

        if (result.disposition === 'executed') {
          this.lastExecutedAt = new Date();
        }

        const removeSet = new Set([...decision.respondTo, ...decision.drop]);
        const remaining = scheduled.filter((r) => !removeSet.has(r.id));
        await this.saveScheduled(remaining);
        for (const id of removeSet) this.deferredUntilByResponseId.delete(id);
      } else if (this.executeCallback) {
        // Legacy single-response path
        const [response] = selectedResponses;
        if (!response) return decision;
        this.decisionDeps?.logger.info('Executing legacy single response', {
          responseId: response.id,
        });
        const result = await this.executeCallback(response);
        this.decisionDeps?.logger.info('Legacy single response result', {
          responseId: response.id,
          disposition: result.disposition,
        });

        if (result.disposition === 'executed') {
          this.deferredUntilByResponseId.delete(response.id);
          this.lastExecutedAt = new Date();
          const removeSet = new Set([
            response.id,
            ...result.clearedResponses,
            ...decision.drop,
          ]);
          const remaining = scheduled.filter((r) => !removeSet.has(r.id));
          await this.saveScheduled(remaining);
        } else if (result.disposition === 'dropped') {
          this.deferredUntilByResponseId.delete(response.id);
          const removeSet = new Set([response.id, ...decision.drop]);
          const remaining = scheduled.filter((r) => !removeSet.has(r.id));
          await this.saveScheduled(remaining);
        } else if (result.disposition === 'deferred') {
          this.deferredUntilByResponseId.set(
            response.id,
            Date.now() + this.getDeferredRetryDelayMs(),
          );
          if (dropSet.size > 0) {
            const remaining = scheduled.filter((r) => !dropSet.has(r.id));
            await this.saveScheduled(remaining);
          }
        }
      }
    } catch (err) {
      this.decisionDeps?.logger.error('Scheduler execute threw', {
        error: err instanceof Error ? err.message : err,
        stack: err instanceof Error ? err.stack : undefined,
      });
      for (const r of selectedResponses) {
        this.deferredUntilByResponseId.set(
          r.id,
          Date.now() + this.getDeferredRetryDelayMs(),
        );
      }
      if (dropSet.size > 0) {
        const remaining = scheduled.filter((r) => !dropSet.has(r.id));
        await this.saveScheduled(remaining);
      }
    } finally {
      for (const r of selectedResponses) this.activeResponseIds.delete(r.id);
    }

    return decision;
  }

  private buildDecisionSignature(
    ready: ScheduledResponse[],
    blocked: ScheduledResponse[],
    activeImpulses: Impulse[],
  ): string {
    return JSON.stringify({
      ready: ready.map((r) => ({
        id: r.id,
        urgency: r.urgency,
        intent: r.intent,
        waitForIdleTargets: r.waitForIdleTargets,
        scheduledAt: r.scheduledAt.toISOString(),
      })),
      blocked: blocked.map((r) => ({
        id: r.id,
        urgency: r.urgency,
        intent: r.intent,
        waitForIdleTargets: r.waitForIdleTargets,
        scheduledAt: r.scheduledAt.toISOString(),
      })),
      active: activeImpulses.map((i) => ({
        id: i.id,
        type: i.type,
        startedAt: i.startedAt.toISOString(),
        trigger: formatPerceptionTrigger(i.triggeredBy),
      })),
    });
  }

  async runDecisionModel(context: {
    ready: ScheduledResponse[];
    blocked: ScheduledResponse[];
    activeImpulses: Impulse[];
  }): Promise<SchedulerDecision | null> {
    const deps = this.decisionDeps;
    if (!deps) return null;
    const flow = createAiFlow<
      SchedulerDecisionContext,
      { decide: ReturnType<typeof createDecisionStage> }
    >('response-scheduler', {
      stages: {
        decide: createDecisionStage(
          this.decisionStage,
          this.decisionPrompt,
          this.vfs,
        ),
      },
    });

    let decision: SchedulerDecision | null = null;

    const run = flow
      .onStep('decide', async ({ step }) => {
        switch (step.kind) {
          case 'reasoning':
            return step.next();
          case 'output':
            decision = step.response ?? null;
            return step.output.accept((output, ctx) => ({
              ctx: { ...ctx, decision: output ?? undefined },
            }));
          default:
            return step.next();
        }
      })
      .start({
        flow: {
          ready: context.ready,
          blocked: context.blocked,
          activeImpulses: context.activeImpulses,
          decision: null,
        },
        firstStage: 'decide',
        deps,
      });

    await run.complete();
    return decision;
  }

  /**
   * Parse AI decision output into a SchedulerDecision.
   *
   * Expected format:
   *   DECISION: respond <id1,id2,...>
   *   DROP: <id3,id4,...>
   *   REASON: <explanation>
   * or:
   *   DECISION: wait
   *   REASON: <explanation>
   *
   * Also supports legacy format:
   *   DECISION: execute <id>
   *   CLEAR: <id1,id2,...>
   */
  normalizeBatchDecisionOutput(
    output: SchedulerDecision | null | undefined,
    ready: ScheduledResponse[],
  ): SchedulerDecision | null {
    const readyIds = new Set(ready.map((r) => r.id));
    if (!output) return null;

    if (output.action === 'wait') {
      const waitUntil =
        output.waitUntil?.kind === 'any_impulse'
          ? output.waitUntil
          : output.waitUntil?.kind === 'impulse' &&
              output.waitUntil.impulseId.trim()
            ? {
                kind: 'impulse' as const,
                impulseId: output.waitUntil.impulseId.trim(),
              }
            : undefined;

      return {
        action: 'wait',
        reason: output.reason.trim(),
        waitUntil,
      };
    }

    const respondTo = output.respondTo.filter((id) => readyIds.has(id));
    if (respondTo.length === 0) {
      return null;
    }

    const respondSet = new Set(respondTo);
    const drop = output.drop.filter((id) => !respondSet.has(id));
    return {
      action: 'act',
      respondTo,
      drop,
      reason: output.reason.trim(),
    };
  }

  /**
   * Check if a response is ready to execute.
   */
  private isReady(response: ScheduledResponse): boolean {
    const deferredUntil = this.deferredUntilByResponseId.get(response.id);
    if (deferredUntil && Date.now() < deferredUntil) {
      return false;
    }

    if (isUrgentUrgency(response.urgency)) {
      // Urgent responses can execute immediately
      return true;
    }

    if (this.config.previewInProgress) {
      return true;
    }

    // waitForIdle: check if required pools/profiles are idle
    const waitTargets = response.waitForIdleTargets ?? [
      { kind: 'pool' as const, name: 'conversation' },
    ];

    for (const target of waitTargets) {
      if (target.kind === 'pool') {
        const activeInPool = this.impulsePool.getActiveByPool(target.name);
        if (activeInPool.length > 0) {
          return false;
        }
        continue;
      }

      const activeForProfile = this.impulsePool.getActiveByProfile(target.name);
      if (activeForProfile.length > 0) {
        return false;
      }
    }

    return true;
  }

  private getDeferredRetryDelayMs(): number {
    return Math.max(this.config.minDelayBetweenResponses, 5000);
  }

  /**
   * Load scheduled responses from VFS.
   */
  private async loadScheduled(): Promise<ScheduledResponse[]> {
    let scheduled: Array<Record<string, unknown>> = [];
    try {
      const content = await this.vfs.read(VFS_PATHS.state.scheduledResponses);
      const parsed = parseContextFile(content);
      scheduled =
        (parsed.meta.scheduled as Array<Record<string, unknown>>) ?? [];
    } catch {
      return [];
    }

    return scheduled.map((entry) => {
      const waitForIdleTargets = Array.isArray(entry.waitForIdleTargets)
        ? (entry.waitForIdleTargets as {
            kind: 'pool' | 'profile';
            name: string;
          }[])
        : Array.isArray(entry.waitFor)
          ? (entry.waitFor as string[]).map((pool) => ({
              kind: 'pool' as const,
              name: pool,
            }))
          : undefined;

      return {
        id: String(entry.id ?? ''),
        scheduledBy: String(entry.scheduledBy ?? ''),
        intent: String(entry.intent ?? ''),
        urgency: ['none', 'defer', 'low', 'normal', 'urgent', 'now'].includes(
          String(entry.urgency ?? ''),
        )
          ? (String(entry.urgency) as ImpulseUrgency)
          : 'normal',
        waitForIdleTargets,
        scheduledAt: new Date(
          String(entry.scheduledAt ?? new Date().toISOString()),
        ),
      } satisfies ScheduledResponse;
    });
  }

  /**
   * Save scheduled responses to VFS.
   */
  private async saveScheduled(scheduled: ScheduledResponse[]): Promise<void> {
    const sanitized = scheduled.map((entry) =>
      stripUndefined({
        id: entry.id,
        scheduledBy: entry.scheduledBy,
        intent: entry.intent,
        urgency: entry.urgency,
        waitForIdleTargets: entry.waitForIdleTargets,
        scheduledAt:
          entry.scheduledAt instanceof Date
            ? entry.scheduledAt.toISOString()
            : entry.scheduledAt,
      }),
    );

    let existingMeta: Record<string, unknown> = {};
    let existingContent = '';
    try {
      const loaded = parseContextFile(
        await this.vfs.read(VFS_PATHS.state.scheduledResponses),
      );
      existingMeta = loaded.meta;
      existingContent = loaded.content;
    } catch {
      // file may not exist yet
    }

    const now = new Date().toISOString();
    const normalizedMeta = {
      ...existingMeta,
      id:
        typeof existingMeta.id === 'string'
          ? existingMeta.id
          : 'scheduled-responses',
      tags: Array.isArray(existingMeta.tags)
        ? (existingMeta.tags as string[])
        : [],
      created:
        typeof existingMeta.created === 'string' ? existingMeta.created : now,
      updated: now,
      scheduled: sanitized,
    };

    await this.vfs.write(
      VFS_PATHS.state.scheduledResponses,
      serializeContextFile(normalizedMeta, existingContent),
    );
  }

  /**
   * Clear a specific scheduled response.
   */
  async clear(responseId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const scheduled = await this.loadScheduled();
      const remaining = scheduled.filter((r) => r.id !== responseId);
      await this.saveScheduled(remaining);
    });
  }

  /**
   * Clear all scheduled responses.
   */
  async clearAll(): Promise<void> {
    await this.withMutationLock(async () => {
      await this.saveScheduled([]);
    });
  }

  /**
   * Get scheduler state for inspection.
   */
  async getState(): Promise<SchedulerState> {
    const scheduled = await this.loadScheduled();
    const activeImpulses = this.impulsePool.getActive();

    return {
      scheduled,
      inProgressImpulses: activeImpulses.map((i) => i.id),
      activeImpulses,
      activeResponses: Array.from(this.activeResponseIds),
      polling: this.isExecuting,
      schedulerBusy: this.isExecuting,
      lastExecutedAt: this.lastExecutedAt,
      isRunning: this.isRunning,
    };
  }

  private async withMutationLock<T>(run: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.catch(() => {}).then(run);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

type SchedulerDecisionContext = {
  ready: ScheduledResponse[];
  blocked: ScheduledResponse[];
  activeImpulses: Impulse[];
  decision: SchedulerDecision | null;
};

function createDecisionStage(
  stageConfig: StageAiSettings,
  systemPrompt: string,
  vfs: OverlayFs,
) {
  const model = stageConfig.model ?? 'moonshotai/kimi-k2.5';
  const output = createAiOutput<
    'decision',
    SchedulerDecisionContext,
    SchedulerDecision
  >('decision', {
    schema: schedulerDecisionSchema,
    validate: validateSchedulerDecision,
    render: (_ctx, value) => {
      if (!value) return 'Decision: none';
      if (value.action === 'wait') {
        return `Decision: wait (${value.reason})`;
      }
      return `Decision: act ${value.respondTo.join(', ')}`;
    },
  });

  return createAiOutputStage<
    'decide',
    SchedulerDecisionContext,
    Record<string, never>,
    SchedulerDecision,
    'decision',
    Record<string, never>
  >('decide', {
    model,
    verbosity: stageConfig.verbosity,
    reasoningEffort: stageConfig.reasoningEffort,
    reasoningSummary: stageConfig.reasoningSummary,
    serviceTier: stageConfig.serviceTier,
    maxOutputTokens: stageConfig.maxOutputTokens,
    maxSteps: 2,
    tools: {},
    storage: () => ({}),
    context: {
      ready: createAiContext<SchedulerDecisionContext>('ready', {
        render: (ctx) =>
          renderScheduledResponses('READY responses', ctx.ready, true),
      }),
      blocked: createAiContext<SchedulerDecisionContext>('blocked', {
        render: (ctx) =>
          renderScheduledResponses('BLOCKED responses', ctx.blocked, false),
      }),
      active: createAiContext<SchedulerDecisionContext>('active', {
        render: (ctx) => renderActiveImpulses(ctx.activeImpulses),
      }),
      stageContext: createAiContext<SchedulerDecisionContext>('stageContext', {
        render: async () =>
          resolveStageContext(vfs, { stage: 'scheduler', now: new Date() }),
      }),
    },
    instructions: createAiPrompt<SchedulerDecisionContext>('instructions', {
      render: () => systemPrompt,
    }),
    inputs: {
      frame: {
        key: 'frame',
        render: () => [
          {
            role: 'system' as const,
            type: 'message' as const,
            content: `# Scheduler Frame
Purpose: decide whether to execute a scheduled response now.
Use READY responses only. If none should execute, wait.
Use active impulses to decide whether to wait.
Output ONLY valid JSON matching the requested schema.`,
          },
        ],
      },
    },
    output,
  });
}

function renderScheduledResponses(
  title: string,
  responses: ScheduledResponse[],
  includeWaitFor: boolean,
): string {
  if (responses.length === 0) {
    return `## ${title}\n\n(none)`;
  }

  const lines = responses
    .slice()
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .map((response) => {
      const parts = [
        `${response.id}`,
        `urgency: ${response.urgency}`,
        `intent: ${response.intent}`,
        `scheduledAt: ${response.scheduledAt.toISOString()}`,
      ];
      if (response.urgency === 'defer') {
        parts.push('deferred: true');
      }
      if (
        includeWaitFor &&
        response.waitForIdleTargets &&
        response.waitForIdleTargets.length > 0
      ) {
        const targets = response.waitForIdleTargets.map(
          (target) => `${target.kind}:${target.name}`,
        );
        parts.push(`waitForIdleTargets: ${targets.join(', ')}`);
      }
      return `- ${parts.join(' | ')}`;
    });

  return `## ${title}\n\n${lines.join('\n')}`;
}

function renderActiveImpulses(impulses: Impulse[]): string {
  if (impulses.length === 0) {
    return '## Active Impulses (in-flight)\n\n(none)';
  }

  const lines = impulses
    .slice()
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map((impulse) => {
      const trigger = formatPerceptionTrigger(impulse.triggeredBy);
      const origin = formatPerceptionOrigin(impulse.triggeredBy);
      const suffix = origin ? ` (${origin})` : '';
      return `- [${impulse.startedAt.toISOString()}] ${impulse.id} (${impulse.type}) trigger: ${trigger}${suffix}`;
    });

  return `## Active Impulses (in-flight)\n\n${lines.join('\n')}`;
}

function formatPerceptionTrigger(perception: Perception): string {
  const display = getPerceptionDisplayContent(perception);
  switch (perception.source) {
    case 'system_event':
      return perception.event ?? display;
    case 'self_reminder':
      return `reminder: "${display}"`;
    case 'time_passed':
    case 'user_message':
      return truncatePerceptionContent(display, 120);
  }
}

function formatPerceptionOrigin(perception: Perception): string | undefined {
  return getPerceptionOrigin(perception);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      cleaned[key] = entry;
    }
  }
  return cleaned as T;
}

/**
 * Create a response scheduler.
 */
export function createResponseScheduler(
  vfs: OverlayFs,
  impulsePool: ImpulsePool,
  config: Partial<SchedulerConfig> = {},
): ResponseScheduler {
  return new ResponseScheduler(vfs, impulsePool, config);
}

// ---------------------------------------------------------------------------
// Lane grouping (connected components by shared target lanes)
// ---------------------------------------------------------------------------

/**
 * Group submissions by shared target lanes using union-find.
 * Impulses sharing ANY target lane are in the same group.
 * Independent groups can commit in parallel.
 */
function groupByTargetLanes(
  submissions: PendingImpulseSubmission[],
): PendingImpulseSubmission[][] {
  if (submissions.length <= 1) return [submissions];

  // Union-Find
  const parent = new Map<number, number>();
  const rank = new Map<number, number>();

  function find(x: number): number {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr) ?? curr;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const rankA = rank.get(rootA) ?? 0;
    const rankB = rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootB, rootA);
      rank.set(rootA, rankA + 1);
    }
  }

  // Initialize
  for (let i = 0; i < submissions.length; i++) {
    parent.set(i, i);
    rank.set(i, 0);
  }

  // Build lane → submission index mapping
  const laneToIndices = new Map<string, number[]>();
  for (const [i, sub] of submissions.entries()) {
    const lanes = sub.targetLanes.length > 0 ? sub.targetLanes : [sub.lane];
    for (const lane of lanes) {
      const indices = laneToIndices.get(lane);
      if (indices) {
        indices.push(i);
      } else {
        laneToIndices.set(lane, [i]);
      }
    }
  }

  // Union submissions that share a lane
  for (const indices of laneToIndices.values()) {
    const [first, ...rest] = indices;
    if (first === undefined) continue;
    for (const other of rest) {
      union(first, other);
    }
  }

  // Collect groups
  const groups = new Map<number, PendingImpulseSubmission[]>();
  for (const [i, sub] of submissions.entries()) {
    const root = find(i);
    const group = groups.get(root);
    if (group) {
      group.push(sub);
    } else {
      groups.set(root, [sub]);
    }
  }

  return Array.from(groups.values());
}
