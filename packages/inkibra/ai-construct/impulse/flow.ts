/**
 * Impulse Flow
 *
 * ai-flow stage definition for impulse thinking.
 */

import {
  createAiContext,
  createAiFlow,
  createAiOutput,
  createAiOutputStage,
  createAiPrompt,
  type OverlayFs,
} from '@inkibra/ai-flow';
import type {
  Computer,
  ResponsePlanPolicy,
} from '@inkibra/ai-sandbox-computer';
import {
  appendPerceptionOrigin,
  formatOriginSuffix,
  formatPerceptionMetadata,
  getPerceptionDisplayContent,
  getPerceptionOrigin,
} from '../construct/perception';
import type {
  ImpulseThinkToolsSettings,
  Perception,
  StageAiSettings,
} from '../construct/types';
import { formatRelativeTime } from '../utils/time';
import { resolveUserTimeZone } from '../utils/timezone';
import { resolveStageContext } from '../vfs/context-system';
import { impulseDecisionOutputSchema } from './flow.schemas';
import type { Impulse, ImpulseDecisionOutput } from './types';

export type ImpulseFlowContext = {
  impulse: Impulse;
  decision: ImpulseDecisionOutput | null;
  responsePlanPolicy?: ResponsePlanPolicy;
};

export type ImpulseFlowConfig = {
  stages?: {
    think?: StageAiSettings & { tools?: ImpulseThinkToolsSettings };
    /** @deprecated Merged into the think stage; kept as config fallback only. */
    schedule?: StageAiSettings;
  };
  systemPrompt?: string;
  thinkPrompt?: string;
  conversationPrompt?: string;
  heartbeatPrompt?: string;
  reminderPrompt?: string;
  schedulePrompt?: string;
  heartbeatSchedulePrompt?: string;
  reminderSchedulePrompt?: string;
  responsePlanPolicy?: ResponsePlanPolicy;
};

function buildImpulseContext(
  vfs: OverlayFs,
  responsePlanPolicy?: ResponsePlanPolicy,
) {
  return {
    perception: createAiContext<ImpulseFlowContext>('perception', {
      render: async (ctx) => {
        const impulse = ctx.impulse;
        const parts: string[] = [];
        const timeZone = await resolveUserTimeZone(vfs);
        const now = new Date();

        parts.push('## Current Perception (internal analysis only)');
        parts.push(`Type: ${impulse.type}`);
        parts.push(
          `Trigger: ${formatPerceptionTrigger(impulse.triggeredBy, now, timeZone)}`,
        );
        parts.push(`Attention: ${impulse.attention.toFixed(2)}`);
        const origin = getPerceptionOrigin(impulse.triggeredBy);
        if (origin) {
          parts.push(`Origin: ${origin}`);
        }
        parts.push(
          `Received: ${formatRelativeTime(impulse.startedAt ?? new Date(), { now, timeZone })}`,
        );
        parts.push('');

        if (impulse.triggeredBy.role === 'user') {
          parts.push('## Incoming Message (for analysis, not reply)');
          parts.push(
            formatUserPerceptionLine(impulse.triggeredBy, now, timeZone),
          );
          parts.push('');
        }

        if (impulse.triggeredBy.role === 'system') {
          const metadata = formatPerceptionMetadata(
            impulse.triggeredBy.metadata,
          );
          if (metadata) {
            parts.push(getSystemMetadataHeading(impulse.triggeredBy));
            parts.push(metadata);
            parts.push('');
          }
        }

        return parts.join('\n');
      },
    }),
    stageContext: createAiContext<ImpulseFlowContext>('stageContext', {
      render: async (ctx) => {
        const now = new Date();
        const timeZone = await resolveUserTimeZone(vfs);
        return resolveStageContext(vfs, {
          stage: 'impulse',
          now,
          timeZone,
          lane: ctx.impulse.lane,
        });
      },
    }),
    responsePlanPolicy: createAiContext<ImpulseFlowContext>(
      'responsePlanPolicy',
      {
        render: (ctx) =>
          renderResponsePlanPolicy(
            ctx.responsePlanPolicy ?? responsePlanPolicy,
            ctx.impulse.lane,
          ),
      },
    ),
  };
}

function renderResponsePlanPolicy(
  policy: ResponsePlanPolicy | undefined,
  currentLane: string,
): string {
  const effectivePolicy = policy ?? {
    sourceLane: currentLane,
    declaredLanes: [currentLane],
    crossLaneTargets: [],
  };

  const lines = ['## Response Lane Policy', ''];
  lines.push(`Current lane: ${effectivePolicy.sourceLane}`);
  lines.push(
    'Same-lane responses are always allowed. Omit lane for same-lane delivery.',
  );
  lines.push(
    'Cross-lane delivery uses plan_response({ lane: "..." }). Invalid targets fail during preview.',
  );
  lines.push('');
  lines.push('Declared lanes/patterns:');
  for (const lane of effectivePolicy.declaredLanes) {
    lines.push(`- ${lane}`);
  }

  lines.push('');
  lines.push('Allowed cross-lane targets from this lane:');
  if (effectivePolicy.crossLaneTargets.length === 0) {
    lines.push('- (none)');
  } else {
    for (const lane of effectivePolicy.crossLaneTargets) {
      lines.push(`- ${lane}`);
    }
  }

  return lines.join('\n');
}

function formatPerceptionTrigger(
  perception: Perception,
  now?: Date,
  timeZone?: string,
): string {
  if (perception.role === 'user') {
    const meta = formatOriginSuffix(perception.metadata);
    const relative = formatRelativeTime(perception.occurredAt, {
      now,
      timeZone,
    });
    return meta
      ? `"${perception.content}" (${relative}; ${meta})`
      : `"${perception.content}" (${relative})`;
  }

  switch (perception.source) {
    case 'system_event':
      return appendPerceptionOrigin(
        perception.event ?? perception.content,
        perception,
      );
    case 'self_reminder':
      return appendPerceptionOrigin(
        `reminder: "${perception.content}"`,
        perception,
      );
    case 'time_passed':
      return appendPerceptionOrigin(
        perception.elapsed
          ? `${perception.elapsed} passed`
          : perception.content,
        perception,
      );
    case 'user_message':
      return appendPerceptionOrigin(perception.content, perception);
  }
}

function formatUserPerceptionLine(
  perception: Perception,
  now?: Date,
  timeZone?: string,
): string {
  const meta = formatOriginSuffix(perception.metadata);
  const stamp = formatRelativeTime(perception.occurredAt, { now, timeZone });
  return meta
    ? `[${stamp}] ${perception.content} (${meta})`
    : `[${stamp}] ${perception.content}`;
}

function getSystemMetadataHeading(perception: Perception): string {
  switch (perception.source) {
    case 'self_reminder':
      return '## Reminder Metadata';
    case 'time_passed':
      return '## Time Metadata';
    case 'system_event':
    case 'user_message':
      return '## System Event Metadata';
  }
}

// ---------------------------------------------------------------------------
// Command Computer Flow (spec §19)
// ---------------------------------------------------------------------------

const DEFAULT_COMPUTER_IMPULSE_PROMPT = `You are an AI construct — a persistent agent backed by a computer. You process impulses (user messages, system events, reminders) by writing and executing TypeScript code on a preview of your construct state.

## Workflow

- If the conversation does not already contain a successful preview_exec result, your next turn must be a preview_exec tool call — not structured JSON.
- Each preview_exec call runs on a forked copy of your state. Nothing is permanent until you commit a real exec_id in your structured output.
- Use command() for registered commands. Use sys/fs for direct VFS reads and writes when that is more natural than command().
- Use plan_response() inside preview_exec to describe WHAT to communicate to the user. The response stage crafts the final wording in your voice.
- Detailed system, developer, and agent package/command docs are already loaded in context. Read those docs for exact APIs and semantics instead of guessing.

## plan_response()

plan_response({ text, importance, lane? }) plans a user-facing message. The text should describe WHAT to communicate — key points, information, and tone direction.

Omit lane for same-lane delivery. Use lane only for permitted cross-lane delivery; invalid targets fail preview validation.

## Your structured output

After processing, return:
- thinking: private reasoning (max 280 chars) — what you noticed, what actions you took. The user never sees this.
- intent: short label for the response (e.g. "add todo confirmation"), or null
- urgency: 'none' | 'defer' | 'low' | 'normal' | 'urgent' | 'now'
- execId: the exec_id to commit. You MUST always use a successful preview_exec and return a real exec_id. Use plan_response() inside preview_exec if you want to reply; omit it if you have nothing to say.

## Auto-previewed intents

The system may auto-run previews for common actions before you see the impulse. Their results appear as prior preview_exec outputs with exec_ids. Those successful auto-previews already satisfy the "run a preview first" requirement, so you may select one directly without calling preview_exec yourself.
`;

/**
 * Create an ai-flow pipeline for the command computer impulse model.
 * Uses preview_exec as the single tool instead of bash/execute/web_search.
 */
export function createImpulseComputerFlow(
  vfs: OverlayFs,
  computer: Computer,
  config: ImpulseFlowConfig = {},
) {
  const stageConfig = config.stages?.think;

  const model = stageConfig?.model ?? 'moonshotai/kimi-k2.5';

  return createAiFlow<
    ImpulseFlowContext & Record<string, unknown>,
    {
      think: ReturnType<typeof createComputerThinkStage>;
    }
  >('impulse-computer', {
    stages: {
      think: createComputerThinkStage(
        stageConfig,
        model,
        computer,
        vfs,
        config,
      ),
    },
  });
}

function hasSuccessfulPreview(
  ctx: ImpulseFlowContext & Record<string, unknown>,
): boolean {
  return Object.values(ctx.previewExecRuns ?? {}).some(
    (preview) => !preview.error,
  );
}

function createComputerThinkStage(
  stageConfig:
    | (StageAiSettings & { tools?: ImpulseThinkToolsSettings })
    | undefined,
  model: string,
  computer: Computer,
  vfs: OverlayFs,
  config: ImpulseFlowConfig,
) {
  return createAiOutputStage<
    'think',
    ImpulseFlowContext & Record<string, unknown>,
    Record<string, unknown>,
    ImpulseDecisionOutput,
    'decision',
    { preview_exec: typeof computer.tool }
  >('think', {
    model,
    verbosity: stageConfig?.verbosity,
    reasoningEffort: stageConfig?.reasoningEffort,
    reasoningSummary: stageConfig?.reasoningSummary,
    serviceTier: stageConfig?.serviceTier,
    maxOutputTokens: stageConfig?.maxOutputTokens,
    maxSteps: 8,
    tools: {
      preview_exec: computer.tool,
    },
    toolChoice: ({ flowContext }) =>
      hasSuccessfulPreview(flowContext) ? 'auto' : 'required',
    context: buildImpulseContext(vfs, config.responsePlanPolicy),
    instructions: createAiPrompt<ImpulseFlowContext>('instructions', {
      render: () => config.systemPrompt ?? DEFAULT_COMPUTER_IMPULSE_PROMPT,
    }),
    inputs: {
      perception: {
        key: 'perception',
        render: (ctx) => {
          const impulse = ctx.impulse;
          const lines: string[] = [];
          lines.push(`[Impulse: ${impulse.type}]`);
          if (impulse.triggeredBy.role === 'user') {
            lines.push(`User: ${impulse.triggeredBy.content}`);
          } else if (impulse.triggeredBy.source === 'system_event') {
            lines.push(
              `Event: ${impulse.triggeredBy.event ?? impulse.triggeredBy.content}`,
            );
          } else if (impulse.triggeredBy.source === 'self_reminder') {
            lines.push(`Reminder: ${impulse.triggeredBy.content}`);
          } else {
            lines.push(
              `System: ${getPerceptionDisplayContent(impulse.triggeredBy)}`,
            );
          }
          return [
            {
              role: 'user' as const,
              type: 'message' as const,
              content: lines.join('\n'),
            },
            {
              role: 'system' as const,
              type: 'message' as const,
              content: `Process this impulse now. If the conversation does not already include a successful preview_exec result with an exec_id, your next turn MUST be a preview_exec tool call with TypeScript code.

CRITICAL: preview_exec is required before final JSON. execId in your structured output must be a real exec_id from a successful preview_exec call, or from a successful auto-preview result already present in the conversation. Failed previews do not count.

If you want to reply to the user, call plan_response({ text: "..." }) inside your preview_exec code. Omit lane for same-lane delivery. Use lane only for an allowed cross-lane target; invalid targets fail preview validation. plan_response() is the ONLY way to communicate with the user.

Use command() for actions. Use sys/fs for direct VFS filesystem work when needed. Read the capability docs already loaded in context for exact command and package APIs.`,
            },
          ];
        },
      },
    },
    output: createAiOutput<
      'decision',
      ImpulseFlowContext,
      ImpulseDecisionOutput
    >('decision', {
      ...impulseDecisionOutputSchema,
      render: (_ctx, value) => {
        if (!value) return 'Decision: none';
        return `Decision: ${value.urgency}${value.execId ? ` [exec: ${value.execId}]` : ''}`;
      },
    }),
    storage: () => ({}),
  });
}
