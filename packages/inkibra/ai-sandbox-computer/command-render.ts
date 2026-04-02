import type { OpenCommandResult } from './commands/context-management';
import type { Command } from './types';

export type RenderedCommandOutput = {
  renderedOutput: string;
  ephemeralOutput?: string;
};

function isOpenFileResult(
  value: unknown,
): value is Extract<OpenCommandResult, { type: 'file' }> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.type === 'file' &&
    typeof record.path === 'string' &&
    typeof record.content === 'string' &&
    typeof record.sha256 === 'string'
  );
}

function renderOpenEphemeralOutput(
  result: Extract<OpenCommandResult, { type: 'file' }>,
): string {
  return [`Opened document: ${result.path}`, '', result.content].join('\n');
}

export function renderCommandOutput<TResult>(
  command: Pick<Command<TResult>, 'name' | 'render'>,
  result: TResult,
): RenderedCommandOutput {
  const renderedOutput = command.render(result);

  if (command.name === 'open' && isOpenFileResult(result)) {
    return {
      renderedOutput,
      ephemeralOutput: renderOpenEphemeralOutput(result),
    };
  }

  return { renderedOutput };
}
