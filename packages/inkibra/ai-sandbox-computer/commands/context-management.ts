/**
 * Built-in context management commands.
 * See spec §8.2 — Context Management table.
 *
 * Command surface: open (non-persistent read), pin, unpin, pinned, status.
 * Persistent runtime context lives in /runtime/handles/pinned.md.
 *
 */
import { createHash } from 'node:crypto';
import {
  estimateTokensFromBytes,
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { defineCommand } from '../define-command';

const PINNED_PATH = '/runtime/handles/pinned.md';
const DEFAULT_MAX_TOKENS = 128_000;

// ---------------------------------------------------------------------------
// Pinned entry types — keep in sync with @inkibra/ai-construct/vfs/pinned.ts
// ---------------------------------------------------------------------------

type PinnedEntryKind = 'file' | 'directory' | 'glob' | 'glob_recursive';
type PinnedEntryMode = 'full' | 'frontmatter';

/**
 * Scope determines when a pin is visible.
 *   - '*'           → global (all impulse lanes + nap)
 *   - 'nap'         → nap stage only
 *   - '<lane-name>' → that specific impulse lane only
 */
type PinnedEntryScope = '*' | 'nap' | (string & {});

type PinnedEntry = {
  path: string;
  kind: PinnedEntryKind;
  mode: PinnedEntryMode;
  scope: PinnedEntryScope;
  source: 'ai';
  reason?: string;
  created_at: string;
  updated: string;
};

function inferPinnedKind(path: string): PinnedEntryKind {
  if (path.endsWith('/**')) return 'glob_recursive';
  if (path.endsWith('/*')) return 'glob';
  if (path.endsWith('/')) return 'directory';
  return 'file';
}

function parsePinnedMode(raw: unknown): PinnedEntryMode {
  return raw === 'frontmatter' ? 'frontmatter' : 'full';
}

function parseScope(raw: unknown): PinnedEntryScope {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return '*';
}

async function loadPinnedEntries(
  fs: OverlayFs,
  path: string = PINNED_PATH,
): Promise<PinnedEntry[]> {
  try {
    const parsed = parseContextFile(await fs.read(path));
    return Array.isArray(parsed.meta.pins)
      ? (parsed.meta.pins as PinnedEntry[])
      : [];
  } catch {
    return [];
  }
}

async function savePinnedEntries(
  fs: OverlayFs,
  pins: PinnedEntry[],
  path: string = PINNED_PATH,
): Promise<void> {
  const now = new Date().toISOString();
  let existingContent = '';
  let existingMeta: Record<string, unknown> = {};

  try {
    const parsed = parseContextFile(await fs.read(path));
    existingContent = parsed.content;
    existingMeta = parsed.meta;
  } catch {
    // create new state file
  }

  const normalizedPins = pins.map((entry) => {
    const anyPin = entry as unknown as Record<string, unknown>;
    const updated =
      typeof anyPin.updated === 'string' && anyPin.updated.length > 0
        ? (anyPin.updated as string)
        : now;
    const normalized: PinnedEntry = {
      path: String(anyPin.path ?? ''),
      kind: anyPin.kind as PinnedEntryKind,
      mode: anyPin.mode as PinnedEntryMode,
      scope: anyPin.scope as PinnedEntryScope,
      source: 'ai',
      ...(typeof anyPin.reason === 'string' ? { reason: anyPin.reason } : {}),
      created_at:
        typeof anyPin.created_at === 'string' &&
        (anyPin.created_at as string).length > 0
          ? (anyPin.created_at as string)
          : now,
      updated,
    };
    return normalized as unknown as Record<string, unknown>;
  });

  await fs.write(
    path,
    serializeContextFile(
      {
        ...existingMeta,
        id:
          typeof existingMeta.id === 'string'
            ? existingMeta.id
            : 'runtime-pinned',
        tags: Array.isArray(existingMeta.tags)
          ? (existingMeta.tags as string[])
          : ['runtime', 'handles'],
        created:
          typeof existingMeta.created === 'string' ? existingMeta.created : now,
        updated: now,
        pins: normalizedPins,
      },
      existingContent,
    ),
  );
}

async function measurePinnedEntries(
  fs: OverlayFs,
  entries: PinnedEntry[],
): Promise<{ totalBytes: number; totalTokens: number }> {
  let totalBytes = 0;
  let totalTokens = 0;

  for (const entry of entries) {
    if (entry.kind !== 'file') {
      continue;
    }

    try {
      const content = await fs.read(entry.path);
      const rendered =
        entry.mode === 'frontmatter'
          ? (content.split('\n---\n')[0] ?? '')
          : content;
      const bytes = new TextEncoder().encode(rendered).length;
      totalBytes += bytes;
      totalTokens += estimateTokensFromBytes(bytes);
    } catch {
      // Skip missing entries; list/status should stay best-effort.
    }
  }

  return { totalBytes, totalTokens };
}

export type OpenCommandResult =
  | {
      path: string;
      type: 'file';
      mode: string;
      bytes: number;
      tokens: number;
      sha256: string;
      content: string;
    }
  | {
      path: string;
      type: 'directory';
      mode: string;
      entries: Array<{
        name: string;
        path: string;
        type: 'file' | 'directory';
      }>;
      bytes: number;
      tokens: number;
    };

// ---------------------------------------------------------------------------
// open — Non-persistent content read (does NOT mutate runtime state)
// ---------------------------------------------------------------------------

export const openCommand = defineCommand({
  name: 'open',
  description:
    'Read file/dir content into context (non-persistent). Supports globs: dir/*, dir/**.',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File or directory path (supports globs)',
    },
    mode: {
      type: 'string',
      flag: '--mode',
      default: 'full',
      description: 'Read mode: full or frontmatter',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    const mode = (parsed.mode as string) || 'full';

    try {
      const content = await ctx.fs.read(path);
      const rendered =
        mode === 'frontmatter' ? (content.split('\n---\n')[0] ?? '') : content;
      const bytes = new TextEncoder().encode(rendered).length;
      const tokens = estimateTokensFromBytes(bytes);
      const sha256 = createHash('sha256').update(rendered).digest('hex');
      return {
        path,
        type: 'file' as const,
        mode,
        bytes,
        tokens,
        sha256,
        content: rendered,
      } satisfies OpenCommandResult;
    } catch {
      const entries = await ctx.fs.list(path);
      return {
        path,
        type: 'directory' as const,
        mode,
        entries: entries.map((e) => ({
          name: e.name,
          path: e.path,
          type: e.type,
        })),
        bytes: 0,
        tokens: 0,
      } satisfies OpenCommandResult;
    }
  },
  render(result) {
    if (result.type === 'directory') {
      return `Opened directory ${result.path} (${result.entries.length} entries) [not pinned]`;
    }
    return `Opened ${result.path} (${result.bytes}b, ~${result.tokens} tokens, sha256=${result.sha256}) [not pinned]`;
  },
});

// ---------------------------------------------------------------------------
// pin — Write scoped entry to /runtime/handles/pinned.md
// ---------------------------------------------------------------------------

export const pinCommand = defineCommand({
  name: 'pin',
  description:
    'Pin file into persistent runtime context (/runtime/handles/pinned.md). Survives LRU eviction.',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File path to pin',
    },
    scope: {
      type: 'string',
      position: 1,
      default: '*',
      description: 'Visibility scope: * (global, default), nap, or a lane name',
    },
    reason: {
      type: 'string',
      flag: '--reason',
      description: 'Reason for pinning',
    },
    mode: {
      type: 'string',
      flag: '--mode',
      default: 'full',
      description: 'Pin mode: full or frontmatter',
    },
  },
  async fn(parsed, ctx) {
    const now = new Date().toISOString();
    const path = parsed.path as string;
    const scope = parseScope(parsed.scope);
    const mode = parsePinnedMode(parsed.mode);
    const reason = parsed.reason as string | undefined;
    const pins = await loadPinnedEntries(ctx.fs);
    const nextEntry: PinnedEntry = {
      path,
      kind: inferPinnedKind(path),
      mode,
      scope,
      source: 'ai',
      reason,
      created_at: now,
      updated: now,
    };
    // Dedup key: (path, scope)
    const deduped = pins.filter(
      (entry) =>
        !(entry.path === nextEntry.path && entry.scope === nextEntry.scope),
    );
    deduped.push(nextEntry);
    await savePinnedEntries(ctx.fs, deduped);
    return { pinned: path, scope, reason, mode };
  },
  render(result) {
    const parts = [`Pinned ${result.pinned} (scope: ${result.scope})`];
    if (result.reason) parts.push(`reason: ${result.reason}`);
    if (result.mode === 'frontmatter') parts.push('(frontmatter only)');
    return parts.join(' ');
  },
});

// ---------------------------------------------------------------------------
// unpin — Remove scoped entry from pinned state (symmetrical with pin)
// ---------------------------------------------------------------------------

export const unpinCommand = defineCommand({
  name: 'unpin',
  description:
    'Remove persistent pin from /runtime/handles/pinned.md by (path, scope).',
  args: {
    path: {
      type: 'string',
      position: 0,
      required: true,
      description: 'File path to unpin',
    },
    scope: {
      type: 'string',
      position: 1,
      default: '*',
      description: 'Visibility scope: * (global, default), nap, or a lane name',
    },
  },
  async fn(parsed, ctx) {
    const path = parsed.path as string;
    const scope = parseScope(parsed.scope);
    const pins = await loadPinnedEntries(ctx.fs);
    const remaining = pins.filter(
      (entry) => !(entry.path === path && entry.scope === scope),
    );
    await savePinnedEntries(ctx.fs, remaining);
    return { unpinned: path, scope, removed: pins.length - remaining.length };
  },
  render(result) {
    return `Unpinned ${result.unpinned} (scope: ${result.scope})`;
  },
});

// ---------------------------------------------------------------------------
// pinned — List entries in /runtime/handles/pinned.md
// ---------------------------------------------------------------------------

export const pinnedCommand = defineCommand({
  name: 'pinned',
  description:
    'List pinned runtime context entries from /runtime/handles/pinned.md',
  args: {
    scope: {
      type: 'string',
      flag: '--scope',
      description: 'Filter by scope (omit for all)',
    },
  },
  async fn(parsed, ctx) {
    const scope = parsed.scope as string | undefined;
    const pins = await loadPinnedEntries(ctx.fs);
    if (!scope) return pins;
    return pins.filter((entry) => entry.scope === scope || entry.scope === '*');
  },
  render(result) {
    if (result.length === 0) return 'No pinned entries';
    const lines = ['Pinned entries:'];
    for (const entry of result) {
      const mode = entry.mode === 'frontmatter' ? ' (frontmatter)' : '';
      lines.push(`  ${entry.path}  scope:${entry.scope}${mode}`);
    }
    return lines.join('\n');
  },
});

// ---------------------------------------------------------------------------
// status — Context pressure view
// ---------------------------------------------------------------------------

type ContextStatus = {
  pinnedFiles: number;
  totalBytes: number;
  totalTokens: number;
  maxTokens: number;
  ratio: number;
  status: 'ok' | 'warning' | 'critical';
};

export const statusCommand = defineCommand({
  name: 'status',
  description: 'Context pressure view (tokens used, budget, pinned files)',
  args: {},
  async fn(_parsed, ctx) {
    const pins = await loadPinnedEntries(ctx.fs);
    const { totalBytes, totalTokens } = await measurePinnedEntries(
      ctx.fs,
      pins,
    );
    const ratio = totalTokens / DEFAULT_MAX_TOKENS;
    const status: ContextStatus['status'] =
      ratio >= 0.9 ? 'critical' : ratio >= 0.75 ? 'warning' : 'ok';

    return {
      pinnedFiles: pins.length,
      totalBytes,
      totalTokens,
      maxTokens: DEFAULT_MAX_TOKENS,
      ratio,
      status,
    } satisfies ContextStatus;
  },
  render(result) {
    const pct = Math.round(result.ratio * 100);
    const lines = [
      `Context status: ${result.status}`,
      `  Pinned files: ${result.pinnedFiles}`,
      `  Tokens: ~${result.totalTokens.toLocaleString()} / ${result.maxTokens.toLocaleString()} (${pct}%)`,
      `  Bytes: ${result.totalBytes.toLocaleString()}`,
    ];
    return lines.join('\n');
  },
});

export const contextManagementCommands = [
  openCommand,
  pinCommand,
  unpinCommand,
  pinnedCommand,
  statusCommand,
];
