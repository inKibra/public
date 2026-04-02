export type ToolUsageEntry = {
  command: string;
  output?: string;
};

export type ToolUsageFormatOptions = {
  maxEntries?: number;
  maxOutputLength?: number;
};

export function extractFilesFromToolUsage(entries: ToolUsageEntry[]): string[] {
  const files = new Set<string>();
  for (const entry of entries) {
    const commands = splitCompoundCommands(entry.command);
    for (const command of commands) {
      const extracted = extractFilesFromCommand(command);
      for (const file of extracted) {
        if (file) files.add(file);
      }
    }
  }
  return Array.from(files);
}

export function formatToolUsageLines(
  entries: ToolUsageEntry[],
  options: ToolUsageFormatOptions = {},
): string[] {
  const maxEntries = options.maxEntries ?? 30;
  const maxOutputLength = options.maxOutputLength ?? 120;
  const trimmed = entries.slice(0, Math.max(maxEntries, 0));
  return trimmed
    .map((entry) => {
      const command = entry.command.trim();
      if (!command) return null;
      const output = normalizeOutput(entry.output ?? '');
      if (!output) return command;
      return `${command} => ${trimOutput(output, maxOutputLength)}`;
    })
    .filter((line): line is string => Boolean(line));
}

function extractFilesFromCommand(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];

  const { commandPart, redirectPath } = splitRedirect(trimmed);
  const tokens = tokenize(commandPart);
  if (tokens.length === 0) {
    return redirectPath ? [redirectPath] : [];
  }

  const [cmd, ...args] = tokens;
  const files: string[] = [];
  const addAll = (values: string[]) => {
    for (const value of values) {
      if (value) files.push(value);
    }
  };
  const addLastNonFlag = () => {
    const value = lastNonFlagArg(args);
    if (value) files.push(value);
  };

  switch (cmd) {
    case 'open':
    case 'close':
      addAll(collectPaths(args));
      break;
    case 'cat':
      addAll(collectPaths(args));
      break;
    case 'head':
    case 'tail':
      addLastNonFlag();
      break;
    case 'grep':
      if (args.length >= 2) addLastNonFlag();
      break;
    case 'patch':
      if (args[0]) files.push(args[0]);
      break;
    case 'rm':
      addAll(collectPaths(args));
      break;
    case 'mkdir':
      addLastNonFlag();
      break;
    case 'echo':
      if (redirectPath) files.push(redirectPath);
      break;
    case 'context': {
      const sub = args[0];
      if (sub === 'pin' || sub === 'unpin') {
        const target = args.find(
          (arg, index) => index > 0 && !arg.startsWith('-'),
        );
        if (target) files.push(target);
      }
      break;
    }
    default:
      break;
  }

  if (redirectPath && !files.includes(redirectPath)) {
    files.push(redirectPath);
  }

  return files;
}

function collectPaths(args: string[]): string[] {
  return args.filter((arg) => arg && !arg.startsWith('-'));
}

function lastNonFlagArg(args: string[]): string | undefined {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    const arg = args[i];
    if (arg && !arg.startsWith('-')) return arg;
  }
  return undefined;
}

function splitRedirect(input: string): {
  commandPart: string;
  redirectPath?: string;
} {
  const appendMatch = input.match(/^(.+?)\s*>>\s*(.+)$/);
  if (appendMatch) {
    return {
      commandPart: appendMatch[1]!.trim(),
      redirectPath: appendMatch[2]!.trim(),
    };
  }
  const writeMatch = input.match(/^(.+?)\s*>\s*(.+)$/);
  if (writeMatch) {
    return {
      commandPart: writeMatch[1]!.trim(),
      redirectPath: writeMatch[2]!.trim(),
    };
  }
  return { commandPart: input };
}

function splitCompoundCommands(input: string): string[] {
  const commands: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let escaped = false;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) commands.push(trimmed);
    current = '';
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      }
      current += char;
      continue;
    }

    if (!inQuote) {
      if (char === '&' && next === '&') {
        flush();
        i += 1;
        continue;
      }
      if (char === '|' && next === '|') {
        flush();
        i += 1;
        continue;
      }
      if (char === '|' || char === ';') {
        flush();
        continue;
      }
    }

    current += char;
  }

  flush();
  return commands.length > 0 ? commands : [input.trim()].filter(Boolean);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeOutput(output: string): string {
  return output.replace(/\s+/g, ' ').trim();
}

function trimOutput(output: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (output.length <= maxLength) return output;
  if (maxLength <= 3) return output.slice(0, maxLength);
  return `${output.slice(0, maxLength - 3)}...`;
}
