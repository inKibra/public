/**
 * VFS Tool
 *
 * AiTool wrapper around ContextShell for bash-like VFS commands.
 */

import { createAiTool, type Validation } from '../flow';
import { createContextShell } from './context-shell';
import type { OverlayFs } from './overlay-fs';

export type CreateVfsToolOptions = {
  fs: OverlayFs;
  name?: string;
  description?: string;
  readOnlyPaths?: string[];
  initialCwd?: string;
};

/**
 * Create a VFS tool for ai-flow stages.
 */
export type VfsToolResult = {
  command: string;
  output: string;
  exitCode: number;
};

export function createVfsTool<TFlowCtx extends Record<string, unknown>, TDeps>(
  options: CreateVfsToolOptions,
) {
  const {
    fs,
    name = 'bash',
    description,
    readOnlyPaths = [],
    initialCwd = '/context',
  } = options;
  const shell = createContextShell(fs, {
    readOnlyPaths,
    initialCwd,
  });

  const baseDescription = `Execute bash-like commands on the virtual filesystem.

File commands:
- ls [path]                            List directory contents
- cat <path>                           Read entire file
- head [-n N] <path>                   Read first N lines
- tail [-n N] <path>                   Read last N lines
- grep [-inr] <pattern> [path]         Search for pattern
- find <path> -name <pattern>          Find files by name
- wc [-lwc] <path>                     Count lines/words/chars
- echo "text" > path                   Write text to file
- patch <path> <old> <new> [--count N] Targeted replacement (use \\n for newlines)
- rm [-rf] <path>                      Delete file(s)
- mkdir <path>                         Create directory
- pwd                                  Print working directory
- cd <path>                            Change directory

Open/Close (persistent context):
- open <path>                          Open file or directory into persistent context
- open <dir/*>                         Open direct files + direct subdirectories (shallow)
- open <dir/**>                        Open files recursively
- close <path>                         Close file or directory from persistent context
- opened                               List currently open files/directories

Reminders (under /context/reminders):
- cron list
- cron show <name>
- cron set <name> --at <time> [--text <message>]
- cron set <name> --every "<cron>" [--text <message>]
- cron snooze <name> --for <duration>
- cron done <name>
- cron rm <name>

Pin management and context pressure:
- context pin <path> --phase <awake|nap|both> --reason "..." [--mode full|frontmatter]
- context unpin <path>
- context status [--phase awake|nap]
- Note: pinning under /context/logs, /handles, or /queue is disallowed

Path pattern semantics:
- /dir/    => directory summary (shallow)
- /dir/*   => shallow expansion (direct files + direct subdirectories)
- /dir/**  => recursive expansion (files recursively)`;

  return createAiTool<TFlowCtx, { command: string }, VfsToolResult, TDeps>(
    name,
    {
      description: description
        ? `${baseDescription}\n\n${description}`
        : baseDescription,
      parameterSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
      parseParameters: (args: string): Validation<{ command: string }> => {
        try {
          const parsed = JSON.parse(args);
          if (typeof parsed.command === 'string') {
            return { success: true, data: { command: parsed.command } };
          }
          return {
            success: false,
            errors: [
              { path: 'command', expected: 'string', value: parsed.command },
            ],
          };
        } catch (e) {
          return {
            success: false,
            errors: [
              {
                message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }
      },
      execute: async ({ command }) => {
        try {
          const result = await shell.exec(command);
          if (result.exitCode === 0) {
            return {
              success: true,
              data: {
                command,
                output: result.stdout || '(no output)',
                exitCode: result.exitCode,
              },
            };
          }
          return {
            success: false,
            message: result.stderr || `Exit code: ${result.exitCode}`,
          };
        } catch (e) {
          return {
            success: false,
            message: e instanceof Error ? e.message : String(e),
          };
        }
      },
      render: (data) => data.output,
    },
  );
}
