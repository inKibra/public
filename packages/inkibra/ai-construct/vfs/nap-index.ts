import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';
import {
  getLogDateFromName,
  listLogEntriesRecursive,
  parseLogName,
} from './logs';

type NapIndexEntry = {
  date: string;
  path: string;
  summary?: string;
  highlights?: string[];
  updated?: string;
};

const DEFAULT_RECENT_COUNT = 3;

export async function updateNapIndex(
  vfs: OverlayFs,
  recentCount = DEFAULT_RECENT_COUNT,
): Promise<string> {
  const dir = VFS_PATHS.logs.root;
  const indexPath = `${dir}/INDEX.md`;

  const napLogs = (await listLogEntriesRecursive(vfs, dir))
    .map((item) => ({
      entry: item.entry,
      parsed: parseLogName(item.entry.name),
    }))
    .filter((item) => item.parsed !== null)
    .sort((a, b) => {
      if (!a.parsed || !b.parsed) return 0;
      const dateCompare = b.parsed.date.localeCompare(a.parsed.date);
      if (dateCompare !== 0) return dateCompare;
      return b.parsed.index - a.parsed.index;
    });

  const recent = await Promise.all(
    napLogs.slice(0, recentCount).map(async (item) => {
      try {
        const content = await vfs.read(item.entry.path);
        const parsed = parseContextFile(content);
        const summary =
          typeof parsed.meta.summary === 'string'
            ? parsed.meta.summary
            : undefined;
        const highlights = Array.isArray(parsed.meta.highlights)
          ? (parsed.meta.highlights.filter(
              (value): value is string => typeof value === 'string',
            ) as string[])
          : undefined;
        const updated =
          typeof parsed.meta.updated === 'string'
            ? parsed.meta.updated
            : undefined;
        const base: NapIndexEntry = {
          date:
            (parsed.meta.date as string) ??
            getLogDateFromName(item.entry.name) ??
            item.entry.name.replace('.log', ''),
          path: item.entry.path,
        };
        if (summary) {
          base.summary = summary;
        }
        if (highlights && highlights.length > 0) {
          base.highlights = highlights;
        }
        if (updated) {
          base.updated = updated;
        }
        return {
          ...base,
        } satisfies NapIndexEntry;
      } catch {
        return {
          date: getLogDateFromName(item.entry.name) ?? item.entry.name,
          path: item.entry.path,
        } satisfies NapIndexEntry;
      }
    }),
  );

  const now = new Date().toISOString();

  // Read existing index if present
  let existingMeta: Record<string, unknown> = {};
  let existingContent = '';
  try {
    const raw = await vfs.read(indexPath);
    const parsed = parseContextFile(raw);
    existingMeta = parsed.meta;
    existingContent = parsed.content;
  } catch {
    // New index
  }

  await vfs.write(
    indexPath,
    serializeContextFile(
      {
        ...existingMeta,
        id: indexPath,
        tags: (existingMeta.tags as string[]) ?? [],
        created:
          typeof existingMeta.created === 'string' ? existingMeta.created : now,
        updated: now,
        recent,
      },
      existingContent || '# Nap Index\n\nRecent nap logs with summaries.',
    ),
  );

  return indexPath;
}
