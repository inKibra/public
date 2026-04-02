/**
 * Command Computer — Core Types
 *
 * Types for the command registry, defineCommand, and arg parsing.
 * See spec §8 for full details.
 */

import type { OverlayFs } from '@inkibra/ai-flow';

// ---------------------------------------------------------------------------
// Arg definitions
// ---------------------------------------------------------------------------

export type ArgType = 'string' | 'number' | 'boolean';

export type ArgDef = {
  type: ArgType;
  /** Positional arg index (0-based). Mutually exclusive with `flag`. */
  position?: number;
  /** Flag name, e.g. '--head', '--format'. Mutually exclusive with `position`. */
  flag?: string;
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
};

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export type CommandContext = {
  fs: OverlayFs;
  registry: CommandRegistry;
  deps?: unknown;
};

export type Command<TResult = unknown> = {
  name: string;
  description: string;
  readme?: string;
  args: Record<string, ArgDef>;
  fn: (
    parsed: Record<string, unknown>,
    ctx: CommandContext,
  ) => Promise<TResult>;
  render: (result: TResult) => string;
};

export type RegisteredCommand = {
  name: string;
  description: string;
  readme?: string;
  args: Record<string, ArgDef>;
  fn: (
    parsed: Record<string, unknown>,
    ctx: CommandContext,
  ) => Promise<unknown>;
  render: (result: unknown) => string;
};

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

export type CommandRegistry = {
  register: (command: Command<any>) => void;
  get: (name: string) => RegisteredCommand | undefined;
  has: (name: string) => boolean;
  dispatch: (
    name: string,
    args: (string | number | boolean)[],
    ctx: CommandContext,
  ) => Promise<unknown>;
  list: () => RegisteredCommand[];
  generateHelp: (name: string) => string | undefined;
};

// ---------------------------------------------------------------------------
// Parsed args result
// ---------------------------------------------------------------------------

export type ParsedArgs = Record<string, string | number | boolean>;

// ---------------------------------------------------------------------------
// Dispatch budget (§20.5)
// ---------------------------------------------------------------------------

/**
 * Rate limits for dispatched impulses per construct.
 * Prevents runaway loops from self-dispatching impulses.
 *
 * When budget is exhausted, the `dispatchImpulse` field is removed
 * from the scheduler's structured output schema.
 */
export type DispatchBudgetConfig = {
  maxPerHour: number;
  maxPerDay: number;
};

export type ArgParseResult =
  | { success: true; parsed: ParsedArgs }
  | { success: false; error: string };
