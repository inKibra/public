/**
 * Mtime checking utilities for incremental builds.
 */

import { stat } from 'node:fs/promises';
import { file as bunFile, Glob } from 'bun';

/**
 * Get the latest mtime from files matching glob patterns.
 */
export async function getSourcesMtime(
  patterns: string[],
  cwd: string,
): Promise<number> {
  let latestMtime = 0;

  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const path of glob.scan({ cwd, absolute: true })) {
      try {
        const s = await stat(path);
        if (s.mtimeMs > latestMtime) {
          latestMtime = s.mtimeMs;
        }
      } catch {
        // File may have been deleted
      }
    }
  }

  return latestMtime;
}

/**
 * Check if manifest is stale compared to source mtime.
 */
export async function isManifestStale(
  manifestPath: string,
  sourcesMtime: number,
): Promise<boolean> {
  const exists = await bunFile(manifestPath).exists();
  if (!exists) return true;

  try {
    const s = await stat(manifestPath);
    return sourcesMtime > s.mtimeMs;
  } catch {
    return true;
  }
}
