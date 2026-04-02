/**
 * Conversation Index
 *
 * Maintains an index of conversation logs and summary placeholders.
 */

import {
  createContextShell,
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { getUtcIsoWeek } from '../utils/time';
import { getLogDir } from './layout';
import { parseLogFile } from './loader';
import {
  ensureEmptyLogFile,
  getActiveLogPath,
  getLogDateFromName,
  listLogEntriesRecursive,
} from './logs';

type DailyMeta = {
  date: string;
  path: string;
  entry_count: number;
  updated?: string;
};

type SummaryMeta = {
  period: string;
  path: string;
  status: 'pending' | 'complete';
  updated?: string;
};

function getWeekId(date: Date): string {
  const { year, week } = getUtcIsoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function getMonthId(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getQuarterId(date: Date): string {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${quarter}`;
}

function summaryPath(baseDir: string, period: string): string {
  return `${baseDir}/${period}.summary.md`;
}

async function ensureSummaryFile(
  vfs: OverlayFs,
  path: string,
  period: string,
): Promise<void> {
  try {
    await vfs.read(path);
    return; // Already exists
  } catch {
    // Create new
  }

  const now = new Date().toISOString();
  await vfs.write(
    path,
    serializeContextFile(
      {
        id: path,
        tags: [],
        created: now,
        updated: now,
        period,
        status: 'pending',
      },
      `# Summary (${period})\n\nPending summary.`,
    ),
  );
}

export async function updateConversationIndex(vfs: OverlayFs): Promise<{
  indexPath: string;
  recentDaily: string[];
  weekSummary: string;
  monthSummary: string;
  quarterSummary: string;
}> {
  const dir = getLogDir();
  const indexPath = `${dir}/INDEX.md`;

  const now = new Date();
  const weekId = getWeekId(now);
  const monthId = getMonthId(now);
  const quarterId = getQuarterId(now);

  const weekSummary = summaryPath(dir, weekId);
  const monthSummary = summaryPath(dir, monthId);
  const quarterSummary = summaryPath(dir, quarterId);

  await ensureSummaryFile(vfs, weekSummary, weekId);
  await ensureSummaryFile(vfs, monthSummary, monthId);
  await ensureSummaryFile(vfs, quarterSummary, quarterId);

  let daily: DailyMeta[] = [];
  try {
    const logFiles = await listLogEntriesRecursive(vfs, dir);

    daily = await Promise.all(
      logFiles.map(async ({ entry }) => {
        try {
          const content = await vfs.read(entry.path);
          const parsed = parseContextFile(content);
          const entryCount =
            (parsed.meta.entry_count as number) ??
            parseLogFile(parsed.content).length;
          const updated =
            typeof parsed.meta.updated === 'string'
              ? parsed.meta.updated
              : undefined;
          return {
            date:
              (parsed.meta.date as string) ??
              getLogDateFromName(entry.name) ??
              entry.name.replace('.log', ''),
            path: entry.path,
            entry_count: entryCount,
            ...(updated ? { updated } : {}),
          } as DailyMeta;
        } catch {
          return {
            date:
              getLogDateFromName(entry.name) ?? entry.name.replace('.log', ''),
            path: entry.path,
            entry_count: 0,
          } as DailyMeta;
        }
      }),
    );
  } catch {
    daily = [];
  }

  daily = daily.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return (b.updated ?? '').localeCompare(a.updated ?? '');
  });
  const recentDaily = daily.slice(0, 2).map((d) => d.path);

  const dailyFrontmatter = daily.slice(0, 30);
  const weekly: SummaryMeta[] = [
    { period: weekId, path: weekSummary, status: 'pending' },
  ];
  const monthly: SummaryMeta[] = [
    { period: monthId, path: monthSummary, status: 'pending' },
  ];
  const quarterly: SummaryMeta[] = [
    { period: quarterId, path: quarterSummary, status: 'pending' },
  ];

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

  const indexNow = now.toISOString();
  await vfs.write(
    indexPath,
    serializeContextFile(
      {
        ...existingMeta,
        id: indexPath,
        tags: (existingMeta.tags as string[]) ?? [],
        created:
          typeof existingMeta.created === 'string'
            ? existingMeta.created
            : indexNow,
        updated: indexNow,
        daily: dailyFrontmatter,
        weekly,
        monthly,
        quarterly,
      },
      existingContent ||
        '# Conversation Index\n\nThis file tracks recent conversation logs and summary periods.',
    ),
  );

  return { indexPath, recentDaily, weekSummary, monthSummary, quarterSummary };
}

export async function autoOpenConversationContext(
  vfs: OverlayFs,
): Promise<void> {
  const { indexPath, recentDaily } = await updateConversationIndex(vfs);
  const logDir = getLogDir();

  const today = new Date();
  const todayPath = await getActiveLogPath(vfs, 'conversation', today);
  await ensureEmptyLogFile(
    vfs,
    todayPath,
    'conversation',
    today.toISOString().slice(0, 10),
  );

  // Open relevant files into context
  const contextShell = createContextShell(vfs);

  const pathsToOpen = new Set<string>([
    indexPath,
    logDir,
    todayPath,
    ...recentDaily,
  ]);

  for (const path of pathsToOpen) {
    try {
      await contextShell.exec(`open ${path}`);
    } catch {
      // ignore
    }
  }
}
