import { type OverlayFs, parseContextFile } from '@inkibra/ai-flow';
import type { Logger } from '@inkibra/logger';
import type { SourceFactType } from '../source-facts';
import { appendFrontmatterLogEntry } from './frontmatter-log-append';
import { VFS_PATHS } from './layout';
export type SourceEventEntry = {
  factId: string;
  factType: Exclude<
    SourceFactType,
    'user_message' | 'rate_response' | 'steer_directive'
  >;
  timestamp: Date;
  traceId?: string;
  payload?: Record<string, unknown>;
};

export async function writeSourceEventEntry(
  vfs: OverlayFs,
  entry: SourceEventEntry,
  options?: { logger?: Logger },
): Promise<void> {
  await appendFrontmatterLogEntry({
    vfs,
    dir: VFS_PATHS.logs.root,
    timestamp: entry.timestamp,
    logType: 'source-event',
    entryText: formatSourceEventEntry(entry),
    logger: options?.logger,
  });
}

export function formatSourceEventEntry(entry: SourceEventEntry): string {
  const lines: string[] = [];
  lines.push(`[${entry.timestamp.toISOString()}] source-event`);
  lines.push(`fact_id: ${entry.factId}`);
  lines.push(`fact_type: ${entry.factType}`);
  if (entry.traceId) {
    lines.push(`trace_id: ${entry.traceId}`);
  }
  if (entry.payload && Object.keys(entry.payload).length > 0) {
    lines.push('payload:');
    for (const [key, value] of Object.entries(entry.payload)) {
      lines.push(`  ${key}: ${serializeValue(value)}`);
    }
  }
  return lines.join('\n').trim();
}

export type ParsedSourceEventEntry = SourceEventEntry & {
  payload?: Record<string, string>;
};

export function parseSourceEventLog(content: string): ParsedSourceEventEntry[] {
  const parsed = content.trim().startsWith('---')
    ? parseContextFile(content).content
    : content;
  if (!parsed.trim()) {
    return [];
  }

  return parsed
    .split(/\n---\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => parseSourceEventBlock(block))
    .filter((entry): entry is ParsedSourceEventEntry => entry !== null);
}

function parseSourceEventBlock(block: string): ParsedSourceEventEntry | null {
  const lines = block.split('\n');
  const header = lines.shift() ?? '';
  const tsMatch = header.match(/^\[(.+?)\]\s+source-event$/);
  const timestamp = tsMatch ? new Date(tsMatch[1]!) : new Date();

  let factId = '';
  let factType: ParsedSourceEventEntry['factType'] | null = null;
  let traceId: string | undefined;
  const payload: Record<string, string> = {};

  let inPayload = false;
  for (const line of lines) {
    if (line === 'payload:') {
      inPayload = true;
      continue;
    }

    if (inPayload && line.startsWith('  ')) {
      const [key, ...rest] = line.trim().split(': ');
      if (key) {
        payload[key] = rest.join(': ');
      }
      continue;
    }

    inPayload = false;
    if (line.startsWith('fact_id: ')) {
      factId = line.slice('fact_id: '.length).trim();
      continue;
    }
    if (line.startsWith('fact_type: ')) {
      const value = line.slice('fact_type: '.length).trim();
      if (
        value === 'impulse' ||
        value === 'system_event' ||
        value === 'self_reminder' ||
        value === 'time_passed' ||
        value === 'mailbox_idle'
      ) {
        factType = value;
      }
      continue;
    }
    if (line.startsWith('trace_id: ')) {
      traceId = line.slice('trace_id: '.length).trim();
    }
  }

  if (!factId || !factType) {
    return null;
  }

  return {
    factId,
    factType,
    timestamp,
    traceId,
    payload: Object.keys(payload).length > 0 ? payload : undefined,
  };
}

function serializeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}
