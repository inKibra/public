/**
 * @inkibra/storybook - JIT Builder
 *
 * Compiles storybook bundles on-demand.
 */

import type { BunPlugin } from 'bun';
import { join } from 'path';
import { createStorybookBuildPlugin } from '../plugin';

// ============================================================================
// Types
// ============================================================================

export type JitBuildOptions = {
  /** Package root directory */
  packageRoot: string;
  /** Bun plugins for the bundler */
  plugins?: BunPlugin[];
  /** Enable verbose logging */
  verbose?: boolean;
};

export type JitBuildResult = {
  /** JavaScript bundle content */
  js: string;
  /** Source map content (if available) */
  sourceMap?: string;
  /** Build timestamp */
  timestamp: number;
};

// ============================================================================
// JIT Bundle Compilation
// ============================================================================

/**
 * JIT compile a bundle (chrome or iframe) on-demand
 */
export async function jitCompileBundle(
  entrypoint: 'chrome' | 'iframe',
  options: JitBuildOptions,
): Promise<JitBuildResult> {
  const { packageRoot, plugins = [], verbose = false } = options;

  const log = verbose ? console.log.bind(console) : () => {};
  const startTime = Date.now();

  log(`[JIT] Compiling ${entrypoint} bundle...`);

  // Create storybook plugin for virtual:storybook resolution
  const storybookBuildPlugin = createStorybookBuildPlugin({
    packageRoot,
    logWarnings: verbose,
  });

  const runtimeDir = join(import.meta.dir, '..', 'runtime');
  const entrypointPath = join(runtimeDir, `${entrypoint}.tsx`);

  // Build to memory (no outdir)
  const result = await Bun.build({
    entrypoints: [entrypointPath],
    target: 'browser',
    format: 'esm',
    minify: false,
    splitting: false, // Disable splitting for simpler single-file output
    sourcemap: 'inline',
    plugins: [storybookBuildPlugin, ...plugins],
    external: [],
  });

  if (!result.success) {
    console.error(`[JIT] ${entrypoint} build failed:`);
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error(`JIT build failed for ${entrypoint}`);
  }

  // Get the output
  const output = result.outputs[0];
  if (!output) {
    throw new Error(`No output from JIT build for ${entrypoint}`);
  }

  const js = await output.text();
  const elapsed = Date.now() - startTime;

  log(`[JIT] ${entrypoint} compiled in ${elapsed}ms`);

  return {
    js,
    timestamp: Date.now(),
  };
}
