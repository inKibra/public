import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import type { Logger } from '@inkibra/logger';
import type { ToolUsage } from '../impulse/types';
import { formatRelativeTime, replaceIsoTimestamps } from '../utils/time';
import { getActiveLogPath } from './logs';

export type FeedbackRating = 'good' | 'bad' | 'neutral';

export type LaneLogRole = 'user' | 'construct' | 'system';

export type LaneScopedLogEntryBase = {
  timestamp: Date;
  role: LaneLogRole;
  sourceLane: string;
  targetLane?: string;
  impulseId?: string;
  responseId?: string;
  factId?: string;
  content: string;
};

export type LaneImpulseLogEntry = LaneScopedLogEntryBase & {
  kind: 'impulse';
  impulseId: string;
  from: string;
  trigger: string;
  thinking: string;
  profile?: string;
  pool?: string;
  regarding?: string;
  toolHistory?: ToolUsage[];
};

export type LaneReflectedImpulseLogEntry = LaneScopedLogEntryBase & {
  kind: 'reflected_impulse';
};

export type LaneResponseLogEntry = LaneScopedLogEntryBase & {
  kind: 'response';
  responseId: string;
};

export type LaneFeedbackLogEntry = LaneScopedLogEntryBase & {
  kind: 'feedback';
  role: 'system';
  rating: FeedbackRating;
  source?: string;
  annotation?: string;
  responseContent?: string;
  precedingUserMessage?: string;
};

export type LaneSteeringLogEntry = LaneScopedLogEntryBase & {
  kind: 'steering';
  role: 'system';
  source?: string;
};

export type LaneLogEntry =
  | LaneImpulseLogEntry
  | LaneReflectedImpulseLogEntry
  | LaneResponseLogEntry
  | LaneFeedbackLogEntry
  | LaneSteeringLogEntry;

export type LaneTranscriptEntry = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  lane: string;
  factId?: string;
  impulseId?: string;
  responseId?: string;
};

export type LaneTimelineEntry = {
  timestamp: Date;
  header: string;
  body: string;
  /** Source lane name (from log file's log_type / lane param) */
  lane?: string;
  /** Entry kind from the parsed LaneLogEntry, if this came from a log body */
  entryKind?: LaneLogEntry['kind'];
  /** Whether this is a parsed body entry or a frontmatter summary stub */
  itemKind?: 'entry' | 'summary';
};

export type LaneLogTimelineVisibility = {
  feedback?: boolean;
  steering?: boolean;
};

const DEFAULT_LANE_LOG_TIMELINE_VISIBILITY: Required<LaneLogTimelineVisibility> =
  {
    feedback: true,
    steering: true,
  };

export const AUXILIARY_LOG_TYPES = new Set([
  'feedback',
  'steering',
  'nap',
  'source-event',
  'transcript',
  'decision',
  'tool',
]);

export function isLaneLogType(logType: string | null | undefined): boolean {
  return typeof logType === 'string' && !AUXILIARY_LOG_TYPES.has(logType);
}

const laneLogWriteQueueByVfs = new WeakMap<OverlayFs, Promise<unknown>>();

async function withLaneLogWriteLock<T>(
  vfs: OverlayFs,
  task: () => Promise<T>,
): Promise<T> {
  const previous = laneLogWriteQueueByVfs.get(vfs) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  laneLogWriteQueueByVfs.set(
    vfs,
    previous.catch(() => {}).then(() => current),
  );

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

export async function writeLaneLogEntry(
  vfs: OverlayFs,
  lane: string,
  entry: LaneLogEntry,
  options?: { logger?: Logger },
): Promise<void> {
  await withLaneLogWriteLock(vfs, async () => {
    const logPath = await getActiveLogPath(vfs, lane, entry.timestamp);
    const day = entry.timestamp.toISOString().slice(0, 10);

    let existing = '';
    try {
      existing = await vfs.read(logPath);
    } catch {
      // File does not exist yet.
    }

    let existingMeta: Record<string, unknown> = {};
    let existingBody = existing;
    if (existing.trim().startsWith('---')) {
      const parsed = parseContextFile(existing);
      existingMeta = parsed.meta;
      existingBody = parsed.content;
    }

    const entryText = formatLaneLogEntry(entry);
    const newBody = existingBody
      ? `${existingBody}\n---\n${entryText}`
      : entryText;
    const entryCount = parseLaneLog(newBody).length;
    const meta = {
      ...existingMeta,
      id: (existingMeta.id as string) ?? logPath,
      type: 'log',
      tags: (existingMeta.tags as string[]) ?? [],
      created:
        (existingMeta.created as string) ?? entry.timestamp.toISOString(),
      updated: entry.timestamp.toISOString(),
      log_type: lane,
      date: (existingMeta.date as string) ?? day,
      entry_count: entryCount,
    };

    await vfs.write(logPath, serializeContextFile(meta, newBody));
    options?.logger?.debug?.('Wrote lane log entry', {
      lane,
      kind: entry.kind,
      logPath,
    });
  });
}

function resolveLaneLogEntryId(entry: LaneLogEntry): string {
  switch (entry.kind) {
    case 'impulse':
      return entry.impulseId;
    case 'response':
      return entry.responseId;
    case 'feedback':
      return entry.responseId ?? entry.factId ?? 'feedback';
    case 'steering':
      return entry.factId ?? 'steering';
    case 'reflected_impulse':
      return entry.impulseId ?? entry.responseId ?? entry.factId ?? entry.kind;
  }
}

export function formatLaneLogEntry(entry: LaneLogEntry): string {
  const lines = [
    `[${entry.timestamp.toISOString()}] ${entry.kind} ${resolveLaneLogEntryId(entry)}`,
  ];
  lines.push(`role: ${entry.role}`);
  lines.push(`source_lane: ${entry.sourceLane}`);
  if (entry.targetLane) {
    lines.push(`target_lane: ${entry.targetLane}`);
  }
  if (entry.impulseId) {
    lines.push(`impulse_id: ${entry.impulseId}`);
  }
  if (entry.responseId) {
    lines.push(`response_id: ${entry.responseId}`);
  }
  if (entry.factId) {
    lines.push(`fact_id: ${entry.factId}`);
  }

  if (entry.kind === 'impulse') {
    lines.push(`from: ${entry.from}`);
    lines.push(`trigger: ${entry.trigger}`);
    if (entry.profile) {
      lines.push(`profile: ${entry.profile}`);
    }
    if (entry.pool) {
      lines.push(`pool: ${entry.pool}`);
    }
    if (entry.regarding) {
      lines.push(`regarding: ${entry.regarding}`);
    }
  } else if (entry.kind === 'feedback') {
    lines.push(`rating: ${entry.rating}`);
    if (entry.source) {
      lines.push(`source: ${entry.source}`);
    }
  } else if (entry.kind === 'steering' && entry.source) {
    lines.push(`source: ${entry.source}`);
  }

  lines.push('');
  lines.push('[content]');
  lines.push(entry.content);

  if (entry.kind === 'impulse') {
    lines.push('');
    lines.push('[thinking]');
    lines.push(entry.thinking);
    if (entry.toolHistory && entry.toolHistory.length > 0) {
      lines.push('');
      lines.push('[tools]');
      for (const tool of entry.toolHistory) {
        const output = tool.output.replace(/\s+/g, ' ').slice(0, 160);
        lines.push(`- ${tool.tool}: ${tool.command} => ${output}`);
      }
    }
  } else if (entry.kind === 'feedback') {
    if (entry.responseContent) {
      lines.push('');
      lines.push('[response]');
      lines.push(entry.responseContent);
    }
    if (entry.precedingUserMessage) {
      lines.push('');
      lines.push('[user_message]');
      lines.push(entry.precedingUserMessage);
    }
  }

  return lines.join('\n').trim();
}

export function parseLaneLog(content: string): LaneLogEntry[] {
  const parsed = content.trim().startsWith('---')
    ? parseContextFile(content).content
    : content;
  if (!parsed.trim()) {
    return [];
  }

  const lines = parsed.split('\n');
  const entries: LaneLogEntry[] = [];
  let current:
    | {
        timestamp: Date;
        kind: LaneLogEntry['kind'];
        entryId: string;
        lines: string[];
      }
    | undefined;

  const pushCurrent = () => {
    if (!current) {
      return;
    }
    const parsedEntry = parseLaneLogBlock(current);
    if (parsedEntry) {
      entries.push(parsedEntry);
    }
    current = undefined;
  };

  const entryHeaderPattern =
    /^\[(.+?)\]\s+(impulse|reflected_impulse|response|feedback|steering)(?:\s+(\S+))?$/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(entryHeaderPattern);
    if (match) {
      pushCurrent();
      current = {
        timestamp: new Date(match[1]!),
        kind: match[2] as LaneLogEntry['kind'],
        entryId: match[3] ?? match[2]!,
        lines: [],
      };
      continue;
    }

    const nextLine = lines[index + 1];
    if (
      line === '---' &&
      typeof nextLine === 'string' &&
      entryHeaderPattern.test(nextLine)
    ) {
      continue;
    }

    if (!current) {
      continue;
    }
    current.lines.push(line);
  }

  pushCurrent();
  return entries;
}

function parseLaneLogBlock(block: {
  timestamp: Date;
  kind: LaneLogEntry['kind'];
  entryId: string;
  lines: string[];
}): LaneLogEntry | null {
  const metadata: Record<string, string> = {};
  const sections = readSections(block.lines);

  let index = 0;
  while (index < block.lines.length) {
    const line = block.lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (
      /^\[(content|thinking|tools|response|user_message)\]$/.test(line.trim())
    ) {
      break;
    }

    const separator = line.indexOf(': ');
    if (separator !== -1) {
      metadata[line.slice(0, separator)] = line.slice(separator + 2).trim();
    }
    index += 1;
  }

  const role = normalizeLaneRole(metadata.role);
  const sourceLane = metadata.source_lane ?? '';
  const targetLane = metadata.target_lane;
  const impulseId = metadata.impulse_id;
  const responseId = metadata.response_id;
  const factId = metadata.fact_id;
  const content = sections.content.trim();
  if (!role || !sourceLane) {
    return null;
  }

  if (block.kind === 'impulse') {
    const from = metadata.from ?? '';
    const trigger = metadata.trigger ?? '';
    if (!impulseId || !from || !trigger || !content) {
      return null;
    }
    return {
      kind: 'impulse',
      timestamp: block.timestamp,
      role,
      sourceLane,
      targetLane,
      impulseId,
      responseId,
      factId,
      content,
      from,
      trigger,
      thinking: sections.thinking.trim(),
      profile: metadata.profile,
      pool: metadata.pool,
      regarding: metadata.regarding,
      toolHistory: parseToolHistory(sections.tools, block.timestamp),
    };
  }

  if (block.kind === 'response') {
    const normalizedResponseId = responseId ?? block.entryId;
    if (!normalizedResponseId || !content) {
      return null;
    }
    return {
      kind: 'response',
      timestamp: block.timestamp,
      role,
      sourceLane,
      targetLane,
      impulseId,
      responseId: normalizedResponseId,
      factId,
      content,
    };
  }

  if (block.kind === 'feedback') {
    const rating = normalizeFeedbackRating(metadata.rating);
    if (!rating || role !== 'system') {
      return null;
    }
    const annotation = normalizeOptionalSection(sections.content);
    return {
      kind: 'feedback',
      timestamp: block.timestamp,
      role,
      sourceLane,
      targetLane,
      impulseId,
      responseId,
      factId,
      content: annotation ?? '',
      rating,
      source: metadata.source,
      annotation,
      responseContent: normalizeOptionalSection(sections.response),
      precedingUserMessage: normalizeOptionalSection(sections.user_message),
    };
  }

  if (block.kind === 'steering') {
    if (role !== 'system' || !content) {
      return null;
    }
    return {
      kind: 'steering',
      timestamp: block.timestamp,
      role,
      sourceLane,
      targetLane,
      impulseId,
      responseId,
      factId,
      content,
      source: metadata.source,
    };
  }

  if (!content) {
    return null;
  }

  return {
    kind: 'reflected_impulse',
    timestamp: block.timestamp,
    role,
    sourceLane,
    targetLane,
    impulseId,
    responseId,
    factId,
    content,
  };
}

function readSections(lines: string[]): {
  content: string;
  thinking: string;
  tools: string[];
  response: string;
  user_message: string;
} {
  const sections = {
    content: [] as string[],
    thinking: [] as string[],
    tools: [] as string[],
    response: [] as string[],
    user_message: [] as string[],
  };
  let current: keyof typeof sections | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === '[content]' ||
      trimmed === '[thinking]' ||
      trimmed === '[tools]' ||
      trimmed === '[response]' ||
      trimmed === '[user_message]'
    ) {
      current = trimmed.slice(1, -1) as keyof typeof sections;
      continue;
    }
    if (!current) {
      continue;
    }
    sections[current].push(line);
  }

  return {
    content: sections.content.join('\n'),
    thinking: sections.thinking.join('\n'),
    tools: sections.tools,
    response: sections.response.join('\n'),
    user_message: sections.user_message.join('\n'),
  };
}

function parseToolHistory(
  lines: string[],
  timestamp: Date,
): NonNullable<LaneImpulseLogEntry['toolHistory']> | undefined {
  const toolHistory: NonNullable<LaneImpulseLogEntry['toolHistory']> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) {
      continue;
    }

    const match = trimmed.match(/^-\s*([^:]+):\s*(.*?)\s*=>\s*(.*)$/);
    if (!match) {
      continue;
    }

    toolHistory.push({
      tool: match[1]!.trim(),
      command: match[2]!.trim(),
      output: match[3]!.trim(),
      timestamp,
    });
  }

  return toolHistory.length > 0 ? toolHistory : undefined;
}

function normalizeLaneRole(value: string | undefined): LaneLogRole | null {
  if (value === 'user' || value === 'construct' || value === 'system') {
    return value;
  }
  return null;
}

function normalizeFeedbackRating(
  value: string | undefined,
): FeedbackRating | undefined {
  if (value === 'good' || value === 'bad' || value === 'neutral') {
    return value;
  }
  return undefined;
}

function normalizeOptionalSection(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function projectTranscriptEntriesFromLaneLog(
  lane: string,
  entries: LaneLogEntry[],
): LaneTranscriptEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === 'response') {
      return [
        {
          role: 'assistant' as const,
          content: entry.content,
          timestamp: entry.timestamp,
          lane,
          factId: entry.factId,
          impulseId: entry.impulseId,
          responseId: entry.responseId,
        },
      ];
    }

    if (entry.kind === 'reflected_impulse') {
      return [
        {
          role: entry.role === 'construct' ? 'assistant' : entry.role,
          content: entry.content,
          timestamp: entry.timestamp,
          lane,
          factId: entry.factId,
          impulseId: entry.impulseId,
          responseId: entry.responseId,
        },
      ];
    }

    return [];
  });
}

export function collectTranscriptEntriesFromLaneLogFiles(
  files: Array<{ lane: string; content: string }>,
): LaneTranscriptEntry[] {
  return files
    .flatMap(({ lane, content }) =>
      projectTranscriptEntriesFromLaneLog(lane, parseLaneLog(content)),
    )
    .sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );
}

export function parseLaneLogFile(
  content: string,
): { lane: string; entries: LaneLogEntry[] } | null {
  const parsed = content.trim().startsWith('---')
    ? parseContextFile(content)
    : { meta: {}, content };
  const logType =
    typeof parsed.meta.log_type === 'string' ? parsed.meta.log_type : undefined;
  if (typeof logType !== 'string' || !isLaneLogType(logType)) {
    return null;
  }

  return {
    lane: logType,
    entries: parseLaneLog(parsed.content),
  };
}

export function projectTranscriptEntriesFromLaneLogFile(
  content: string,
): LaneTranscriptEntry[] {
  const parsed = parseLaneLogFile(content);
  if (!parsed) {
    return [];
  }

  return projectTranscriptEntriesFromLaneLog(parsed.lane, parsed.entries);
}

export function projectTimelineEntriesFromLaneLogFile(
  content: string,
  options: {
    now: Date;
    timeZone?: string;
    visibility?: LaneLogTimelineVisibility;
  },
): LaneTimelineEntry[] {
  const parsed = parseLaneLogFile(content);
  if (!parsed) {
    return [];
  }

  return projectTimelineEntriesFromLaneLog(
    parsed.lane,
    parsed.entries,
    options,
  );
}

export function projectTimelineEntriesFromLaneLog(
  lane: string,
  entries: LaneLogEntry[],
  options: {
    now: Date;
    timeZone?: string;
    visibility?: LaneLogTimelineVisibility;
  },
): LaneTimelineEntry[] {
  const visibility = {
    ...DEFAULT_LANE_LOG_TIMELINE_VISIBILITY,
    ...options.visibility,
  };

  return entries.flatMap((entry) => {
    if (entry.kind === 'feedback' && !visibility.feedback) {
      return [];
    }
    if (entry.kind === 'steering' && !visibility.steering) {
      return [];
    }

    const relative = formatRelativeTime(entry.timestamp, {
      now: options.now,
      timeZone: options.timeZone,
    });
    let label: string;
    if (entry.kind === 'impulse') {
      label = `impulse:${lane} ${entry.impulseId}`;
    } else if (entry.kind === 'response') {
      label = `response:${lane} ${entry.responseId}`;
    } else if (entry.kind === 'feedback') {
      label = `feedback:${lane} ${entry.rating}`;
    } else if (entry.kind === 'steering') {
      label = `steering:${lane}`;
    } else {
      label = `reflected:${lane}`;
    }

    return [
      {
        timestamp: entry.timestamp,
        header: `[${relative}] ${label}`,
        body: formatLaneLogTimelineBody(entry, options.now, options.timeZone),
        lane,
        entryKind: entry.kind,
        itemKind: 'entry',
      },
    ];
  });
}

function formatLaneLogTimelineBody(
  entry: LaneLogEntry,
  now: Date,
  timeZone?: string,
): string {
  if (entry.kind === 'impulse') {
    const lines = [
      `from: ${entry.from}`,
      `trigger: ${entry.trigger}`,
      '[content]',
      entry.content,

      '[thinking]',
      entry.thinking,
    ];
    if (entry.toolHistory && entry.toolHistory.length > 0) {
      lines.push('', '[tools]');
      for (const tool of entry.toolHistory) {
        lines.push(`- ${tool.tool}: ${tool.command} => ${tool.output}`);
      }
    }
    return formatLaneLogTimelineText(lines.join('\n'), now, timeZone);
  }

  if (entry.kind === 'feedback') {
    const lines = [`rating: ${entry.rating}`];
    if (entry.source) {
      lines.push(`source: ${entry.source}`);
    }
    if (entry.annotation) {
      lines.push('', '[annotation]', entry.annotation);
    }
    if (entry.precedingUserMessage) {
      lines.push('', '[preceding_user_message]', entry.precedingUserMessage);
    }
    if (entry.responseContent) {
      lines.push('', '[response]', entry.responseContent);
    }
    return formatLaneLogTimelineText(lines.join('\n'), now, timeZone);
  }

  if (entry.kind === 'steering') {
    const lines = [];
    if (entry.source) {
      lines.push(`source: ${entry.source}`);
    }
    lines.push('[directive]', entry.content);
    if (entry.targetLane && entry.targetLane !== entry.sourceLane) {
      lines.push('', `target lane: ${entry.targetLane}`);
    }
    return formatLaneLogTimelineText(lines.join('\n'), now, timeZone);
  }

  const lines = [entry.content];
  if (entry.targetLane && entry.targetLane !== entry.sourceLane) {
    lines.push(`target lane: ${entry.targetLane}`);
  }
  return formatLaneLogTimelineText(lines.join('\n'), now, timeZone);
}

function formatLaneLogTimelineText(
  content: string,
  now: Date,
  timeZone?: string,
): string {
  return replaceIsoTimestamps(content, now, timeZone)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
