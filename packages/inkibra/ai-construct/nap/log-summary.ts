import {
  type AIDeps,
  createAiFlow,
  createAiOutput,
  createAiOutputStage,
  createAiPrompt,
} from '@inkibra/ai-flow';
import type { StageAiSettings } from '../construct/types';
import { napLaneLogSummaryOutputSchema } from './log-summary.schemas';

export type NapLaneLogSummary = {
  summary: string;
  highlights: string[];
};

type NapLogSummaryFlowContext = {
  lane: string;
  logType: string;
  compactedPath: string;
  entryCount: number;
  compactedContent: string;
  summarize: NapLaneLogSummary | null;
};

type NapLogSummaryOutputName = 'summarize';

const NAP_LOG_SUMMARIZE_PROMPT = `You are summarizing one compacted lane log for internal memory.

Summarize only the supplied log file. Do not infer facts that are not grounded in the file.
Do not describe the compaction process, frontmatter, or metadata bookkeeping.
Write factual summaries of what happened in this lane log.

Return structured output only.`;

export async function summarizeCompactedLaneLog(
  deps: AIDeps,
  args: {
    lane: string;
    logType: string;
    compactedPath: string;
    entryCount: number;
    compactedContent: string;
    stageConfig: StageAiSettings;
  },
): Promise<NapLaneLogSummary> {
  const model =
    args.stageConfig.model ??
    (() => {
      throw new Error(
        'No model configured for nap/summarize stage. Set stages.summarize.model or stages.analyze.model.',
      );
    })();

  const output = createAiOutput<
    NapLogSummaryOutputName,
    Pick<NapLogSummaryFlowContext, 'summarize'>,
    NapLaneLogSummary
  >('summarize', {
    ...napLaneLogSummaryOutputSchema,
    render: (_ctx, result) =>
      result ? `Summary: ${result.summary}` : 'Summary not available',
  });

  const stage = createAiOutputStage<
    'summarize',
    NapLogSummaryFlowContext,
    Record<string, never>,
    NapLaneLogSummary,
    NapLogSummaryOutputName,
    Record<string, never>
  >('summarize', {
    model,
    verbosity: args.stageConfig.verbosity,
    reasoningEffort: args.stageConfig.reasoningEffort,
    reasoningSummary: args.stageConfig.reasoningSummary,
    serviceTier: args.stageConfig.serviceTier,
    maxOutputTokens: args.stageConfig.maxOutputTokens,
    maxSteps: 2,
    tools: {},
    storage: () => ({}),
    context: {},
    instructions: createAiPrompt<NapLogSummaryFlowContext>('instructions', {
      render: (ctx) => `${NAP_LOG_SUMMARIZE_PROMPT}

## Lane
${ctx.lane}

## Log Type
${ctx.logType}

## Guidance
${renderLogTypeGuidance(ctx.logType)}`,
    }),
    inputs: {
      frame: {
        key: 'frame',
        render: (ctx) => [
          {
            role: 'user' as const,
            type: 'message' as const,
            content: renderSummaryFrame(ctx),
          },
        ],
      },
    },
    output,
  });

  const flow = createAiFlow<
    NapLogSummaryFlowContext,
    { summarize: typeof stage }
  >('nap-log-summary-flow', {
    stages: { summarize: stage },
  });

  let result: NapLaneLogSummary | null = null;
  await flow
    .onStep('summarize', async ({ step }) => {
      switch (step.kind) {
        case 'reasoning':
        case 'tool':
          return step.next();
        case 'output':
          return step.output.accept((outputValue, ctx) => {
            result = outputValue;
            return {
              ctx: {
                ...ctx,
                summarize: outputValue,
              },
            };
          });
      }
    })
    .start({
      flow: {
        lane: args.lane,
        logType: args.logType,
        compactedPath: args.compactedPath,
        entryCount: args.entryCount,
        compactedContent: args.compactedContent,
        summarize: null,
      },
      firstStage: 'summarize',
      deps,
    })
    .complete();

  if (!result) {
    throw new Error(
      `nap/summarize produced no output for ${args.compactedPath}`,
    );
  }

  return result;
}

function renderSummaryFrame(ctx: NapLogSummaryFlowContext): string {
  return [
    '# Compacted Lane Log',
    '',
    `Path: ${ctx.compactedPath}`,
    `Lane: ${ctx.lane}`,
    `Log type: ${ctx.logType}`,
    `Entry count: ${ctx.entryCount}`,
    '',
    '## Log Content',
    ctx.compactedContent,
  ].join('\n');
}

function renderLogTypeGuidance(logType: string): string {
  switch (logType) {
    case 'conversation':
      return 'Summarize the interaction, key requests, decisions, and unresolved asks in this lane.';
    case 'heartbeat':
      return 'Summarize operational state changes, recurring behavior, and any anomalies in this lane.';
    case 'source-event':
      return 'Summarize incoming source events, what changed, and any notable implications in this lane.';
    default:
      return 'Summarize the notable activity in this lane log factually and concisely.';
  }
}
