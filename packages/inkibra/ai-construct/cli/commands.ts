/**
 * CLI Commands
 *
 * Command handlers for the REPL demo.
 */

import type { Construct } from '../construct/construct';
import type { ConstructOp } from '../runtime/ops';
import type { FeedbackRating } from '../vfs/feedback';
import { getLogDir, VFS_PATHS } from '../vfs/layout';

// ---------------------------------------------------------------------------
// Command Registry (single source of truth for help + autocomplete)
// ---------------------------------------------------------------------------

export type CommandDef = {
  /** Primary command name (e.g. 'help') */
  name: string;
  /** Alternate names (e.g. ['h']) */
  aliases: string[];
  /** Category for grouping in help text */
  category: 'general' | 'inspection' | 'actions' | 'feedback' | 'chat';
  /** Short description shown in help and suggestions */
  description: string;
  /** Usage hint shown when command is highlighted (e.g. '<good|bad|neutral> [annotation]') */
  usage?: string;
};

export const COMMAND_REGISTRY: CommandDef[] = [
  {
    name: 'help',
    aliases: ['h'],
    category: 'general',
    description: 'Show available commands',
  },
  {
    name: 'quit',
    aliases: ['q', 'exit'],
    category: 'general',
    description: 'Exit the demo',
  },
  {
    name: 'logs',
    aliases: [],
    category: 'inspection',
    description: 'Show impulse logs',
  },
  {
    name: 'state',
    aliases: [],
    category: 'inspection',
    description: 'Show construct state',
  },
  {
    name: 'impulses',
    aliases: [],
    category: 'inspection',
    description: 'Show active impulses',
  },
  {
    name: 'scheduler',
    aliases: [],
    category: 'inspection',
    description: 'Show scheduler state',
  },
  {
    name: 'bash',
    aliases: ['vfs'],
    category: 'inspection',
    description: 'List VFS directory',
    usage: '[path]',
  },
  {
    name: 'read',
    aliases: [],
    category: 'inspection',
    description: 'Read a VFS file',
    usage: '<path>',
  },
  {
    name: 'time',
    aliases: [],
    category: 'actions',
    description: 'Inject time-passed perception',
    usage: '[duration]',
  },
  {
    name: 'event',
    aliases: [],
    category: 'actions',
    description: 'Inject system event',
    usage: '[name]',
  },
  {
    name: 'hypno',
    aliases: [],
    category: 'actions',
    description: 'Start hypno mode (analyze/propose with human review)',
  },
  {
    name: 'accept',
    aliases: [],
    category: 'actions',
    description: 'Accept current hypno stage and advance',
  },
  {
    name: 'update',
    aliases: [],
    category: 'actions',
    description: 'Apply current review plan to the hypno draft',
  },
  {
    name: 'nap',
    aliases: [],
    category: 'actions',
    description: 'Run automatic nap (no human review)',
  },
  {
    name: 'flush',
    aliases: [],
    category: 'actions',
    description: 'Flush VFS to disk',
  },
  {
    name: 'rate',
    aliases: [],
    category: 'feedback',
    description: 'Rate the last construct response',
    usage: '<lane> <good|bad|neutral> [annotation]',
  },
  {
    name: 'steer',
    aliases: [],
    category: 'feedback',
    description: 'Inject a steering directive',
    usage: '<lane> <directive>',
  },
];

export type CommandSuggestion = {
  /** The primary command name */
  name: string;
  /** Aliases displayed inline (e.g. "(q, exit)") */
  aliasHint: string;
  /** Short description */
  description: string;
  /** Usage args hint */
  usage?: string;
};

/**
 * Get matching command suggestions for the current input fragment.
 * Returns all commands when fragment is empty (just typed : or /).
 */
export function getCommandSuggestions(fragment: string): CommandSuggestion[] {
  const lower = fragment.toLowerCase();
  const matches: CommandSuggestion[] = [];

  for (const cmd of COMMAND_REGISTRY) {
    const allNames = [cmd.name, ...cmd.aliases];
    const isMatch = lower === '' || allNames.some((n) => n.startsWith(lower));

    if (isMatch) {
      matches.push({
        name: cmd.name,
        aliasHint: cmd.aliases.length > 0 ? `(${cmd.aliases.join(', ')})` : '',
        description: cmd.description,
        usage: cmd.usage,
      });
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a command from input.
 */
export function parseCommand(
  input: string,
): { command: string; args: string[] } | null {
  if (!input.startsWith(':') && !input.startsWith('/')) {
    return null;
  }

  const parts = input.slice(1).split(/\s+/);
  return {
    command: parts[0]?.toLowerCase() ?? '',
    args: parts.slice(1),
  };
}

/**
 * Command handler result.
 */
export type CommandResult = {
  output: string;
  exit?: boolean;
};

export type CliConstructHandle = {
  constructId: string;
  construct: Construct;
  submit: (op: ConstructOp) => Promise<unknown>;
  flush: () => Promise<void>;
};

/**
 * Commands allowed during hypno review (analyze/propose stages).
 * All other commands are blocked to avoid side-effects mid-review.
 */
const HYPNO_REVIEW_ALLOWED = new Set([
  'help',
  'h',
  'accept',
  'update',
  'quit',
  'q',
  'exit',
  'read',
  'bash',
  'vfs',
  'logs',
  'state',
]);

/**
 * Handle a command.
 */
export async function handleCommand(
  handle: CliConstructHandle,
  command: string,
  args: string[],
): Promise<CommandResult> {
  const construct = handle.construct;
  // Gate commands during hypno review
  const hypnoStage = construct.isHypnoActive()
    ? construct.getHypnoStage()
    : null;
  const inHypnoReview = hypnoStage === 'analyze' || hypnoStage === 'propose';
  if (inHypnoReview && !HYPNO_REVIEW_ALLOWED.has(command)) {
    return {
      output: `Command :${command} is not available during hypno review. Allowed: :help, :accept, :update, :read, :quit`,
    };
  }

  switch (command) {
    case 'help':
    case 'h':
      return { output: getHelpText() };

    case 'quit':
    case 'q':
    case 'exit':
      return { output: 'Goodbye!', exit: true };

    case 'logs':
      return { output: await getLogsOutput(construct) };

    case 'state':
      return { output: await getStateOutput(construct) };

    case 'impulses':
      return { output: getImpulsesOutput(construct) };

    case 'scheduler':
      return { output: await getSchedulerOutput(construct) };

    case 'vfs':
    case 'bash':
      return { output: await getVfsOutput(construct, args[0] ?? '/') };

    case 'read':
      return { output: await readFile(construct, args[0] ?? '') };

    case 'time':
      return {
        output: await injectTimePerception(handle, args[0] ?? '30m'),
      };

    case 'event':
      return {
        output: await injectSystemEvent(handle, args.join(' ') || 'test-event'),
      };

    case 'hypno':
      return { output: await handleHypnoStart(handle) };

    case 'accept':
      return { output: await handleHypnoAccept(handle) };

    case 'update':
      return { output: await handleHypnoUpdate(handle) };

    case 'nap':
      await submitCliOp(handle, 'run_nap');
      return { output: 'Nap complete.' };

    case 'flush':
      await handle.flush();
      return { output: 'VFS flushed to disk.' };

    case 'rate':
      return { output: await handleRate(handle, args) };

    case 'steer':
      return { output: await handleSteer(handle, args) };

    default:
      return {
        output: `Unknown command: ${command}. Type :help for available commands.`,
      };
  }
}

/**
 * Get help text (generated from COMMAND_REGISTRY).
 */
function getHelpText(): string {
  const categoryLabels: Record<CommandDef['category'], string> = {
    general: 'General',
    inspection: 'Inspection',
    actions: 'Actions',
    feedback: 'Feedback',
    chat: 'Chat',
  };

  const categoryOrder: CommandDef['category'][] = [
    'general',
    'inspection',
    'actions',
    'feedback',
  ];

  const lines: string[] = ['Available Commands (prefix with : or /):'];

  for (const cat of categoryOrder) {
    const cmds = COMMAND_REGISTRY.filter((c) => c.category === cat);
    if (cmds.length === 0) continue;

    lines.push('');
    lines.push(`${categoryLabels[cat]}:`);
    for (const cmd of cmds) {
      const names = [`:${cmd.name}`, ...cmd.aliases.map((a) => `:${a}`)].join(
        ', ',
      );
      const usage = cmd.usage ? ` ${cmd.usage}` : '';
      const padded = `  ${names}${usage}`.padEnd(38);
      lines.push(`${padded} ${cmd.description}`);
    }
  }

  lines.push('');
  lines.push('Chat:');
  lines.push('  Just type normally to send a user message.');

  return lines.join('\n');
}

/**
 * Get logs output.
 */
async function getLogsOutput(construct: Construct): Promise<string> {
  const vfs = construct.getVfs();
  const lines: string[] = [];

  const logDir = getLogDir();
  lines.push(`--- Logs (${logDir}) ---`);
  try {
    const { listLogEntriesRecursive } = await import('../vfs/logs');
    const logEntries = await listLogEntriesRecursive(vfs, logDir);
    const sorted = logEntries
      .filter((e) => e.parsed)
      .sort((a, b) => a.entry.name.localeCompare(b.entry.name));

    if (sorted.length === 0) {
      lines.push('(no log files)');
    } else {
      for (const entry of sorted.slice(-5)) {
        lines.push(
          `File: ${entry.entry.name} (${entry.parsed?.logType ?? 'unknown'})`,
        );
      }
    }
  } catch {
    lines.push('(not found)');
  }
  lines.push('');

  // Feedback and steering logs
  for (const [name, logType] of Object.entries({
    Feedback: 'feedback',
    Steering: 'steering',
  })) {
    lines.push(`--- ${name} Logs (${VFS_PATHS.logs.root}) ---`);
    try {
      const found = await showLatestLogInDir(
        vfs,
        VFS_PATHS.logs.root,
        `.${logType}.log`,
      );
      lines.push(found || '(no log files)');
    } catch {
      lines.push('(not found)');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Find and read the latest .log file in a VFS directory (recursive).
 */
async function showLatestLogInDir(
  vfs: ReturnType<Construct['getVfs']>,
  dir: string,
  suffix = '.log',
): Promise<string | null> {
  const scan = async (d: string): Promise<string[]> => {
    let entries: Awaited<ReturnType<typeof vfs.list>>;
    try {
      entries = await vfs.list(d);
    } catch {
      return [];
    }
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.type === 'directory') {
        paths.push(...(await scan(entry.path)));
      } else if (entry.name.endsWith(suffix)) {
        paths.push(entry.path);
      }
    }
    return paths;
  };

  const logPaths = (await scan(dir)).sort();
  if (logPaths.length === 0) return null;

  const latest = logPaths.at(-1);
  if (latest === undefined) return null;
  const content = await vfs.read(latest);
  return `File: ${latest}\n${content || '(empty)'}`;
}

/**
 * Get construct state output.
 */
async function getStateOutput(construct: Construct): Promise<string> {
  const state = await construct.getState();
  return `
Construct State:
  ID: ${state.id}
  Storage: ${state.storage}
  Running: ${state.isRunning}
  Active Impulses: ${state.activeImpulses}
  Queued Perceptions: ${state.queuedPerceptions}
  Scheduled Responses: ${state.scheduledResponses}
`.trim();
}

/**
 * Get impulses output.
 */
function getImpulsesOutput(construct: Construct): string {
  const pool = construct.getImpulsePool();
  const state = pool.getState();

  if (state.active.length === 0) {
    return 'No active impulses.';
  }

  const lines: string[] = ['Active Impulses:'];
  for (const impulse of state.active) {
    lines.push(
      `  ${impulse.id} [${impulse.type}] attention=${impulse.attention.toFixed(2)} status=${impulse.status}`,
    );
  }

  if (state.queuedCount > 0) {
    lines.push(`\nQueued: ${state.queuedCount} perceptions waiting`);
  }

  return lines.join('\n');
}

/**
 * Get scheduler output.
 */
async function getSchedulerOutput(construct: Construct): Promise<string> {
  const state = await construct.getScheduler().getState();

  if (state.scheduled.length === 0) {
    return `Scheduler: ${state.isRunning ? 'Running' : 'Stopped'}\nNo scheduled responses.`;
  }

  const lines: string[] = [
    `Scheduler: ${state.isRunning ? 'Running' : 'Stopped'}`,
    '',
    'Scheduled Responses:',
  ];

  for (const response of state.scheduled) {
    lines.push(`  ${response.id}`);
    lines.push(`    Intent: ${response.intent}`);
    lines.push(`    Urgency: ${response.urgency}`);
    lines.push(`    Scheduled by: ${response.scheduledBy}`);
  }

  return lines.join('\n');
}

/**
 * Get VFS directory listing.
 */
async function getVfsOutput(
  construct: Construct,
  path: string,
): Promise<string> {
  const vfs = construct.getVfs();

  try {
    const entries = await vfs.list(path);
    if (entries.length === 0) {
      return `${path}: (empty directory)`;
    }

    const lines: string[] = [`${path}:`];
    for (const entry of entries) {
      const suffix = entry.type === 'directory' ? '/' : '';
      lines.push(`  ${entry.name}${suffix}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Error listing ${path}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Read a VFS file.
 */
async function readFile(construct: Construct, path: string): Promise<string> {
  if (!path) {
    return 'Usage: :read <path>';
  }

  const vfs = construct.getVfs();

  try {
    const content = await vfs.read(path);
    return `--- ${path} ---\n${content}`;
  } catch (err) {
    return `Error reading ${path}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Inject a time-passed perception.
 */
async function injectTimePerception(
  handle: CliConstructHandle,
  duration: string,
): Promise<string> {
  await submitCliOp(handle, 'time_passed', {
    elapsed: duration,
    now: new Date().toISOString(),
  });
  return `Injected TIME_PASSED: ${duration}`;
}

/**
 * Inject a system event.
 */
async function injectSystemEvent(
  handle: CliConstructHandle,
  event: string,
): Promise<string> {
  await submitCliOp(handle, 'system_event', {
    event,
    payload: {},
    occurredAt: new Date().toISOString(),
  });
  return `Injected SYSTEM_EVENT: ${event}`;
}

/**
 * Handle :hypno command — start a hypno (human-gated) nap session.
 */
async function handleHypnoStart(handle: CliConstructHandle): Promise<string> {
  const construct = handle.construct;
  if (construct.isHypnoActive()) {
    return `Hypno already active (stage: ${construct.getHypnoStage()}). Use :accept to advance or Esc to cancel.`;
  }

  try {
    await submitCliOp(handle, 'start_hypno');
    return 'Hypno started. Analyze stage running...';
  } catch (error) {
    return `Failed to start hypno: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Handle :accept command — accept current hypno review stage.
 * Double-accept if there are unapplied plan changes.
 */
async function handleHypnoAccept(handle: CliConstructHandle): Promise<string> {
  const construct = handle.construct;
  if (!construct.isHypnoActive()) {
    return 'No hypno session active. Use :hypno to start one.';
  }

  const stage = construct.getHypnoStage();
  if (stage === 'commit' || stage === 'completed' || stage === 'cancelled') {
    return `Cannot accept — hypno is in ${stage} stage.`;
  }

  await submitCliOp(handle, 'accept_hypno');
  return `Accepted ${stage} stage. Advancing...`;
}

/**
 * Handle :update command — apply current review plan to the draft.
 */
async function handleHypnoUpdate(handle: CliConstructHandle): Promise<string> {
  const construct = handle.construct;
  if (!construct.isHypnoActive()) {
    return 'No hypno session active. Use :hypno to start one.';
  }

  const stage = construct.getHypnoStage();
  if (stage !== 'analyze' && stage !== 'propose') {
    return `Cannot update — hypno is in ${stage} stage.`;
  }

  const review = construct.getHypnoReviewState();
  if (
    !review ||
    !review.currentPlan ||
    review.currentPlan === '(no changes yet)'
  ) {
    return 'No update plan to apply. Chat with the evaluator first to build a plan.';
  }

  await submitCliOp(handle, 'update_hypno');
  return 'Applying update plan to draft...';
}

/**
 * Handle :rate command.
 * Usage: :rate <lane> <good|bad|neutral> ["annotation text"]
 */
async function handleRate(
  handle: CliConstructHandle,
  args: string[],
): Promise<string> {
  if (args.length < 2) {
    return 'Usage: :rate <lane> <good|bad|neutral> [annotation]\nExample: :rate conversation bad "too aggressive"';
  }

  const lane = (args[0] ?? '').trim();
  if (lane.length === 0) {
    return 'Lane must be a non-empty string.';
  }

  const ratingArg = (args[1] ?? '').toLowerCase();
  if (ratingArg !== 'good' && ratingArg !== 'bad' && ratingArg !== 'neutral') {
    return `Invalid rating: "${ratingArg}". Must be good, bad, or neutral.`;
  }

  const rating: FeedbackRating = ratingArg;

  // Join remaining args as annotation, stripping surrounding quotes
  let annotation: string | undefined;
  if (args.length > 2) {
    annotation = args.slice(2).join(' ');
    if (
      (annotation.startsWith('"') && annotation.endsWith('"')) ||
      (annotation.startsWith("'") && annotation.endsWith("'"))
    ) {
      annotation = annotation.slice(1, -1);
    }
  }

  await submitCliOp(handle, 'rate_response', {
    rating,
    annotation,
    source: 'tui',
    lane,
  });
  const suffix = annotation ? ` — "${annotation}"` : '';
  return `Rated last response in ${lane}: ${rating}${suffix}`;
}

/**
 * Handle :steer command.
 * Usage: :steer <lane> <directive text>
 */
async function handleSteer(
  handle: CliConstructHandle,
  args: string[],
): Promise<string> {
  if (args.length < 2) {
    return 'Usage: :steer <lane> <directive>\nExample: :steer conversation Be more encouraging, less drill-sergeant';
  }

  const lane = (args[0] ?? '').trim();
  if (lane.length === 0) {
    return 'Lane must be a non-empty string.';
  }

  const directive = args.slice(1).join(' ');
  await submitCliOp(handle, 'steer_directive', {
    directive,
    source: 'tui',
    lane,
  });
  return `Steering directive injected into ${lane}: "${directive}"`;
}

async function submitCliOp<TKind extends ConstructOp['kind']>(
  handle: CliConstructHandle,
  kind: TKind,
  payload?: Extract<ConstructOp, { kind: TKind }>['payload'],
): Promise<void> {
  await handle.submit({
    opId: `${kind}:${handle.constructId}:${crypto.randomUUID()}`,
    kind,
    payload,
    createdAt: new Date().toISOString(),
  } as Extract<ConstructOp, { kind: TKind }>);
}
