/**
 * Response Flow
 *
 * ai-flow stage definition for response generation.
 *
 * The response flow produces one plain-text output covering all selected
 * intents from the scheduler's batch decision. There is no separate
 * "decide whether to respond" stage — the scheduler is the only arbiter.
 *
 * Stages:
 * - generate: produce a plain-text thread covering all intents
 * - evalDraft: quality gate (repetition, tone, coverage)
 */

import {
  createAiContext,
  createAiFlow,
  createAiOutput,
  createAiOutputStage,
  createAiPrompt,
  createAiTextStage,
  type OverlayFs,
} from '@inkibra/ai-flow';
import type { StageAiSettings } from '../construct/types';
import { resolveStageContext } from '../vfs/context-system';
import { readDerivedTranscriptEntries } from '../vfs/transcript';
import { evalDraftOutputSchema } from './flow.schemas';

/**
 * A scheduled intent to be covered by the response.
 */
export type ResponseIntent = {
  id: string;
  intent: string;
  scheduledBy: string;
};

export type ResponseFlowContext = {
  /** Ordered intents to cover (scheduler priority order) */
  intents: ResponseIntent[];
  /** Scheduler context for generation frame */
  schedulerContext?: string;
  evalDraft: EvalDraftVerdict | null;
  draft?: string;
  attempt?: number;
  regenGuidance?: string;
};

/**
 * @deprecated Response decide is removed. Scheduler is now the only arbiter.
 */
export type ResponseDecision = {
  decision: 'respond' | 'wait' | 'drop';
  reason: string;
};

export type EvalDraftVerdict = {
  verdict: 'ok' | 'revise' | 'drop';
  repeat: 'ok' | 'repeat';
  tone: 'ok' | 'mismatch';
  /** Whether the draft covers all selected intents */
  coverage?: 'ok' | 'incomplete';
  reason: string;
};

export type ResponseFlowConfig = {
  stages?: {
    /** @deprecated decide stage is removed */
    decide?: StageAiSettings;
    generate?: StageAiSettings;
    evalDraft?: StageAiSettings;
  };
  systemPrompt?: string;
  /** @deprecated decide stage is removed */
  decisionPrompt?: string;
  evalDraftPrompt?: string;
};

const DEFAULT_RESPONSE_SYSTEM_PROMPT = `You are responding to a user based on your accumulated thinking.

Generate a natural, helpful response. Be conversational and genuine.
Avoid repeating what you already said; respond only to new points.

Write as a short text-message thread in natural prose. Output between 1 and 10 messages.
Separate distinct sent messages with a blank line.
Do not use labels like MESSAGE 1 or separators like ---.
Keep each message short and cover distinct points.

You must address all of the listed intents in your response, in priority order.
Earlier intents have higher priority. Do not skip any intent.`;

const DEFAULT_EVAL_DRAFT_PROMPT = `Evaluate the draft response for repetition, tone/personality fit, and coverage of all selected intents.

Use the pinned context as the source of personality, soul, identity, and repeat-policy guidance.
Use the recent activity log only to understand what happened in the last 30 minutes.

Rules:
- If the draft repeats prior content or paraphrases without advancing the conversation, mark repeat as "repeat".
- If the draft conflicts with SOUL.md, IDENTITY.md, or sounds robotic/corporate/jackass-y, mark tone as "mismatch".
- If the draft misses one or more selected intents, mark coverage as "incomplete".
- If all checks pass, verdict is "ok".
- If the draft should be regenerated, verdict is "revise".
- If the draft should not be sent at all, verdict is "drop".

Return JSON only with keys:
- verdict: "ok" | "revise" | "drop"
- repeat: "ok" | "repeat"
- tone: "ok" | "mismatch"
- coverage: "ok" | "incomplete"
- reason: short explanation
`;

export function createResponseFlow(
  vfs: OverlayFs,
  config: ResponseFlowConfig = {},
) {
  const stages = config.stages;
  const systemPrompt = config.systemPrompt ?? DEFAULT_RESPONSE_SYSTEM_PROMPT;
  const evalDraftPrompt = config.evalDraftPrompt ?? DEFAULT_EVAL_DRAFT_PROMPT;

  return createAiFlow<
    ResponseFlowContext,
    {
      generate: ReturnType<typeof createGenerateStage>;
      evalDraft: ReturnType<typeof createEvalDraftStage>;
    }
  >('response-generation', {
    stages: {
      generate: createGenerateStage(stages?.generate, systemPrompt, vfs),
      evalDraft: createEvalDraftStage(stages?.evalDraft, evalDraftPrompt, vfs),
    },
  });
}

function createGenerateStage(
  stageConfig: StageAiSettings | undefined,
  systemPrompt: string,
  vfs: OverlayFs,
) {
  const model =
    stageConfig?.model ??
    (() => {
      throw new Error(
        'No model configured for response/generate stage. Set stageConfig.model.',
      );
    })();
  return createAiTextStage<'generate', ResponseFlowContext, {}>('generate', {
    model,
    verbosity: stageConfig?.verbosity,
    reasoningEffort: stageConfig?.reasoningEffort,
    reasoningSummary: stageConfig?.reasoningSummary,
    serviceTier: stageConfig?.serviceTier,
    maxOutputTokens: stageConfig?.maxOutputTokens,
    context: {
      stageContext: createAiContext<ResponseFlowContext>('stageContext', {
        render: async () =>
          resolveStageContext(vfs, { stage: 'response', now: new Date() }),
      }),
    },
    instructions: createAiPrompt<ResponseFlowContext>('instructions', {
      render: () => systemPrompt,
    }),
    inputs: {
      frame: {
        key: 'frame',
        render: async (ctx) => [
          {
            role: 'system' as const,
            type: 'message' as const,
            content: renderResponseFrame(ctx, {
              title: 'Generation Frame',
              purpose: 'generate the next user-facing response',
              includeRegen: true,
            }),
          },
        ],
      },
    },
  });
}

function createEvalDraftStage(
  stageConfig: StageAiSettings | undefined,
  prompt: string,
  vfs: OverlayFs,
) {
  const model =
    stageConfig?.model ??
    (() => {
      throw new Error(
        'No model configured for response/evalDraft stage. Set stageConfig.model.',
      );
    })();
  const output = createAiOutput<
    'evalDraft',
    Pick<ResponseFlowContext, 'draft'>,
    EvalDraftVerdict
  >('evalDraft', {
    ...evalDraftOutputSchema,
    render: (_ctx, output) =>
      output ? `Draft eval: ${output.verdict}` : 'Draft eval: unknown',
  });

  return createAiOutputStage<
    'evalDraft',
    ResponseFlowContext,
    Record<string, never>,
    EvalDraftVerdict,
    'evalDraft',
    Record<string, never>
  >('evalDraft', {
    model,
    verbosity: stageConfig?.verbosity,
    reasoningEffort: stageConfig?.reasoningEffort,
    reasoningSummary: stageConfig?.reasoningSummary,
    serviceTier: stageConfig?.serviceTier,
    maxOutputTokens: stageConfig?.maxOutputTokens,
    maxSteps: 2,
    tools: {},
    storage: () => ({}),
    context: {
      stageContext: createAiContext<ResponseFlowContext>('stageContext', {
        render: async () =>
          resolveStageContext(vfs, { stage: 'response', now: new Date() }),
      }),
      draft: createAiContext<ResponseFlowContext>('draft', {
        render: (ctx) => (ctx.draft ? `## Draft\n\n${ctx.draft}` : ''),
      }),
    },
    instructions: createAiPrompt<ResponseFlowContext>('instructions', {
      render: () => prompt,
    }),
    inputs: {
      frame: {
        key: 'frame',
        render: async (ctx) => {
          const previousResponse = await getLastConstructResponse(vfs);
          return [
            {
              role: 'system' as const,
              type: 'message' as const,
              content: renderEvalFrame(
                previousResponse,
                ctx.draft,
                'Draft Eval',
                prompt,
                ctx.intents,
              ),
            },
          ];
        },
      },
    },
    output,
  });
}

function renderResponseFrame(
  ctx: ResponseFlowContext,
  options: { title: string; purpose: string; includeRegen: boolean },
): string {
  const lines: string[] = [];
  lines.push(`# ${options.title}`);
  lines.push(`Purpose: ${options.purpose}.`);
  lines.push('');

  // Render intents in priority order
  if (ctx.intents.length > 0) {
    lines.push('## Intents to Cover (priority order)');
    lines.push('You must address ALL of these intents in one response.');
    lines.push('');
    for (let i = 0; i < ctx.intents.length; i++) {
      const intent = ctx.intents[i]!;
      lines.push(`${i + 1}. [${intent.id}] ${intent.intent}`);
    }
  }

  if (ctx.schedulerContext) {
    lines.push('');
    lines.push('## Scheduler Context');
    lines.push(ctx.schedulerContext);
  }

  if (options.includeRegen && ctx.regenGuidance) {
    lines.push('');
    lines.push('## Regeneration Guidance');
    lines.push(ctx.regenGuidance);
  }

  return lines.join('\n');
}

function renderEvalFrame(
  previousResponse: string,
  currentDraft: string | undefined,
  title: string,
  prompt: string,
  intents?: ResponseIntent[],
): string {
  const lines = [
    `# ${title} Frame`,
    prompt.trim(),
    '',
    'Previous Construct Response:',
    previousResponse,
    '',
    'Draft Response Under Evaluation:',
    currentDraft?.trim() || '(none)',
  ];

  if (intents && intents.length > 0) {
    lines.push('');
    lines.push('Selected Intents (all must be covered):');
    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i]!;
      lines.push(`${i + 1}. [${intent.id}] ${intent.intent}`);
    }
  }

  return lines.join('\n');
}

async function getLastConstructResponse(vfs: OverlayFs): Promise<string> {
  try {
    const entries = await readDerivedTranscriptEntries(vfs);
    const last = entries
      .filter((entry) => entry.role === 'construct')
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .pop();

    return last?.content?.trim() || '(none)';
  } catch {
    return '(none)';
  }
}
