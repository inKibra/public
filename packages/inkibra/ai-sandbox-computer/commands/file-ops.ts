/**
 * Built-in file operation commands.
 * See spec §8.2 — File Operations table.
 */

import { defineCommand } from '../define-command';

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

export const readCommand = defineCommand({
  name: 'read',
  description: 'Read a file, optionally first/last N lines',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File path',
    },
    head: { type: 'number', flag: '--head', description: 'First N lines' },
    tail: { type: 'number', flag: '--tail', description: 'Last N lines' },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    const content = await ctx.fs.read(path);
    const lines = content.split('\n');

    if (typeof parsed.head === 'number') {
      return lines.slice(0, parsed.head).join('\n');
    }
    if (typeof parsed.tail === 'number') {
      return lines.slice(-parsed.tail).join('\n');
    }
    return content;
  },
  render(result) {
    const lines = result.split('\n');
    return lines
      .map((line, i) => `${String(i + 1).padStart(4)}: ${line}`)
      .join('\n');
  },
});

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

export const writeCommand = defineCommand({
  name: 'write',
  description: 'Create or overwrite a file',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File path',
    },
    content: {
      type: 'string',
      position: 1,
      required: true,
      description: 'File content',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    const content = parsed.content as string;
    await ctx.fs.write(path, content);
    const bytes = new TextEncoder().encode(content).length;
    return { path, bytes };
  },
  render(result) {
    return `Wrote ${result.bytes} bytes to ${result.path}`;
  },
});

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

export const editCommand = defineCommand({
  name: 'edit',
  description: 'Targeted string replacement in a file',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File path',
    },
    old: {
      type: 'string',
      position: 1,
      required: true,
      description: 'Text to find',
    },
    new: {
      type: 'string',
      position: 2,
      required: true,
      description: 'Replacement text',
    },
    count: {
      type: 'number',
      flag: '--count',
      description: 'Max replacements (default: all)',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    const oldText = parsed.old as string;
    const newText = parsed.new as string;
    const maxCount = parsed.count as number | undefined;

    if (!oldText) {
      throw new Error('edit: search text must not be empty');
    }

    const content = await ctx.fs.read(path);

    let replacements = 0;
    let result = content;

    if (maxCount !== undefined) {
      let pos = 0;
      let output = '';
      while (replacements < maxCount) {
        const idx = result.indexOf(oldText, pos);
        if (idx === -1) break;
        output += result.slice(pos, idx) + newText;
        pos = idx + oldText.length;
        replacements++;
      }
      output += result.slice(pos);
      result = output;
    } else {
      // Replace all occurrences
      const parts = result.split(oldText);
      replacements = parts.length - 1;
      result = parts.join(newText);
    }

    if (replacements === 0) {
      throw new Error(`edit: text not found in ${path}`);
    }

    await ctx.fs.write(path, result);
    return { path, replacements };
  },
  render(result) {
    return `${result.replacements} replacement${result.replacements === 1 ? '' : 's'} in ${result.path}`;
  },
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

type ListEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
};

export const listCommand = defineCommand({
  name: 'list',
  description: 'List directory contents',
  args: {
    path: {
      type: 'string',
      position: 0,
      default: '.',
      description: 'Directory path',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    const entries = await ctx.fs.list(path);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
      size: e.size,
    })) as ListEntry[];
  },
  render(result) {
    if (result.length === 0) return '(empty directory)';
    return result
      .map((e: ListEntry) => {
        const prefix = e.type === 'directory' ? 'd ' : '  ';
        const size = e.size != null ? `  ${e.size}b` : '';
        return `${prefix}${e.name}${size}`;
      })
      .join('\n');
  },
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

type SearchMatch = {
  path: string;
  line: number;
  text: string;
};

export const searchCommand = defineCommand({
  name: 'search',
  description: 'Search file contents by pattern',
  args: {
    pattern: {
      type: 'string',
      position: 0,
      required: true,
      description: 'Search pattern (regex)',
    },
    path: {
      type: 'string',
      position: 1,
      default: '/',
      description: 'Directory to search',
    },
    recursive: {
      type: 'boolean',
      flag: '--recursive',
      default: true,
      description: 'Search recursively',
    },
  },
  async fn(parsed, ctx) {
    const pattern = new RegExp(parsed.pattern as string, 'i');
    const searchPath = parsed.path as string;
    const matches: SearchMatch[] = [];

    async function searchDir(dir: string) {
      const entries = await ctx.fs.list(dir);
      for (const entry of entries) {
        if (entry.type === 'directory') {
          if (parsed.recursive) {
            await searchDir(entry.path);
          }
        } else {
          try {
            const content = await ctx.fs.read(entry.path);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (pattern.test(lines[i]!)) {
                matches.push({
                  path: entry.path,
                  line: i + 1,
                  text: lines[i]!,
                });
              }
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    await searchDir(searchPath);
    return matches;
  },
  render(result) {
    if (result.length === 0) return 'No matches found';
    return result
      .map((m: SearchMatch) => `${m.path}:${m.line}: ${m.text}`)
      .join('\n');
  },
});

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

export const findCommand = defineCommand({
  name: 'find',
  description: 'Find files by name pattern',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'Root directory',
    },
    name: {
      type: 'string',
      flag: '--name',
      description: 'Glob pattern to match',
    },
  },
  async fn(parsed, ctx) {
    const rootPath = parsed.path as string;
    const namePattern = parsed.name as string | undefined;
    const found: string[] = [];

    const regex = namePattern
      ? new RegExp(
          `^${namePattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`,
        )
      : undefined;

    async function walk(dir: string) {
      const entries = await ctx.fs.list(dir);
      for (const entry of entries) {
        if (!regex || regex.test(entry.name)) {
          found.push(entry.path);
        }
        if (entry.type === 'directory') {
          await walk(entry.path);
        }
      }
    }

    await walk(rootPath);
    return found;
  },
  render(result) {
    if (result.length === 0) return 'No files found';
    return result.join('\n');
  },
});

// ---------------------------------------------------------------------------
// stat
// ---------------------------------------------------------------------------

type FileStat = {
  path: string;
  size: number;
  lines: number;
  words: number;
};

export const statCommand = defineCommand({
  name: 'stat',
  description: 'File metadata (size, lines, words)',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File path',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    const content = await ctx.fs.read(path);
    const size = new TextEncoder().encode(content).length;
    const lines = content.split('\n').length;
    const words = content.split(/\s+/).filter(Boolean).length;
    return { path, size, lines, words } as FileStat;
  },
  render(result) {
    return `${result.path}: ${result.size} bytes, ${result.lines} lines, ${result.words} words`;
  },
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

export const removeCommand = defineCommand({
  name: 'remove',
  description: 'Delete a file',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File path',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    await ctx.fs.delete(path);
    return { removed: path };
  },
  render(result) {
    return `Removed ${result.removed}`;
  },
});

// ---------------------------------------------------------------------------
// mkdir
// ---------------------------------------------------------------------------

export const mkdirCommand = defineCommand({
  name: 'mkdir',
  description: 'Create directory (recursive)',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'Directory path',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    // OverlayFs creates directories implicitly on write,
    // but we create a placeholder to ensure the dir exists in listings
    const placeholder = path.endsWith('/') ? `${path}.keep` : `${path}/.keep`;
    try {
      await ctx.fs.read(placeholder);
    } catch {
      await ctx.fs.write(placeholder, '');
    }
    return { created: path };
  },
  render(result) {
    return `Created ${result.created}`;
  },
});

// ---------------------------------------------------------------------------
// Register all built-in file commands
// ---------------------------------------------------------------------------

export const fileOperationCommands = [
  readCommand,
  writeCommand,
  editCommand,
  listCommand,
  searchCommand,
  findCommand,
  statCommand,
  removeCommand,
  mkdirCommand,
];
