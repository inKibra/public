/**
 * Globals — command(), show(), plan_response()
 *
 * These are injected into the preview execution context.
 * See spec §8.4, §9, §10.
 */

import { inspect } from 'node:util';
import { renderCommandOutput } from './command-render';
import type { CommandContext, CommandRegistry } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResponsePlan = {
  text: string;
  importance?: 'low' | 'normal' | 'high' | 'urgent';
  /** Target lane for this response (defaults to source impulse's lane) */
  lane?: string;
};

export type ResponsePlanPolicy = {
  sourceLane: string;
  declaredLanes: string[];
  crossLaneTargets: string[];
};

export type PreviewGlobals = {
  command: (
    name: string,
    ...args: (string | number | boolean)[]
  ) => Promise<unknown>;
  show: <T>(value: T) => T;
  plan_response: (response: ResponsePlan) => void;
  console: CapturedConsole;
};

export type CapturedConsole = {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
};

// ---------------------------------------------------------------------------
// Command result tagging
// ---------------------------------------------------------------------------

const COMMAND_TAG = Symbol('command-result');

type TaggedValue = {
  [COMMAND_TAG]?: string;
};

function tagCommandResult<T>(value: T, commandName: string): T {
  if (value !== null && typeof value === 'object') {
    (value as TaggedValue)[COMMAND_TAG] = commandName;
  }
  return value;
}

function getCommandTag(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object') {
    return (value as TaggedValue)[COMMAND_TAG];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === 'string'
        ? arg
        : inspect(arg, { depth: 6, colors: false, breakLength: 80 }),
    )
    .join(' ');
}

function formatCommandStart(
  name: string,
  args: (string | number | boolean)[],
): string {
  const argStr = args
    .map((a) => (typeof a === 'string' ? `"${a}"` : String(a)))
    .join(' ');
  return `Running command: ${name} ${argStr}`.trimEnd();
}

function formatCommandError(name: string, error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `Error in ${name}: ${msg}`;
}

function matchLanePattern(lane: string, pattern: string): boolean {
  if (pattern === lane) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return lane.startsWith(`${prefix}:`);
  }
  return false;
}

function validateResponsePlan(
  response: ResponsePlan,
  policy: ResponsePlanPolicy | undefined,
): ResponsePlan {
  const text = typeof response.text === 'string' ? response.text.trim() : '';
  if (!text) {
    throw new Error('plan_response text must be a non-empty string.');
  }

  const lane =
    typeof response.lane === 'string' ? response.lane.trim() : undefined;
  const normalized: ResponsePlan = {
    text,
    importance: response.importance,
    lane: lane && lane.length > 0 ? lane : undefined,
  };

  if (!policy || !normalized.lane) {
    return normalized;
  }

  if (normalized.lane === policy.sourceLane) {
    return { ...normalized, lane: undefined };
  }

  const declared = policy.declaredLanes.some((pattern) =>
    matchLanePattern(normalized.lane!, pattern),
  );
  if (!declared) {
    throw new Error(
      `plan_response lane "${normalized.lane}" is not declared. Known lanes/patterns: ${policy.declaredLanes.join(', ') || '(none)'}.`,
    );
  }

  const allowed = policy.crossLaneTargets.some((pattern) =>
    matchLanePattern(normalized.lane!, pattern),
  );
  if (!allowed) {
    throw new Error(
      `plan_response lane "${normalized.lane}" is not allowed from "${policy.sourceLane}". Allowed cross-lane targets: ${policy.crossLaneTargets.join(', ') || '(none)'}. Omit lane for same-lane delivery.`,
    );
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type CreateGlobalsOptions = {
  registry: CommandRegistry;
  ctx: CommandContext;
  stdout: string[];
  responsePlans: ResponsePlan[];
  ephemeralCommandOutputs?: string[];
  responsePlanPolicy?: ResponsePlanPolicy;
};

/**
 * Create the preview execution globals: command(), show(), plan_response(), console.
 */
export function createPreviewGlobals(
  options: CreateGlobalsOptions,
): PreviewGlobals {
  const {
    registry,
    ctx,
    stdout,
    responsePlans,
    ephemeralCommandOutputs = [],
    responsePlanPolicy,
  } = options;

  // command() — spec §8.4, §9.1
  async function command(
    name: string,
    ...args: (string | number | boolean)[]
  ): Promise<unknown> {
    stdout.push(formatCommandStart(name, args));
    try {
      const result = await registry.dispatch(name, args, ctx);
      const cmd = registry.get(name);
      if (cmd) {
        const rendered = renderCommandOutput(
          { name: cmd.name, render: cmd.render },
          result,
        );
        stdout.push(rendered.renderedOutput);
        if (rendered.ephemeralOutput) {
          ephemeralCommandOutputs.push(rendered.ephemeralOutput);
        }
        return tagCommandResult(result, name);
      }
      return result;
    } catch (error) {
      stdout.push(formatCommandError(name, error));
      throw error;
    }
  }

  // show() — spec §9.2
  function show<T>(value: T): T {
    const tag = getCommandTag(value);
    if (tag) {
      const cmd = registry.get(tag);
      if (cmd) {
        stdout.push(cmd.render(value));
        return value;
      }
    }
    stdout.push(formatConsoleArgs([value]));
    return value;
  }

  // plan_response() — spec §10
  function plan_response(response: ResponsePlan): void {
    responsePlans.push(validateResponsePlan(response, responsePlanPolicy));
  }

  // Captured console
  const capturedConsole: CapturedConsole = {
    log: (...args: unknown[]) => stdout.push(formatConsoleArgs(args)),
    warn: (...args: unknown[]) => stdout.push(formatConsoleArgs(args)),
    error: (...args: unknown[]) => stdout.push(formatConsoleArgs(args)),
    info: (...args: unknown[]) => stdout.push(formatConsoleArgs(args)),
  };

  return {
    command,
    show,
    plan_response,
    console: capturedConsole,
  };
}
