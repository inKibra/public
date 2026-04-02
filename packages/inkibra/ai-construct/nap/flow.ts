import type { VfsToolResult } from '@inkibra/ai-flow';
import {
  type AIDeps,
  type ContextMeta,
  createAiContext,
  createAiFlow,
  createAiPrompt,
  createAiTextStage,
  createAiTool,
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
  type Validation,
} from '@inkibra/ai-flow';
import {
  type Command,
  type ComputerConfig,
  contextManagementCommands,
  createCommandRegistry,
  createComputer,
  fileOperationCommands,
  pmCommand,
  renderCommandOutput,
} from '@inkibra/ai-sandbox-computer';
import type {
  NapCommitToolsSettings,
  StageAiSettings,
} from '../construct/types';
import { resolveUserTimeZone } from '../utils/timezone';
import {
  buildLaneStageContextPressureDiagnostics,
  type ContextPressureConfig,
  DEFAULT_CONTEXT_PRESSURE_CONFIG,
  type LaneStageContextPressureDiagnostics,
} from '../vfs/context-pressure';
import {
  loadLanesConfig,
  renderSection,
  resolveStageContext,
} from '../vfs/context-system';
import { getLogWeekDir, VFS_PATHS } from '../vfs/layout';
import { parseLogName } from '../vfs/logs';
import {
  consumeNextNapImprints,
  consumeNextNapPins,
  loadPendingNextNapImprints,
  loadPendingNextNapPins,
  type NextNapImprintEntry,
  type NextNapPinEntry,
} from '../vfs/nap-instructions';

import { summarizeCompactedLaneLog } from './log-summary';

type NapStageName = 'analyze' | 'propose';

type LaneDraft = {
  lane: string;
  content: string;
};

type PreparedNapState = {
  shared: NapSharedContext;
  nextNapPinQueuePath: string;
  nextNapImprintQueuePath: string;
};

type NapSharedContext = {
  now: Date;
  lanes: string[];
  logPlans: LogRotationPlan[];
  contextPressure: LaneStageContextPressureDiagnostics;
  nextNapPins: NextNapPinEntry[];
  nextNapImprints: NextNapImprintEntry[];
};

type CommitFlowContext = NapSharedContext & {
  analysis: string;
  proposal: string;
  commitCompleted: boolean;
  commitSummary?: string;
  commitToolCalls: number;
};

type CompletionToolResult = {
  summary: string;
};

type NapManagedLogType = string;

const NON_COMPACTABLE_LOG_TYPES = new Set(['nap']);
type LogRotationPlan = {
  type: NapManagedLogType;
  dir: string;
  day: string;
  current?: string;
  next: string;
  compactedPath?: string;
  rotatedTo?: string;
  entryCount?: number;
  retainedEntries?: number;
};

const NAP_ANALYZE_PROMPT = `You are running a NAP (compaction) analysis for a single lane. This is internal and not user-facing.

Goal: decide which docs to update and what identity evolution work matters for this lane.

Focus only on the supplied lane. Produce a concise analysis draft for that lane.
Do not use tools in this stage.`;

const NAP_PROPOSE_PROMPT = `You are running the NAP (compaction) propose stage for a single lane. This is internal and not user-facing.

Based on the supplied lane analysis, produce concrete proposals for identity evolution and file changes for that lane.

Focus only on the supplied lane. Do not use tools in this stage.`;

const NAP_COMMIT_PROMPT = `You are running the NAP (compaction) commit stage. This is internal.

The host already rotated and compacted the managed logs before this stage. Treat the log-rotation report in context as authoritative; do not re-run that mechanical work.

Detailed system, developer, and agent capability docs are already loaded in context; use those docs for exact command/package behavior.

Use the direct command tools for persistent edits to the real construct state: file changes, context management, and local VFS package management.
Use preview_exec only for speculative verification and inspection on a forked copy of the current state. preview_exec does NOT persist changes by itself.

Goals:
- Update core docs (SOUL, USER, PRINCIPLES, HEARTBEAT, BOOTSTRAP) only when the analysis/proposal justifies it.
- Write a nap log in /logs/nap/ named YYYY-MM-DD-<n>.log with frontmatter + body.
- Delete BOOTSTRAP.md only if its own instructions are satisfied.

You MUST call complete_nap_commit once all persistent filesystem/package work is finished.
Only after calling complete_nap_commit may you return the final nap log text.

Nap log guidance:
- Frontmatter: summary (one paragraph), highlights (short list), files_touched (paths), bootstrap_deleted (true/false), log_rotation (map of old->new).
- Body sections: What I did / What I learned / What I updated / What I'm unsure about / Next time.

When everything is complete, output the full nap log text (frontmatter + body) as your final response, with no extra commentary.`;

const HYPNO_REVIEW_PROMPT = `You are a review evaluator during a hypno (identity evolution) session.
The human trainer is evaluating a merged draft. Help them assess and refine it.

Your role:
- Discuss the draft honestly: answer questions, point out issues, suggest improvements
- Maintain a cumulative Update Plan that captures all agreed-upon changes

Always end your response with an Update Plan section using this exact header:

## Update Plan

[List all concrete changes to apply to the draft. Write "(no changes yet)" if nothing actionable has been discussed.]

Rules for the plan:
- Keep it cumulative — include ALL discussed changes, not just the latest
- Be specific — reference sections, quote text to change, describe edits precisely
- If the trainer explicitly rejects a change, remove it from the plan
- If the trainer asks a question without requesting changes, keep the plan unchanged`;

export function renderNapPromptWithImprints(
  basePrompt: string,
  imprints: NextNapImprintEntry[],
): string {
  if (imprints.length === 0) {
    return basePrompt;
  }

  const lines = imprints.map((entry) => `- (${entry.id}) ${entry.text}`);
  return `${basePrompt}

## Next Nap Imprints (Host Directive)

Apply these directives during this nap run:
${lines.join('\n')}`;
}

export type HypnoReviewState = {
  readonly chatTranscript: ReadonlyArray<{
    role: 'human' | 'assistant';
    text: string;
  }>;
  readonly currentPlan: string;
  readonly planRevision: number;
  readonly lastAppliedRevision: number;
  readonly hasPendingPlan: boolean;
};

export type HypnoResult = {
  status: 'completed' | 'cancelled';
  analysis: string;
  proposal: string;
  tools: VfsToolResult[];
};

/**
 * Interactive hypno session handle returned by `runHypnoFlow`.
 *
 * Lifecycle: analyze → propose → commit → completed (or cancelled at any point).
 * The trainer drives each stage transition via `accept()`, `feedback()`, or `cancel()`.
 */
export type HypnoSession = {
  /** Current stage in the hypno lifecycle. */
  readonly stage: 'analyze' | 'propose' | 'commit' | 'completed' | 'cancelled';
  /** Merged draft content across all lanes for the current stage. */
  readonly draft: string;
  /** Current review chat state (transcript, plan, revision tracking). */
  readonly reviewState: HypnoReviewState;
  /** Accept the current draft and advance to the next stage. */
  accept: () => void;
  /** Provide feedback on the current draft; triggers a re-generation. */
  feedback: (text: string) => void;
  /** Send a free-form chat message to the review LLM. Feedback is broadcast to all lanes. */
  chat: (text: string) => Promise<string>;
  /** Apply the accumulated plan from the review chat to the current draft. */
  applyPlan: () => void;
  /** Cancel the hypno session at any stage. */
  cancel: () => void;
  /** Resolves when the session reaches 'completed' or 'cancelled'. */
  done: Promise<HypnoResult>;
};

/** Callbacks for observing hypno session progress. All optional. */
export type HypnoCallbacks = {
  /** Fired when a full draft is ready for review at the given stage. */
  onDraftReady?: (stage: 'analyze' | 'propose', draft: string) => void;
  onDraftChunk?: (
    stage: 'analyze' | 'propose',
    text: string,
    delta: string,
  ) => void;
  /** Fired when the analysis stage completes. */
  onAnalysis?: (content: string) => void;
  /** Fired when the proposal stage completes. */
  onProposal?: (content: string) => void;
  /** Fired when a VFS tool is executed during the commit stage. */
  onTool?: (tool: VfsToolResult) => void;
  /** Fired on every stage transition. */
  onStageChange?: (stage: HypnoSession['stage']) => void;
  onReviewChunk?: (
    stage: 'analyze' | 'propose',
    text: string,
    delta: string,
  ) => void;
  onReviewReply?: (
    stage: 'analyze' | 'propose',
    reply: string,
    plan: string,
  ) => void;
  onPlanUpdated?: (stage: 'analyze' | 'propose', plan: string) => void;
};

type NapFlowCallbacks = {
  onStageChange?: (stage: 'analyze' | 'propose' | 'commit') => void;
  onAnalysis?: (content: string) => void;
  onTool?: (tool: VfsToolResult) => void;
};

type NapFlowResult = {
  analysis: string;
  proposal: string;
  tools: VfsToolResult[];
};

function parseReviewResponse(text: string): { reply: string; plan: string } {
  const marker = '## Update Plan';
  const idx = text.lastIndexOf(marker);
  if (idx === -1) return { reply: text.trim(), plan: '' };
  return {
    reply: text.slice(0, idx).trim(),
    plan: text.slice(idx + marker.length).trim(),
  };
}

function buildReviewSystemMessage(
  stage: 'analyze' | 'propose',
  draft: string,
): string {
  const stageLabel = stage === 'analyze' ? 'analysis' : 'proposal';
  return `${HYPNO_REVIEW_PROMPT}

## Current ${stageLabel} Draft

${draft}`;
}

function mergeLaneDrafts(label: string, drafts: LaneDraft[]): string {
  const sections = drafts.map(({ lane, content }) => {
    const body = content.trim().length > 0 ? content.trim() : '(empty)';
    return `## Lane: ${lane}\n\n${body}`;
  });
  return `# ${label}\n\n${sections.join('\n\n')}`;
}

function buildHypnoFeedback(
  stage: 'analyze' | 'propose',
  currentDraft: string,
  reviewerNote: string,
): string {
  const stageLabel = stage === 'analyze' ? 'analysis' : 'proposal';
  return [
    `## Revision Request (${stageLabel})`,
    '',
    'You are revising an existing merged draft based on human feedback.',
    'Apply only the requested changes. Preserve all unchanged sections.',
    'Return the complete revised draft with edits applied.',
    '',
    '### Reviewer Feedback',
    '',
    reviewerNote,
    '',
    '### Current Draft to Revise',
    '',
    currentDraft,
  ].join('\n');
}

function buildLaneFeedbackMap(
  stage: NapStageName,
  drafts: LaneDraft[],
  reviewerNote: string,
): Record<string, string> {
  return Object.fromEntries(
    drafts.map((draft) => [
      draft.lane,
      buildHypnoFeedback(stage, draft.content, reviewerNote),
    ]),
  );
}

type PreviewExecToolResult = {
  execId: string;
  stdout: string;
};

function createStringValidation<T extends Record<string, string>>(
  key: keyof T & string,
): (raw: string) => Validation<T> {
  return (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        return {
          success: false,
          errors: [{ path: key, expected: 'non-empty string', value }],
        };
      }
      return {
        success: true,
        data: { [key]: value } as T,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            message:
              error instanceof Error ? error.message : 'invalid JSON payload',
          },
        ],
      };
    }
  };
}

async function getOrderedNapLanes(vfs: OverlayFs): Promise<string[]> {
  const lanes = Object.keys(await loadLanesConfig(vfs));
  return lanes.length > 0 ? lanes : ['conversation'];
}

async function prepareNapState(
  vfs: OverlayFs,
  options: {
    nextNapPinQueuePath?: string;
    nextNapImprintQueuePath?: string;
    contextPressureConfig?: ContextPressureConfig;
  },
): Promise<PreparedNapState> {
  const now = new Date();
  const contextPressure = await buildLaneStageContextPressureDiagnostics(
    vfs,
    options.contextPressureConfig ?? DEFAULT_CONTEXT_PRESSURE_CONFIG,
  );
  const logPlans = await buildLogRotationPlans(vfs, now);
  const appliedLogPlans = await applyLogRotationPlans(vfs, now, logPlans);
  const nextNapPinQueuePath =
    options.nextNapPinQueuePath ?? VFS_PATHS.queue.napPinQueue;
  const nextNapPins = await loadPendingNextNapPins(vfs, nextNapPinQueuePath);

  const nextNapImprintQueuePath =
    options.nextNapImprintQueuePath ?? VFS_PATHS.queue.nextNapImprintQueue;
  const nextNapImprints = await loadPendingNextNapImprints(
    vfs,
    nextNapImprintQueuePath,
  );

  const shared: NapSharedContext = {
    now,
    lanes: await getOrderedNapLanes(vfs),
    logPlans: appliedLogPlans,
    contextPressure,
    nextNapPins,
    nextNapImprints,
  };

  await syncNapContextSnapshots(vfs, shared);
  shared.contextPressure = await buildLaneStageContextPressureDiagnostics(
    vfs,
    options.contextPressureConfig ?? DEFAULT_CONTEXT_PRESSURE_CONFIG,
  );
  await syncNapContextSnapshots(vfs, shared);
  return {
    shared,
    nextNapPinQueuePath,
    nextNapImprintQueuePath,
  };
}

async function finalizePreparedNapState(
  vfs: OverlayFs,
  prepared: PreparedNapState,
  cancelled = false,
): Promise<void> {
  if (!cancelled && prepared.shared.nextNapPins.length > 0) {
    await consumeNextNapPins(
      vfs,
      prepared.shared.nextNapPins.map((entry) => entry.id),
      prepared.nextNapPinQueuePath,
    );
  }
  if (!cancelled && prepared.shared.nextNapImprints.length > 0) {
    await consumeNextNapImprints(
      vfs,
      prepared.shared.nextNapImprints.map((entry) => entry.id),
      prepared.nextNapImprintQueuePath,
    );
  }
}

async function summarizePreparedNapLogs(args: {
  vfs: OverlayFs;
  deps: AIDeps;
  shared: NapSharedContext;
  stageConfig?: StageAiSettings;
}): Promise<void> {
  const stageConfig = args.stageConfig;
  const compactedPlans = args.shared.logPlans.filter(
    (plan) =>
      typeof plan.compactedPath === 'string' &&
      typeof plan.entryCount === 'number' &&
      plan.entryCount > 0,
  );
  if (compactedPlans.length === 0) {
    return;
  }
  if (!stageConfig?.model) {
    throw new Error(
      'No model configured for nap/summarize stage. Set stages.summarize.model or stages.analyze.model.',
    );
  }

  await Promise.all(
    compactedPlans.map(async (plan) => {
      const compactedPath = plan.compactedPath;
      if (!compactedPath) return;
      const raw = await args.vfs.read(compactedPath);
      const parsed = parseContextFile(raw);
      const result = await summarizeCompactedLaneLog(args.deps, {
        lane: plan.type,
        logType: plan.type,
        compactedPath,
        entryCount: plan.entryCount ?? 0,
        compactedContent: parsed.content,
        stageConfig,
      });
      await writeCompactedLogSummary(args.vfs, compactedPath, result);
    }),
  );
}

async function runLaneDraftStage(args: {
  vfs: OverlayFs;
  deps: AIDeps;
  shared: NapSharedContext;
  lane: string;
  stage: NapStageName;
  stageConfig?: StageAiSettings;
  laneAnalysis?: string;
  feedback?: string;
  onChunk?: (text: string, delta: string) => void;
}): Promise<string> {
  const promptBase =
    args.stage === 'analyze' ? NAP_ANALYZE_PROMPT : NAP_PROPOSE_PROMPT;
  const systemPrompt = renderNapPromptWithImprints(
    `${promptBase}\n\n## Target Lane\n\n${args.lane}\n\nFocus only on this lane.`,
    args.shared.nextNapImprints,
  );

  const contextSections = await buildLaneContextSections({
    vfs: args.vfs,
    shared: args.shared,
    lane: args.lane,
    stage: args.stage,
    laneAnalysis: args.laneAnalysis,
  });

  const input: Array<{
    role: 'system' | 'user';
    type: 'message';
    content: string;
  }> = [
    {
      role: 'system',
      type: 'message',
      content: systemPrompt,
    },
    {
      role: 'user',
      type: 'message',
      content: contextSections.join('\n\n'),
    },
  ];

  if (args.feedback) {
    input.push({
      role: 'user',
      type: 'message',
      content: args.feedback,
    });
  }

  const stageSettings = args.stageConfig;
  const stream = args.deps.openAI.responses.stream({
    model:
      stageSettings?.model ??
      (() => {
        throw new Error(
          `No model configured for nap/${args.stage} stage. Set stageConfig.model.`,
        );
      })(),
    service_tier: stageSettings?.serviceTier,
    input,
    stream: true,
    text: {
      verbosity: stageSettings?.verbosity,
      format: { type: 'text' as const },
    },
    reasoning: {
      summary: stageSettings?.reasoningSummary,
      effort: stageSettings?.reasoningEffort,
    },
    max_output_tokens: stageSettings?.maxOutputTokens,
  });

  let fullText = '';
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      const delta = event.delta ?? '';
      fullText += delta;
      args.onChunk?.(fullText, delta);
    }
  }

  return fullText.trim();
}

async function generateMergedLaneDrafts(args: {
  vfs: OverlayFs;
  deps: AIDeps;
  shared: NapSharedContext;
  stage: NapStageName;
  stageConfig?: StageAiSettings;
  feedbackByLane?: Record<string, string>;
  laneAnalyses?: Record<string, string>;
  onMergedChunk?: (text: string, delta: string) => void;
}): Promise<{ merged: string; drafts: LaneDraft[] }> {
  const drafts: LaneDraft[] = [];
  let previousMerged = '';

  for (const lane of args.shared.lanes) {
    const content = await runLaneDraftStage({
      vfs: args.vfs,
      deps: args.deps,
      shared: args.shared,
      lane,
      stage: args.stage,
      stageConfig: args.stageConfig,
      laneAnalysis: args.laneAnalyses?.[lane],
      feedback: args.feedbackByLane?.[lane],
    });
    drafts.push({ lane, content });
    const merged = mergeLaneDrafts(
      args.stage === 'analyze'
        ? 'Nap Analysis by Lane'
        : 'Nap Proposal by Lane',
      drafts,
    );
    const delta = merged.slice(previousMerged.length);
    previousMerged = merged;
    args.onMergedChunk?.(merged, delta);
  }

  return {
    merged: previousMerged,
    drafts,
  };
}

function createCompletionTool() {
  return createAiTool<
    CommitFlowContext,
    { summary: string },
    CompletionToolResult,
    AIDeps
  >('complete_nap_commit', {
    description:
      'Call this exactly once after all nap filesystem work is complete. Provide a short summary of the completed commit.',
    parameterSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Short summary of the completed commit work',
        },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    parseParameters: createStringValidation<{ summary: string }>('summary'),
    execute: async ({ summary }) => ({
      success: true as const,
      data: { summary },
    }),
    render: ({ summary }) => `Completion recorded: ${summary}`,
  });
}

type DirectCommandToolResult = {
  command: string;
  output: string;
  ephemeralOutput?: string;
};

function buildDirectCommandParameterSchema(
  command: Pick<Command<never>, 'args'>,
) {
  const properties = Object.fromEntries(
    Object.entries(command.args).map(([name, def]) => [
      name,
      {
        type: def.type,
        ...(def.description ? { description: def.description } : {}),
      },
    ]),
  );
  const required = Object.entries(command.args)
    .filter(([, def]) => def.required !== false && def.default === undefined)
    .map(([name]) => name);

  return {
    type: 'object' as const,
    properties,
    required,
    additionalProperties: false,
  };
}

function createValidationError(
  path: string,
  expected: string,
  value: unknown,
): Validation<Record<string, unknown>> {
  return {
    success: false,
    errors: [{ path, expected, value }],
  };
}

function validateDirectCommandParameters(
  command: Pick<Command<never>, 'args'>,
): (raw: string) => Validation<Record<string, unknown>> {
  return (raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return createValidationError(
        '$',
        'valid JSON object',
        error instanceof Error ? error.message : raw,
      );
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return createValidationError('$', 'object', parsed);
    }

    const record = parsed as Record<string, unknown>;
    const allowed = new Set(Object.keys(command.args));
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        return createValidationError(
          key,
          'known command argument',
          record[key],
        );
      }
    }

    const normalized: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(command.args)) {
      const value = record[name];
      if (value === undefined) {
        if (def.default !== undefined) {
          normalized[name] = def.default;
          continue;
        }
        if (def.required === false) {
          continue;
        }
        return createValidationError(name, def.type, value);
      }

      if (typeof value !== def.type) {
        return createValidationError(name, def.type, value);
      }
      normalized[name] = value;
    }

    return { success: true, data: normalized };
  };
}

function createDirectCommandTool<TResult>(args: {
  command: Command<TResult>;
  registry: ReturnType<typeof createCommandRegistry>;
  vfs: OverlayFs;
}) {
  const parameterSchema = buildDirectCommandParameterSchema(args.command);
  const parseParameters = validateDirectCommandParameters(args.command);

  return createAiTool<
    CommitFlowContext,
    Record<string, unknown>,
    DirectCommandToolResult,
    AIDeps
  >(args.command.name, {
    description: `${args.command.description} Persists changes to the real construct state during nap commit.`,
    parameterSchema,
    parseParameters,
    execute: async (parameters) => {
      const result = await args.command.fn(parameters, {
        fs: args.vfs,
        registry: args.registry,
      });
      const rendered = renderCommandOutput(args.command, result);
      return {
        success: true as const,
        data: {
          command: args.command.name,
          output: rendered.renderedOutput,
          ephemeralOutput: rendered.ephemeralOutput,
        },
      };
    },
    render: (result) =>
      result.ephemeralOutput
        ? {
            renderedOutput: result.output,
            ephemeralOutput: result.ephemeralOutput,
          }
        : result.output,
  });
}

async function runCommitStage(args: {
  vfs: OverlayFs;
  deps: AIDeps;
  shared: NapSharedContext;
  analysis: string;
  proposal: string;
  stageConfig?: StageAiSettings & { tools?: NapCommitToolsSettings };
  computerConfig?: ComputerConfig;
  onTool?: (tool: VfsToolResult) => void;
}): Promise<VfsToolResult[]> {
  const maxToolCalls = args.stageConfig?.tools?.maxToolCalls ?? 20;
  const computer = createComputer(args.vfs, args.computerConfig ?? {});
  const completionTool = createCompletionTool();
  const directRegistry = createCommandRegistry();
  const persistentCommands = [
    ...fileOperationCommands,
    ...contextManagementCommands,
    pmCommand,
    ...(args.computerConfig?.commands ?? []),
  ];
  for (const command of persistentCommands) {
    directRegistry.register(command);
  }
  const directCommandNames = new Set(
    persistentCommands.map((command) => command.name),
  );
  const directCommandTools = Object.fromEntries(
    persistentCommands.map((command) => [
      command.name,
      createDirectCommandTool({
        command,
        registry: directRegistry,
        vfs: args.vfs,
      }),
    ]),
  );

  const tools = {
    ...directCommandTools,
    preview_exec: computer.tool,
    complete_nap_commit: completionTool,
  };

  const stage = createAiTextStage<'commit', CommitFlowContext, typeof tools>(
    'commit',
    {
      model:
        args.stageConfig?.model ??
        (() => {
          throw new Error(
            'No model configured for nap/commit stage. Set stageConfig.model.',
          );
        })(),
      verbosity: args.stageConfig?.verbosity,
      reasoningEffort: args.stageConfig?.reasoningEffort,
      reasoningSummary: args.stageConfig?.reasoningSummary,
      serviceTier: args.stageConfig?.serviceTier,
      maxOutputTokens: args.stageConfig?.maxOutputTokens,
      context: buildCommitContext(args.vfs),
      instructions: createAiPrompt<CommitFlowContext>('instructions', {
        render: (ctx) =>
          renderNapPromptWithImprints(NAP_COMMIT_PROMPT, ctx.nextNapImprints),
      }),
      inputs: {},
      tools,
      toolChoice: ({ flowContext }) =>
        flowContext.commitCompleted ? 'none' : 'required',
    },
  );

  const flow = createAiFlow<CommitFlowContext, { commit: typeof stage }>(
    'nap-commit-flow',
    { stages: { commit: stage } },
  );

  const toolHistory: VfsToolResult[] = [];

  const run = flow.onStep('commit', async ({ step }) => {
    switch (step.kind) {
      case 'reasoning':
      case 'chunk':
        return step.next();
      case 'tool': {
        const toolData = step.toolData as Partial<Record<string, unknown[]>>;
        const previewResults = (toolData.preview_exec ??
          []) as PreviewExecToolResult[];
        const completionResults = (toolData.complete_nap_commit ??
          []) as CompletionToolResult[];
        const directResults = Object.entries(toolData).flatMap(
          ([name, results]) =>
            directCommandNames.has(name)
              ? ((results ?? []) as DirectCommandToolResult[])
              : [],
        );

        for (const result of previewResults) {
          const toolEvent: VfsToolResult = {
            command: `preview_exec (${result.execId})`,
            output: result.stdout || '(no output)',
            exitCode: 0,
          };
          toolHistory.push(toolEvent);
          args.onTool?.(toolEvent);
        }

        for (const result of directResults) {
          const toolEvent: VfsToolResult = {
            command: result.command,
            output: result.output || '(no output)',
            exitCode: 0,
          };
          toolHistory.push(toolEvent);
          args.onTool?.(toolEvent);
        }

        const nextToolCalls =
          step.context.commitToolCalls +
          previewResults.length +
          directResults.length;
        if (!step.context.commitCompleted && nextToolCalls > maxToolCalls) {
          throw new Error(
            `Nap commit exceeded maxToolCalls=${maxToolCalls} without explicit completion`,
          );
        }
        const completion = completionResults.at(-1);
        return step.nextContext((ctx) => ({
          ...ctx,
          commitToolCalls: nextToolCalls,
          commitCompleted: completionResults.length > 0 || ctx.commitCompleted,
          commitSummary: completion?.summary ?? ctx.commitSummary,
        }));
      }
      case 'text': {
        if (step.context.commitCompleted) {
          return step.output.accept((_output, ctx) => ({ ctx: { ...ctx } }));
        }
        return step.output.reject({
          text: 'Before returning the final nap log, call complete_nap_commit with a concise summary after all filesystem work is finished.',
        });
      }
    }
  });

  await run
    .start({
      flow: {
        ...args.shared,
        analysis: args.analysis,
        proposal: args.proposal,
        commitCompleted: false,
        commitSummary: undefined,
        commitToolCalls: 0,
      },
      firstStage: 'commit',
      deps: args.deps,
    })
    .complete();

  return toolHistory;
}

/**
 * Run a non-interactive nap flow: summarize compacted logs → analyze → propose → commit.
 * Returns the merged analysis/proposal text and tool results applied during commit.
 */
export async function runNapFlow(
  vfs: OverlayFs,
  deps: AIDeps,
  callbacks: NapFlowCallbacks = {},
  options: {
    nextNapPinQueuePath?: string;
    nextNapImprintQueuePath?: string;
    contextPressureConfig?: ContextPressureConfig;
    computerConfig?: ComputerConfig;
    stages?: {
      summarize?: StageAiSettings;
      analyze?: StageAiSettings;
      propose?: StageAiSettings;
      commit?: StageAiSettings & { tools?: NapCommitToolsSettings };
    };
  } = {},
): Promise<NapFlowResult> {
  const prepared = await prepareNapState(vfs, options);
  await summarizePreparedNapLogs({
    vfs,
    deps,
    shared: prepared.shared,
    stageConfig: options.stages?.summarize ?? options.stages?.analyze,
  });
  callbacks.onStageChange?.('analyze');
  const analyzeDrafts = await generateMergedLaneDrafts({
    vfs,
    deps,
    shared: prepared.shared,
    stage: 'analyze',
    stageConfig: options.stages?.analyze,
  });
  callbacks.onAnalysis?.(analyzeDrafts.merged);

  const laneAnalysisMap = Object.fromEntries(
    analyzeDrafts.drafts.map((draft) => [draft.lane, draft.content]),
  );

  callbacks.onStageChange?.('propose');
  const proposeDrafts = await generateMergedLaneDrafts({
    vfs,
    deps,
    shared: prepared.shared,
    stage: 'propose',
    stageConfig: options.stages?.propose,
    laneAnalyses: laneAnalysisMap,
  });

  callbacks.onStageChange?.('commit');
  const tools = await runCommitStage({
    vfs,
    deps,
    shared: prepared.shared,
    analysis: analyzeDrafts.merged,
    proposal: proposeDrafts.merged,
    stageConfig: options.stages?.commit,
    computerConfig: options.computerConfig,
    onTool: callbacks.onTool,
  });

  await finalizePreparedNapState(vfs, prepared);
  return {
    analysis: analyzeDrafts.merged,
    proposal: proposeDrafts.merged,
    tools,
  };
}

/**
 * Run an interactive hypno flow with trainer review.
 *
 * Returns a `HypnoSession` handle the caller uses to drive the
 * analyze → propose → commit lifecycle. The session supports
 * `accept()`, `feedback()`, `chat()`, and `cancel()` at each stage.
 *
 * Await `session.done` for the final `HypnoResult`.
 */
export async function runHypnoFlow(
  vfs: OverlayFs,
  deps: AIDeps,
  callbacks: HypnoCallbacks = {},
  options: {
    nextNapPinQueuePath?: string;
    nextNapImprintQueuePath?: string;
    contextPressureConfig?: ContextPressureConfig;
    computerConfig?: ComputerConfig;
    stages?: {
      summarize?: StageAiSettings;
      analyze?: StageAiSettings;
      propose?: StageAiSettings;
      commit?: StageAiSettings & { tools?: NapCommitToolsSettings };
    };
  } = {},
): Promise<HypnoSession> {
  const prepared = await prepareNapState(vfs, options);
  await summarizePreparedNapLogs({
    vfs,
    deps,
    shared: prepared.shared,
    stageConfig: options.stages?.summarize ?? options.stages?.analyze,
  });
  let analysisText = '';
  let proposalText = '';
  let currentDraft = '';
  let cancelled = false;
  let currentStage: HypnoSession['stage'] = 'analyze';
  const toolHistory: VfsToolResult[] = [];

  type ReviewStage = 'analyze' | 'propose';
  type ReviewAction =
    | { type: 'accept' }
    | { type: 'feedback'; text: string }
    | { type: 'cancel' };

  let reviewResolver: ((action: ReviewAction) => void) | null = null;
  const pendingReviewActionByStage: Partial<Record<ReviewStage, ReviewAction>> =
    {};

  let reviewTranscript: Array<{ role: 'human' | 'assistant'; text: string }> =
    [];
  let reviewPlan = '';
  let reviewPlanRevision = 0;
  let reviewLastAppliedRevision = 0;
  let reviewChatChain: Promise<string> = Promise.resolve('');

  const laneAnalysisMap: Record<string, string> = {};

  function resetReviewState() {
    reviewTranscript = [];
    reviewPlan = '';
    reviewPlanRevision = 0;
    reviewLastAppliedRevision = 0;
    reviewChatChain = Promise.resolve('');
  }

  function getActiveReviewStage(): ReviewStage | null {
    if (currentStage === 'analyze' || currentStage === 'propose') {
      return currentStage;
    }
    return null;
  }

  function dispatchReviewAction(action: ReviewAction): void {
    if (reviewResolver) {
      const resolve = reviewResolver;
      reviewResolver = null;
      resolve(action);
      return;
    }

    const stage = getActiveReviewStage();
    if (!stage) {
      return;
    }
    pendingReviewActionByStage[stage] = action;
  }

  function waitForReview(stage: ReviewStage): Promise<ReviewAction> {
    const pending = pendingReviewActionByStage[stage];
    if (pending) {
      delete pendingReviewActionByStage[stage];
      return Promise.resolve(pending);
    }

    return new Promise<ReviewAction>((resolve) => {
      reviewResolver = (action) => {
        reviewResolver = null;
        resolve(action);
      };
    });
  }

  function getReviewState(): HypnoReviewState {
    return {
      chatTranscript: reviewTranscript,
      currentPlan: reviewPlan,
      planRevision: reviewPlanRevision,
      lastAppliedRevision: reviewLastAppliedRevision,
      hasPendingPlan:
        reviewPlanRevision > reviewLastAppliedRevision &&
        reviewPlan.length > 0 &&
        reviewPlan !== '(no changes yet)',
    };
  }

  async function reviewChatImpl(text: string): Promise<string> {
    const stage = currentStage as ReviewStage;
    const draft = currentDraft;
    const reviewStageSettings =
      stage === 'analyze' ? options.stages?.analyze : options.stages?.propose;
    const reviewModel =
      reviewStageSettings?.model ??
      (() => {
        throw new Error(
          `No model configured for hypno/${stage} stage. Set stageConfig.model.`,
        );
      })();

    const systemMsg = buildReviewSystemMessage(stage, draft);
    const input: Array<{
      role: 'system' | 'user' | 'assistant';
      type: 'message';
      content: string;
    }> = [];

    // Always prepend system message — ai-flow replays its own history.
    input.push({
      role: 'system',
      type: 'message',
      content: systemMsg,
    });
    for (const entry of reviewTranscript) {
      input.push({
        role: entry.role === 'human' ? 'user' : 'assistant',
        type: 'message',
        content: entry.text,
      });
    }
    input.push({
      role: 'user',
      type: 'message',
      content: text,
    });

    const stream = deps.openAI.responses.stream({
      model: reviewModel,
      service_tier: reviewStageSettings?.serviceTier,
      input,
      stream: true,
      text: {
        verbosity: reviewStageSettings?.verbosity,
        format: { type: 'text' as const },
      },
      reasoning: {
        summary: reviewStageSettings?.reasoningSummary,
        effort: reviewStageSettings?.reasoningEffort,
      },
      max_output_tokens: reviewStageSettings?.maxOutputTokens,
    });

    let fullText = '';
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        const delta = event.delta ?? '';
        fullText += delta;
        callbacks.onReviewChunk?.(stage, fullText, delta);
      }
    }

    reviewTranscript = [
      ...reviewTranscript,
      { role: 'human', text },
      { role: 'assistant', text: fullText },
    ];

    const { reply, plan } = parseReviewResponse(fullText);
    if (plan && plan !== reviewPlan) {
      reviewPlan = plan;
      reviewPlanRevision += 1;
      callbacks.onPlanUpdated?.(stage, plan);
    }
    callbacks.onReviewReply?.(stage, reply, plan || reviewPlan);
    return reply;
  }

  function setStage(stage: HypnoSession['stage']) {
    currentStage = stage;
    if (stage !== 'analyze') delete pendingReviewActionByStage.analyze;
    if (stage !== 'propose') delete pendingReviewActionByStage.propose;
    resetReviewState();
    callbacks.onStageChange?.(stage);
  }

  const donePromise = (async (): Promise<HypnoResult> => {
    try {
      let analyzeFeedbackByLane: Record<string, string> | undefined;
      setStage('analyze');
      while (true) {
        const analyzeDrafts = await generateMergedLaneDrafts({
          vfs,
          deps,
          shared: prepared.shared,
          stage: 'analyze',
          stageConfig: options.stages?.analyze,
          feedbackByLane: analyzeFeedbackByLane,
          onMergedChunk: (text, delta) => {
            currentDraft = text;
            callbacks.onDraftChunk?.('analyze', text, delta);
          },
        });
        analysisText = analyzeDrafts.merged;
        currentDraft = analysisText;
        for (const draft of analyzeDrafts.drafts) {
          laneAnalysisMap[draft.lane] = draft.content;
        }
        resetReviewState();
        callbacks.onDraftReady?.('analyze', analysisText);

        const action = await waitForReview('analyze');
        if (action.type === 'cancel') {
          cancelled = true;
          break;
        }
        if (action.type === 'feedback') {
          analyzeFeedbackByLane = buildLaneFeedbackMap(
            'analyze',
            analyzeDrafts.drafts,
            action.text,
          );
          continue;
        }

        callbacks.onAnalysis?.(analysisText);
        break;
      }

      if (!cancelled) {
        let proposeFeedbackByLane: Record<string, string> | undefined;
        setStage('propose');
        while (true) {
          const proposeDrafts = await generateMergedLaneDrafts({
            vfs,
            deps,
            shared: prepared.shared,
            stage: 'propose',
            stageConfig: options.stages?.propose,
            laneAnalyses: laneAnalysisMap,
            feedbackByLane: proposeFeedbackByLane,
            onMergedChunk: (text, delta) => {
              currentDraft = text;
              callbacks.onDraftChunk?.('propose', text, delta);
            },
          });
          proposalText = proposeDrafts.merged;
          currentDraft = proposalText;
          resetReviewState();
          callbacks.onDraftReady?.('propose', proposalText);

          const action = await waitForReview('propose');
          if (action.type === 'cancel') {
            cancelled = true;
            break;
          }
          if (action.type === 'feedback') {
            proposeFeedbackByLane = buildLaneFeedbackMap(
              'propose',
              proposeDrafts.drafts,
              action.text,
            );
            continue;
          }

          callbacks.onProposal?.(proposalText);
          break;
        }
      }

      if (!cancelled) {
        setStage('commit');
        currentDraft = proposalText;
        const tools = await runCommitStage({
          vfs,
          deps,
          shared: prepared.shared,
          analysis: analysisText,
          proposal: proposalText,
          stageConfig: options.stages?.commit,
          computerConfig: options.computerConfig,
          onTool: (tool) => {
            toolHistory.push(tool);
            callbacks.onTool?.(tool);
          },
        });
        if (toolHistory.length === 0) {
          toolHistory.push(...tools);
        }
      }
    } finally {
      await finalizePreparedNapState(vfs, prepared, cancelled);
    }

    setStage(cancelled ? 'cancelled' : 'completed');
    return {
      status: cancelled ? 'cancelled' : 'completed',
      analysis: analysisText,
      proposal: proposalText,
      tools: toolHistory,
    };
  })();

  return {
    get stage() {
      return currentStage;
    },
    get draft() {
      return currentDraft;
    },
    get reviewState() {
      return getReviewState();
    },
    accept: () => {
      dispatchReviewAction({ type: 'accept' });
    },
    feedback: (text: string) => {
      const stage = getActiveReviewStage();
      if (!stage) return;
      dispatchReviewAction({
        type: 'feedback',
        text,
      });
    },
    chat: (text: string): Promise<string> => {
      reviewChatChain = reviewChatChain
        .then(() => reviewChatImpl(text))
        .catch(
          (error) =>
            `Review chat error: ${error instanceof Error ? error.message : String(error)}`,
        );
      return reviewChatChain;
    },
    applyPlan: () => {
      if (!reviewPlan || reviewPlan === '(no changes yet)') return;
      const stage = getActiveReviewStage();
      if (!stage) return;
      reviewLastAppliedRevision = reviewPlanRevision;
      dispatchReviewAction({
        type: 'feedback',
        text: `Apply the following update plan:\n\n${reviewPlan}`,
      });
    },
    cancel: () => {
      cancelled = true;
      dispatchReviewAction({ type: 'cancel' });
    },
    done: donePromise,
  };
}

function buildCommitContext(vfs: OverlayFs) {
  return {
    analysis: createAiContext<CommitFlowContext>('analysis', {
      render: (ctx) => `## Merged Analysis\n\n${ctx.analysis}`,
    }),
    proposal: createAiContext<CommitFlowContext>('proposal', {
      render: (ctx) => `## Merged Proposal\n\n${ctx.proposal}`,
    }),
    stageContext: createAiContext<CommitFlowContext>('stageContext', {
      render: async (ctx) => {
        const timeZone = await resolveUserTimeZone(vfs);
        return resolveStageContext(vfs, {
          stage: 'nap/commit',
          now: ctx.now,
          timeZone,
        });
      },
    }),
  };
}

function toNapStageName(stage: NapStageName): 'nap/analyze' | 'nap/propose' {
  return stage === 'analyze' ? 'nap/analyze' : 'nap/propose';
}

async function buildLaneContextSections(args: {
  vfs: OverlayFs;
  shared: NapSharedContext;
  lane: string;
  stage: NapStageName;
  laneAnalysis?: string;
}): Promise<string[]> {
  const timeZone = await resolveUserTimeZone(args.vfs);
  const stageContext = await resolveStageContext(args.vfs, {
    stage: toNapStageName(args.stage),
    lane: args.lane,
    now: args.shared.now,
    timeZone,
  });

  const sections: string[] = [];
  if (args.laneAnalysis) {
    sections.push(`## Lane Analysis\n\n${args.laneAnalysis}`);
  }
  if (stageContext.trim().length > 0) {
    sections.push(stageContext);
  }
  return sections;
}

async function syncNapContextSnapshots(
  vfs: OverlayFs,
  shared: NapSharedContext,
): Promise<void> {
  await vfs.write(
    VFS_PATHS.state.napContextPressure,
    `${renderContextPressureSection(shared.contextPressure)}\n`,
  );
  await vfs.write(
    VFS_PATHS.state.napLogRotation,
    `${renderRotationSection(shared.logPlans)}\n`,
  );
  await vfs.write(
    VFS_PATHS.queue.nextNapPins,
    `${renderNextNapPinsSection(shared.nextNapPins)}\n`,
  );
  await vfs.write(
    VFS_PATHS.queue.nextNapImprints,
    `${renderNextNapImprintsSection(shared.nextNapImprints)}\n`,
  );
  await vfs.write(
    VFS_PATHS.state.queuedNapPinContext,
    `${await renderQueuedNapPinContext(vfs, shared.nextNapPins, shared.now)}\n`,
  );
}

function renderContextPressureSection(
  contextPressure: LaneStageContextPressureDiagnostics,
): string {
  const maxPair = contextPressure.maxPair;
  const header = ['## Context Pressure', ''];

  if (!maxPair) {
    return `${header.join('\n')}\nNo rendered pinned context pairs.`;
  }

  header.push(
    `Overall max: ${maxPair.stage} / ${maxPair.lane} — ~${maxPair.contextTokens} / ${maxPair.maxTokens} tokens (${(maxPair.ratio * 100).toFixed(1)}%) [${maxPair.status.toUpperCase()}]`,
  );

  const lines = contextPressure.pairs.map((entry) => {
    const pinned =
      entry.pinnedPaths.length > 0
        ? ` | pins: ${entry.pinnedPaths.join(', ')}`
        : '';
    return `- ${entry.stage} / ${entry.lane}: ~${entry.contextTokens} tokens (${entry.totalEntries} entries)${pinned}`;
  });

  return `${header.join('\n')}\n\n${lines.join('\n')}`;
}

function renderRotationSection(logPlans: LogRotationPlan[]): string {
  const lines = logPlans.map((plan) => {
    const current = plan.current ? `current: ${plan.current}` : 'current: none';
    const rotated = plan.rotatedTo ? ` | rotated_to: ${plan.rotatedTo}` : '';
    const compacted = plan.compactedPath
      ? ` | compacted: ${plan.compactedPath}`
      : '';
    const counts =
      typeof plan.entryCount === 'number' &&
      typeof plan.retainedEntries === 'number'
        ? ` | entries: ${plan.entryCount} -> ${plan.retainedEntries}`
        : '';
    return `- ${plan.type}: ${current} | next: ${plan.next}${rotated}${compacted}${counts}`;
  });
  return `## Automated Log Rotation\n\n${lines.join('\n')}`;
}

function renderNextNapPinsSection(nextNapPins: NextNapPinEntry[]): string {
  if (nextNapPins.length === 0) {
    return '## Next Nap Pin Queue\n\n(none)';
  }
  const lines = nextNapPins.map(
    (entry) => `- ${entry.id} | pin: ${entry.path}`,
  );
  return `## Next Nap Pin Queue\n\n${lines.join('\n')}`;
}

async function renderQueuedNapPinContext(
  vfs: OverlayFs,
  nextNapPins: NextNapPinEntry[],
  now: Date,
): Promise<string> {
  if (nextNapPins.length === 0) {
    return '## Queued Next Nap Pin Context\n\n(none)';
  }

  const timeZone = await resolveUserTimeZone(vfs);
  return renderSection(
    vfs,
    'Queued Next Nap Pin Context',
    nextNapPins.map((entry) => entry.path),
    'verbatim',
    { now, timeZone },
  );
}

function renderNextNapImprintsSection(
  nextNapImprints: NextNapImprintEntry[],
): string {
  if (nextNapImprints.length === 0) {
    return '## Next Nap Imprints\n\n(none)';
  }
  const lines = nextNapImprints.map((entry) => `- ${entry.id}: ${entry.text}`);
  return `## Next Nap Imprints\n\n${lines.join('\n')}`;
}

async function buildLogRotationPlans(
  vfs: OverlayFs,
  date: Date,
): Promise<LogRotationPlan[]> {
  const day = date.toISOString().slice(0, 10);
  const dir = getLogWeekDir(date);
  const entries = await vfs.list(dir).catch(() => []);
  const discoveredTypes = Array.from(
    new Set(
      entries
        .filter((entry) => entry.type === 'file' && entry.name.endsWith('.log'))
        .map((entry) => parseLogName(entry.name)?.logType)
        .filter(
          (type): type is string =>
            typeof type === 'string' && !NON_COMPACTABLE_LOG_TYPES.has(type),
        ),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return discoveredTypes.map((type) => {
    const parsed = entries
      .filter((entry) => entry.type === 'file' && entry.name.endsWith('.log'))
      .map((entry) => ({ entry, parsed: parseLogName(entry.name) }))
      .filter(
        (item) =>
          item.parsed !== null &&
          item.parsed.date === day &&
          item.parsed.logType === type,
      );

    let current: string | undefined;
    let maxIndex = -1;

    for (const item of parsed) {
      if (!item.parsed) continue;
      if (item.parsed.index >= maxIndex) {
        maxIndex = item.parsed.index;
        current = item.entry.path;
      }
    }

    const nextIndex = Math.max(maxIndex, -1) + 1;
    return {
      type,
      dir,
      day,
      current,
      next: `${dir}/${day}-${nextIndex}.${type}.log`,
    } satisfies LogRotationPlan;
  });
}

function splitLogEntries(content: string): {
  meta: Record<string, unknown>;
  entries: string[];
} {
  if (!content.trim()) {
    return { meta: {}, entries: [] };
  }

  const parsed = content.trim().startsWith('---')
    ? parseContextFile(content)
    : { meta: {}, content };

  return {
    meta: parsed.meta,
    entries: parsed.content
      .split(/\n---\n/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

function extractLogEntryTimestamp(entry: string): string | undefined {
  const match = entry.match(/^\[(.+?)\]/);
  return match?.[1];
}

function buildRotatedLogMeta(args: {
  path: string;
  type: NapManagedLogType;
  day: string;
  now: string;
  existingMeta: Record<string, unknown>;
  retainedEntries: string[];
}): ContextMeta {
  return {
    ...args.existingMeta,
    id: args.path,
    tags: Array.isArray(args.existingMeta.tags)
      ? (args.existingMeta.tags as string[])
      : [],
    type: 'log',
    log_type: args.type,
    date: args.day,
    created: (args.existingMeta.created as string) ?? args.now,
    updated: args.now,
    entry_count: args.retainedEntries.length,
  } as ContextMeta;
}

function buildCompactedLogMeta(args: {
  path: string;
  type: NapManagedLogType;
  day: string;
  now: string;
  existingMeta: Record<string, unknown>;
  allEntries: string[];
}): ContextMeta {
  const latestEntryAt = extractLogEntryTimestamp(args.allEntries.at(-1) ?? '');
  return {
    ...args.existingMeta,
    id: args.path,
    tags: Array.isArray(args.existingMeta.tags)
      ? (args.existingMeta.tags as string[])
      : [],
    type: 'log',
    log_type: args.type,
    date: args.day,
    created: (args.existingMeta.created as string) ?? args.now,
    updated: args.now,
    compacted_at: args.now,
    entry_count: args.allEntries.length,
    latest_entry_at: latestEntryAt,
  } as ContextMeta;
}

async function writeCompactedLogSummary(
  vfs: OverlayFs,
  compactedPath: string,
  result: { summary: string; highlights: string[] },
): Promise<void> {
  const raw = await vfs.read(compactedPath);
  const parsed = parseContextFile(raw);
  const now = new Date().toISOString();
  const meta: ContextMeta = {
    ...parsed.meta,
    id: parsed.meta.id ?? compactedPath,
    tags: Array.isArray(parsed.meta.tags) ? parsed.meta.tags : [],
    created: parsed.meta.created ?? now,
    updated: now,
    summary: result.summary,
    highlights: result.highlights,
  };
  await vfs.write(compactedPath, serializeContextFile(meta, parsed.content));
}

async function applyLogRotationPlans(
  vfs: OverlayFs,
  date: Date,
  plans: LogRotationPlan[],
): Promise<LogRotationPlan[]> {
  const now = date.toISOString();
  const appliedPlans: LogRotationPlan[] = [];

  for (const plan of plans) {
    const sourcePath = plan.current;
    if (!sourcePath) {
      appliedPlans.push({ ...plan });
      continue;
    }

    const raw = await safeRead(vfs, sourcePath);
    if (!raw) {
      appliedPlans.push({ ...plan });
      continue;
    }

    const { meta, entries } = splitLogEntries(raw);
    if (entries.length === 0) {
      appliedPlans.push({
        ...plan,
        compactedPath: sourcePath,
        entryCount: 0,
        retainedEntries: 0,
      });
      continue;
    }

    // Old file: keep entries and write factual compaction metadata only
    const compactedMeta = buildCompactedLogMeta({
      path: sourcePath,
      type: plan.type,
      day: plan.day,
      now,
      existingMeta: meta,
      allEntries: entries,
    });
    await vfs.write(
      sourcePath,
      serializeContextFile(compactedMeta, entries.join('\n---\n')),
    );

    // New file: empty, for future writes
    const nextPath = plan.next;
    const nextMeta = buildRotatedLogMeta({
      path: nextPath,
      type: plan.type,
      day: plan.day,
      now,
      existingMeta: meta,
      retainedEntries: [],
    });
    await vfs.write(nextPath, serializeContextFile(nextMeta, ''));

    appliedPlans.push({
      ...plan,
      compactedPath: sourcePath,
      rotatedTo: nextPath,
      entryCount: entries.length,
      retainedEntries: 0,
    });
  }

  return appliedPlans;
}

async function safeRead(vfs: OverlayFs, path: string): Promise<string | null> {
  try {
    return await vfs.read(path);
  } catch {
    return null;
  }
}
