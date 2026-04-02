/**
 * Impulse Runner
 *
 * Runs an impulse using ai-flow for LLM interactions.
 */

import type { AIDeps, OverlayFs } from '@inkibra/ai-flow';
import type {
  ComputerConfig,
  ResponsePlanPolicy,
} from '@inkibra/ai-sandbox-computer';
import { getPerceptionDisplayContent } from '../construct/perception';
import type {
  ImpulseThinkToolsSettings,
  Perception,
  StageAiSettings,
} from '../construct/types';
import { writeLaneLogEntry } from '../vfs/lane-logs';
import { createImpulseComputerFlow } from './flow';
import {
  type LlmStageCallback,
  runImpulse as runComputerImpulse,
} from './run-impulse';
import type {
  Impulse,
  ImpulseAction,
  ImpulseDecisionOutput,
  ImpulseLogEntry,
  ImpulseResult,
  ToolUsage,
  WaitForIdleTarget,
} from './types';

/**
 * Configuration for the impulse runner.
 */
export type ImpulseRunnerConfig = {
  stages?: {
    think?: StageAiSettings & { tools?: ImpulseThinkToolsSettings };
    /** @deprecated Merged into the think stage; kept as config fallback only. */
    schedule?: StageAiSettings;
  };
  /** System prompt for the impulse */
  systemPrompt?: string;
  /** Profile-specific think prompt override */
  thinkPrompt?: string;
  /** Profile-specific schedule prompt override */
  schedulePrompt?: string;
  /** Idle targets for waitForIdle responses */
  defaultWaitForIdleTargets?: WaitForIdleTarget[];
  /** plan_response validation + prompt policy for the current lane. */
  responsePlanPolicy?: ResponsePlanPolicy;
  /** Command computer configuration — preview_exec commands, bindings, modules, ai SDK */
  computerConfig: ComputerConfig;
};

export const DEFAULT_IMPULSE_RUNNER_CONFIG = {
  defaultWaitForIdleTargets: [{ kind: 'pool', name: 'conversation' }],
} satisfies Omit<ImpulseRunnerConfig, 'computerConfig'>;

/**
 * Callback for streaming impulse thinking.
 */
export type OnThinkingChunk = (chunk: string) => void;

/**
 * Callback for tool usage during impulse.
 */
export type OnImpulseTool = (tool: ToolUsage) => void;

/**
 * Format a perception for display in the impulse header.
 */
function formatPerceptionTrigger(perception: Perception): string {
  if (perception.role === 'user') {
    return formatMessageTrigger(perception.content, perception.metadata);
  }

  switch (perception.source) {
    case 'system_event':
      return appendOrigin(
        `${perception.event ?? perception.content}`,
        formatOriginSuffix(perception.metadata),
      );
    case 'self_reminder':
      return appendOrigin(
        `reminder: "${perception.content}"`,
        formatOriginSuffix(perception.metadata),
      );
    case 'time_passed':
      return perception.elapsed
        ? `${perception.elapsed} passed`
        : perception.content;
    case 'user_message':
      return formatMessageTrigger(perception.content, perception.metadata);
  }
}

/**
 * Format the "from" field for an impulse log entry.
 */
function formatFrom(perception: Perception): string {
  if (perception.role === 'user') {
    return formatUserFrom(perception.metadata);
  }

  switch (perception.source) {
    case 'time_passed':
      return 'system (time)';
    case 'system_event':
      return appendOrigin(
        `system (${perception.event ?? 'event'})`,
        formatOriginSuffix(perception.metadata),
      );
    case 'self_reminder':
      return appendOrigin(
        'self-reminder',
        formatOriginSuffix(perception.metadata),
      );
    case 'user_message':
      return formatUserFrom(perception.metadata);
  }
}

function formatUserFrom(meta?: Record<string, unknown>): string {
  const speaker =
    (meta && (getMetaString(meta, 'speaker') ?? getMetaString(meta, 'from'))) ||
    'user';
  const suffix = formatOriginSuffix(meta, ['speaker', 'from']);
  return suffix ? `${speaker} (${suffix})` : speaker;
}

function formatMessageTrigger(
  content: string,
  meta?: Record<string, unknown>,
): string {
  const suffix = formatOriginSuffix(meta);
  return suffix ? `"${content}" (${suffix})` : `"${content}"`;
}

function appendOrigin(base: string, origin?: string): string {
  return origin ? `${base} (${origin})` : base;
}

function formatOriginSuffix(
  meta: Record<string, unknown> | undefined,
  omitKeys: string[] = [],
): string | undefined {
  if (!meta) return undefined;
  const parts: string[] = [];

  const add = (label: string, key: string) => {
    if (omitKeys.includes(key)) return;
    const value = getMetaString(meta, key);
    if (value) parts.push(`${label}: ${value}`);
  };

  add('speaker', 'speaker');
  add('from', 'from');
  add('recipient', 'recipient');
  add('to', 'to');
  add('channel', 'channel');
  add('source', 'source');

  return parts.length > 0 ? parts.join(', ') : undefined;
}

function getMetaString(
  meta: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = meta[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/**
 * Run an impulse, returning the result.
 */
export async function runImpulse(
  impulse: Impulse,
  vfs: OverlayFs,
  config: ImpulseRunnerConfig,
  onThinking?: OnThinkingChunk,
  onTool?: OnImpulseTool,
  deps?: AIDeps,
): Promise<ImpulseResult> {
  const fullConfig = { ...DEFAULT_IMPULSE_RUNNER_CONFIG, ...config };
  const startTime = Date.now();

  const logDiag = (label: string, extra: Record<string, unknown> = {}) => {
    console.warn(
      `[DIAG:impulse-runner] impulse=${impulse.id} ${label} elapsed=${Date.now() - startTime}ms ${Object.entries(
        extra,
      )
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')}`.trim(),
    );
  };

  if (!deps) {
    throw new Error(
      'AIDeps must be provided to runImpulse (openAI client and logger)',
    );
  }

  console.warn(
    `[DIAG:impulse-runner] impulse=${impulse.id} computerConfig=true configKeys=${Object.keys(config).join(',')}`,
  );

  return runImpulseWithComputer(
    impulse,
    vfs,
    fullConfig,
    onThinking,
    onTool,
    deps,
    logDiag,
  );
}

function normalizeUrgency(
  value: string | undefined,
): ImpulseDecisionOutput['urgency'] {
  switch (value) {
    case 'defer':
    case 'low':
    case 'normal':
    case 'urgent':
    case 'now':
      return value;
    default:
      return 'none';
  }
}

/**
 * Parse action markers from thinking text.
 */
function parseActions(thinking: string): ImpulseAction[] {
  const actions: ImpulseAction[] = [];

  // Match [opening path]
  const openMatches = thinking.matchAll(/\[opening\s+([^\]]+)\]/g);
  for (const match of openMatches) {
    actions.push({ type: 'open_file', path: match[1]! });
  }

  // Match [closing path]
  const closeMatches = thinking.matchAll(/\[closing\s+([^\]]+)\]/g);
  for (const match of closeMatches) {
    actions.push({ type: 'close_file', path: match[1]! });
  }

  // Match [writing to path: content] or [updating path]
  const writeMatches = thinking.matchAll(
    /\[(?:writing to|updating)\s+([^\]:]+)(?::\s*([^\]]*))?\]/g,
  );
  for (const match of writeMatches) {
    actions.push({
      type: 'write_file',
      path: match[1]!,
      content: match[2] ?? '',
    });
  }

  // Match [scheduling response: intent, mode]
  const scheduleMatches = thinking.matchAll(
    /\[scheduling response:\s*([^,\]]+)(?:,\s*(waitForIdle|wait-for-impulses|urgent))?(?:,\s*clear_others)?\]/g,
  );
  for (const match of scheduleMatches) {
    const rawMode = (match[2] as string | undefined) ?? 'waitForIdle';
    actions.push({
      type: 'schedule_response',
      intent: match[1]!.trim(),
      urgency: rawMode === 'urgent' ? 'urgent' : 'normal',
    });
  }

  // Match [spawning sub-agent: task] or [spawning subflow: task]
  const spawnMatches = thinking.matchAll(
    /\[spawning\s+(?:sub-agent|subflow):\s*([^\]]+)\]/g,
  );
  for (const match of spawnMatches) {
    actions.push({ type: 'spawn_subflow', task: match[1]! });
  }

  // Match [linking to impulse-id: relationship]
  const linkMatches = thinking.matchAll(
    /\[linking(?:\s+to)?\s+(impulse-\d+):\s*([^\]]+)\]/g,
  );
  for (const match of linkMatches) {
    actions.push({
      type: 'link_impulse',
      targetId: match[1]!,
      relationship: match[2]!,
    });
  }

  return actions;
}

function getLaneLogRole(perception: Perception): 'user' | 'system' {
  return perception.role;
}

// ---------------------------------------------------------------------------
// Command Computer Path (spec §19)
// ---------------------------------------------------------------------------

/**
 * Run an impulse using the command computer preview/commit model.
 *
 * Uses ai-sandbox-computer's runImpulse orchestration:
 * 1. Intent hint matching + auto-preview
 * 2. LLM stage with preview_exec as single tool
 * 3. Decision: { thinking, urgency, execId }
 * 4. Commit selected preview against real VFS
 */
async function runImpulseWithComputer(
  impulse: Impulse,
  vfs: OverlayFs,
  config: ImpulseRunnerConfig,
  onThinking: OnThinkingChunk | undefined,
  onTool: OnImpulseTool | undefined,
  deps: AIDeps,
  logDiag: (label: string, extra?: Record<string, unknown>) => void,
): Promise<ImpulseResult> {
  const startTime = Date.now();

  // Extract perception text for intent matching
  const perceptionText = extractPerceptionText(impulse.triggeredBy);

  // Capture flow context for exec diag logging
  let capturedFlowContext: Record<string, unknown> = {};

  // The LLM stage callback — ai-construct provides the ai-flow pipeline
  const llmStage: LlmStageCallback = async ({
    computer,
    flowContext,
    autoPreviewResults: _autoPreviewResults,
    impulse: _impulseInput,
  }) => {
    // Build the ai-flow output stage with preview_exec as the only tool
    const flow = createImpulseComputerFlow(vfs, computer, config);

    // Pre-fill auto-preview results into the flow context
    // The LLM will see these as pre-existing tool results
    let thinking = '';
    let decision: ImpulseDecisionOutput | null = null;

    const run = flow
      .onStep('think', async ({ step }) => {
        switch (step.kind) {
          case 'reasoning':
            if (onThinking && step.reasoning.delta) {
              onThinking(step.reasoning.delta);
            }
            return step.next();
          case 'tool': {
            // Track execute tool usage and sync preview records to flowContext
            const previewExecData = step.toolData.preview_exec ?? [];
            for (const entry of previewExecData) {
              // Sync preview records from ai-flow context to shared flowContext
              const ctx = step.context;
              if (ctx.previewExecRuns) {
                flowContext.previewExecRuns =
                  ctx.previewExecRuns as typeof flowContext.previewExecRuns;
              }
              if (ctx.previewExecOrder) {
                flowContext.previewExecOrder =
                  ctx.previewExecOrder as typeof flowContext.previewExecOrder;
              }
              const toolUsage: ToolUsage = {
                tool: 'preview_exec',
                command: `preview_exec (${entry.execId ?? 'unknown'})`,
                output: entry.stdout ?? entry.error ?? '(no output)',
                timestamp: new Date(),
              };
              onTool?.(toolUsage);
            }
            return step.next();
          }
          case 'output': {
            decision = step.response as ImpulseDecisionOutput;
            thinking = decision?.thinking ?? '';
            if (thinking && onThinking) {
              onThinking(thinking);
            }

            // Null execId is only valid after at least one successful preview exists.
            const availableRuns = flowContext.previewExecRuns ?? {};
            const successfulEntries = Object.entries(availableRuns).filter(
              ([, preview]) => !preview.error,
            );
            const successfulIds = successfulEntries.map(([execId]) => execId);

            if (decision.execId === null && successfulIds.length === 0) {
              return step.output.reject({
                text: 'REJECTED: execId cannot be null because you do not have a successful preview_exec yet. Call preview_exec with your code first, then set execId to the returned exec_id.',
              });
            }

            if (decision.execId !== null) {
              const selectedPreview = availableRuns[decision.execId];
              if (!selectedPreview) {
                return step.output.reject({
                  text:
                    successfulIds.length > 0
                      ? `REJECTED: execId "${decision.execId}" does not exist. Available successful execIds: [${successfulIds.join(', ')}]. Set execId to one of these, or call preview_exec first to create a new one.`
                      : `REJECTED: execId "${decision.execId}" does not exist. You do not have a successful preview_exec yet. You MUST call preview_exec with your code first, then set execId to the returned exec_id.`,
                });
              }

              if (selectedPreview.error) {
                return step.output.reject({
                  text:
                    successfulIds.length > 0
                      ? `REJECTED: execId "${decision.execId}" refers to a failed preview_exec. Failed previews do not count. Available successful execIds: [${successfulIds.join(', ')}]. Set execId to one of these, or call preview_exec again.`
                      : `REJECTED: execId "${decision.execId}" refers to a failed preview_exec. Failed previews do not count. Call preview_exec again and use the exec_id from a successful preview.`,
                });
              }
            }

            return step.output.accept((_output, ctx) => ({
              ctx: {
                ...ctx,
                decision,
              },
            }));
          }
        }
      })
      .start({
        flow: {
          impulse,
          decision: null,
          responsePlanPolicy: config.responsePlanPolicy,
          ...flowContext,
        },
        firstStage: 'think',
        deps,
      });

    await run.complete();
    capturedFlowContext = { ...flowContext };
    logDiag('llm.complete', {
      thinking: thinking.length,
      previewRuns: Object.keys(flowContext.previewExecRuns ?? {}).length,
    });

    if (!decision) {
      throw new Error(
        'Impulse think stage completed without a decision payload.',
      );
    }

    return decision;
  };

  // Run the full command computer pipeline
  const result = await runComputerImpulse(
    {
      impulseId: impulse.id,
      text: perceptionText,
      type: impulse.type,
    },
    vfs,
    {
      computer: config.computerConfig!,
      maxIntentHints: 3,
      responsePlanPolicy: config.responsePlanPolicy,
    },
    llmStage,
  );

  logDiag('computerImpulse.complete', {
    committed: result.commitResult.committed,
    responsePlans: result.commitResult.responsePlans.length,
    matchedIntents: result.matchedIntents.length,
  });

  // Write exec diag log
  try {
    await writeExecDiagLog(vfs, impulse, {
      decision: {
        thinking: result.decision.thinking,
        urgency: result.decision.urgency,
        execId: result.decision.selectedPreview?.execId ?? null,
        selectedPreview: result.decision.selectedPreview,
      },
      commitResult: result.commitResult,
      flowContext: capturedFlowContext,
    });
  } catch {
    // Best-effort — don't break the impulse
  }

  // No legacy scheduledResponse — the command computer path delivers
  // plan_response() proposals directly via construct.deliverResponsePlan().
  // The scheduler handles the exec commit, not response generation.

  // Create log entry
  const logEntry: ImpulseLogEntry = {
    timestamp: new Date(),
    impulseId: impulse.id,
    from: formatFrom(impulse.triggeredBy),
    profile: impulse.profile,
    pool: impulse.pool,
    trigger: formatPerceptionTrigger(impulse.triggeredBy),
    thinking: result.decision.thinking,
    actions: parseActions(result.decision.thinking),
    toolHistory: [],
  };

  await writeLaneLogEntry(vfs, impulse.lane, {
    kind: 'impulse',
    timestamp: logEntry.timestamp,
    role: getLaneLogRole(impulse.triggeredBy),
    sourceLane: impulse.lane,
    impulseId: impulse.id,
    content: extractPerceptionText(impulse.triggeredBy),
    from: logEntry.from,
    profile: logEntry.profile,
    pool: logEntry.pool,
    regarding: logEntry.regarding,
    trigger: logEntry.trigger,
    thinking: logEntry.thinking,
    toolHistory: logEntry.toolHistory,
  });

  return {
    impulseId: impulse.id,
    status: impulse.attention >= 0.1 ? 'completed' : 'abandoned',
    logEntry,
    computerResult: {
      selectedPreview: result.decision.selectedPreview,
      commitResult: result.commitResult,
      responsePlans: result.commitResult.responsePlans,
      urgency: normalizeUrgency(result.decision.urgency),
      thinking: result.decision.thinking,
    },
    durationMs: Date.now() - startTime,
  };
}

/**
 * Extract text from a perception for intent matching.
 */
// ---------------------------------------------------------------------------
// Exec Diag Log
// ---------------------------------------------------------------------------

const EXEC_DIAG_DIR = '/runtime/diag/response-lifecycle-logs';

async function writeExecDiagLog(
  vfs: OverlayFs,
  impulse: Impulse,
  result: {
    decision: {
      thinking: string;
      urgency: string;
      execId: string | null;
      selectedPreview: unknown;
    };
    commitResult: {
      committed: boolean;
      responsePlans: Array<{ text: string; importance?: string }>;
    };
    flowContext: {
      previewExecRuns?: Record<
        string,
        {
          execId: string;
          code?: string;
          stdout?: string;
          error?: string;
          responsePlans?: unknown[];
        }
      >;
    };
  },
): Promise<void> {
  const { getOrRotateDiagLog } = await import('../vfs/layout');
  const logPath = await getOrRotateDiagLog(vfs, EXEC_DIAG_DIR);

  const lines: string[] = [];
  const now = new Date();
  lines.push(`[${now.toISOString()}] ${impulse.id}`);
  lines.push(`trigger: ${impulse.type}`);
  lines.push(
    `decision: urgency=${result.decision.urgency} execId=${result.decision.execId ?? 'null'} committed=${result.commitResult.committed}`,
  );
  lines.push(`thinking: ${result.decision.thinking}`);
  lines.push('');

  // Log each preview_exec call
  const runs = result.flowContext.previewExecRuns ?? {};
  for (const [execId, run] of Object.entries(runs)) {
    lines.push(`--- preview_exec ${execId} ---`);
    if (run.code) {
      lines.push('```typescript');
      lines.push(run.code);
      lines.push('```');
    }
    if (run.stdout) {
      lines.push('stdout:');
      lines.push(run.stdout);
    }
    if (run.error) {
      lines.push(`error: ${run.error}`);
    }
    if (run.responsePlans && run.responsePlans.length > 0) {
      lines.push('response plans:');
      for (const plan of run.responsePlans as Array<{
        text: string;
        importance?: string;
      }>) {
        lines.push(`  [${plan.importance ?? 'normal'}] ${plan.text}`);
      }
    }
    lines.push('');
  }

  // Log committed response plans
  if (result.commitResult.responsePlans.length > 0) {
    lines.push('--- committed response plans ---');
    for (const plan of result.commitResult.responsePlans) {
      lines.push(`  [${plan.importance ?? 'normal'}] ${plan.text}`);
    }
    lines.push('');
  }

  const entry = lines.join('\n');

  let existing = '';
  try {
    existing = await vfs.read(logPath);
  } catch {
    // File doesn't exist yet
  }

  const separator = existing.trim() ? '\n---\n' : '';
  await vfs.write(logPath, `${existing}${separator}${entry}`);
}

function extractPerceptionText(perception: Perception): string {
  return getPerceptionDisplayContent(perception);
}
