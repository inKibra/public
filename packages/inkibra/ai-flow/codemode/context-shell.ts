/**
 * Context Shell
 *
 * A minimal bash-like shell for interacting with the overlay filesystem.
 * Provides familiar Unix commands for AI agents to explore and modify context.
 *
 * Supported commands:
 * - ls [path]           - List directory contents
 * - cat <path>          - Read entire file
 * - head [-n N] <path>  - Read first N lines (default 10)
 * - tail [-n N] <path>  - Read last N lines (default 10)
 * - grep <pattern> [path] - Search for pattern in files
 * - echo "content" > path - Write content to file
 * - patch <path> <old> <new> [--count N] - Targeted replacement
 * - rm <path>           - Delete file
 * - mkdir -p <path>     - Create directory (implicit on write)
 * - find <path> -name <pattern> - Find files by name
 * - wc [-lwc] <path>    - Count lines/words/chars
 * - pwd                 - Print working directory
 * - cd <path>           - Change working directory
 *
 * File handle commands (persistent across shell sessions):
 * - open <path>         - Open file/directory into persistent context
 * - open <dir/*>        - Open direct files + direct subdirectories (shallow)
 * - open <dir/**>       - Open files recursively
 * - close <path>        - Close file/directory from persistent context
 * - opened              - List currently open files/directories
 * - cron ...            - Manage reminder files under /context/reminders/
 * - context pin|unpin|status - Pin management and context pressure view
 *   (pinning /context/logs, /handles, and /queue is disallowed)
 */

import { parseExpression } from 'cron-parser';
import { parseContextFile, serializeContextFile } from '../context/frontmatter';
import { countTokens, estimateTokensFromBytes } from '../tokenizer';
import type { FsEntry, OverlayFs } from './overlay-fs';

/**
 * Result of a shell command execution
 */
export type ShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ContextShellOptions = {
  readOnlyPaths?: string[];
  initialCwd?: string;
};

/**
 * Parsed command structure
 */
type ParsedCommand = {
  cmd: string;
  args: string[];
  redirect?: {
    type: '>' | '>>';
    path: string;
  };
  pipe?: ParsedCommand;
};

/**
 * Maximum output length (30KB like bash-tool)
 */
const MAX_OUTPUT_LENGTH = 30_000;
const REMINDERS_ROOT = '/context/reminders';

/**
 * Parse a command string into structured form
 */
function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  // Handle output redirection
  let redirect: ParsedCommand['redirect'];
  let commandPart = trimmed;

  const appendMatch = commandPart.match(/^(.+?)\s*>>\s*(.+)$/);
  const writeMatch = commandPart.match(/^(.+?)\s*>\s*(.+)$/);

  if (appendMatch) {
    commandPart = appendMatch[1]!.trim();
    redirect = { type: '>>', path: appendMatch[2]!.trim() };
  } else if (writeMatch) {
    commandPart = writeMatch[1]!.trim();
    redirect = { type: '>', path: writeMatch[2]!.trim() };
  }

  // Parse command and arguments
  const tokens = tokenize(commandPart);
  const cmd = tokens[0] ?? '';
  const args = tokens.slice(1);

  return { cmd, args, redirect };
}

/**
 * Tokenize a command string, handling quoted strings
 */
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

/**
 * Truncate output to max length
 */
function truncate(output: string, max: number = MAX_OUTPUT_LENGTH): string {
  if (output.length <= max) return output;
  const truncated = output.slice(0, max);
  return (
    truncated + `\n... (truncated, ${output.length - max} more characters)`
  );
}

function normalizeProtectedPath(fs: OverlayFs, path: string): string {
  return fs.normalizePath(path);
}

function isPathReadOnly(
  fs: OverlayFs,
  path: string,
  readOnlyPaths: string[],
): boolean {
  const normalized = normalizeProtectedPath(fs, path);
  return readOnlyPaths.some((candidate) => {
    const protectedPath = normalizeProtectedPath(fs, candidate);
    return (
      normalized === protectedPath || normalized.startsWith(`${protectedPath}/`)
    );
  });
}

/**
 * Format entries for ls output
 */
function formatLsEntry(entry: FsEntry, long: boolean): string {
  if (long) {
    const type = entry.type === 'directory' ? 'd' : '-';
    const modified = entry.modified ?? '-';
    return `${type} ${modified.slice(0, 10)} ${entry.name}${entry.type === 'directory' ? '/' : ''}`;
  }
  return entry.name + (entry.type === 'directory' ? '/' : '');
}

// ============================================================================
// Command Implementations
// ============================================================================

async function execLs(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  let path = '.';
  let long = false;
  let all = false;

  // Parse flags
  for (const arg of args) {
    if (arg === '-l') {
      long = true;
    } else if (arg === '-a') {
      all = true;
    } else if (arg === '-la' || arg === '-al') {
      long = true;
      all = true;
    } else if (!arg.startsWith('-')) {
      path = arg;
    }
  }

  try {
    const entries = await fs.list(path);
    const filtered = all
      ? entries
      : entries.filter((e) => !e.name.startsWith('.'));
    const lines = filtered.map((e) => formatLsEntry(e, long));
    return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

async function execCat(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'cat: missing file operand', exitCode: 1 };
  }

  try {
    const contents: string[] = [];
    for (const path of args) {
      const content = await fs.read(path);
      contents.push(content);
    }
    return { stdout: contents.join('\n'), stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

async function execHead(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  let lines = 10;
  let path: string | undefined;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-n' && args[i + 1]) {
      lines = parseInt(args[i + 1]!, 10);
      i++;
    } else if (arg.startsWith('-n')) {
      lines = parseInt(arg.slice(2), 10);
    } else if (!arg.startsWith('-')) {
      path = arg;
    }
  }

  if (!path) {
    return { stdout: '', stderr: 'head: missing file operand', exitCode: 1 };
  }

  try {
    const content = await fs.read(path);
    const allLines = content.split('\n');
    const result = allLines.slice(0, lines).join('\n');
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

async function execTail(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  let lines = 10;
  let path: string | undefined;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-n' && args[i + 1]) {
      lines = parseInt(args[i + 1]!, 10);
      i++;
    } else if (arg.startsWith('-n')) {
      lines = parseInt(arg.slice(2), 10);
    } else if (!arg.startsWith('-')) {
      path = arg;
    }
  }

  if (!path) {
    return { stdout: '', stderr: 'tail: missing file operand', exitCode: 1 };
  }

  try {
    const content = await fs.read(path);
    const allLines = content.split('\n');
    const result = allLines.slice(-lines).join('\n');
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

async function execGrep(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  let pattern: string | undefined;
  let paths: string[] = [];
  let ignoreCase = false;
  let lineNumbers = false;
  let recursive = false;

  // Parse arguments
  for (const arg of args) {
    if (arg === '-i') {
      ignoreCase = true;
    } else if (arg === '-n') {
      lineNumbers = true;
    } else if (arg === '-r' || arg === '-R') {
      recursive = true;
    } else if (arg === '-rn' || arg === '-nr') {
      recursive = true;
      lineNumbers = true;
    } else if (!arg.startsWith('-')) {
      if (!pattern) {
        pattern = arg;
      } else {
        paths.push(arg);
      }
    }
  }

  if (!pattern) {
    return { stdout: '', stderr: 'grep: missing pattern', exitCode: 2 };
  }

  // Default to current directory if no path specified
  if (paths.length === 0) {
    paths = ['.'];
  }

  try {
    const regex = new RegExp(pattern, ignoreCase ? 'i' : '');
    const matches: string[] = [];

    // Collect all files to search
    const filesToSearch: string[] = [];

    for (const searchPath of paths) {
      if (recursive) {
        await collectFilesRecursive(fs, searchPath, filesToSearch);
      } else {
        // Check if it's a file or directory
        const exists = await fs.exists(searchPath);
        if (exists) {
          filesToSearch.push(searchPath);
        }
      }
    }

    // Search each file
    for (const filePath of filesToSearch) {
      try {
        const content = await fs.read(filePath);
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            let match = '';
            if (filesToSearch.length > 1 || recursive) {
              match += `${filePath}:`;
            }
            if (lineNumbers) {
              match += `${index + 1}:`;
            }
            match += line;
            matches.push(match);
          }
        });
      } catch {
        // Skip files that can't be read
      }
    }

    if (matches.length === 0) {
      return { stdout: '', stderr: '', exitCode: 1 };
    }

    return { stdout: matches.join('\n'), stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: `grep: ${String(error)}`, exitCode: 2 };
  }
}

/**
 * Recursively collect all files under a path
 */
async function collectFilesRecursive(
  fs: OverlayFs,
  path: string,
  result: string[],
): Promise<void> {
  try {
    const entries = await fs.list(path);
    for (const entry of entries) {
      if (entry.type === 'file') {
        result.push(entry.path);
      } else if (entry.type === 'directory') {
        await collectFilesRecursive(fs, entry.path, result);
      }
    }
  } catch {
    // Path might be a file, not a directory
    const exists = await fs.exists(path);
    if (exists) {
      result.push(path);
    }
  }
}

async function execEcho(
  fs: OverlayFs,
  args: string[],
  redirect?: ParsedCommand['redirect'],
): Promise<ShellResult> {
  const output = args.join(' ');

  if (redirect) {
    try {
      if (redirect.type === '>>') {
        // Append mode
        let existing = '';
        try {
          existing = await fs.read(redirect.path);
        } catch {
          // File doesn't exist, start fresh
        }
        await fs.write(
          redirect.path,
          existing + (existing ? '\n' : '') + output,
        );
      } else {
        // Overwrite mode
        await fs.write(redirect.path, output);
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    } catch (error) {
      return { stdout: '', stderr: String(error), exitCode: 1 };
    }
  }

  return { stdout: output, stderr: '', exitCode: 0 };
}

async function execPatch(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  if (args.length < 3) {
    return {
      stdout: '',
      stderr: 'usage: patch <path> <old> <new> [--count N]',
      exitCode: 1,
    };
  }

  const countIndex = args.findIndex((arg) => arg === '--count' || arg === '-n');
  let count: number | null = null;

  if (countIndex >= 0) {
    const raw = args[countIndex + 1];
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isNaN(parsed) || parsed < 1) {
      return {
        stdout: '',
        stderr: 'patch: --count must be a positive integer',
        exitCode: 1,
      };
    }
    count = parsed;
  }

  const filteredArgs =
    countIndex >= 0
      ? args.filter((_, idx) => idx !== countIndex && idx !== countIndex + 1)
      : args;

  const [path, rawOld, rawNew] = filteredArgs;
  if (!path || rawOld === undefined || rawNew === undefined) {
    return {
      stdout: '',
      stderr: 'usage: patch <path> <old> <new> [--count N]',
      exitCode: 1,
    };
  }

  const oldText = unescapeArg(rawOld);
  const newText = unescapeArg(rawNew);

  try {
    const content = await fs.read(path);
    const { updated, replaced } = replaceWithCount(
      content,
      oldText,
      newText,
      count,
    );
    if (replaced === 0) {
      return {
        stdout: '',
        stderr: 'patch: pattern not found',
        exitCode: 1,
      };
    }
    await fs.write(path, updated);
    return {
      stdout: `patched ${replaced} occurrence(s)`,
      stderr: '',
      exitCode: 0,
    };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

function unescapeArg(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function replaceWithCount(
  input: string,
  search: string,
  replacement: string,
  count: number | null,
): { updated: string; replaced: number } {
  if (search.length === 0) {
    return { updated: input, replaced: 0 };
  }

  if (count === null) {
    const updated = input.split(search).join(replacement);
    const replaced = input.includes(search)
      ? input.split(search).length - 1
      : 0;
    return { updated, replaced };
  }

  let replaced = 0;
  let updated = '';
  let cursor = 0;

  while (cursor < input.length) {
    const index = input.indexOf(search, cursor);
    if (index === -1 || replaced >= count) {
      updated += input.slice(cursor);
      break;
    }

    updated += input.slice(cursor, index) + replacement;
    replaced += 1;
    cursor = index + search.length;
  }

  return { updated, replaced };
}

async function execRm(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  let force = false;
  const paths: string[] = [];

  for (const arg of args) {
    if (arg === '-f' || arg === '-rf' || arg === '-fr') {
      force = true;
    } else if (!arg.startsWith('-')) {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    return { stdout: '', stderr: 'rm: missing operand', exitCode: 1 };
  }

  const errors: string[] = [];

  for (const path of paths) {
    try {
      await fs.delete(path);
    } catch (error) {
      if (!force) {
        errors.push(`rm: cannot remove '${path}': ${String(error)}`);
      }
    }
  }

  if (errors.length > 0) {
    return { stdout: '', stderr: errors.join('\n'), exitCode: 1 };
  }

  return { stdout: '', stderr: '', exitCode: 0 };
}

async function execMkdir(
  _fs: OverlayFs,
  _args: string[],
): Promise<ShellResult> {
  // mkdir is implicit in our filesystem - directories are created on write
  // This is a no-op that always succeeds
  return { stdout: '', stderr: '', exitCode: 0 };
}

function execPwd(fs: OverlayFs): ShellResult {
  return { stdout: fs.cwd, stderr: '', exitCode: 0 };
}

function execCd(fs: OverlayFs, args: string[]): ShellResult {
  const path = args[0] ?? '/';
  fs.cd(path);
  return { stdout: '', stderr: '', exitCode: 0 };
}

async function execFind(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  let searchPath = '.';
  let namePattern: string | undefined;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-name' && args[i + 1]) {
      namePattern = args[i + 1];
      i++;
    } else if (!arg.startsWith('-')) {
      searchPath = arg;
    }
  }

  try {
    const files: string[] = [];
    await collectFilesRecursive(fs, searchPath, files);

    let filtered = files;
    if (namePattern) {
      // Convert glob pattern to regex
      const regex = new RegExp(
        '^' +
          namePattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.') +
          '$',
      );
      filtered = files.filter((f) => {
        const name = f.split('/').pop() ?? '';
        return regex.test(name);
      });
    }

    return { stdout: filtered.join('\n'), stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

async function execWc(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  let countLines = false;
  let countWords = false;
  let countBytes = false;
  const paths: string[] = [];

  for (const arg of args) {
    if (arg === '-l') countLines = true;
    else if (arg === '-w') countWords = true;
    else if (arg === '-c') countBytes = true;
    else if (!arg.startsWith('-')) paths.push(arg);
  }

  // Default to all counts if none specified
  if (!countLines && !countWords && !countBytes) {
    countLines = countWords = countBytes = true;
  }

  if (paths.length === 0) {
    return { stdout: '', stderr: 'wc: missing file operand', exitCode: 1 };
  }

  try {
    const results: string[] = [];

    for (const path of paths) {
      const content = await fs.read(path);
      const lines = content.split('\n').length;
      const words = content.split(/\s+/).filter(Boolean).length;
      const bytes = new TextEncoder().encode(content).length;

      const parts: string[] = [];
      if (countLines) parts.push(String(lines).padStart(8));
      if (countWords) parts.push(String(words).padStart(8));
      if (countBytes) parts.push(String(bytes).padStart(8));
      parts.push(path);

      results.push(parts.join(' '));
    }

    return { stdout: results.join('\n'), stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: String(error), exitCode: 1 };
  }
}

// ============================================================================
// Open/Close File Handle Commands
// ============================================================================

/**
 * Well-known path for tracking opened files
 */
const OPENED_STATE_PATH = '/handles/opened.md';

/**
 * Entry in the opened files state
 */
type OpenedEntry = {
  path: string;
  type: 'file' | 'directory';
  mode?: 'full' | 'frontmatter';
  pin?: 'awake' | 'nap' | 'both';
  pin_source?: 'system' | 'ai';
  pin_reason?: string;
  pin_path?: string;
  opened_at: string;
  last_accessed_at?: string;
  opened_by?: string;
  size_bytes: number;
  size_tokens?: number;
  score?: number;
  ttl_ms?: number;
  expires_at?: string;
};

/**
 * State of opened files
 */
type OpenedState = {
  updated_at: string;
  context_bytes: number;
  context_tokens: number;
  files: OpenedEntry[];
  ai_pins?: Array<{
    path: string;
    phase: 'awake' | 'nap' | 'both';
    mode?: 'full' | 'frontmatter';
    reason: string;
    created_at: string;
    updated_at: string;
  }>;
  recently_closed?: Array<{
    path: string;
    type: 'file' | 'directory';
    closed_at: string;
    size_bytes: number;
    size_tokens?: number;
    /** Frontmatter snapshot captured at close time */
    frontmatter?: Record<string, unknown>;
  }>;
};

const DEFAULT_OPEN_SCORE = 1;
const MAX_OPEN_SCORE = 3;
const DEFAULT_OPEN_TTL_MS = 12 * 60 * 60 * 1000;

function safeCountTokens(text: string): number {
  try {
    return countTokens(text);
  } catch {
    const bytes = new TextEncoder().encode(text).length;
    return estimateTokensFromBytes(bytes);
  }
}

function safeDateMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      cleaned[key] = entry;
    }
  }
  return cleaned as T;
}

function normalizeOpenedEntry(entry: OpenedEntry): OpenedEntry {
  const nowMs = Date.now();
  const openedAtMs = safeDateMs(entry.opened_at, nowMs);
  const lastAccessedMs = safeDateMs(entry.last_accessed_at, openedAtMs);
  const score =
    typeof entry.score === 'number' ? entry.score : DEFAULT_OPEN_SCORE;
  const ttlMs = typeof entry.ttl_ms === 'number' ? entry.ttl_ms : undefined;
  const expiresAt =
    entry.expires_at ??
    (ttlMs ? new Date(lastAccessedMs + ttlMs).toISOString() : undefined);

  return {
    ...entry,
    opened_at: new Date(openedAtMs).toISOString(),
    last_accessed_at: new Date(lastAccessedMs).toISOString(),
    score,
    ttl_ms: ttlMs,
    expires_at: expiresAt,
  } as OpenedEntry;
}

/**
 * Load the current opened state
 */
async function loadOpenedState(fs: OverlayFs): Promise<OpenedState> {
  try {
    const content = await fs.read(OPENED_STATE_PATH);
    const { meta } = parseContextFile(content);
    const files = ((meta.files as OpenedEntry[]) || []).map((entry) =>
      stripUndefined(normalizeOpenedEntry(entry)),
    );
    const contextBytes = (meta.context_bytes as number) || 0;
    const contextTokensRaw = meta.context_tokens as number | undefined;
    const contextTokens =
      typeof contextTokensRaw === 'number'
        ? contextTokensRaw
        : files.reduce(
            (sum, file) =>
              sum +
              (typeof file.size_tokens === 'number'
                ? file.size_tokens
                : estimateTokensFromBytes(file.size_bytes)),
            0,
          );
    return {
      updated_at: (meta.updated_at as string) || new Date().toISOString(),
      context_bytes: contextBytes,
      context_tokens: contextTokens,
      files,
      ai_pins: (meta.ai_pins as OpenedState['ai_pins']) || [],
      recently_closed:
        (meta.recently_closed as OpenedState['recently_closed']) || [],
    };
  } catch {
    // File doesn't exist, return empty state
    return {
      updated_at: new Date().toISOString(),
      context_bytes: 0,
      context_tokens: 0,
      files: [],
      ai_pins: [],
      recently_closed: [],
    };
  }
}

/**
 * Save the opened state
 */
async function saveOpenedState(
  fs: OverlayFs,
  state: OpenedState,
): Promise<void> {
  const normalized = {
    ...state,
    files: state.files.map((entry) =>
      stripUndefined(normalizeOpenedEntry(entry)),
    ),
  };
  const content = serializeContextFile(
    {
      id: 'opened-files',
      tags: [],
      created: normalized.updated_at,
      updated: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      context_bytes: normalized.context_bytes,
      context_tokens: normalized.context_tokens,
      files: normalized.files,
      ai_pins: normalized.ai_pins ?? [],
      recently_closed: normalized.recently_closed ?? [],
    },
    '',
  );
  await fs.write(OPENED_STATE_PATH, content);
}

/**
 * Get frontmatter summary for a file.
 * Only .md files are expected to have YAML frontmatter.
 */
async function getFileFrontmatter(
  fs: OverlayFs,
  path: string,
): Promise<{ frontmatter: string; size: number }> {
  const content = await fs.read(path);
  const size = new TextEncoder().encode(content).length;

  // Only .md files use YAML frontmatter; skip parsing for other file types
  if (!path.endsWith('.md')) {
    return { frontmatter: '  (no frontmatter)', size };
  }

  const { meta } = parseContextFile(content);

  // Format frontmatter as readable summary
  const frontmatterLines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          frontmatterLines.push(`  ${key}: [${value.join(', ')}]`);
        }
      } else if (typeof value === 'object') {
        frontmatterLines.push(`  ${key}: ${JSON.stringify(value)}`);
      } else {
        frontmatterLines.push(`  ${key}: ${value}`);
      }
    }
  }

  const frontmatter =
    frontmatterLines.length > 0
      ? frontmatterLines.join('\n')
      : '  (no frontmatter)';

  return { frontmatter, size };
}

function inferPinKind(
  path: string,
): 'file' | 'directory' | 'glob' | 'glob_recursive' {
  if (path.endsWith('/**')) return 'glob_recursive';
  if (path.endsWith('/*')) return 'glob';
  if (path.endsWith('/')) return 'directory';
  return 'file';
}

function normalizePinRoot(path: string): string {
  if (path.endsWith('/**')) return path.slice(0, -3);
  if (path.endsWith('/*')) return path.slice(0, -2);
  return path;
}

function isPinAllowed(path: string): boolean {
  const root = normalizePinRoot(path).replace(/\/+$/, '');
  if (root === '/context/logs' || root.startsWith('/context/logs/'))
    return false;
  if (root === '/handles' || root.startsWith('/handles/')) {
    return false;
  }
  if (root === '/context/handles' || root.startsWith('/context/handles/')) {
    return false;
  }
  if (root === '/queue' || root.startsWith('/queue/')) {
    return false;
  }
  if (root === '/context/queue' || root.startsWith('/context/queue/')) {
    return false;
  }
  return true;
}

function asDirectoryPath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

async function listFilesRecursive(
  fs: OverlayFs,
  root: string,
): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries: FsEntry[];
    try {
      entries = await fs.list(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.type === 'directory') {
        queue.push(entry.path);
      } else {
        files.push(entry.path);
      }
    }
  }

  return files;
}

function parseContextPinArgs(args: string[]): {
  path: string | null;
  phase: 'awake' | 'nap' | 'both' | null;
  reason: string | null;
  mode: 'full' | 'frontmatter';
} {
  let path: string | null = null;
  let phase: 'awake' | 'nap' | 'both' | null = null;
  let reason: string | null = null;
  let mode: 'full' | 'frontmatter' = 'full';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--phase') {
      const value = args[i + 1];
      if (value === 'awake' || value === 'nap' || value === 'both') {
        phase = value;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith('--phase=')) {
      const value = arg.slice('--phase='.length);
      if (value === 'awake' || value === 'nap' || value === 'both') {
        phase = value;
      }
      continue;
    }

    if (arg === '--reason') {
      reason = args[i + 1] ?? null;
      i += 1;
      continue;
    }

    if (arg.startsWith('--reason=')) {
      reason = arg.slice('--reason='.length) || null;
      continue;
    }

    if (arg === '--mode') {
      const value = args[i + 1];
      if (value === 'full' || value === 'frontmatter') {
        mode = value;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value === 'full' || value === 'frontmatter') {
        mode = value;
      }
      continue;
    }

    if (!arg.startsWith('-') && !path) {
      path = arg;
    }
  }

  return { path, phase, reason, mode };
}

function parseContextStatusArgs(args: string[]): {
  phase?: 'awake' | 'nap';
} {
  let phase: 'awake' | 'nap' | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--phase') {
      const value = args[i + 1];
      if (value === 'awake' || value === 'nap') {
        phase = value;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--phase=')) {
      const value = arg.slice('--phase='.length);
      if (value === 'awake' || value === 'nap') {
        phase = value;
      }
    }
  }

  return { phase };
}

const CONTEXT_MAX_TOKENS = 400_000;
const CONTEXT_WARN_RATIO = 0.75;
const CONTEXT_CRITICAL_RATIO = 0.9;

function determineContextStatus(ratio: number): 'ok' | 'warning' | 'critical' {
  if (ratio >= CONTEXT_CRITICAL_RATIO) return 'critical';
  if (ratio >= CONTEXT_WARN_RATIO) return 'warning';
  return 'ok';
}

function parseOpenArgs(args: string[]): {
  path: string | null;
  frontmatterOnly: boolean;
} {
  let frontmatterOnly = false;
  let path: string | null = null;

  for (const arg of args) {
    if (arg === '--frontmatter' || arg === '-f') {
      frontmatterOnly = true;
    } else if (!arg.startsWith('-')) {
      path = arg;
    }
  }

  return { path, frontmatterOnly };
}

/**
 * Open a file into persistent context
 */
async function execOpen(
  fs: OverlayFs,
  args: string[],
  openedBy?: string,
): Promise<ShellResult> {
  const parsed = parseOpenArgs(args);
  if (!parsed.path) {
    return { stdout: '', stderr: 'open: missing path operand', exitCode: 1 };
  }

  const path = parsed.path;
  const frontmatterOnly = parsed.frontmatterOnly;
  const state = await loadOpenedState(fs);
  const pathKind = inferPinKind(path);

  if (pathKind === 'glob' || pathKind === 'glob_recursive') {
    const root = pathKind === 'glob' ? path.slice(0, -2) : path.slice(0, -3);
    let rootEntries: Array<{ path: string; type: 'file' | 'directory' }> = [];
    try {
      rootEntries = (await fs.list(root)).map((entry) => ({
        path: entry.path,
        type: entry.type,
      }));
    } catch {
      return {
        stdout: '',
        stderr: `open: ${path}: No such file or directory`,
        exitCode: 1,
      };
    }

    const targets =
      pathKind === 'glob'
        ? rootEntries.map((entry) =>
            entry.type === 'directory'
              ? asDirectoryPath(entry.path)
              : entry.path,
          )
        : await listFilesRecursive(fs, root);

    if (targets.length === 0) {
      return {
        stdout: '',
        stderr: `open: ${path}: no matches`,
        exitCode: 1,
      };
    }

    const outputs: string[] = [];
    const errors: string[] = [];

    for (const target of targets) {
      const targetArgs = frontmatterOnly ? ['--frontmatter', target] : [target];
      const result = await execOpen(fs, targetArgs, openedBy);
      if (result.exitCode !== 0) {
        errors.push(`${target}: ${result.stderr || result.stdout}`);
        continue;
      }
      outputs.push(`== ${target} ==\n${result.stdout}`);
    }

    return {
      stdout: outputs.join('\n\n').trim(),
      stderr: errors.join('\n').trim(),
      exitCode: errors.length > 0 ? 1 : 0,
    };
  }

  // Check if already open
  const existingIndex = state.files.findIndex((f) => f.path === path);
  if (existingIndex >= 0) {
    // Already open, just return the content
    const entry = state.files[existingIndex]!;
    if (entry.type === 'file' && entry.pin_source === 'system') {
      const requestedMode: 'full' | 'frontmatter' = frontmatterOnly
        ? 'frontmatter'
        : 'full';
      const currentMode: 'full' | 'frontmatter' =
        entry.mode === 'frontmatter' ? 'frontmatter' : 'full';
      if (requestedMode !== currentMode) {
        return {
          stdout: '',
          stderr: `open: ${path}: cannot change mode for system-pinned file (current=${currentMode}, requested=${requestedMode})`,
          exitCode: 1,
        };
      }
    }

    const now = new Date().toISOString();
    const currentScore =
      typeof entry.score === 'number' ? entry.score : DEFAULT_OPEN_SCORE;
    entry.last_accessed_at = now;
    entry.score = Math.min(MAX_OPEN_SCORE, currentScore + 0.2);
    if (entry.ttl_ms) {
      entry.expires_at = new Date(Date.now() + entry.ttl_ms).toISOString();
    }
    state.updated_at = now;
    await saveOpenedState(fs, state);
    if (entry.type === 'file') {
      if (frontmatterOnly) {
        const { frontmatter } = await getFileFrontmatter(fs, path);
        const sizeBytes = new TextEncoder().encode(frontmatter).length;
        entry.size_bytes = sizeBytes;
        entry.size_tokens = safeCountTokens(frontmatter);
        entry.mode = 'frontmatter';
        state.context_bytes = state.files.reduce(
          (sum, f) => sum + f.size_bytes,
          0,
        );
        state.context_tokens = state.files.reduce(
          (sum, f) =>
            sum +
            (typeof f.size_tokens === 'number'
              ? f.size_tokens
              : estimateTokensFromBytes(f.size_bytes)),
          0,
        );
        await saveOpenedState(fs, state);
        return {
          stdout: `(already open)\n\n${frontmatter}`,
          stderr: '',
          exitCode: 0,
        };
      }
      const content = await fs.read(path);
      const sizeBytes = new TextEncoder().encode(content).length;
      entry.size_bytes = sizeBytes;
      entry.size_tokens = safeCountTokens(content);
      entry.mode = 'full';
      state.context_bytes = state.files.reduce(
        (sum, f) => sum + f.size_bytes,
        0,
      );
      state.context_tokens = state.files.reduce(
        (sum, f) =>
          sum +
          (typeof f.size_tokens === 'number'
            ? f.size_tokens
            : estimateTokensFromBytes(f.size_bytes)),
        0,
      );
      await saveOpenedState(fs, state);
      return {
        stdout: `(already open)\n\n${content}`,
        stderr: '',
        exitCode: 0,
      };
    }
    const listing = await formatDirectoryWithFrontmatter(fs, path);
    return {
      stdout: `(already open)\n\n${listing}`,
      stderr: '',
      exitCode: 0,
    };
  }

  try {
    let isDirectory = false;
    const existsAsFile = await fs.exists(path);
    if (existsAsFile) {
      isDirectory = false;
    } else {
      const children = await fs.list(path);
      if (children.length === 0) {
        return {
          stdout: '',
          stderr: `open: ${path}: No such file or directory`,
          exitCode: 1,
        };
      }
      isDirectory = true;
    }

    let output: string;
    let sizeBytes: number;
    let sizeTokens: number;

    const now = new Date().toISOString();
    if (isDirectory) {
      // Open directory: get listing + all frontmatter
      output = await formatDirectoryWithFrontmatter(fs, path);
      sizeBytes = new TextEncoder().encode(output).length;
      sizeTokens = safeCountTokens(output);

      state.files.push({
        path,
        type: 'directory',
        opened_at: now,
        last_accessed_at: now,
        opened_by: openedBy,
        size_bytes: sizeBytes,
        size_tokens: sizeTokens,
        score: DEFAULT_OPEN_SCORE,
        ttl_ms: DEFAULT_OPEN_TTL_MS,
        expires_at: new Date(Date.now() + DEFAULT_OPEN_TTL_MS).toISOString(),
      });
    } else {
      if (frontmatterOnly) {
        const { frontmatter } = await getFileFrontmatter(fs, path);
        output = frontmatter;
        sizeBytes = new TextEncoder().encode(output).length;
        sizeTokens = safeCountTokens(output);
      } else {
        const content = await fs.read(path);
        output = content;
        sizeBytes = new TextEncoder().encode(output).length;
        sizeTokens = safeCountTokens(output);
      }

      state.files.push({
        path,
        type: 'file',
        mode: frontmatterOnly ? 'frontmatter' : 'full',
        opened_at: now,
        last_accessed_at: now,
        opened_by: openedBy,
        size_bytes: sizeBytes,
        size_tokens: sizeTokens,
        score: DEFAULT_OPEN_SCORE,
        ttl_ms: DEFAULT_OPEN_TTL_MS,
        expires_at: new Date(Date.now() + DEFAULT_OPEN_TTL_MS).toISOString(),
      });
    }

    // Update total context bytes
    state.context_bytes = state.files.reduce((sum, f) => sum + f.size_bytes, 0);
    state.context_tokens = state.files.reduce(
      (sum, f) =>
        sum +
        (typeof f.size_tokens === 'number'
          ? f.size_tokens
          : estimateTokensFromBytes(f.size_bytes)),
      0,
    );
    state.updated_at = new Date().toISOString();

    await saveOpenedState(fs, state);

    return { stdout: output, stderr: '', exitCode: 0 };
  } catch (error) {
    return { stdout: '', stderr: `open: ${String(error)}`, exitCode: 1 };
  }
}

/**
 * Format a directory listing with frontmatter for all files
 */
async function formatDirectoryWithFrontmatter(
  fs: OverlayFs,
  dirPath: string,
): Promise<string> {
  const entries = await fs.list(dirPath);
  const lines: string[] = [];

  lines.push(`Directory: ${dirPath}`);
  lines.push(`Files: ${entries.filter((e) => e.type === 'file').length}`);
  lines.push(
    `Subdirectories: ${entries.filter((e) => e.type === 'directory').length}`,
  );
  lines.push('');

  // Include README.md full content at the top (like GitHub directory view)
  const readmeEntry = entries.find(
    (e) => e.type === 'file' && e.name.toLowerCase() === 'readme.md',
  );
  if (readmeEntry) {
    try {
      const content = await fs.read(readmeEntry.path);
      lines.push(content.trim());
      lines.push('');
    } catch {
      // skip if unreadable
    }
  }

  lines.push('---');
  lines.push('');

  for (const entry of entries) {
    // Skip README.md — already rendered above
    if (entry.type === 'file' && entry.name.toLowerCase() === 'readme.md') {
      continue;
    }
    if (entry.type === 'directory') {
      lines.push(`[DIR] ${entry.name}/`);
    } else {
      lines.push(`[FILE] ${entry.name}`);
      try {
        const { frontmatter } = await getFileFrontmatter(fs, entry.path);
        lines.push(frontmatter);
      } catch {
        lines.push('  (could not read frontmatter)');
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function recomputeContextTotals(state: OpenedState): void {
  state.context_bytes = state.files.reduce((sum, f) => sum + f.size_bytes, 0);
  state.context_tokens = state.files.reduce(
    (sum, f) =>
      sum +
      (typeof f.size_tokens === 'number'
        ? f.size_tokens
        : estimateTokensFromBytes(f.size_bytes)),
    0,
  );
  state.updated_at = new Date().toISOString();
}

async function upsertAiPinnedFile(
  fs: OverlayFs,
  state: OpenedState,
  options: {
    filePath: string;
    pinPath: string;
    phase: 'awake' | 'nap' | 'both';
    mode: 'full' | 'frontmatter';
    reason: string;
  },
): Promise<boolean> {
  const { filePath, pinPath, phase, mode, reason } = options;
  const existing = state.files.find((entry) => entry.path === filePath);

  if (existing?.pin_source === 'system') {
    return false;
  }

  let output = '';
  if (mode === 'frontmatter') {
    const { frontmatter } = await getFileFrontmatter(fs, filePath);
    output = frontmatter;
  } else {
    output = await fs.read(filePath);
  }

  const now = new Date().toISOString();
  const sizeBytes = new TextEncoder().encode(output).length;
  const sizeTokens = safeCountTokens(output);

  if (existing) {
    existing.type = 'file';
    existing.mode = mode;
    existing.pin = phase;
    existing.pin_source = 'ai';
    existing.pin_reason = reason;
    existing.pin_path = pinPath;
    existing.last_accessed_at = now;
    existing.opened_by = 'context-pin';
    existing.size_bytes = sizeBytes;
    existing.size_tokens = sizeTokens;
    existing.score = Math.max(
      existing.score ?? DEFAULT_OPEN_SCORE,
      MAX_OPEN_SCORE,
    );
    return true;
  }

  state.files.push({
    path: filePath,
    type: 'file',
    mode,
    pin: phase,
    pin_source: 'ai',
    pin_reason: reason,
    pin_path: pinPath,
    opened_at: now,
    last_accessed_at: now,
    opened_by: 'context-pin',
    size_bytes: sizeBytes,
    size_tokens: sizeTokens,
    score: MAX_OPEN_SCORE,
    ttl_ms: DEFAULT_OPEN_TTL_MS,
    expires_at: new Date(Date.now() + DEFAULT_OPEN_TTL_MS).toISOString(),
  });
  return true;
}

async function upsertAiPinnedDirectory(
  fs: OverlayFs,
  state: OpenedState,
  options: {
    dirPath: string;
    phase: 'awake' | 'nap' | 'both';
    reason: string;
  },
): Promise<boolean> {
  const { dirPath, phase, reason } = options;
  const existing = state.files.find((entry) => entry.path === dirPath);

  if (existing?.pin_source === 'system') {
    return false;
  }

  const output = await formatDirectoryWithFrontmatter(fs, dirPath);
  const now = new Date().toISOString();
  const sizeBytes = new TextEncoder().encode(output).length;
  const sizeTokens = safeCountTokens(output);

  if (existing) {
    existing.type = 'directory';
    existing.mode = undefined;
    existing.pin = phase;
    existing.pin_source = 'ai';
    existing.pin_reason = reason;
    existing.pin_path = dirPath;
    existing.last_accessed_at = now;
    existing.opened_by = 'context-pin';
    existing.size_bytes = sizeBytes;
    existing.size_tokens = sizeTokens;
    existing.score = Math.max(
      existing.score ?? DEFAULT_OPEN_SCORE,
      MAX_OPEN_SCORE,
    );
    return true;
  }

  state.files.push({
    path: dirPath,
    type: 'directory',
    pin: phase,
    pin_source: 'ai',
    pin_reason: reason,
    pin_path: dirPath,
    opened_at: now,
    last_accessed_at: now,
    opened_by: 'context-pin',
    size_bytes: sizeBytes,
    size_tokens: sizeTokens,
    score: MAX_OPEN_SCORE,
    ttl_ms: DEFAULT_OPEN_TTL_MS,
    expires_at: new Date(Date.now() + DEFAULT_OPEN_TTL_MS).toISOString(),
  });
  return true;
}

async function execContextPin(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const parsed = parseContextPinArgs(args);
  if (!parsed.path) {
    return {
      stdout: '',
      stderr:
        'context pin: missing path (usage: context pin <path> --phase <awake|nap|both> --reason "..." [--mode full|frontmatter])',
      exitCode: 1,
    };
  }
  if (!parsed.phase) {
    return {
      stdout: '',
      stderr: 'context pin: --phase is required (awake|nap|both)',
      exitCode: 1,
    };
  }
  if (!parsed.reason || parsed.reason.trim().length === 0) {
    return {
      stdout: '',
      stderr: 'context pin: --reason is required',
      exitCode: 1,
    };
  }

  const path = parsed.path;
  const kind = inferPinKind(path);
  if (!isPinAllowed(path)) {
    return {
      stdout: '',
      stderr:
        'context pin: paths under /context/logs, /handles, and /queue are runtime-managed and cannot be pinned',
      exitCode: 1,
    };
  }
  const state = await loadOpenedState(fs);
  const now = new Date().toISOString();

  const systemConflict = state.files.some((entry) => {
    if (entry.pin_source !== 'system') return false;
    if (entry.pin_path === path || entry.path === path) return true;
    if (kind === 'glob' && entry.pin_path === path) return true;
    return false;
  });

  if (systemConflict) {
    return {
      stdout: '',
      stderr: `context pin: ${path} is system-pinned and cannot be overridden`,
      exitCode: 1,
    };
  }

  if (!state.ai_pins) state.ai_pins = [];
  const existingRuleIndex = state.ai_pins.findIndex(
    (rule) => rule.path === path,
  );
  const nextRule = {
    path,
    phase: parsed.phase,
    mode: kind === 'directory' ? undefined : parsed.mode,
    reason: parsed.reason.trim(),
    created_at:
      existingRuleIndex >= 0
        ? state.ai_pins[existingRuleIndex]!.created_at
        : now,
    updated_at: now,
  };

  if (existingRuleIndex >= 0) {
    state.ai_pins[existingRuleIndex] = nextRule;
  } else {
    state.ai_pins.push(nextRule);
  }

  let pinnedCount = 0;
  try {
    if (kind === 'directory') {
      const pinned = await upsertAiPinnedDirectory(fs, state, {
        dirPath: path,
        phase: parsed.phase,
        reason: parsed.reason.trim(),
      });
      pinnedCount += pinned ? 1 : 0;
    } else if (kind === 'glob') {
      const root = path.slice(0, -2);
      let entries: Array<{ path: string; type: 'file' | 'directory' }> = [];
      try {
        entries = (await fs.list(root)).map((entry) => ({
          path: entry.path,
          type: entry.type,
        }));
      } catch {
        return {
          stdout: '',
          stderr: `context pin: ${path}: No such file or directory`,
          exitCode: 1,
        };
      }
      for (const entry of entries) {
        if (entry.type === 'directory') {
          const pinned = await upsertAiPinnedDirectory(fs, state, {
            dirPath: asDirectoryPath(entry.path),
            phase: parsed.phase,
            reason: parsed.reason.trim(),
          });
          pinnedCount += pinned ? 1 : 0;
          continue;
        }
        const pinned = await upsertAiPinnedFile(fs, state, {
          filePath: entry.path,
          pinPath: path,
          phase: parsed.phase,
          mode: parsed.mode,
          reason: parsed.reason.trim(),
        });
        pinnedCount += pinned ? 1 : 0;
      }
    } else if (kind === 'glob_recursive') {
      const root = path.slice(0, -3);
      try {
        await fs.list(root);
      } catch {
        return {
          stdout: '',
          stderr: `context pin: ${path}: No such file or directory`,
          exitCode: 1,
        };
      }
      const files = await listFilesRecursive(fs, root);
      for (const filePath of files) {
        const pinned = await upsertAiPinnedFile(fs, state, {
          filePath,
          pinPath: path,
          phase: parsed.phase,
          mode: parsed.mode,
          reason: parsed.reason.trim(),
        });
        pinnedCount += pinned ? 1 : 0;
      }
    } else {
      const pinned = await upsertAiPinnedFile(fs, state, {
        filePath: path,
        pinPath: path,
        phase: parsed.phase,
        mode: parsed.mode,
        reason: parsed.reason.trim(),
      });
      pinnedCount += pinned ? 1 : 0;
    }
  } catch (error) {
    return {
      stdout: '',
      stderr: `context pin: ${String(error)}`,
      exitCode: 1,
    };
  }

  recomputeContextTotals(state);
  await saveOpenedState(fs, state);

  return {
    stdout: `pinned: ${path} (phase=${parsed.phase}, mode=${kind === 'directory' ? 'directory' : parsed.mode}, source=ai, matched=${pinnedCount})`,
    stderr: '',
    exitCode: 0,
  };
}

async function execContextUnpin(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const path = args.find((arg) => !arg.startsWith('-'));
  if (!path) {
    return {
      stdout: '',
      stderr: 'context unpin: missing path (usage: context unpin <path>)',
      exitCode: 1,
    };
  }

  const state = await loadOpenedState(fs);

  const systemPinned = state.files.some(
    (entry) =>
      entry.pin_source === 'system' &&
      (entry.path === path || entry.pin_path === path),
  );

  const previousRules = state.ai_pins ?? [];
  const nextRules = previousRules.filter((rule) => rule.path !== path);
  const removedRules = previousRules.length - nextRules.length;
  state.ai_pins = nextRules;

  let unpinnedEntries = 0;
  for (const entry of state.files) {
    if (entry.pin_source !== 'ai') continue;
    if (entry.pin_path !== path && entry.path !== path) continue;

    entry.pin = undefined;
    entry.pin_source = undefined;
    entry.pin_reason = undefined;
    entry.pin_path = undefined;
    unpinnedEntries += 1;
  }

  if (removedRules === 0 && unpinnedEntries === 0) {
    if (systemPinned) {
      return {
        stdout: '',
        stderr: `context unpin: ${path} is system-pinned and cannot be unpinned`,
        exitCode: 1,
      };
    }
    return {
      stdout: '',
      stderr: `context unpin: ${path} is not pinned by AI`,
      exitCode: 1,
    };
  }

  recomputeContextTotals(state);
  await saveOpenedState(fs, state);

  return {
    stdout: `unpinned: ${path} (rules removed=${removedRules}, entries updated=${unpinnedEntries})`,
    stderr: '',
    exitCode: 0,
  };
}

async function execContextStatus(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const { phase } = parseContextStatusArgs(args);
  const state = await loadOpenedState(fs);

  const ratio =
    CONTEXT_MAX_TOKENS > 0 ? state.context_tokens / CONTEXT_MAX_TOKENS : 0;
  const status = determineContextStatus(ratio);
  const remaining = Math.max(0, CONTEXT_MAX_TOKENS - state.context_tokens);

  const entries = phase
    ? state.files.filter((entry) => entry.pin === phase || entry.pin === 'both')
    : state.files;

  const lines: string[] = [];
  lines.push('Context Status');
  lines.push(
    `- Usage: ${state.context_tokens}/${CONTEXT_MAX_TOKENS} tokens (${(ratio * 100).toFixed(1)}%)`,
  );
  lines.push(`- Remaining: ${remaining} tokens`);
  lines.push(`- Pressure: ${status.toUpperCase()}`);
  lines.push(`- Open entries: ${state.files.length}`);
  lines.push(`- AI pin rules: ${(state.ai_pins ?? []).length}`);
  if (phase) {
    lines.push(`- Phase filter: ${phase}`);
  }
  lines.push('');
  lines.push('Entries:');

  if (entries.length === 0) {
    lines.push('(none)');
  } else {
    const sorted = [...entries].sort((a, b) => {
      const aPinned = a.pin ? 1 : 0;
      const bPinned = b.pin ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const aTokens =
        typeof a.size_tokens === 'number'
          ? a.size_tokens
          : estimateTokensFromBytes(a.size_bytes);
      const bTokens =
        typeof b.size_tokens === 'number'
          ? b.size_tokens
          : estimateTokensFromBytes(b.size_bytes);
      return bTokens - aTokens;
    });

    for (const entry of sorted) {
      const tokens =
        typeof entry.size_tokens === 'number'
          ? entry.size_tokens
          : estimateTokensFromBytes(entry.size_bytes);
      const type = entry.type === 'directory' ? '[DIR]' : '[FILE]';
      const pinPhase = entry.pin ? `[pin:${entry.pin}]` : '[open]';
      const source = entry.pin_source ? `[${entry.pin_source}]` : '';
      const mode = entry.mode ? `[${entry.mode}]` : '';
      const reason = entry.pin_reason ? ` reason="${entry.pin_reason}"` : '';
      lines.push(
        `${type} ${entry.path} ${pinPhase}${source}${mode} (~${tokens} tokens)${reason}`,
      );
    }
  }

  return {
    stdout: lines.join('\n'),
    stderr: '',
    exitCode: 0,
  };
}

async function execContext(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case 'pin':
      return execContextPin(fs, rest);
    case 'unpin':
      return execContextUnpin(fs, rest);
    case 'status':
      return execContextStatus(fs, rest);
    default:
      return {
        stdout: '',
        stderr: 'context: unknown subcommand (use: context pin|unpin|status)',
        exitCode: 1,
      };
  }
}

/**
 * Close a file/directory from persistent context
 */
async function execClose(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'close: missing path operand', exitCode: 1 };
  }

  const path = args[0]!;
  const state = await loadOpenedState(fs);

  const index = state.files.findIndex((f) => f.path === path);
  if (index < 0) {
    return { stdout: '', stderr: `close: ${path}: not open`, exitCode: 1 };
  }

  const existing = state.files[index]!;
  if (existing.pin_source === 'system') {
    return {
      stdout: '',
      stderr: `close: ${path}: system-pinned entries cannot be closed`,
      exitCode: 1,
    };
  }
  if (existing.pin_source === 'ai') {
    return {
      stdout: '',
      stderr: `close: ${path}: pinned by AI, run context unpin ${existing.pin_path ?? path} first`,
      exitCode: 1,
    };
  }

  const removed = state.files.splice(index, 1)[0]!;

  // Capture frontmatter before losing the file reference (only .md files have frontmatter)
  let closedFrontmatter: Record<string, unknown> | undefined;
  if (removed.type === 'file' && removed.path.endsWith('.md')) {
    try {
      const content = await fs.read(removed.path);
      const { meta } = parseContextFile(content);
      // Only store if there's meaningful frontmatter beyond standard fields
      const meaningfulKeys = Object.keys(meta).filter(
        (k) =>
          !['id', 'tags', 'created', 'updated', 'updated_at'].includes(k) &&
          meta[k] !== undefined &&
          meta[k] !== null &&
          meta[k] !== '',
      );
      if (meaningfulKeys.length > 0) {
        closedFrontmatter = meta;
      }
    } catch {
      // File may have been deleted or unreadable; skip frontmatter capture
    }
  }

  state.context_bytes = state.files.reduce((sum, f) => sum + f.size_bytes, 0);
  state.context_tokens = state.files.reduce(
    (sum, f) =>
      sum +
      (typeof f.size_tokens === 'number'
        ? f.size_tokens
        : estimateTokensFromBytes(f.size_bytes)),
    0,
  );
  state.updated_at = new Date().toISOString();

  if (!state.recently_closed) {
    state.recently_closed = [];
  }
  state.recently_closed.unshift({
    path: removed.path,
    type: removed.type,
    closed_at: new Date().toISOString(),
    size_bytes: removed.size_bytes,
    size_tokens: removed.size_tokens,
    ...(closedFrontmatter ? { frontmatter: closedFrontmatter } : {}),
  });
  if (state.recently_closed.length > 20) {
    state.recently_closed = state.recently_closed.slice(0, 20);
  }

  await saveOpenedState(fs, state);

  return {
    stdout: `closed: ${removed.path} (${removed.type}, ${removed.size_bytes} bytes)`,
    stderr: '',
    exitCode: 0,
  };
}

/**
 * List currently open files/directories
 */
async function execOpened(fs: OverlayFs): Promise<ShellResult> {
  const state = await loadOpenedState(fs);

  if (state.files.length === 0) {
    return { stdout: '(no files currently open)', stderr: '', exitCode: 0 };
  }

  const lines: string[] = [];
  lines.push(`Open files: ${state.files.length}`);
  lines.push(
    `Total context: ${state.context_bytes} bytes / ${state.context_tokens} tokens`,
  );
  lines.push('');

  for (const entry of state.files) {
    const typeLabel = entry.type === 'directory' ? '[DIR]' : '[FILE]';
    const sizeLabel = `${entry.size_bytes} bytes / ${
      entry.size_tokens ?? estimateTokensFromBytes(entry.size_bytes)
    } tokens`;
    const openedByLabel = entry.opened_by ? ` (by ${entry.opened_by})` : '';
    const pinLabel = entry.pin
      ? ` [pin:${entry.pin}${entry.pin_source ? `/${entry.pin_source}` : ''}]`
      : '';
    const modeLabel = entry.mode ? ` [${entry.mode}]` : '';
    lines.push(
      `${typeLabel} ${entry.path}${modeLabel}${pinLabel} - ${sizeLabel}${openedByLabel}`,
    );
  }

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

type ReminderEntry = {
  path: string;
  meta: Record<string, unknown>;
  content: string;
};

function cronUsage(): string {
  return [
    'cron usage:',
    '  cron list',
    '  cron show <name|/context/reminders/file.md>',
    '  cron set <name> --at <time> [--text <message>] [--timezone <tz>]',
    '  cron set <name> --every <cron> [--text <message>] [--timezone <tz>]',
    '  cron snooze <name> --for <duration>',
    '  cron done <name>',
    '  cron cancel <name>',
    '  cron rm <name>',
    '',
    'duration examples: 30m, 2h, 1d, 1w',
  ].join('\n');
}

function normalizeReminderPath(
  fs: OverlayFs,
  raw: string,
): { path?: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: 'cron: missing reminder name' };
  }

  let candidate = trimmed;
  if (!candidate.startsWith('/')) {
    candidate = `${REMINDERS_ROOT}/${candidate}`;
  }
  if (!candidate.endsWith('.md')) {
    candidate = `${candidate}.md`;
  }

  const normalized = fs.normalizePath(candidate);
  if (!normalized.startsWith(`${REMINDERS_ROOT}/`)) {
    return {
      error: `cron: reminder path must be under ${REMINDERS_ROOT}`,
    };
  }

  return { path: normalized };
}

function parseDurationMs(value: string): number | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return null;

  const re = /(\d+)([smhdw])/g;
  let total = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null = re.exec(normalized);
  while (match !== null) {
    if (match.index !== lastIndex) {
      return null;
    }
    lastIndex = re.lastIndex;

    const amount = Number.parseInt(match[1] ?? '0', 10);
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    switch (unit) {
      case 's':
        total += amount * 1000;
        break;
      case 'm':
        total += amount * 60_000;
        break;
      case 'h':
        total += amount * 3_600_000;
        break;
      case 'd':
        total += amount * 86_400_000;
        break;
      case 'w':
        total += amount * 604_800_000;
        break;
      default:
        return null;
    }

    match = re.exec(normalized);
  }

  if (lastIndex !== normalized.length || total <= 0) {
    return null;
  }
  return total;
}

function parseAtTime(value: string, now = new Date()): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const relative = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  const durationMs = parseDurationMs(relative);
  if (durationMs !== null) {
    return new Date(now.getTime() + durationMs);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function computeNextCronTime(
  expression: string,
  now: Date,
  timezone?: string,
): Date | null {
  try {
    const interval = parseExpression(expression, {
      currentDate: now,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

function basenameWithoutMd(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

function reminderPreview(content: string, max = 80): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return '(empty)';
  if (firstLine.length <= max) return firstLine;
  return `${firstLine.slice(0, max - 3)}...`;
}

function stripUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      cleaned[key] = entry;
    }
  }
  return cleaned as T;
}

async function loadReminderEntry(
  fs: OverlayFs,
  path: string,
): Promise<ReminderEntry | null> {
  try {
    const raw = await fs.read(path);
    const parsed = parseContextFile(raw);
    return {
      path,
      meta: parsed.meta,
      content: parsed.content,
    };
  } catch {
    return null;
  }
}

async function saveReminderEntry(
  fs: OverlayFs,
  path: string,
  meta: Record<string, unknown>,
  content: string,
): Promise<void> {
  const now = new Date().toISOString();
  const normalizedMeta = {
    ...meta,
    id: typeof meta.id === 'string' ? meta.id : basenameWithoutMd(path),
    tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
    created: typeof meta.created === 'string' ? meta.created : now,
    updated: now,
    updated_at: now,
  };

  await fs.write(path, serializeContextFile(normalizedMeta, content));
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function execCronList(fs: OverlayFs): Promise<ShellResult> {
  let entries: FsEntry[] = [];
  try {
    entries = await fs.list(REMINDERS_ROOT);
  } catch {
    return { stdout: '(no reminders)', stderr: '', exitCode: 0 };
  }

  const reminders = entries
    .filter((entry) => entry.type === 'file' && entry.path.endsWith('.md'))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (reminders.length === 0) {
    return { stdout: '(no reminders)', stderr: '', exitCode: 0 };
  }

  const lines: string[] = ['Reminders:', ''];
  for (const reminder of reminders) {
    const loaded = await loadReminderEntry(fs, reminder.path);
    if (!loaded) continue;

    const status =
      typeof loaded.meta.status === 'string' ? loaded.meta.status : 'pending';
    const due =
      (loaded.meta.next_fire_at as string | undefined) ??
      (loaded.meta.due_at as string | undefined) ??
      '-';
    const cron = (loaded.meta.cron as string | undefined) ?? '-';
    const preview = reminderPreview(loaded.content);
    lines.push(
      `- ${basenameWithoutMd(reminder.path)} [${status}] due=${due} cron=${cron} :: ${preview}`,
    );
  }

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

async function execCronShow(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const name = args[0];
  if (!name) {
    return {
      stdout: '',
      stderr: `cron show: missing name\n${cronUsage()}`,
      exitCode: 1,
    };
  }
  const resolved = normalizeReminderPath(fs, name);
  if (!resolved.path) {
    return {
      stdout: '',
      stderr: resolved.error ?? 'cron show: invalid path',
      exitCode: 1,
    };
  }

  const loaded = await loadReminderEntry(fs, resolved.path);
  if (!loaded) {
    return {
      stdout: '',
      stderr: `cron show: ${resolved.path}: not found`,
      exitCode: 1,
    };
  }

  const lines: string[] = [`Path: ${resolved.path}`, ''];
  lines.push('Frontmatter:');
  for (const [key, value] of Object.entries(loaded.meta)) {
    if (value === undefined) continue;
    lines.push(
      `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    );
  }
  lines.push('');
  lines.push('Content:');
  lines.push(loaded.content || '(empty)');

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

async function execCronSet(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const name = args[0];
  if (!name) {
    return {
      stdout: '',
      stderr: `cron set: missing name\n${cronUsage()}`,
      exitCode: 1,
    };
  }

  const resolved = normalizeReminderPath(fs, name);
  if (!resolved.path) {
    return {
      stdout: '',
      stderr: resolved.error ?? 'cron set: invalid path',
      exitCode: 1,
    };
  }

  const atRaw = getFlagValue(args, '--at');
  const every = getFlagValue(args, '--every');
  const text = getFlagValue(args, '--text');
  const timezone = getFlagValue(args, '--timezone');

  if ((atRaw ? 1 : 0) + (every ? 1 : 0) !== 1) {
    return {
      stdout: '',
      stderr: 'cron set: specify exactly one of --at or --every',
      exitCode: 1,
    };
  }

  const now = new Date();
  const existing = await loadReminderEntry(fs, resolved.path);
  const baseMeta = existing?.meta ?? {};
  const baseContent = existing?.content ?? '';

  let dueAt: string | undefined;
  let cron: string | undefined;
  let nextFireAt: string | undefined;

  if (atRaw) {
    const when = parseAtTime(atRaw, now);
    if (!when) {
      return {
        stdout: '',
        stderr: `cron set: invalid --at value: ${atRaw}`,
        exitCode: 1,
      };
    }
    dueAt = when.toISOString();
  } else if (every) {
    const next = computeNextCronTime(every, now, timezone);
    if (!next) {
      return {
        stdout: '',
        stderr: `cron set: invalid --every cron expression: ${every}`,
        exitCode: 1,
      };
    }
    cron = every;
    nextFireAt = next.toISOString();
  }

  const content =
    text ?? (baseContent || `Reminder: ${basenameWithoutMd(resolved.path)}`);
  const nextMeta = stripUndefinedFields({
    ...baseMeta,
    status: 'pending',
    due_at: dueAt,
    cron,
    next_fire_at: nextFireAt,
    last_fired_at: undefined,
    timezone: timezone ?? (baseMeta.timezone as string | undefined),
  });

  await saveReminderEntry(fs, resolved.path, nextMeta, content);
  return {
    stdout: `saved: ${resolved.path}`,
    stderr: '',
    exitCode: 0,
  };
}

async function execCronDone(
  fs: OverlayFs,
  args: string[],
  status: 'done' | 'snoozed' = 'done',
): Promise<ShellResult> {
  const name = args[0];
  if (!name) {
    return {
      stdout: '',
      stderr: `cron: missing name\n${cronUsage()}`,
      exitCode: 1,
    };
  }
  const resolved = normalizeReminderPath(fs, name);
  if (!resolved.path) {
    return {
      stdout: '',
      stderr: resolved.error ?? 'cron: invalid path',
      exitCode: 1,
    };
  }

  const existing = await loadReminderEntry(fs, resolved.path);
  if (!existing) {
    return {
      stdout: '',
      stderr: `cron: ${resolved.path}: not found`,
      exitCode: 1,
    };
  }

  await saveReminderEntry(
    fs,
    resolved.path,
    {
      ...existing.meta,
      status,
    },
    existing.content,
  );

  return { stdout: `${status}: ${resolved.path}`, stderr: '', exitCode: 0 };
}

async function execCronSnooze(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const name = args[0];
  if (!name) {
    return {
      stdout: '',
      stderr: `cron snooze: missing name\n${cronUsage()}`,
      exitCode: 1,
    };
  }
  const resolved = normalizeReminderPath(fs, name);
  if (!resolved.path) {
    return {
      stdout: '',
      stderr: resolved.error ?? 'cron snooze: invalid path',
      exitCode: 1,
    };
  }

  const durationRaw = getFlagValue(args, '--for');
  if (!durationRaw) {
    return {
      stdout: '',
      stderr: 'cron snooze: missing --for <duration>',
      exitCode: 1,
    };
  }
  const durationMs = parseDurationMs(durationRaw);
  if (!durationMs) {
    return {
      stdout: '',
      stderr: `cron snooze: invalid duration: ${durationRaw}`,
      exitCode: 1,
    };
  }

  const existing = await loadReminderEntry(fs, resolved.path);
  if (!existing) {
    return {
      stdout: '',
      stderr: `cron snooze: ${resolved.path}: not found`,
      exitCode: 1,
    };
  }

  const next = new Date(Date.now() + durationMs).toISOString();
  const hasCron =
    typeof existing.meta.cron === 'string' && existing.meta.cron.length > 0;
  await saveReminderEntry(
    fs,
    resolved.path,
    stripUndefinedFields({
      ...existing.meta,
      status: 'pending',
      next_fire_at: next,
      due_at: hasCron ? undefined : next,
    }),
    existing.content,
  );

  return {
    stdout: `snoozed: ${resolved.path} until ${next}`,
    stderr: '',
    exitCode: 0,
  };
}

async function execCronRemove(
  fs: OverlayFs,
  args: string[],
): Promise<ShellResult> {
  const name = args[0];
  if (!name) {
    return {
      stdout: '',
      stderr: `cron rm: missing name\n${cronUsage()}`,
      exitCode: 1,
    };
  }
  const resolved = normalizeReminderPath(fs, name);
  if (!resolved.path) {
    return {
      stdout: '',
      stderr: resolved.error ?? 'cron rm: invalid path',
      exitCode: 1,
    };
  }

  try {
    await fs.delete(resolved.path);
    return { stdout: `removed: ${resolved.path}`, stderr: '', exitCode: 0 };
  } catch {
    return {
      stdout: '',
      stderr: `cron rm: ${resolved.path}: not found`,
      exitCode: 1,
    };
  }
}

async function execCron(fs: OverlayFs, args: string[]): Promise<ShellResult> {
  const subcommand = (args[0] ?? '').toLowerCase();
  const rest = args.slice(1);

  switch (subcommand) {
    case 'list':
      return execCronList(fs);
    case 'show':
      return execCronShow(fs, rest);
    case 'set':
      return execCronSet(fs, rest);
    case 'snooze':
      return execCronSnooze(fs, rest);
    case 'done':
      return execCronDone(fs, rest, 'done');
    case 'cancel':
      return execCronDone(fs, rest, 'done');
    case 'rm':
    case 'delete':
      return execCronRemove(fs, rest);
    default:
      return {
        stdout: '',
        stderr: cronUsage(),
        exitCode: 1,
      };
  }
}

// ============================================================================
// Shell Implementation
// ============================================================================

/**
 * Context shell for executing bash-like commands
 */
export class ContextShell {
  constructor(
    private fs: OverlayFs,
    private options: ContextShellOptions = {},
  ) {
    if (options.initialCwd) {
      this.fs.cd(options.initialCwd);
    }
  }

  /**
   * Execute a command string
   */
  async exec(command: string): Promise<ShellResult> {
    const parsed = parseCommand(command);

    if (!parsed.cmd) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    const readOnlyPaths = this.options.readOnlyPaths ?? [];
    if (readOnlyPaths.length > 0) {
      const blockedPath = this.findBlockedWritePath(parsed, readOnlyPaths);
      if (blockedPath) {
        return {
          stdout: '',
          stderr: `write blocked: ${blockedPath} is read-only`,
          exitCode: 1,
        };
      }
    }

    let result: ShellResult;

    switch (parsed.cmd) {
      case 'ls':
        result = await execLs(this.fs, parsed.args);
        break;
      case 'cat':
        result = await execCat(this.fs, parsed.args);
        break;
      case 'head':
        result = await execHead(this.fs, parsed.args);
        break;
      case 'tail':
        result = await execTail(this.fs, parsed.args);
        break;
      case 'grep':
        result = await execGrep(this.fs, parsed.args);
        break;
      case 'echo':
        result = await execEcho(this.fs, parsed.args, parsed.redirect);
        break;
      case 'rm':
        result = await execRm(this.fs, parsed.args);
        break;
      case 'mkdir':
        result = await execMkdir(this.fs, parsed.args);
        break;
      case 'pwd':
        result = execPwd(this.fs);
        break;
      case 'cd':
        result = execCd(this.fs, parsed.args);
        break;
      case 'find':
        result = await execFind(this.fs, parsed.args);
        break;
      case 'wc':
        result = await execWc(this.fs, parsed.args);
        break;
      case 'open':
        result = await execOpen(this.fs, parsed.args);
        break;
      case 'patch':
        result = await execPatch(this.fs, parsed.args);
        break;
      case 'close':
        result = await execClose(this.fs, parsed.args);
        break;
      case 'opened':
        result = await execOpened(this.fs);
        break;
      case 'cron':
        result = await execCron(this.fs, parsed.args);
        break;
      case 'context':
        result = await execContext(this.fs, parsed.args);
        break;
      default:
        result = {
          stdout: '',
          stderr: `${parsed.cmd}: command not found`,
          exitCode: 127,
        };
    }

    // Handle redirects for non-echo commands
    if (parsed.redirect && parsed.cmd !== 'echo') {
      try {
        if (parsed.redirect.type === '>>') {
          let existing = '';
          try {
            existing = await this.fs.read(parsed.redirect.path);
          } catch {
            // File doesn't exist
          }
          await this.fs.write(
            parsed.redirect.path,
            existing + (existing ? '\n' : '') + result.stdout,
          );
        } else {
          await this.fs.write(parsed.redirect.path, result.stdout);
        }
        result.stdout = '';
      } catch (error) {
        result.stderr = String(error);
        result.exitCode = 1;
      }
    }

    // Truncate output
    result.stdout = truncate(result.stdout);
    result.stderr = truncate(result.stderr, 10_000);

    return result;
  }

  private findBlockedWritePath(
    parsed: ParsedCommand,
    readOnlyPaths: string[],
  ): string | null {
    const writeTargets: string[] = [];

    if (parsed.redirect) {
      writeTargets.push(parsed.redirect.path);
    }

    if (parsed.cmd === 'patch' && parsed.args[0]) {
      writeTargets.push(parsed.args[0]);
    }

    if (parsed.cmd === 'rm') {
      for (const arg of parsed.args) {
        if (!arg.startsWith('-')) {
          writeTargets.push(arg);
        }
      }
    }

    if (parsed.cmd === 'cron') {
      const sub = (parsed.args[0] ?? '').toLowerCase();
      if (['set', 'snooze', 'done', 'cancel', 'rm', 'delete'].includes(sub)) {
        const target = parsed.args[1];
        if (target) {
          const resolved = normalizeReminderPath(this.fs, target);
          if (resolved.path) {
            writeTargets.push(resolved.path);
          }
        }
      }
    }

    if (writeTargets.length === 0) {
      return null;
    }

    for (const target of writeTargets) {
      if (isPathReadOnly(this.fs, target, readOnlyPaths)) {
        return this.fs.normalizePath(target);
      }
    }

    return null;
  }
}

/**
 * Create a context shell
 */
export function createContextShell(
  fs: OverlayFs,
  options: ContextShellOptions = {},
): ContextShell {
  return new ContextShell(fs, options);
}
