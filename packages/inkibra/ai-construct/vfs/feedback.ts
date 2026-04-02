import type { OverlayFs } from '@inkibra/ai-flow';
import {
  type LaneFeedbackLogEntry,
  type LaneSteeringLogEntry,
  parseLaneLog,
} from './lane-logs';
import {
  readDerivedTranscriptEntries,
  type TranscriptEntry,
} from './transcript';

export type { FeedbackRating } from './lane-logs';
export type FeedbackEntry = LaneFeedbackLogEntry;
export type SteeringEntry = LaneSteeringLogEntry;

export function parseFeedbackLog(content: string): FeedbackEntry[] {
  return parseLaneLog(content).filter(
    (entry): entry is LaneFeedbackLogEntry => entry.kind === 'feedback',
  );
}

export function parseSteeringLog(content: string): SteeringEntry[] {
  return parseLaneLog(content).filter(
    (entry): entry is LaneSteeringLogEntry => entry.kind === 'steering',
  );
}

/**
 * Get the most recent construct response and its preceding user message.
 * When a lane is provided, only transcript rows from that lane are considered.
 */
export async function getLatestConstructResponse(
  vfs: OverlayFs,
  lane?: string,
): Promise<{
  responseId?: string;
  responseContent: string;
  precedingUserMessage?: string;
} | null> {
  const entries: TranscriptEntry[] = await readDerivedTranscriptEntries(vfs);
  const relevantEntries =
    typeof lane === 'string' && lane.length > 0
      ? entries.filter((entry) => entry.lane === lane)
      : entries;
  if (relevantEntries.length === 0) return null;

  let lastConstructIdx = -1;
  for (let i = relevantEntries.length - 1; i >= 0; i -= 1) {
    const entry = relevantEntries[i];
    if (entry?.role === 'construct') {
      lastConstructIdx = i;
      break;
    }
  }

  if (lastConstructIdx === -1) return null;

  const latestEntry = relevantEntries[lastConstructIdx];
  if (!latestEntry) return null;

  let precedingUserMessage: string | undefined;
  for (let i = lastConstructIdx - 1; i >= 0; i -= 1) {
    const entry = relevantEntries[i];
    if (entry?.role === 'user') {
      precedingUserMessage = entry.content;
      break;
    }
  }

  return {
    responseId: latestEntry.responseId,
    responseContent: latestEntry.content,
    precedingUserMessage,
  };
}
