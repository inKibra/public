/**
 * Scheduler Commit — Commit selected previews and handle ordering.
 *
 * Single impulse (common case): re-run code on real VFS.
 * Concurrent impulses: generate ordering candidates, let scheduler LLM pick.
 *
 * See spec §20.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import {
  type AiComputerModule,
  type CommandRegistry,
  type CommitResult,
  commitPreview,
  type DispatchBudgetConfig,
  type PreviewExecRecord,
  type PreviewInvocationHostContext,
  type ResponsePlan,
} from '@inkibra/ai-sandbox-computer';
import type { ResolvedImpulseDecision } from './impulse-decision';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchedulerDecisionOutput = {
  thinking: string;
  consumedImpulses: string[];
  droppedImpulses: string[];
  dispatchImpulse?: {
    reason: string;
  };
};

export type SchedulerCommitConfig = {
  registry: CommandRegistry;
  overlayFs: OverlayFs;
  modules?: AiComputerModule<any, any, any, any>[];
  timeoutMs?: number;
  transactionRuntime?: import('@inkibra/router').TransactionRuntime;
  hostContext?: PreviewInvocationHostContext;
};

export type SchedulerCommitResult = {
  committed: boolean;
  commitResult?: CommitResult;
  responsePlans: ResponsePlan[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Single impulse commit (§20.1)
// ---------------------------------------------------------------------------

/**
 * Commit a single impulse's selected preview against real state.
 * This is the common case — no concurrent impulses.
 */
export async function commitSingleImpulse(
  decision: ResolvedImpulseDecision,
  config: SchedulerCommitConfig,
): Promise<SchedulerCommitResult> {
  // §20.2 — No selected preview
  if (!decision.selectedPreview) {
    return {
      committed: false,
      responsePlans: [],
    };
  }

  // §20.1 — Re-run code against real VFS
  const result = await commitPreview(decision.selectedPreview, {
    registry: config.registry,
    overlayFs: config.overlayFs,
    modules: config.modules,
    timeoutMs: config.timeoutMs,
    transactionRuntime: config.transactionRuntime,
    hostContext: config.hostContext,
  });

  if (result.error) {
    return {
      committed: false,
      responsePlans: result.responsePlans,
      error: result.error,
    };
  }

  return {
    committed: true,
    commitResult: result,
    responsePlans: result.responsePlans,
  };
}

// ---------------------------------------------------------------------------
// Concurrent impulse ordering candidates (§20.3)
// ---------------------------------------------------------------------------

export type OrderingCandidate = {
  candidateId: string;
  impulseOrder: string[];
  previews: PreviewExecRecord[];
  combinedStdout: string;
  combinedResponsePlans: ResponsePlan[];
};

/**
 * Generate ordering candidates for concurrent impulses.
 * For 2 impulses: generates A→B and B→A orderings.
 * Each candidate forks the VFS and runs both previews sequentially.
 */
export async function generateOrderingCandidates(
  decisions: ResolvedImpulseDecision[],
  config: SchedulerCommitConfig,
): Promise<OrderingCandidate[]> {
  const withPreviews = decisions.filter((d) => d.selectedPreview !== null);

  if (withPreviews.length <= 1) {
    // No concurrent impulses — single commit path
    return [];
  }

  // For 2 impulses: A→B and B→A
  if (withPreviews.length === 2) {
    const [a, b] = withPreviews as [
      ResolvedImpulseDecision,
      ResolvedImpulseDecision,
    ];

    const candidateAB = await runOrderingCandidate(
      `order_${a.impulseId}_${b.impulseId}`,
      [a, b],
      config,
    );

    const candidateBA = await runOrderingCandidate(
      `order_${b.impulseId}_${a.impulseId}`,
      [b, a],
      config,
    );

    return [candidateAB, candidateBA].filter(
      (c): c is OrderingCandidate => c !== null,
    );
  }

  // 3+ impulses: just try the natural order for now
  const candidate = await runOrderingCandidate(
    `order_${withPreviews.map((d) => d.impulseId).join('_')}`,
    withPreviews,
    config,
  );

  return candidate ? [candidate] : [];
}

async function runOrderingCandidate(
  candidateId: string,
  decisions: ResolvedImpulseDecision[],
  config: SchedulerCommitConfig,
): Promise<OrderingCandidate | null> {
  // Fork VFS for candidate evaluation
  const forkedFs = config.overlayFs.fork();
  const allStdout: string[] = [];
  const allResponsePlans: ResponsePlan[] = [];
  const previews: PreviewExecRecord[] = [];

  for (const decision of decisions) {
    if (!decision.selectedPreview) continue;
    const result = await commitPreview(decision.selectedPreview, {
      registry: config.registry,
      overlayFs: forkedFs,
      modules: config.modules,
      timeoutMs: config.timeoutMs,
      transactionRuntime: config.transactionRuntime,
      hostContext: config.hostContext,
    });

    if (result.error) {
      // Ordering failed — this candidate is invalid
      return null;
    }

    allStdout.push(result.stdout);
    allResponsePlans.push(...result.responsePlans);
    previews.push(decision.selectedPreview);
  }

  return {
    candidateId,
    impulseOrder: decisions.map((d) => d.impulseId),
    previews,
    combinedStdout: allStdout.join('\n---\n'),
    combinedResponsePlans: allResponsePlans,
  };
}

// ---------------------------------------------------------------------------
// Dispatch budget tracking (§20.5)
// ---------------------------------------------------------------------------

export type DispatchBudgetState = {
  dispatchedLastHour: number;
  dispatchedLastDay: number;
  budgetExhausted: boolean;
};

/**
 * Check dispatch budget and return current state.
 * Used to decide whether to include dispatchImpulse in the scheduler schema.
 */
export function checkDispatchBudget(
  recentDispatches: { timestamp: number }[],
  config: DispatchBudgetConfig,
): DispatchBudgetState {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const dispatchedLastHour = recentDispatches.filter(
    (d) => d.timestamp >= oneHourAgo,
  ).length;
  const dispatchedLastDay = recentDispatches.filter(
    (d) => d.timestamp >= oneDayAgo,
  ).length;

  return {
    dispatchedLastHour,
    dispatchedLastDay,
    budgetExhausted:
      dispatchedLastHour >= config.maxPerHour ||
      dispatchedLastDay >= config.maxPerDay,
  };
}

// ---------------------------------------------------------------------------
// Scheduler LLM selection (§20.4)
// ---------------------------------------------------------------------------

/**
 * Pending impulse summary for the scheduler LLM.
 */
export type PendingImpulseSummary = {
  impulseId: string;
  thinking: string;
  urgency: string;
  previewStdout: string;
  previewDraftCount: number;
};

/**
 * Input to the scheduler LLM callback.
 */
export type SchedulerLlmInput = {
  pendingImpulses: PendingImpulseSummary[];
  orderingCandidates: OrderingCandidate[];
  budgetState: DispatchBudgetState;
};

/**
 * Callback for the scheduler LLM. Provided by the caller.
 * Returns the scheduler's decision output.
 */
export type SchedulerLlmCallback = (
  input: SchedulerLlmInput,
) => Promise<SchedulerDecisionOutput>;

export type SchedulerSelectionConfig = SchedulerCommitConfig & {
  budgetConfig: DispatchBudgetConfig;
  recentDispatches: { timestamp: number }[];
  schedulerLlm: SchedulerLlmCallback;
};

export type SchedulerSelectionResult = {
  decision: SchedulerDecisionOutput;
  commitResult?: SchedulerCommitResult;
  /** Impulses that were consumed (committed). */
  consumedImpulseIds: string[];
  /** Impulses that were explicitly dropped. */
  droppedImpulseIds: string[];
  /** Impulses deferred for next scheduler turn (not consumed or dropped). */
  deferredImpulseIds: string[];
  /** New impulse to dispatch, if any. */
  dispatchedImpulse?: { reason: string };
};

/**
 * Run the scheduler LLM selection for concurrent impulses (§20.4).
 *
 * 1. Generate ordering candidates
 * 2. Build impulse summaries
 * 3. Check dispatch budget
 * 4. Call scheduler LLM
 * 5. Validate the decision
 * 6. Commit the selected ordering
 */
export async function runSchedulerSelection(
  decisions: ResolvedImpulseDecision[],
  config: SchedulerSelectionConfig,
): Promise<SchedulerSelectionResult> {
  const allImpulseIds = decisions.map((d) => d.impulseId);

  // Step 1: Generate ordering candidates
  const candidates = await generateOrderingCandidates(decisions, config);

  // Step 2: Build impulse summaries
  const pendingImpulses: PendingImpulseSummary[] = decisions.map((d) => ({
    impulseId: d.impulseId,
    thinking: d.thinking,
    urgency: d.urgency,
    previewStdout: d.selectedPreview?.stdout ?? '',
    previewDraftCount: d.selectedPreview?.responsePlans?.length ?? 0,
  }));

  // Step 3: Check dispatch budget
  const budgetState = checkDispatchBudget(
    config.recentDispatches,
    config.budgetConfig,
  );

  // Step 4: Call scheduler LLM
  const decision = await config.schedulerLlm({
    pendingImpulses,
    orderingCandidates: candidates,
    budgetState,
  });

  // Step 5: Validate consumedImpulses matches a valid ordering
  const consumedSet = new Set(decision.consumedImpulses);
  const droppedSet = new Set(decision.droppedImpulses);
  const deferredImpulseIds = allImpulseIds.filter(
    (id) => !consumedSet.has(id) && !droppedSet.has(id),
  );

  // Step 6: If impulses were consumed, find matching candidate and commit
  let commitResult: SchedulerCommitResult | undefined;

  if (decision.consumedImpulses.length > 0) {
    // Find the ordering candidate that matches consumedImpulses order
    const matchingCandidate = candidates.find(
      (c) =>
        c.impulseOrder.length === decision.consumedImpulses.length &&
        c.impulseOrder.every((id, i) => id === decision.consumedImpulses[i]),
    );

    if (matchingCandidate && matchingCandidate.previews.length > 0) {
      // Commit the combined ordering against real VFS (§20.6)
      // Re-run each preview in order on the real overlayFs
      const allResponsePlans: ResponsePlan[] = [];
      let commitError: string | undefined;

      for (const preview of matchingCandidate.previews) {
        const result = await commitPreview(preview, {
          registry: config.registry,
          overlayFs: config.overlayFs,
          modules: config.modules,
          timeoutMs: config.timeoutMs,
          transactionRuntime: config.transactionRuntime,
          hostContext: config.hostContext,
        });
        allResponsePlans.push(...result.responsePlans);
        if (result.error) {
          commitError = result.error;
          break;
        }
      }

      commitResult = commitError
        ? {
            committed: false,
            responsePlans: allResponsePlans,
            error: commitError,
          }
        : {
            committed: true,
            responsePlans: allResponsePlans,
          };
    } else if (decision.consumedImpulses.length === 1) {
      // Single impulse consumed — use the direct commit path
      const singleDecision = decisions.find(
        (d) => d.impulseId === decision.consumedImpulses[0],
      );
      if (singleDecision) {
        commitResult = await commitSingleImpulse(singleDecision, config);
      }
    }
  }

  // Suppress dispatchImpulse if budget is exhausted
  const dispatchedImpulse =
    decision.dispatchImpulse && !budgetState.budgetExhausted
      ? decision.dispatchImpulse
      : undefined;

  return {
    decision,
    commitResult,
    consumedImpulseIds: decision.consumedImpulses,
    droppedImpulseIds: decision.droppedImpulses,
    deferredImpulseIds: deferredImpulseIds,
    dispatchedImpulse: dispatchedImpulse,
  };
}
