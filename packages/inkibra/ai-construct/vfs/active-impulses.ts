/*
 * Active Impulses Snapshot
 *
 * Writes a time-ordered snapshot of in-flight impulses for context.
 */

import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import {
  getPerceptionDisplayContent,
  getPerceptionOrigin,
  truncatePerceptionContent,
} from '../construct/perception';
import type { Perception } from '../construct/types';
import type { Impulse } from '../impulse/types';
import { VFS_PATHS } from './layout';

const MAX_TRIGGER_LENGTH = 160;

export async function writeActiveImpulses(
  vfs: OverlayFs,
  impulses: Impulse[],
): Promise<void> {
  const path = VFS_PATHS.state.activeImpulses;
  const now = new Date().toISOString();
  const sorted = [...impulses].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );

  // Read existing metadata
  let existingMeta: Record<string, unknown> = {};
  try {
    const raw = await vfs.read(path);
    const parsed = parseContextFile(raw);
    existingMeta = parsed.meta;
  } catch {
    // New file
  }

  const lines = sorted.map(formatImpulseLine);
  const content = lines.join('\n');

  await vfs.write(
    path,
    serializeContextFile(
      {
        ...existingMeta,
        id: path,
        tags: (existingMeta.tags as string[]) ?? [],
        created:
          typeof existingMeta.created === 'string' ? existingMeta.created : now,
        updated: now,
        active_count: sorted.length,
      },
      content,
    ),
  );
}

function formatImpulseLine(impulse: Impulse): string {
  const trigger = formatPerceptionTrigger(impulse.triggeredBy);
  const origin = formatPerceptionOrigin(impulse.triggeredBy);
  const suffix = origin ? ` (${origin})` : '';
  return `- [${impulse.startedAt.toISOString()}] ${impulse.id} (pool=${impulse.pool}, profile=${impulse.profile}) trigger: ${trigger}${suffix}`;
}

function formatPerceptionTrigger(perception: Perception): string {
  const display = getPerceptionDisplayContent(perception);
  switch (perception.source) {
    case 'system_event':
      return perception.event ?? display;
    case 'self_reminder':
      return `reminder: "${display}"`;
    case 'time_passed':
    case 'user_message':
      return `"${truncatePerceptionContent(display, MAX_TRIGGER_LENGTH)}"`;
  }
}

function formatPerceptionOrigin(perception: Perception): string | undefined {
  return getPerceptionOrigin(perception);
}
