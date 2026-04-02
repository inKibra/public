/**
 * VFS Loader
 *
 * Utilities for loading and parsing the construct's VFS content.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import { parseContextFile } from '@inkibra/ai-flow';
import type { ImpulseLogEntry } from '../impulse/types';
import type { ScheduledResponse } from '../scheduler/types';
import { formatRelativeTime, replaceIsoTimestamps } from '../utils/time';
import { parseFeedbackLog, parseSteeringLog } from './feedback';
import { projectTimelineEntriesFromLaneLogFile } from './lane-logs';
import { LOG_LOAD_ORDER, parseLogType, VFS_PATHS } from './layout';
import { getLatestLogPath, listLogEntriesRecursive } from './logs';
import {
  loadOpenedState,
  type OpenedFileEntry,
  type OpenedFilesState,
} from './opened';
import type { TranscriptRole } from './transcript';
import { readDerivedTranscriptEntries } from './transcript';

export type { OpenedFileEntry, OpenedFilesState };

/**
 * Loaded content of an opened file or directory.
 */
export type OpenedFileContent = {
  path: string;
  type: 'file' | 'directory';
  mode?: 'full' | 'frontmatter';
  content: string;
  meta?: Record<string, unknown>;
  size_bytes: number;
  size_tokens?: number;
};

type ResolvedOpenedFileView = OpenedFileContent & {
  type: 'file';
  source: 'direct' | 'directory';
};

type ResolvedOpenedFileCandidate = {
  path: string;
  mode: 'full' | 'frontmatter';
  source: 'direct' | 'directory';
  priority: 1 | 2 | 3;
  size_tokens?: number;
};

/**
 * Context for opened files.
 */
export type OpenedFilesContext = {
  state: OpenedFilesState;
  contents: OpenedFileContent[];
  totalBytes: number;
};

/**
 * Accumulated context loaded from the VFS.
 */
export type AccumulatedContext = {
  /** Logs in load order */
  logs: {
    internal: ImpulseLogEntry[];
    background: ImpulseLogEntry[];
    conversation: ImpulseLogEntry[];
  };

  /** Opened files (files/directories currently loaded into context) */
  openedFiles: OpenedFilesContext;

  /** Scheduled responses */
  scheduledResponses: ScheduledResponse[];
};

/**
 * Parse a log file into entries.
 */
export function parseLogFile(content: string): ImpulseLogEntry[] {
  if (!content.trim()) {
    return [];
  }

  const entries: ImpulseLogEntry[] = [];
  const blocks = content.split(/\n---\n/).filter(Boolean);

  for (const block of blocks) {
    const entry = parseLogEntry(block);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Parse a single log entry block.
 */
function parseLogEntry(block: string): ImpulseLogEntry | null {
  const lines = block.trim().split('\n');
  if (lines.length === 0) return null;

  // Parse header line: [timestamp] impulse-id
  const headerMatch = lines[0]?.match(/^\[([^\]]+)\]\s+(\S+)/);
  if (!headerMatch) return null;

  const timestamp = new Date(headerMatch[1]!);
  const impulseId = headerMatch[2]!;

  // Parse metadata lines
  let from = '';
  let regarding: string | undefined;
  let trigger = '';
  let thinkingStartLine = 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('from: ')) {
      from = line.slice(6);
    } else if (line.startsWith('regarding: ')) {
      regarding = line.slice(11);
    } else if (line.startsWith('trigger: ')) {
      trigger = line.slice(9);
    } else if (!line.startsWith('---') && line.trim()) {
      thinkingStartLine = i;
      break;
    }
  }

  const bodyLines = lines.slice(thinkingStartLine);
  const { thinking, toolLines } = splitThinkingAndTools(bodyLines);

  // Parse actions from thinking
  const actions = parseActionsFromThinking(thinking);
  const toolHistory = parseToolHistory(toolLines, timestamp);

  return {
    timestamp,
    impulseId,
    from,
    regarding,
    trigger,
    thinking,
    actions,
    toolHistory: toolHistory.length > 0 ? toolHistory : undefined,
  };
}

function splitThinkingAndTools(lines: string[]): {
  thinking: string;
  toolLines: string[];
} {
  const toolsIndex = lines.findIndex((line) => line.trim() === '[tools]');
  if (toolsIndex === -1) {
    return { thinking: lines.join('\n').trim(), toolLines: [] };
  }

  const thinkingLines = lines.slice(0, toolsIndex);
  while (
    thinkingLines.length > 0 &&
    !thinkingLines[thinkingLines.length - 1]?.trim()
  ) {
    thinkingLines.pop();
  }

  return {
    thinking: thinkingLines.join('\n').trim(),
    toolLines: lines.slice(toolsIndex + 1),
  };
}

function parseToolHistory(
  lines: string[],
  timestamp: Date,
): NonNullable<ImpulseLogEntry['toolHistory']> {
  const toolHistory: NonNullable<ImpulseLogEntry['toolHistory']> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;

    const match = trimmed.match(/^-\s*([^:]+):\s*(.*?)\s*=>\s*(.*)$/);
    if (!match) continue;

    toolHistory.push({
      tool: match[1]!.trim(),
      command: match[2]!.trim(),
      output: match[3]!.trim(),
      timestamp,
    });
  }

  return toolHistory;
}

/**
 * Parse action markers from thinking text.
 */
function parseActionsFromThinking(
  thinking: string,
): ImpulseLogEntry['actions'] {
  const actions: ImpulseLogEntry['actions'] = [];

  // Match [opening path]
  const openMatches = thinking.matchAll(/\[opening\s+([^\]]+)\]/g);
  for (const match of openMatches) {
    actions.push({ type: 'open_file', path: match[1]! });
  }

  // Match [closing path]
  const closeMatches = thinking.matchAll(/\[closing\s+([^\]]+)\]/g);
  for (const match of closeMatches) {
    actions.push({ type: 'close_file', path: match[1]! });
  }

  // Match [writing to path: content] or [updating path]
  const writeMatches = thinking.matchAll(
    /\[(?:writing to|updating)\s+([^\]:]+)(?::\s*([^\]]*))?\]/g,
  );
  for (const match of writeMatches) {
    actions.push({
      type: 'write_file',
      path: match[1]!,
      content: match[2] ?? '',
    });
  }

  // Match [scheduling response: intent, mode]
  const scheduleMatches = thinking.matchAll(
    /\[scheduling response:\s*([^,\]]+)(?:,\s*(waitForIdle|wait-for-impulses|urgent))?(?:,\s*clear_others)?\]/g,
  );
  for (const match of scheduleMatches) {
    const rawMode = (match[2] as string | undefined) ?? 'waitForIdle';
    actions.push({
      type: 'schedule_response',
      intent: match[1]!.trim(),
      urgency: rawMode === 'urgent' ? 'urgent' : 'normal',
    });
  }

  // Match [spawning sub-agent: task] or [spawning subflow: task]
  const spawnMatches = thinking.matchAll(
    /\[spawning\s+(?:sub-agent|subflow):\s*([^\]]+)\]/g,
  );
  for (const match of spawnMatches) {
    actions.push({ type: 'spawn_subflow', task: match[1]! });
  }

  // Match [linking to impulse-id: relationship]
  const linkMatches = thinking.matchAll(
    /\[linking(?:\s+to)?\s+(impulse-\d+):\s*([^\]]+)\]/g,
  );
  for (const match of linkMatches) {
    actions.push({
      type: 'link_impulse',
      targetId: match[1]!,
      relationship: match[2]!,
    });
  }

  return actions;
}

/**
 * Load accumulated context from the VFS.
 */
export async function loadAccumulatedContext(
  vfs: OverlayFs,
): Promise<AccumulatedContext> {
  // Load logs in order (latest file per type)
  const logs = {
    internal: [] as ImpulseLogEntry[],
    background: [] as ImpulseLogEntry[],
    conversation: [] as ImpulseLogEntry[],
  };

  for (const type of LOG_LOAD_ORDER) {
    if (type in logs) {
      logs[type as keyof typeof logs] = await loadLatestLogFile(vfs, type);
    }
  }

  // Load opened files
  const openedFiles = await loadOpenedFiles(vfs);

  // Load scheduled responses
  const scheduledResponses = await loadScheduledResponses(vfs);

  return {
    logs,
    openedFiles,
    scheduledResponses,
  };
}

/**
 * Load the latest log file for an impulse type.
 */
async function loadLatestLogFile(
  vfs: OverlayFs,
  type: string,
): Promise<ImpulseLogEntry[]> {
  try {
    const latest = await getLatestLogPath(vfs, type);
    if (!latest) return [];
    const content = await vfs.read(latest);
    const parsed = parseContextFile(content);
    return parseLogFile(parsed.content);
  } catch {
    return [];
  }
}

/**
 * Load scheduled responses from VFS.
 */
async function loadScheduledResponses(
  vfs: OverlayFs,
): Promise<ScheduledResponse[]> {
  try {
    const content = await vfs.read(VFS_PATHS.state.scheduledResponses);
    const { meta } = parseContextFile(content);
    const scheduled =
      (meta.scheduled as Array<Record<string, unknown>> | undefined) ?? [];
    return scheduled.map(normalizeScheduledResponse);
  } catch {
    return [];
  }
}

function normalizeScheduledResponse(
  entry: Record<string, unknown>,
): ScheduledResponse {
  const waitForIdleTargets = Array.isArray(entry.waitForIdleTargets)
    ? (entry.waitForIdleTargets as {
        kind: 'pool' | 'profile';
        name: string;
      }[])
    : Array.isArray(entry.waitFor)
      ? (entry.waitFor as string[]).map((pool) => ({
          kind: 'pool' as const,
          name: pool,
        }))
      : undefined;

  return {
    id: String(entry.id ?? ''),
    scheduledBy: String(entry.scheduledBy ?? ''),
    intent: String(entry.intent ?? ''),
    urgency: ['none', 'defer', 'low', 'normal', 'urgent', 'now'].includes(
      String(entry.urgency ?? ''),
    )
      ? (String(entry.urgency) as ScheduledResponse['urgency'])
      : 'normal',
    waitForIdleTargets,
    scheduledAt: new Date(
      String(entry.scheduledAt ?? new Date().toISOString()),
    ),
  };
}

// loadOpenedState imported from ./opened

/**
 * Load opened files and their contents.
 */
export async function loadOpenedFiles(
  vfs: OverlayFs,
): Promise<OpenedFilesContext> {
  const state = await loadOpenedState(vfs);
  const contents: OpenedFileContent[] = [];

  for (const entry of state.files) {
    try {
      if (entry.type === 'file') {
        const fileView = await loadFileView(vfs, entry.path, entry.mode);
        contents.push({
          path: entry.path,
          type: 'file',
          mode: entry.mode,
          content: fileView.content,
          meta: fileView.meta,
          size_bytes: new TextEncoder().encode(fileView.content).length,
          size_tokens: entry.size_tokens,
        });
      } else if (entry.type === 'directory') {
        const listing = await loadDirectoryWithFrontmatter(vfs, entry.path);
        contents.push({
          path: entry.path,
          type: 'directory',
          mode: entry.mode,
          content: listing,
          size_bytes: new TextEncoder().encode(listing).length,
          size_tokens: entry.size_tokens,
        });
      }
    } catch {
      // File may have been deleted, skip it
    }
  }

  return {
    state,
    contents,
    totalBytes: contents.reduce((sum, c) => sum + c.size_bytes, 0),
  };
}

type LoadedFileView = {
  content: string;
  meta?: Record<string, unknown>;
};

async function loadFileView(
  vfs: OverlayFs,
  path: string,
  mode?: 'full' | 'frontmatter',
): Promise<LoadedFileView> {
  const raw = await vfs.read(path);
  const parsed = safeParseContextFile(raw);

  if (mode === 'frontmatter') {
    return {
      content: renderFrontmatterSummary(parsed?.meta),
      meta: parsed?.meta,
    };
  }

  return {
    content: raw,
    meta: parsed?.meta,
  };
}

function safeParseContextFile(
  content: string,
): ReturnType<typeof parseContextFile> | null {
  if (!content.trim().startsWith('---')) {
    return null;
  }
  try {
    return parseContextFile(content);
  } catch {
    return null;
  }
}

function renderFrontmatterSummary(meta?: Record<string, unknown>): string {
  if (!meta) {
    return '  (no frontmatter)';
  }

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

  return frontmatterLines.length > 0
    ? frontmatterLines.join('\n')
    : '  (no frontmatter)';
}

/**
 * Load a directory listing with frontmatter for all files.
 */
async function loadDirectoryWithFrontmatter(
  vfs: OverlayFs,
  dirPath: string,
): Promise<string> {
  const entries = await vfs.list(dirPath);
  const lines: string[] = [];

  lines.push(`Directory: ${dirPath}`);
  lines.push(`Files: ${entries.filter((e) => e.type === 'file').length}`);
  lines.push(
    `Subdirectories: ${entries.filter((e) => e.type === 'directory').length}`,
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const entry of entries) {
    if (entry.type === 'directory') {
      lines.push(`[DIR] ${entry.name}/`);
    } else {
      lines.push(`[FILE] ${entry.name}`);
      try {
        const content = await vfs.read(entry.path);
        lines.push(
          renderFrontmatterSummary(safeParseContextFile(content)?.meta),
        );
      } catch {
        lines.push('  (could not read frontmatter)');
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
/**
 * Get the combined log content for response generation.
 * Logs are concatenated in load order (internal, background, conversation).
 */
export function getCombinedLogContent(
  context: AccumulatedContext,
  options: { now?: Date; timeZone?: string } = {},
): string {
  const entries = collectOpenLogEntries(context.openedFiles.contents);
  if (entries.length === 0) {
    return '';
  }

  const sorted = entries.sort(
    (a, b) => a.entry.timestamp.getTime() - b.entry.timestamp.getTime(),
  );

  const lines: string[] = [];
  for (const item of sorted) {
    lines.push(formatLogEntry(item.entry, item.logType, options));
  }

  return lines.join('\n');
}

export type OpenFilesRenderOptions = {
  now?: Date;
  timeZone?: string;
  visibility?: LogVisibility;
  title?: string;
};

export type PinnedOpenFilesRenderOptions = OpenFilesRenderOptions & {
  includeLogs?: boolean;
};

export type ActiveScheduledSummaryOptions = {
  now?: Date;
  timeZone?: string;
  maxScheduled?: number;
};

export type RecentLogSummaryOptions = {
  now?: Date;
  timeZone?: string;
  visibility?: LogVisibility;
  minutes?: number;
  maxItems?: number;
  title?: string;
};

export type TranscriptWindowOptions = {
  now?: Date;
  timeZone?: string;
  minutes?: number;
  minItems?: number;
  maxItems?: number;
  roles?: TranscriptRole[];
  title?: string;
};

export async function renderPinnedOpenFilesContext(
  vfs: OverlayFs,
  options: PinnedOpenFilesRenderOptions = {},
): Promise<string> {
  const openedFiles = await loadOpenedFiles(vfs);
  const pinnedPaths = new Set(
    openedFiles.state.files
      .filter((entry) => entry.pin)
      .map((entry) => entry.path),
  );
  const includeLogs = options.includeLogs ?? false;
  const filtered = openedFiles.contents.filter((entry) => {
    if (!pinnedPaths.has(entry.path)) return false;
    if (includeLogs) return true;
    return !isLogPath(entry.path);
  });
  if (filtered.length === 0) {
    return '';
  }

  return renderOpenFilesContext(
    {
      logs: { internal: [], background: [], conversation: [] },
      openedFiles: {
        ...openedFiles,
        contents: filtered,
        totalBytes: filtered.reduce((sum, entry) => sum + entry.size_bytes, 0),
      },
      scheduledResponses: [],
    },
    {
      ...options,
      title: options.title ?? 'Pinned Context',
    },
  );
}

function getOpenedEntryPriority(
  candidate: ResolvedOpenedFileCandidate,
): 1 | 2 | 3 {
  return candidate.priority;
}

async function resolveOpenedFileViews(
  vfs: OverlayFs,
): Promise<ResolvedOpenedFileView[]> {
  const state = await loadOpenedState(vfs);
  const candidatesByPath = new Map<string, ResolvedOpenedFileCandidate>();

  const addCandidate = (candidate: ResolvedOpenedFileCandidate) => {
    const existing = candidatesByPath.get(candidate.path);
    if (
      !existing ||
      getOpenedEntryPriority(candidate) > getOpenedEntryPriority(existing)
    ) {
      candidatesByPath.set(candidate.path, candidate);
    }
  };

  for (const entry of state.files) {
    if (entry.type === 'file') {
      addCandidate({
        path: entry.path,
        mode: entry.mode === 'frontmatter' ? 'frontmatter' : 'full',
        source: 'direct',
        priority: entry.mode === 'frontmatter' ? 2 : 3,
        size_tokens: entry.size_tokens,
      });
      continue;
    }

    try {
      const children = await vfs.list(entry.path);
      for (const child of children) {
        if (child.type !== 'file') {
          continue;
        }
        addCandidate({
          path: child.path,
          mode: 'frontmatter',
          source: 'directory',
          priority: 1,
        });
      }
    } catch {
      // Ignore unreadable directories.
    }
  }

  const resolved: ResolvedOpenedFileView[] = [];
  for (const candidate of Array.from(candidatesByPath.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    try {
      const view = await loadFileView(vfs, candidate.path, candidate.mode);
      resolved.push({
        path: candidate.path,
        type: 'file',
        mode: candidate.mode,
        content: view.content,
        meta: view.meta,
        size_bytes: new TextEncoder().encode(view.content).length,
        size_tokens: candidate.size_tokens,
        source: candidate.source,
      });
    } catch {
      // File may have been deleted, skip it.
    }
  }

  return resolved;
}

export async function renderOpenedNonLogFilesContext(
  vfs: OverlayFs,
  options: OpenFilesRenderOptions = {},
): Promise<string> {
  const resolved = await resolveOpenedFileViews(vfs);
  const nonLog = resolved.filter((entry) => !isLogPath(entry.path));
  if (nonLog.length === 0) {
    return '';
  }

  return renderOpenFilesContext(
    {
      logs: { internal: [], background: [], conversation: [] },
      openedFiles: {
        state: {
          updated: new Date().toISOString(),
          context_bytes: nonLog.reduce(
            (sum, entry) => sum + entry.size_bytes,
            0,
          ),
          context_tokens: nonLog.reduce(
            (sum, entry) => sum + (entry.size_tokens ?? 0),
            0,
          ),
          files: [],
          ai_pins: [],
          recently_closed: [],
        },
        contents: nonLog,
        totalBytes: nonLog.reduce((sum, entry) => sum + entry.size_bytes, 0),
      },
      scheduledResponses: [],
    },
    {
      ...options,
      title: options.title ?? 'Opened Files',
    },
  );
}

export async function renderOpenedLogTimeline(
  vfs: OverlayFs,
  options: {
    now?: Date;
    timeZone?: string;
    visibility?: LogVisibility;
    title?: string;
  } = {},
): Promise<string> {
  const resolved = await resolveOpenedFileViews(vfs);
  const logs = resolved.filter((entry) => isLogPath(entry.path));
  return renderTimelineEntries(
    collectTimelineEntries(logs, options, {
      ...DEFAULT_LOG_VISIBILITY,
      ...options.visibility,
    }),
    options.title ?? 'Open Logs (chronological)',
  );
}

export async function renderActiveScheduledSummary(
  vfs: OverlayFs,
  options: ActiveScheduledSummaryOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone;
  const maxScheduled = options.maxScheduled ?? 8;

  let activeBody = '(none)';
  try {
    const content = await vfs.read(VFS_PATHS.state.activeImpulses);
    const parsed = parseContextFile(content);
    const body = parsed.content.trim();
    if (body) {
      activeBody = replaceIsoTimestamps(body, now, timeZone);
    }
  } catch {
    // ignore missing state
  }

  const scheduledResponses = await loadScheduledResponses(vfs);
  const scheduledLines = scheduledResponses
    .slice()
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, maxScheduled)
    .map((response) => {
      const deferred = response.urgency === 'defer' ? ' deferred' : '';
      const waitFor =
        response.waitForIdleTargets && response.waitForIdleTargets.length > 0
          ? ` waitFor=${response.waitForIdleTargets
              .map((target) => `${target.kind}:${target.name}`)
              .join(',')}`
          : '';
      return `- ${response.id} (${response.urgency}${deferred}) intent: ${response.intent}${waitFor}`;
    });
  const scheduledBody =
    scheduledLines.length > 0 ? scheduledLines.join('\n') : '(none)';

  return [
    '## Active / Scheduled Summary',
    '',
    '### Active Impulses',
    activeBody,
    '',
    '### Scheduled Responses',
    scheduledBody,
  ]
    .join('\n')
    .trimEnd();
}

function renderTimelineEntries(
  entries: TimelineEntry[],
  title: string,
): string {
  if (entries.length === 0) {
    return '';
  }

  const lines: string[] = [`## ${title}`, ''];
  for (const item of entries) {
    lines.push(item.header);
    if (item.body) {
      lines.push(item.body);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

async function loadTimelineFilesForPaths(
  vfs: OverlayFs,
  paths: string[],
): Promise<OpenedFileContent[]> {
  const contents: OpenedFileContent[] = [];
  for (const path of paths) {
    try {
      const view = await loadFileView(vfs, path, 'full');
      contents.push({
        path,
        type: 'file',
        mode: 'full',
        content: view.content,
        meta: view.meta,
        size_bytes: new TextEncoder().encode(view.content).length,
      });
    } catch {
      // ignore unreadable logs
    }
  }
  return contents;
}

export async function renderRecentLogTimeline(
  vfs: OverlayFs,
  options: RecentLogSummaryOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone;
  const visibility = {
    ...DEFAULT_LOG_VISIBILITY,
    ...options.visibility,
  };
  const cutoff =
    typeof options.minutes === 'number'
      ? now.getTime() - options.minutes * 60_000
      : undefined;
  const maxItems = options.maxItems ?? 12;
  const logRoots = [VFS_PATHS.logs.root];

  const pathSet = new Set<string>();
  for (const root of logRoots) {
    const entries = await listLogEntriesRecursive(vfs, root).catch(() => []);
    for (const entry of entries) {
      pathSet.add(entry.entry.path);
    }
  }

  const timelineFiles = await loadTimelineFilesForPaths(
    vfs,
    Array.from(pathSet).sort((a, b) => a.localeCompare(b)),
  );
  const items = collectTimelineEntries(
    timelineFiles,
    { now, timeZone },
    visibility,
  )
    .filter((item) => (cutoff ? item.timestamp.getTime() >= cutoff : true))
    .slice(-maxItems);

  return renderTimelineEntries(items, options.title ?? 'Recent Log Timeline');
}

export async function renderRecentLogSummary(
  vfs: OverlayFs,
  options: RecentLogSummaryOptions = {},
): Promise<string> {
  const openedFiles = await loadOpenedFiles(vfs);
  const now = options.now ?? new Date();
  const timeZone = options.timeZone;
  const visibility = {
    ...DEFAULT_LOG_VISIBILITY,
    ...options.visibility,
  };
  const cutoff =
    typeof options.minutes === 'number'
      ? now.getTime() - options.minutes * 60_000
      : undefined;
  const maxItems = options.maxItems ?? 12;

  const items = collectTimelineEntries(
    openedFiles.contents,
    { now, timeZone },
    visibility,
  )
    .filter((item) => (cutoff ? item.timestamp.getTime() >= cutoff : true))
    .slice(-maxItems);

  if (items.length === 0) {
    return '';
  }

  return [
    `## ${options.title ?? 'Recent Log Summary'}`,
    '',
    ...items.map((item) => item.header),
  ].join('\n');
}

export async function renderTranscriptWindow(
  vfs: OverlayFs,
  options: TranscriptWindowOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone;
  const cutoff =
    typeof options.minutes === 'number'
      ? now.getTime() - options.minutes * 60_000
      : undefined;
  const roles = options.roles ? new Set(options.roles) : undefined;
  const logs = await listLogEntriesRecursive(vfs, VFS_PATHS.logs.root);
  const entries = await loadTranscriptEntries(
    vfs,
    logs.map((item) => item.entry.path),
  );

  const filtered = entries.filter((entry) =>
    roles ? roles.has(entry.role) : true,
  );
  const recent = cutoff
    ? filtered.filter((entry) => entry.timestamp.getTime() >= cutoff)
    : filtered;
  const minItems = options.minItems ?? 0;
  const fallback = minItems > 0 ? filtered.slice(-minItems) : [];
  const combined = dedupeTranscriptEntries([...recent, ...fallback]);
  const limited =
    typeof options.maxItems === 'number' && options.maxItems > 0
      ? combined.slice(-options.maxItems)
      : combined;

  if (limited.length === 0) {
    return '';
  }

  const lines: string[] = [`## ${options.title ?? 'Recent Transcript'}`, ''];
  for (const entry of limited) {
    const relative = formatRelativeTime(entry.timestamp, { now, timeZone });
    lines.push(`[${relative}] ${entry.role}`);
    lines.push(
      ...replaceIsoTimestamps(entry.content, now, timeZone)
        .split('\n')
        .map((line) => `  ${line}`),
    );
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function renderOpenFilesContext(
  context: AccumulatedContext,
  options: OpenFilesRenderOptions = {},
): string {
  const vis = { ...DEFAULT_LOG_VISIBILITY, ...options.visibility };
  const nonLog = context.openedFiles.contents.filter((entry) => {
    if (entry.type === 'directory') return true;
    if (!isLogPath(entry.path)) return true;
    // For frontmatter log files, respect visibility settings
    if (entry.mode === 'frontmatter') {
      if (entry.path.startsWith(VFS_PATHS.logs.root) && !vis.feedback)
        return false;
      if (entry.path.startsWith(VFS_PATHS.logs.root) && !vis.steering)
        return false;
      return true;
    }
    return false;
  });
  if (nonLog.length === 0) {
    return '';
  }

  const now = options.now ?? new Date();
  const sections = nonLog.map((entry) => {
    const content = replaceIsoTimestamps(entry.content, now, options.timeZone);
    const suffix = entry.mode === 'frontmatter' ? ' (frontmatter)' : '';
    return `### ${entry.path}${suffix}\n${content}`;
  });

  return `## ${options.title ?? 'Open Files'}\n\n${sections.join('\n\n')}`;
}

/**
 * Options controlling which log families appear in the timeline and open-files
 * context renderers.  Defaults: feedback hidden, steering visible.
 */
export type LogVisibility = {
  /** Include feedback log entries (ratings/annotations). Default: false */
  feedback?: boolean;
  /** Include steering log entries (directives). Default: true */
  steering?: boolean;
};

const DEFAULT_LOG_VISIBILITY: Required<LogVisibility> = {
  feedback: false,
  steering: true,
};

export function renderOpenLogTimeline(
  context: AccumulatedContext,
  options: { now?: Date; timeZone?: string; visibility?: LogVisibility } = {},
): string {
  const vis = { ...DEFAULT_LOG_VISIBILITY, ...options.visibility };
  return renderTimelineEntries(
    collectTimelineEntries(context.openedFiles.contents, options, vis),
    'Open Logs (chronological)',
  );
}

export function getLatestImpulseEntry(
  context: AccumulatedContext,
  logType?: string,
): { entry: ImpulseLogEntry; logType: string } | null {
  const entries = collectOpenLogEntries(context.openedFiles.contents);
  const filtered = logType
    ? entries.filter((item) => item.logType === logType)
    : entries;
  if (filtered.length === 0) return null;
  return filtered.sort(
    (a, b) => a.entry.timestamp.getTime() - b.entry.timestamp.getTime(),
  )[filtered.length - 1]!;
}

/**
 * Format a log entry for display.
 */
function formatLogEntry(
  entry: ImpulseLogEntry,
  logType: string,
  options: { now?: Date; timeZone?: string },
): string {
  const lines: string[] = [];
  const relative = formatRelativeTime(entry.timestamp, {
    now: options.now,
    timeZone: options.timeZone,
  });
  lines.push(`[${relative}] (type: ${logType}) ${entry.impulseId}`);
  lines.push(`from: ${entry.from}`);
  if (entry.regarding) {
    lines.push(`regarding: ${entry.regarding}`);
  }
  lines.push(`trigger: ${entry.trigger}`);
  lines.push('');
  lines.push(entry.thinking);
  lines.push('');
  const output = lines.join('\n');
  const now = options.now ?? new Date();
  return replaceIsoTimestamps(output, now, options.timeZone);
}

function collectOpenLogEntries(
  opened: OpenedFileContent[],
): Array<{ entry: ImpulseLogEntry; logType: string }> {
  const entries: Array<{ entry: ImpulseLogEntry; logType: string }> = [];
  const logDirs = [
    VFS_PATHS.logs.root,
    VFS_PATHS.logs.root,
    VFS_PATHS.logs.root,
  ];

  for (const file of opened) {
    if (file.type !== 'file') continue;
    if (!file.path.endsWith('.log')) continue;
    if (!logDirs.some((dir) => file.path.startsWith(dir))) continue;

    const parsed = parseLogContent(file.content);
    if (!parsed) continue;
    const logType = resolveLogType(
      file.path,
      parsed.meta?.log_type as string | undefined,
    );
    for (const entry of parsed.entries) {
      entries.push({ entry, logType });
    }
  }

  return entries;
}

function isLogPath(path: string): boolean {
  return path.startsWith(VFS_PATHS.logs.root);
}

type TimelineEntry = {
  timestamp: Date;
  header: string;
  body: string;
};

type TranscriptWindowEntry = {
  role: TranscriptRole;
  content: string;
  timestamp: Date;
};

async function loadTranscriptEntries(
  vfs: OverlayFs,
  _paths: string[],
): Promise<TranscriptWindowEntry[]> {
  const entries = await readDerivedTranscriptEntries(vfs);
  return entries.map((entry) => ({
    role: entry.role,
    content: entry.content,
    timestamp: entry.timestamp,
  }));
}

function dedupeTranscriptEntries(
  entries: TranscriptWindowEntry[],
): TranscriptWindowEntry[] {
  const seen = new Set<string>();
  const deduped: TranscriptWindowEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.timestamp.toISOString()}|${entry.role}|${entry.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function collectTimelineEntries(
  opened: OpenedFileContent[],
  options: { now?: Date; timeZone?: string },
  visibility: Required<LogVisibility> = DEFAULT_LOG_VISIBILITY,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const now = options.now ?? new Date();
  const timeZone = options.timeZone;

  for (const file of opened) {
    if (file.type !== 'file') continue;
    if (!file.path.endsWith('.log')) continue;

    if (file.mode === 'frontmatter') {
      const summaryEntry = buildFrontmatterTimelineEntry(
        file,
        now,
        timeZone,
        visibility,
      );
      if (summaryEntry) {
        entries.push(summaryEntry);
      }
      continue;
    }

    const laneTimelineEntries = projectTimelineEntriesFromLaneLogFile(
      file.content,
      {
        now,
        timeZone,
        visibility,
      },
    );
    if (laneTimelineEntries.length > 0) {
      entries.push(...laneTimelineEntries);
      continue;
    }

    // Flat log structure: determine type from filename suffix
    const fileLogType = parseLogType(file.path.split('/').pop() ?? '');

    if (fileLogType === 'steering') {
      if (!visibility.steering) continue;
      const parsed = parseSteeringLog(file.content);
      for (const entry of parsed) {
        const relative = formatRelativeTime(entry.timestamp, { now, timeZone });
        const sourceTag = entry.source ? ` (${entry.source})` : '';
        const header = `[${relative}] steering:directive${sourceTag}`;
        const body = formatTimelineBody(
          `[INTERNAL STEERING - not visible to client]\n${entry.content}`,
          now,
          timeZone,
        );
        entries.push({ timestamp: entry.timestamp, header, body });
      }
      continue;
    }

    if (fileLogType === 'feedback') {
      if (!visibility.feedback) continue;
      const parsed = parseFeedbackLog(file.content);
      for (const entry of parsed) {
        const relative = formatRelativeTime(entry.timestamp, { now, timeZone });
        const sourceTag = entry.source ? ` (${entry.source})` : '';
        const annotationTag = entry.annotation ? `: ${entry.annotation}` : '';
        const header = `[${relative}] feedback:${entry.rating}${sourceTag}`;
        const body = formatTimelineBody(
          `Rating: ${entry.rating}${annotationTag}`,
          now,
          timeZone,
        );
        entries.push({ timestamp: entry.timestamp, header, body });
      }
      continue;
    }

    if (fileLogType === 'nap') {
      const parsed = parseContextFile(file.content);
      const updated =
        (parsed.meta.updated as string | undefined) ??
        (parsed.meta.created as string | undefined);
      const timestamp = updated ? new Date(updated) : now;
      const relative = formatRelativeTime(timestamp, { now, timeZone });
      const header = `[${relative}] nap:${file.path.split('/').pop() ?? ''}`;
      const body = formatTimelineBody(file.content, now, timeZone);
      entries.push({ timestamp, header, body });
      continue;
    }

    if (!isLogPath(file.path)) continue;

    const parsed = parseLogContent(file.content);
    if (!parsed) continue;
    const logType = resolveLogType(
      file.path,
      parsed.meta?.log_type as string | undefined,
    );
    for (const entry of parsed.entries) {
      const relative = formatRelativeTime(entry.timestamp, { now, timeZone });
      const header = `[${relative}] impulse:${logType} ${entry.impulseId}`;
      const body = formatImpulseTimelineEntry(entry, now, timeZone);
      entries.push({ timestamp: entry.timestamp, header, body });
    }
  }

  return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function formatImpulseTimelineEntry(
  entry: ImpulseLogEntry,
  now: Date,
  timeZone?: string,
): string {
  const lines: string[] = [];
  lines.push(`from: ${entry.from}`);
  if (entry.regarding) {
    lines.push(`regarding: ${entry.regarding}`);
  }
  lines.push(`trigger: ${entry.trigger}`);
  lines.push(entry.thinking);
  const output = lines.join('\n');
  return formatTimelineBody(output, now, timeZone);
}

function formatTimelineBody(
  content: string,
  now: Date,
  timeZone?: string,
): string {
  const normalized = replaceIsoTimestamps(content, now, timeZone);
  return normalized
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function buildFrontmatterTimelineEntry(
  file: OpenedFileContent,
  now: Date,
  timeZone: string | undefined,
  _visibility: Required<LogVisibility>,
): TimelineEntry | null {
  if (!isLogPath(file.path)) {
    return null;
  }

  const basename = file.path.split('/').pop() ?? file.path;
  const fileType = parseLogType(basename);

  const timestamp = resolveFrontmatterTimestamp(file.meta, now);
  const relative = formatRelativeTime(timestamp, { now, timeZone });
  const logType = resolveLogType(
    file.path,
    typeof file.meta?.log_type === 'string' ? file.meta.log_type : undefined,
  );

  const label =
    fileType === 'nap' ? `nap:${basename}` : `${logType}:summary ${basename}`;

  return {
    timestamp,
    header: `[${relative}] ${label}`,
    body: formatTimelineBody(file.content, now, timeZone),
  };
}

function resolveFrontmatterTimestamp(
  meta: Record<string, unknown> | undefined,
  fallback: Date,
): Date {
  const timestampKeys = ['updated', 'created', 'created_at'];
  for (const key of timestampKeys) {
    const value = meta?.[key];
    if (typeof value !== 'string') {
      continue;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback;
}

function parseLogContent(content: string): {
  entries: ImpulseLogEntry[];
  meta?: Record<string, unknown>;
} | null {
  if (!content.trim()) return null;
  if (content.trim().startsWith('---')) {
    const parsed = parseContextFile(content);
    return {
      entries: parseLogFile(parsed.content),
      meta: parsed.meta as Record<string, unknown>,
    };
  }
  return { entries: parseLogFile(content) };
}

function resolveLogType(path: string, metaType?: string): string {
  if (metaType) {
    return metaType === 'conversation' ? 'listening_thoughts' : metaType;
  }
  // Flat log structure: type is in the filename suffix
  // e.g. "2026-03-24-0.conversation.log" → "conversation" → "listening_thoughts"
  const fileType = parseLogType(path.split('/').pop() ?? '');
  if (fileType === 'conversation') return 'listening_thoughts';
  if (fileType) return fileType;
  return 'log';
}
