/**
 * runImpulse — Top-level orchestration for the command computer impulse lifecycle.
 *
 * Ties together: intent hint matching → preview engine → LLM stage → decision → commit.
 * See spec §19.3.
 *
 * This is the integration point between ai-construct's impulse lifecycle
 * and the command computer. The actual LLM stage is provided by ai-flow
 * and configured by the caller.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import {
  type ComputerConfig,
  createComputer,
  type ImpulseFlowContext,
  type PreviewExecRecord,
  type ResponsePlanPolicy,
} from '@inkibra/ai-sandbox-computer';
import {
  type ResolvedImpulseDecision,
  resolveImpulseDecision,
} from './impulse-decision';
import type { IntentHint } from './intent-hints';
import { loadIntentHints, matchIntentHints } from './intent-hints';
import type { SchedulerCommitResult } from './scheduler-commit';
import { commitSingleImpulse } from './scheduler-commit';
import type { ImpulseDecisionOutput } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImpulseInput = {
  impulseId: string;
  text: string;
  type: string;
};

export type RunImpulseConfig = {
  computer: ComputerConfig;
  maxIntentHints?: number;
  responsePlanPolicy?: ResponsePlanPolicy;
};

export type RunImpulseResult = {
  impulseId: string;
  decision: ResolvedImpulseDecision;
  commitResult: SchedulerCommitResult;
  matchedIntents: IntentHint[];
  autoPreviewRecords: PreviewExecRecord[];
  flowContext: ImpulseFlowContext;
};

/**
 * Callback for the LLM stage. The caller provides this — it runs the
 * ai-flow pipeline with the preview_exec tool and returns the decision.
 */
export type LlmStageCallback = (args: {
  computer: ReturnType<typeof createComputer>;
  flowContext: ImpulseFlowContext;
  autoPreviewResults: Array<{ execId: string; stdout: string }>;
  impulse: ImpulseInput;
}) => Promise<ImpulseDecisionOutput>;

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run a full impulse through the command computer lifecycle.
 *
 * 1. Load + match intent hints
 * 2. Auto-preview matched commands
 * 3. Call LLM stage (provided by caller)
 * 4. Resolve decision
 * 5. Commit selected preview
 */
export async function runImpulse(
  impulse: ImpulseInput,
  overlayFs: OverlayFs,
  config: RunImpulseConfig,
  llmStage: LlmStageCallback,
): Promise<RunImpulseResult> {
  // Step 1: Create computer
  const computer = createComputer(overlayFs, config.computer);

  // Step 2: Intent hint matching
  const intents = await loadIntentHints(overlayFs);
  const matchedIntents = matchIntentHints(
    intents,
    impulse.text,
    config.maxIntentHints ?? 3,
  );

  // Step 3: Auto-preview matched intent commands
  const flowContext: ImpulseFlowContext =
    config.responsePlanPolicy === undefined
      ? {}
      : { responsePlanPolicy: config.responsePlanPolicy };
  const autoPreviewRecords: PreviewExecRecord[] = [];
  const autoPreviewResults: Array<{ execId: string; stdout: string }> = [];

  for (const intent of matchedIntents) {
    const result = await computer.tool.execute(
      `await command(${intent.command
        .split(' ')
        .map((a) => `'${a.replace(/'/g, "\\'")}'`)
        .join(', ')})`,
      flowContext,
      undefined,
    );
    if (result.success) {
      autoPreviewRecords.push(result.data);
      autoPreviewResults.push({
        execId: result.data.execId,
        stdout: result.data.stdout,
      });
    }
  }

  // Step 3.5: Write flow state to /runtime/state/self-ctx.json
  // Agent can inspect via `status` command.
  await overlayFs.write(
    '/runtime/state/self-ctx.json',
    JSON.stringify(
      {
        impulseId: impulse.impulseId,
        impulseType: impulse.type,
        matchedIntents: matchedIntents.map((h) => ({
          intent: h.intent,
          command: h.command,
        })),
        autoPreviewCount: autoPreviewRecords.length,
        previewExecOrder: flowContext.previewExecOrder ?? [],
      },
      null,
      2,
    ),
  );

  // Step 4: LLM stage (provided by caller)
  const decisionOutput = await llmStage({
    computer,
    flowContext,
    autoPreviewResults,
    impulse,
  });

  // Step 5: Resolve decision
  const decision = resolveImpulseDecision(
    impulse.impulseId,
    decisionOutput,
    flowContext,
  );

  // Step 6: Commit selected preview against real state
  const commitResult = await commitSingleImpulse(decision, {
    registry: computer.registry,
    overlayFs,
    modules: config.computer.modules,
    transactionRuntime: config.computer.transactionRuntime,
    hostContext: {
      ctx: flowContext,
      input: impulse,
      responsePlanPolicy: config.responsePlanPolicy,
    },
  });

  return {
    impulseId: impulse.impulseId,
    decision,
    commitResult,
    matchedIntents,
    autoPreviewRecords,
    flowContext,
  };
}
