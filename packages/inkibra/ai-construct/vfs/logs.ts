import {
  createContextShell,
  type OverlayFs,
  serializeContextFile,
} from '@inkibra/ai-flow';
import type { ImpulseType } from '../impulse/types';
import { getUtcIsoWeek } from '../utils/time';
import { getLogDir, getLogWeekDir, VFS_PATHS } from './layout';

type ParsedLogName = {
  date: string;
  index: number;
  logType: string | null;
};

type FsEntry = Awaited<ReturnType<OverlayFs['list']>>[number];

/** Matches the current log layout only: YYYY-MM-DD-N.type.log */
const LOG_NAME_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})-(\d+)\.([^/]+)\.log$/;

export async function getLatestLogPath(
  vfs: OverlayFs,
  type: ImpulseType,
): Promise<string | null> {
  const dir = getLogDir();
  const candidates = await listLogEntriesRecursive(vfs, dir);
  const typed = candidates.filter((c) => c.parsed?.logType === type);
  const latest = typed.sort(compareLogNames).at(-1);
  return latest ? latest.entry.path : null;
}

export async function getLatestLogPathForDir(
  vfs: OverlayFs,
  dir: string,
): Promise<string | null> {
  const candidates = await listLogEntriesRecursive(vfs, dir);
  const latest = candidates.sort(compareLogNames).at(-1);
  return latest ? latest.entry.path : null;
}

export async function getActiveLogPath(
  vfs: OverlayFs,
  type: ImpulseType,
  date = new Date(),
): Promise<string> {
  const dir = getLogWeekDir(date);
  const day = date.toISOString().slice(0, 10);
  const candidates = (await listLogEntries(vfs, dir)).filter(
    (item) =>
      item.parsed && item.parsed.date === day && item.parsed.logType === type,
  );

  if (candidates.length === 0) {
    return `${dir}/${day}-0.${type}.log`;
  }

  return candidates.sort(compareLogNames)[candidates.length - 1]!.entry.path;
}

export async function getActiveLogPathForDir(
  vfs: OverlayFs,
  dir: string,
  date = new Date(),
  logType?: string,
): Promise<string> {
  const weekDir = getLogWeekDirForDir(dir, date);
  const day = date.toISOString().slice(0, 10);
  const candidates = (await listLogEntries(vfs, weekDir)).filter((item) => {
    if (!item.parsed || item.parsed.date !== day) return false;
    if (logType && item.parsed.logType !== logType) return false;
    return true;
  });

  if (candidates.length === 0) {
    const suffix = logType ? `.${logType}` : '';
    return `${weekDir}/${day}-0${suffix}.log`;
  }

  return candidates.sort(compareLogNames)[candidates.length - 1]!.entry.path;
}

/** Number of previous weeks to open as directory (frontmatter summaries). */
const PREVIOUS_WEEKS_TO_OPEN = 3;

export async function openLatestLogHandles(vfs: OverlayFs): Promise<void> {
  const shell = createContextShell(vfs);
  const now = new Date();

  async function safeExec(cmd: string): Promise<void> {
    try {
      await shell.exec(cmd);
    } catch {
      // ignore — dir/file may not exist yet
    }
  }

  /**
   * Open log handles for a log directory:
   * - Current week: open year dir, week dir, and current log file (full)
   * - Previous N weeks: open week dir (directory open → frontmatter summaries)
   */
  async function openLogDirHandles(dir: string): Promise<void> {
    // Current week: year dir + week dir + active log file
    await safeExec(`open ${getLogYearDirForDir(dir, now)}`);
    await safeExec(`open ${getLogWeekDirForDir(dir, now)}`);
    const current = await getActiveLogPathForDir(vfs, dir, now);
    if (current) await safeExec(`open ${current}`);

    // Previous weeks: open as directory (gives frontmatter summaries of children)
    for (let i = 1; i <= PREVIOUS_WEEKS_TO_OPEN; i++) {
      const prevDate = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const prevWeekDir = getLogWeekDirForDir(dir, prevDate);
      await safeExec(`open ${prevWeekDir}`);
    }
  }

  // All log types share /logs/ — open once
  await openLogDirHandles(getLogDir());
}

export async function openNapSummaryContext(vfs: OverlayFs): Promise<void> {
  const shell = createContextShell(vfs);
  const now = new Date();
  try {
    await shell.exec(`open ${getLogYearDirForDir(VFS_PATHS.logs.root, now)}`);
  } catch {
    // ignore
  }

  try {
    await shell.exec(`open ${getLogWeekDirForDir(VFS_PATHS.logs.root, now)}`);
  } catch {
    // ignore
  }

  const latestNap = await getLatestLogPathForDir(vfs, VFS_PATHS.logs.root);
  if (latestNap) {
    try {
      await shell.exec(`open --frontmatter ${latestNap}`);
    } catch {
      // ignore
    }
  }
}

export async function getRecentNapLogs(
  vfs: OverlayFs,
  count: number,
): Promise<string[]> {
  const entries = await listLogEntriesRecursive(vfs, VFS_PATHS.logs.root);
  const sorted = entries.sort(compareLogNames);
  return sorted.slice(-count).map((item) => item.entry.path);
}

export async function getRandomNapLogs(
  vfs: OverlayFs,
  count: number,
  exclude: string[] = [],
): Promise<string[]> {
  const entries = await listLogEntriesRecursive(vfs, VFS_PATHS.logs.root);
  const eligible = entries
    .map((item) => item.entry.path)
    .filter((path) => !exclude.includes(path));

  if (eligible.length === 0) return [];

  const selected: string[] = [];
  const pool = [...eligible];

  while (pool.length > 0 && selected.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    selected.push(pool.splice(index, 1)[0]!);
  }

  return selected;
}

export async function ensureEmptyLogFile(
  vfs: OverlayFs,
  path: string,
  impulseType: ImpulseType,
  day: string,
): Promise<void> {
  try {
    await vfs.read(path);
    return;
  } catch {
    // continue
  }

  const now = new Date().toISOString();
  const content = serializeContextFile(
    {
      id: path,
      type: 'log',
      tags: [],
      created: now,
      updated: now,
      log_type: impulseType,
      date: day,
      entry_count: 0,
    },
    '',
  );

  await vfs.write(path, content);
}

export function parseLogName(name: string): ParsedLogName | null {
  const match = name.match(LOG_NAME_RE);
  if (!match) return null;

  const date = match[1]!;
  const index = Number.parseInt(match[2]!, 10);
  const logType = match[3]!;
  return {
    date,
    index: Number.isNaN(index) ? 0 : index,
    logType,
  };
}

export function getLogDateFromName(name: string): string | null {
  const parsed = parseLogName(name);
  return parsed ? parsed.date : null;
}

function compareLogNames(
  a: { parsed: ParsedLogName | null },
  b: { parsed: ParsedLogName | null },
): number {
  if (!a.parsed || !b.parsed) return 0;
  if (a.parsed.date !== b.parsed.date) {
    return a.parsed.date.localeCompare(b.parsed.date);
  }
  if (a.parsed.index !== b.parsed.index) {
    return a.parsed.index - b.parsed.index;
  }
  return 0;
}

async function listLogEntries(vfs: OverlayFs, dir: string) {
  const entries = await safeList(vfs, dir);
  return entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({ entry, parsed: parseLogName(entry.name) }))
    .filter((item) => item.parsed !== null);
}

export async function listLogEntriesRecursive(vfs: OverlayFs, dir: string) {
  const entries = await safeList(vfs, dir);
  const results: Array<{ entry: FsEntry; parsed: ParsedLogName | null }> = [];

  for (const entry of entries) {
    if (entry.type === 'file') {
      results.push({ entry, parsed: parseLogName(entry.name) });
    } else if (entry.type === 'directory') {
      const nested = await safeList(vfs, entry.path);
      for (const child of nested) {
        if (child.type === 'file') {
          results.push({ entry: child, parsed: parseLogName(child.name) });
        } else if (child.type === 'directory') {
          const deep = await safeList(vfs, child.path);
          for (const deepEntry of deep) {
            if (deepEntry.type === 'file') {
              results.push({
                entry: deepEntry,
                parsed: parseLogName(deepEntry.name),
              });
            }
          }
        }
      }
    }
  }

  return results.filter((item) => item.parsed !== null);
}

function getLogYearDirForDir(dir: string, date = new Date()): string {
  const { year } = getUtcIsoWeek(date);
  return `${dir}/${year}`;
}

function getLogWeekDirForDir(dir: string, date = new Date()): string {
  const { year, week } = getUtcIsoWeek(date);
  const weekLabel = String(week).padStart(2, '0');
  return `${dir}/${year}/W${weekLabel}`;
}

async function safeList(vfs: OverlayFs, path: string) {
  try {
    return await vfs.list(path);
  } catch {
    return [];
  }
}
