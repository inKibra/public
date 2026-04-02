/**
 * @inkibra/storybook - Configuration
 *
 * Per-package storybook configuration for story discovery and build.
 */

import type { BunPlugin } from 'bun';
import type { StoryKind } from './types';

// ============================================================================
// Glob Rule
// ============================================================================

/**
 * A glob rule for discovering story files.
 */
export type GlobRule = {
  /** Glob pattern relative to package root */
  pattern: string;
  /** Classification for stories matched by this pattern */
  kind: StoryKind;
};

// ============================================================================
// Build Config
// ============================================================================

/**
 * Result from build preload function.
 */
export type BuildPreloadResult = {
  /** Additional Bun plugins from preload */
  plugins?: BunPlugin[];
  /** CSS file paths to inject in HTML head */
  css?: string[];
  /** Raw HTML strings to inject in head */
  head?: string[];
};

/**
 * Build configuration for the storybook runtime.
 */
export type BuildConfig = {
  /** Bun plugins for the bundler (e.g., vanilla-extract) */
  plugins?: BunPlugin[];
  /** CSS file paths to inject as <link> tags in HTML head */
  css?: string[];
  /** Raw HTML strings to inject in <head> (fonts, meta tags, etc.) */
  head?: string[];
  /**
   * Async setup function that runs before build.
   * Use for pre-compilation steps (e.g., vanilla-extract pre-compile).
   * Results are merged with the other options.
   */
  preload?: () => Promise<BuildPreloadResult>;
};

// ============================================================================
// Storybook Config
// ============================================================================

/**
 * Configuration for story discovery in a package.
 */
export type StorybookConfig = {
  /** Glob rules for discovering story files */
  rules: GlobRule[];

  /**
   * Infer category from file path.
   * Called when story's meta.category is not explicitly set.
   *
   * @example
   * ```ts
   * categoryFromPath: (filePath) => {
   *   if (filePath.startsWith('app/feed/')) return 'feed';
   *   if (filePath.startsWith('app/settings')) return 'settings';
   *   return undefined;
   * }
   * ```
   */
  categoryFromPath?: (filePath: string) => string | undefined;

  /**
   * Generate file ID from filename stem.
   * Default: returns the stem as-is.
   *
   * @param stem - Filename without extension (e.g., 'training-home' from 'training-home.story.tsx')
   */
  idFromFile?: (stem: string) => string;

  /**
   * Generate variant ID from file ID and export name.
   * Default: `${fileId}--${kebabCase(exportName)}` or just `${fileId}` if exportName is 'Default'.
   *
   * @param fileId - The file ID
   * @param exportName - The export name (e.g., 'Default', 'WithError')
   */
  idFromVariant?: (fileId: string, exportName: string) => string;

  /**
   * Build configuration for the storybook runtime.
   * Includes CSS paths, Bun plugins, head content, and preload hooks.
   *
   * @example
   * ```ts
   * build: {
   *   css: ['./styles.css'],
   *   head: ['<link href="https://fonts.googleapis.com/..." rel="stylesheet">'],
   *   preload: async () => {
   *     const result = await precompileVanillaExtract({ searchDirs: ['.'] });
   *     return {
   *       plugins: [createVanillaExtractRedirectPlugin(result)],
   *       css: [result.cssBundlePath],
   *     };
   *   },
   * }
   * ```
   */
  build?: BuildConfig;
};

// ============================================================================
// Default Configuration Helpers
// ============================================================================

/**
 * Convert a string to kebab-case.
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Default file ID generator: returns stem as-is.
 */
export function defaultIdFromFile(stem: string): string {
  return stem;
}

/**
 * Default variant ID generator.
 * - If exportName is 'Default', returns just the fileId
 * - Otherwise, returns `${fileId}--${kebabCase(exportName)}`
 */
export function defaultIdFromVariant(
  fileId: string,
  exportName: string,
): string {
  if (exportName === 'Default') {
    return fileId;
  }
  return `${fileId}--${toKebabCase(exportName)}`;
}

// ============================================================================
// Config Factory
// ============================================================================

/**
 * Define a storybook configuration with type safety.
 */
export function defineStorybookConfig(
  config: StorybookConfig,
): StorybookConfig {
  return {
    idFromFile: defaultIdFromFile,
    idFromVariant: defaultIdFromVariant,
    ...config,
  };
}

/**
 * Resolve config with defaults applied.
 */
export function resolveConfig(
  config: StorybookConfig,
): Required<Omit<StorybookConfig, 'categoryFromPath' | 'build'>> &
  Pick<StorybookConfig, 'categoryFromPath' | 'build'> {
  return {
    rules: config.rules,
    categoryFromPath: config.categoryFromPath,
    idFromFile: config.idFromFile ?? defaultIdFromFile,
    idFromVariant: config.idFromVariant ?? defaultIdFromVariant,
    build: config.build,
  };
}
