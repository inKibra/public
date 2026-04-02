import {
  type OverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import type { Logger } from '@inkibra/logger';
import { getActiveLogPathForDir } from './logs';

const logWriteLocks = new Map<string, Promise<void>>();

export async function appendFrontmatterLogEntry(input: {
  vfs: OverlayFs;
  dir: string;
  timestamp: Date;
  logType: string;
  entryText: string;
  logger?: Logger;
}): Promise<void> {
  const totalStartMs = Date.now();
  const logPath = await getActiveLogPathForDir(
    input.vfs,
    input.dir,
    input.timestamp,
    input.logType,
  );

  await withLogPathLock(logPath, async () => {
    const day = input.timestamp.toISOString().slice(0, 10);

    let existing = '';
    const readStartMs = Date.now();
    try {
      existing = await input.vfs.read(logPath);
    } catch {
      // log doesn't exist yet
    }
    const readMs = Date.now() - readStartMs;

    let existingMeta: Record<string, unknown> = {};
    let existingBody = existing;
    const parseStartMs = Date.now();
    if (existing.trim().startsWith('---')) {
      const parsed = parseContextFile(existing);
      existingMeta = parsed.meta;
      existingBody = parsed.content;
    }
    const parseMs = Date.now() - parseStartMs;

    const assembleStartMs = Date.now();
    const newBody = existingBody
      ? `${existingBody}\n---\n${input.entryText}`
      : input.entryText;
    const entryCount = newBody.trim()
      ? newBody.split(/\n---\n/).filter(Boolean).length
      : 0;

    const now = new Date().toISOString();
    const meta = {
      ...existingMeta,
      id: (existingMeta.id as string) ?? logPath,
      type: 'log',
      tags: (existingMeta.tags as string[]) ?? [],
      created: (existingMeta.created as string) ?? now,
      updated: now,
      log_type: input.logType,
      date: (existingMeta.date as string) ?? day,
      entry_count: entryCount,
    };
    const assembleMs = Date.now() - assembleStartMs;

    const serializeStartMs = Date.now();
    const newContent = serializeContextFile(meta, newBody);
    const serializeMs = Date.now() - serializeStartMs;
    const writeStartMs = Date.now();
    await input.vfs.write(logPath, newContent);
    const writeMs = Date.now() - writeStartMs;
    input.logger?.debug('vfs appendFrontmatterLogEntry', {
      path: logPath,
      readMs,
      parseMs,
      assembleMs,
      serializeMs,
      writeMs,
      totalMs: Date.now() - totalStartMs,
    });
  });
}

async function withLogPathLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = logWriteLocks.get(path) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  logWriteLocks.set(path, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (logWriteLocks.get(path) === tail) {
      logWriteLocks.delete(path);
    }
  }
}
