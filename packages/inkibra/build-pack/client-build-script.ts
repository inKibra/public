#!/usr/bin/env bun

/**
 * Standalone client build script.
 *
 * This script is designed to be run as a subprocess to avoid module caching
 * conflicts with vanilla-extract's compile() function.
 *
 * Usage:
 *   bun run client-build-script.ts \
 *     --entry-point ./frontends/tempo/tempo.client.tsx \
 *     --output-dir ./dist/tempo \
 *     --public-path /assets/v1.0.0/tempo \
 *     --package-dir /path/to/package \
 *     --env-defines '{"NODE_ENV":"production"}' \
 *     --plugins '{"vanillaExtract":true,"assetsPath":true}' \
 *     [--splitting] [--minify] [--sourcemap inline|none]
 *
 * The script outputs a JSON result to stdout between markers:
 *   >>>BUILD_RESULT_START>>>
 *   { ... manifest ... }
 *   >>>BUILD_RESULT_END>>>
 */

import { createClientBuildRunner } from './client-build-runner';
import type { ClientBuildPlugins } from './client-config';
import { resolveClientPlugins } from './client-config';
import { parseClientBuildArgs } from './plugins/client-build-cli-args';

// Parse CLI arguments
const args = parseClientBuildArgs(process.argv.slice(2));

// Parse additional args that aren't in the standard CLI parser
const argv = process.argv.slice(2);
let packageDir = process.cwd();
let envDefines: Record<string, string | undefined> = {};
let plugins: ClientBuildPlugins = {};

for (let i = 0; i < argv.length; i++) {
  const nextArg = argv[i + 1];
  if (argv[i] === '--package-dir' && nextArg) {
    packageDir = nextArg;
    i++;
  } else if (argv[i] === '--env-defines' && nextArg) {
    try {
      envDefines = JSON.parse(nextArg);
    } catch (e) {
      console.error('[Build Script] Failed to parse --env-defines:', e);
      process.exit(1);
    }
    i++;
  } else if (argv[i] === '--plugins' && nextArg) {
    try {
      plugins = JSON.parse(nextArg);
    } catch (e) {
      console.error('[Build Script] Failed to parse --plugins:', e);
      process.exit(1);
    }
    i++;
  }
}

// Merge with defaults (auto-enables React Refresh when ASSET_BUILD_MODE=hmr)
const resolvedPlugins: Required<ClientBuildPlugins> =
  resolveClientPlugins(plugins);

if (!args.entryPoint) {
  console.error('[Build Script] Missing required --entry-point');
  process.exit(1);
}

if (!args.outputDir) {
  console.error('[Build Script] Missing required --output-dir');
  process.exit(1);
}

console.log('[Build Script] Starting build...');
console.log('[Build Script] Entry:', args.entryPoint);
console.log('[Build Script] Output:', args.outputDir);
console.log('[Build Script] Package dir:', packageDir);
console.log('[Build Script] Splitting:', args.splitting);
console.log('[Build Script] Plugins:', resolvedPlugins);

// Create and run the build
// Note: No need for buildOptions.external - Bun's target: 'browser' automatically
// uses browser-compatible versions of packages (e.g., pino/browser.js)
const runner = createClientBuildRunner({
  packageDir,
  splitting: args.splitting,
  envDefines,
  plugins: resolvedPlugins,
});

try {
  await runner.runWithArgs(args, { writeManifest: true });
  console.log('[Build Script] Build completed successfully');
} catch (error) {
  console.error('[Build Script] Build failed:', error);
  process.exit(1);
}
