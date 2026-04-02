/**
 * Story Discovery
 *
 * Discovers story files and extracts variant metadata using AST analysis.
 */

import { resolveConfig, type StorybookConfig } from '../config';
import type { StoryManifest, StoryRecord } from '../types';
import { extractVariantsFromFile, normalizeVariant } from './extract';
import { type DiscoveredFile, discoverStoryFiles } from './glob';

// Re-export for convenience
export {
  extractVariantsFromFile,
  extractVariantsFromSource,
  normalizeVariant,
} from './extract';
export {
  type DiscoveredFile,
  discoverStoryFiles,
  getFilenameStem,
} from './glob';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of discovering stories.
 */
export type DiscoveryResult = {
  /** The story manifest */
  manifest: StoryManifest;
  /** Discovered files */
  files: DiscoveredFile[];
  /** Warnings encountered during discovery */
  warnings: string[];
};

// ============================================================================
// Manifest Building
// ============================================================================

/**
 * Build a story manifest from discovered files.
 */
export async function buildManifest(
  packageRoot: string,
  config: StorybookConfig,
): Promise<DiscoveryResult> {
  const resolved = resolveConfig(config);
  const warnings: string[] = [];

  // Discover files
  const files = await discoverStoryFiles(
    packageRoot,
    resolved.rules,
    resolved.idFromFile,
  );

  // Extract variants from each file
  const records: StoryRecord[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const result = await extractVariantsFromFile(file.absolutePath);
    warnings.push(...result.warnings);

    for (const variant of result.variants) {
      const normalized = normalizeVariant(variant);

      // Generate ID
      const id =
        normalized.meta.id ??
        resolved.idFromVariant(file.fileId, variant.exportName);

      // Check for duplicate IDs
      if (seenIds.has(id)) {
        warnings.push(
          `Duplicate story ID "${id}" in ${file.relativePath}:${variant.exportName}`,
        );
        continue;
      }
      seenIds.add(id);

      // Infer category from path if not set
      const category =
        normalized.meta.category ??
        resolved.categoryFromPath?.(file.relativePath);

      const record: StoryRecord = {
        id,
        fileId: file.fileId,
        exportName: variant.exportName,
        kind: file.kind,
        filePath: file.relativePath,
        meta: {
          ...normalized.meta,
          category,
        },
        review: normalized.review,
        vrt: normalized.vrt,
      };

      records.push(record);
    }
  }

  // Sort by ID for stable ordering
  records.sort((a, b) => a.id.localeCompare(b.id));

  return {
    manifest: records,
    files,
    warnings,
  };
}

/**
 * Load storybook config from a package.
 */
export async function loadConfig(
  packageRoot: string,
): Promise<StorybookConfig | null> {
  const configPaths = [
    `${packageRoot}/storybook.config.ts`,
    `${packageRoot}/storybook.config.js`,
  ];

  for (const configPath of configPaths) {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      try {
        const mod = await import(configPath);
        return mod.default ?? mod;
      } catch (e) {
        console.error(`Failed to load storybook config from ${configPath}:`, e);
      }
    }
  }

  return null;
}

/**
 * Discover stories for a package.
 */
export async function discoverStories(
  packageRoot: string,
  configOverride?: StorybookConfig,
): Promise<DiscoveryResult> {
  const config = configOverride ?? (await loadConfig(packageRoot));

  if (!config) {
    return {
      manifest: [],
      files: [],
      warnings: [`No storybook.config.ts found in ${packageRoot}`],
    };
  }

  return buildManifest(packageRoot, config);
}
