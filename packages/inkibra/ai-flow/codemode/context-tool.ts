/**
 * Context Tool
 *
 * AI-facing tool for interacting with the context filesystem using bash-like commands.
 * This is the interface that gets exposed to the LLM.
 */

import type { ContextShell, ShellResult } from './context-shell';
import type { OverlayFs } from './overlay-fs';

/**
 * Tool definition for AI SDK compatibility
 */
export type ContextToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: {
      command: {
        type: 'string';
        description: string;
      };
    };
    required: ['command'];
  };
  execute: (params: { command: string }) => Promise<ContextToolResult>;
};

/**
 * Result returned to the AI
 */
export type ContextToolResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Options for creating the context tool
 */
export type CreateContextToolOptions = {
  /** The shell to execute commands with */
  shell: ContextShell;
  /** Optional: filesystem for additional metadata */
  fs?: OverlayFs;
  /** Custom tool name (default: 'context') */
  name?: string;
  /** Additional description text */
  additionalDescription?: string;
};

/**
 * Generate the tool description
 */
function generateDescription(options?: { additional?: string }): string {
  const base = `Execute bash-like commands on the context filesystem.

## Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| ls [path] | List directory contents | \`ls /context/user/\` |
| cat <path> | Read entire file | \`cat /context/profile.md\` |
| head [-n N] <path> | Read first N lines (default 10) | \`head -n 20 /context/notes.md\` |
| tail [-n N] <path> | Read last N lines (default 10) | \`tail -n 5 /context/log.md\` |
| grep <pattern> [path] | Search for pattern | \`grep "tags:.*fitness" /context/\` |
| echo "text" > path | Write text to file | \`echo "# Notes" > /context/new.md\` |
| rm <path> | Delete file | \`rm /context/old.md\` |
| pwd | Print working directory | \`pwd\` |
| cd <path> | Change directory | \`cd /context/user/\` |
| find <path> -name <pattern> | Find files by name | \`find /context -name "*.md"\` |
| wc [-l] <path> | Count lines/words/bytes | \`wc -l /context/file.md\` |
| open <path> | Open file/directory into persistent context | \`open /context/reminders/\` |
| close <path> | Close opened file/directory from context | \`close /context/reminders/\` |
| opened | List open context handles | \`opened\` |
| cron list | List reminders | \`cron list\` |
| cron set <name> --at <time> | Create one-time reminder | \`cron set pay-rent --at "2026-03-01T09:00:00Z"\` |
| cron set <name> --every <cron> | Create recurring reminder | \`cron set daily-walk --every "0 18 * * *"\` |

## Flags

- \`ls -l\`: Long format with dates
- \`ls -a\`: Show hidden files
- \`grep -i\`: Case insensitive
- \`grep -n\`: Show line numbers
- \`grep -r\`: Recursive search
- \`rm -f\`: Force delete (no error if missing)

## File Format

Files use markdown with YAML frontmatter:

\`\`\`markdown
---
type: note
tags: [fitness, legs]
---

# My Notes

Content here...
\`\`\`

## Tips

- Use \`grep "tags:.*fitness"\` to find files by tag
- Use \`head -n 15\` to peek at frontmatter
- Paths starting with \`/\` are absolute, others relative to cwd
- Use \`>\` to write, \`>>\` to append`;

  if (options?.additional) {
    return base + '\n\n' + options.additional;
  }

  return base;
}

/**
 * Create a context tool for AI usage
 */
export function createContextTool(
  options: CreateContextToolOptions,
): ContextToolDefinition {
  const { shell, name = 'context', additionalDescription } = options;

  return {
    name,
    description: generateDescription({ additional: additionalDescription }),
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
      },
      required: ['command'],
    },
    execute: async ({ command }): Promise<ContextToolResult> => {
      const result = await shell.exec(command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  };
}

/**
 * Format a shell result for display to the AI
 */
export function formatShellResult(result: ShellResult): string {
  const parts: string[] = [];

  if (result.stdout) {
    parts.push(result.stdout);
  }

  if (result.stderr) {
    parts.push(`[stderr] ${result.stderr}`);
  }

  if (result.exitCode !== 0 && !result.stderr) {
    parts.push(`[exit code: ${result.exitCode}]`);
  }

  return parts.join('\n') || '(no output)';
}

/**
 * Create a simplified context tool that returns formatted string output
 */
export function createSimpleContextTool(options: CreateContextToolOptions): {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: {
      command: { type: 'string'; description: string };
    };
    required: ['command'];
  };
  execute: (params: { command: string }) => Promise<string>;
} {
  const tool = createContextTool(options);

  return {
    ...tool,
    execute: async ({ command }) => {
      const result = await tool.execute({ command });
      return formatShellResult(result);
    },
  };
}
