import type { OverlayFs } from '@inkibra/ai-flow';
import {
  isLaneLogType,
  projectTranscriptEntriesFromLaneLogFile,
} from './lane-logs';
import { VFS_PATHS } from './layout';
import { listLogEntriesRecursive } from './logs';

export type TranscriptRole = 'user' | 'construct' | 'system';

export type TranscriptEntry = {
  role: TranscriptRole;
  content: string;
  timestamp: Date;
  lane?: string;
  factId?: string;
  impulseId?: string;
  responseId?: string;
};

export function parseTranscriptLog(content: string): TranscriptEntry[] {
  return projectTranscriptEntriesFromLaneLogFile(content).map((entry) => ({
    role: entry.role === 'assistant' ? 'construct' : entry.role,
    content: entry.content,
    timestamp: entry.timestamp,
    lane: entry.lane,
    factId: entry.factId,
    impulseId: entry.impulseId,
    responseId: entry.responseId,
  }));
}

export async function readDerivedTranscriptEntries(
  vfs: OverlayFs,
): Promise<TranscriptEntry[]> {
  const candidates = await listLogEntriesRecursive(vfs, VFS_PATHS.logs.root);
  const laneLogs = candidates
    .filter((candidate) => isLaneLogType(candidate.parsed?.logType))
    .sort((left, right) => left.entry.path.localeCompare(right.entry.path));

  const entries: TranscriptEntry[] = [];
  for (const log of laneLogs) {
    try {
      entries.push(...parseTranscriptLog(await vfs.read(log.entry.path)));
    } catch {
      // Ignore unreadable lane logs.
    }
  }

  return entries.sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
}
