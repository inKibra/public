/**
 * defineCommand — Universal command definition interface.
 * See spec §8.1.
 */

import type { ArgDef, Command, CommandContext } from './types';

export function defineCommand<TResult>(opts: {
  name: string;
  description: string;
  readme?: string;
  args: Record<string, ArgDef>;
  fn: (
    parsed: Record<string, unknown>,
    ctx: CommandContext,
  ) => Promise<TResult>;
  render: (result: TResult) => string;
}): Command<TResult> {
  return opts;
}
