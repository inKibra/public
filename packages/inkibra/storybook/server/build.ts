/**
 * @inkibra/storybook - Build Script
 *
 * Bundles the chrome and iframe entrypoints for the storybook runtime.
 * Uses Bun's bundler with the storybook plugin for virtual:storybook resolution.
 */

import type { BunPlugin } from 'bun';
import { join } from 'path';
import { storybookPlugin } from '../plugin';

/**
 * Result from preload function, merged into build options.
 */
export type PreloadResult = {
  /** Additional Bun plugins from preload */
  plugins?: BunPlugin[];
  /** CSS file paths to inject in HTML head */
  css?: string[];
  /** Raw HTML strings to inject in head */
  head?: string[];
};

export type BuildOptions = {
  /** Package root directory (defaults to cwd) */
  packageRoot?: string;
  /** Output directory (defaults to dist/ in package root) */
  outdir?: string;
  /** Whether to minify output */
  minify?: boolean;
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
  preload?: () => Promise<PreloadResult>;
};

export type BuildResult = {
  chromeBundle: string;
  iframeBundle: string;
  /** Merged CSS paths (from options + preload) */
  css: string[];
  /** Merged head content (from options + preload) */
  head: string[];
};

/**
 * Build the storybook runtime bundles.
 */
export async function buildStorybookRuntime(
  options: BuildOptions = {},
): Promise<BuildResult> {
  const packageRoot = options.packageRoot ?? process.cwd();
  const outdir = options.outdir ?? join(packageRoot, 'dist');
  const minify = options.minify ?? false;

  // Run preload if provided
  let preloadResult: PreloadResult = {};
  if (options.preload) {
    console.log('[storybook] Running preload...');
    preloadResult = await options.preload();
    console.log('[storybook] Preload complete');
  }

  // Merge plugins from options and preload
  const plugins: BunPlugin[] = [
    ...(options.plugins ?? []),
    ...(preloadResult.plugins ?? []),
  ];

  // Merge CSS paths
  const css: string[] = [...(options.css ?? []), ...(preloadResult.css ?? [])];

  // Merge head content
  const head: string[] = [
    ...(options.head ?? []),
    ...(preloadResult.head ?? []),
  ];

  // Register the storybook plugin for virtual:storybook resolution
  storybookPlugin({ packageRoot, logWarnings: true });

  const runtimeDir = join(import.meta.dir, '..', 'runtime');

  // Build chrome bundle
  const chromeResult = await Bun.build({
    entrypoints: [join(runtimeDir, 'chrome.tsx')],
    outdir,
    target: 'browser',
    format: 'esm',
    minify,
    splitting: true,
    naming: '[name].[ext]',
    plugins,
    external: [], // Bundle everything
  });

  if (!chromeResult.success) {
    console.error('[storybook] Chrome build failed:');
    for (const log of chromeResult.logs) {
      console.error(log);
    }
    throw new Error('Chrome build failed');
  }

  // Build iframe bundle
  const iframeResult = await Bun.build({
    entrypoints: [join(runtimeDir, 'iframe.tsx')],
    outdir,
    target: 'browser',
    format: 'esm',
    minify,
    splitting: true,
    naming: '[name].[ext]',
    plugins,
    external: [],
  });

  if (!iframeResult.success) {
    console.error('[storybook] Iframe build failed:');
    for (const log of iframeResult.logs) {
      console.error(log);
    }
    throw new Error('Iframe build failed');
  }

  return {
    chromeBundle: '/dist/chrome.js',
    iframeBundle: '/dist/iframe.js',
    css,
    head,
  };
}

// CLI entrypoint
if (import.meta.main) {
  const packageRoot = process.argv[2] || process.cwd();

  console.log(`[storybook] Building runtime for: ${packageRoot}`);

  buildStorybookRuntime({ packageRoot })
    .then((result) => {
      console.log('[storybook] Build complete:');
      console.log(`  Chrome: ${result.chromeBundle}`);
      console.log(`  Iframe: ${result.iframeBundle}`);
    })
    .catch((err) => {
      console.error('[storybook] Build error:', err);
      process.exit(1);
    });
}
