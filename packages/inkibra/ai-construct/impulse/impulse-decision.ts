/**
 * Impulse Decision — Validate and resolve AI structured output against flow context.
 *
 * After the AI calls preview_exec one or more times, it produces a
 * structured output selecting which preview to commit.
 * See spec §7.
 */

import type {
  ImpulseFlowContext,
  PreviewExecRecord,
} from '@inkibra/ai-sandbox-computer';
import type { ImpulseDecisionOutput, ImpulseUrgency } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolvedImpulseDecision = {
  impulseId: string;
  thinking: string;
  urgency: ImpulseUrgency;
  selectedPreview: PreviewExecRecord | null;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and resolve the impulse decision output against flow context.
 * execId may be null for observation-only decisions; otherwise it must refer
 * to a successful preview in ctx.previewExecRuns.
 */
export function resolveImpulseDecision(
  impulseId: string,
  decision: ImpulseDecisionOutput,
  ctx: ImpulseFlowContext,
): ResolvedImpulseDecision {
  if (decision.execId === null) {
    return {
      impulseId,
      thinking: decision.thinking,
      urgency: decision.urgency,
      selectedPreview: null,
    };
  }

  const runs = ctx.previewExecRuns ?? {};
  const preview = runs[decision.execId];
  if (!preview) {
    throw new Error(
      `execId "${decision.execId}" not found in preview runs (available: ${Object.keys(runs).join(', ') || 'none'})`,
    );
  }

  if (preview.error) {
    throw new Error(
      `execId "${decision.execId}" refers to a failed preview_exec. Failed previews cannot be committed.`,
    );
  }
  return {
    impulseId,
    thinking: decision.thinking,
    urgency: decision.urgency,
    selectedPreview: preview,
  };
}
