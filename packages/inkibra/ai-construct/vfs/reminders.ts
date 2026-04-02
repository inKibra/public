import {
  type ContextMeta,
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';

export type ReminderMeta = {
  type?: string;
  cron?: string;
  due_at?: string;
  next_fire_at?: string;
  last_fired_at?: string;
  status?: 'pending' | 'done' | 'snoozed';
  priority?: string;
  timezone?: string;
  tags?: string[];
  source?: string;
  [key: string]: unknown;
};

export type ReminderEntry = {
  path: string;
  meta: ReminderMeta;
  content: string;
};

export async function listReminders(vfs: OverlayFs): Promise<string[]> {
  try {
    const entries = await vfs.list(VFS_PATHS.reminders.root);
    return entries
      .filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'))
      .map((entry) => entry.path);
  } catch {
    return [];
  }
}

export async function loadReminder(
  vfs: OverlayFs,
  path: string,
): Promise<ReminderEntry | null> {
  try {
    const raw = await vfs.read(path);
    const parsed = parseContextFile(raw);
    return {
      path,
      meta: parsed.meta as ReminderMeta,
      content: parsed.content,
    };
  } catch {
    return null;
  }
}

export async function saveReminder(
  vfs: OverlayFs,
  entry: ReminderEntry,
): Promise<void> {
  const now = new Date().toISOString();

  // Load existing to preserve metadata
  let existingMeta: Partial<ContextMeta> = {};

  try {
    const raw = await vfs.read(entry.path);
    const parsed = parseContextFile(raw);
    existingMeta = parsed.meta;
  } catch {
    // New file
  }

  const merged = {
    ...existingMeta,
    ...entry.meta,
    id: entry.path,
    tags: existingMeta.tags ?? [],
    created: existingMeta.created ?? now,
    updated: now,
  } satisfies ContextMeta;
  await vfs.write(
    entry.path,
    serializeContextFile(merged, entry.content ?? ''),
  );
}
