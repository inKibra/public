/**
 * Glob-based file discovery for story files.
 */

import { basename, relative } from 'node:path';
import { Glob } from 'bun';
import type { GlobRule } from '../config';
import type { StoryKind } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * A discovered story file with its metadata.
 */
export type DiscoveredFile = {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to the package root */
  relativePath: string;
  /** File ID derived from filename stem */
  fileId: string;
  /** Story kind from the matching rule */
  kind: StoryKind;
};

// ============================================================================
// File Discovery
// ============================================================================

/**
 * Extract filename stem (without .story.tsx or .stories.tsx extension).
 */
export function getFilenameStem(filePath: string): string {
  const name = basename(filePath);
  // Remove .story.tsx, .stories.tsx, .story.ts, .stories.ts extensions
  return name.replace(/\.(story|stories)\.(tsx?|jsx?)$/, '');
}

/**
 * Discover story files matching the glob rules.
 */
export async function discoverStoryFiles(
  packageRoot: string,
  rules: GlobRule[],
  idFromFile: (stem: string) => string,
): Promise<DiscoveredFile[]> {
  const discovered: DiscoveredFile[] = [];
  const seenPaths = new Set<string>();

  for (const rule of rules) {
    const glob = new Glob(rule.pattern);
    const matches = glob.scanSync({ cwd: packageRoot, absolute: true });

    for (const absolutePath of matches) {
      // Avoid duplicates if multiple rules match the same file
      if (seenPaths.has(absolutePath)) continue;
      seenPaths.add(absolutePath);

      const relativePath = relative(packageRoot, absolutePath);
      const stem = getFilenameStem(absolutePath);
      const fileId = idFromFile(stem);

      discovered.push({
        absolutePath,
        relativePath,
        fileId,
        kind: rule.kind,
      });
    }
  }

  // Sort by relativePath for stable ordering
  discovered.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return discovered;
}
