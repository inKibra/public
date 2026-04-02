/**
 * Preload Runner
 *
 * Provides a clean, explicit API for configuring Bun preload scripts.
 * Reduces boilerplate in preload.ts files while keeping configuration visible.
 *
 * @example
 * ```typescript
 * import { createPreload } from '@inkibra/build-pack';
 *
 * createPreload({
 *   packageDir: import.meta.dir,
 *   matchScripts: ['server.ts', 'scripts', '.test.ts'],
 *   plugins: {
 *     loadSchemas: true,
 *     assetsPath: true,
 *     clientBuild: false,
 *     vanillaExtractNoop: true,
 *   },
 *   // Paths are optional - derived from packageDir and package.json
 * });
 * ```
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { type BunPlugin, plugin } from 'bun';
import { setServerPackageDir } from './client-manifest';
import { assetsPathPlugin } from './plugins/assets-path-plugin';
import { clientBuildPlugin } from './plugins/client-build-plugin';
import { clientStubPlugin } from './plugins/client-stub-plugin';
import { loadSchemasPlugin } from './plugins/load-schemas-plugin';
import { vanillaExtractNoopPlugin } from './plugins/vanilla-extract-noop-plugin';
import {
  createVanillaExtractPrecompiledPlugin,
  createVanillaExtractSsrPlugin,
} from './plugins/vanilla-extract-precompile';

// ============================================================================
// Types
// ============================================================================

/**
 * Plugin configuration for preload
 */
export type PreloadPlugins = {
  /** Enable typia schema loading (default: true) */
  loadSchemas?: boolean;
  /** Code mode transform plugin for .tool.ts files (default: disabled). */
  codeMode?: boolean | BunPlugin;
  /** Enable assets path resolution (default: true) */
  assetsPath?: boolean;
  /**
   * Enable client stub plugin for buildConfig extraction (default: true).
   * This is the new pattern - extracts buildConfig from .client.tsx files
   * without loading browser code.
   */
  clientStub?: boolean;
  /**
   * @deprecated Use buildConfig pattern with clientStub instead.
   * Enable legacy client build plugin for .client.tsx files (default: false).
   */
  clientBuild?: boolean;
  /**
   * Enable vanilla-extract noop plugin for .css.ts files (default: false)
   * When enabled, redirects @vanilla-extract/* imports to noop stubs so
   * .css.ts files can execute without VE build support. Class names will
   * be empty strings - styles only apply after client hydration.
   */
  vanillaExtractNoop?: boolean;
  /**
   * Enable vanilla-extract SSR plugin for .css.ts files (default: false)
   * When enabled, pre-compiles all .css.ts files to ensure server and client
   * use identical class names for proper hydration.
   */
  vanillaExtractSsr?: boolean;
  /** Enable vanilla-extract precompiled plugin (default: false) */
  vanillaExtractPrecompiled?: boolean;
  /**
   * Directories to search for .css.ts files during pre-compilation.
   * Required when vanillaExtractSsr is enabled.
   */
  vanillaExtractSearchDirs?: string[];
  /**
   * Output directory for pre-compiled vanilla-extract files.
   * Default: 'dist/vanilla-extract'
   */
  vanillaExtractOutdir?: string;
  /**
   * Identifier mode for vanilla-extract class names.
   * Must match the client build configuration.
   * Default: 'debug'
   */
  vanillaExtractIdentifiers?: 'short' | 'debug';
  /** Enable code splitting for client bundles (default: true) */
  splitting?: boolean;
  /**
   * Per-frontend splitting overrides.
   * Keys are patterns to match against the client path.
   * Values are the splitting setting for that frontend.
   *
   * @example
   * ```typescript
   * splittingOverrides: {
   *   'my-ios-app': false,  // Disable splitting for iOS app (OTA needs single bundle)
   * }
   * ```
   */
  splittingOverrides?: Record<string, boolean>;
  /**
   * Per-frontend format overrides.
   * Keys are patterns to match against the client path.
   * Values are the format ('esm' | 'cjs' | 'iife') for that frontend.
   *
   * @example
   * ```typescript
   * formatOverrides: {
   *   'my-ios-app': 'cjs',  // Use CJS for iOS app (OTA loader can't handle ESM)
   * }
   * ```
   */
  formatOverrides?: Record<string, 'esm' | 'cjs' | 'iife'>;
  /**
   * Per-frontend minify overrides.
   * Keys are patterns to match against the client path.
   * Values are the minify setting for that frontend.
   */
  minifyOverrides?: Record<string, boolean>;
};

type ResolvedPreloadPlugins = Required<Omit<PreloadPlugins, 'codeMode'>> & {
  codeMode: BunPlugin | null;
};

/**
 * Path configuration for preload
 */
export type PreloadPaths = {
  /** Assets source directory (default: packageDir/assets) */
  assets?: string;
  /** Output directory (default: ./dist) */
  outdir?: string;
  /** Public path for URLs (default: /dist) */
  publicPath?: string;
  /** Public path for assets (default: /dist/assets) */
  assetsPublicPath?: string;
};

/**
 * Script matching configuration
 */
export type PreloadMatchScripts = {
  /**
   * Scripts that need full plugin support (server, dev, tests).
   * These get loadSchemas, assetsPath, AND clientBuild plugins.
   */
  server?: string[];
  /**
   * Scripts that only need build plugins (build-clients.ts).
   * These get loadSchemas and assetsPath, but NOT clientBuild.
   */
  buildClients?: string[];
};

/**
 * Configuration for createPreload
 */
export type PreloadConfig = {
  /** Package directory (typically import.meta.dir) */
  packageDir: string;

  /**
   * Script patterns to match.
   * Can be a simple array (applies to all scripts) or an object with server/buildClients keys.
   */
  matchScripts: string[] | PreloadMatchScripts;

  /** Plugin configuration (can override defaults per context) */
  plugins?: PreloadPlugins;

  /** Path configuration */
  paths?: PreloadPaths;
};

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Check if current script matches any of the patterns
 */
function matchesScript(patterns: string[]): boolean {
  const candidates = new Set<string>();

  const argvPath = process.argv.at(1);
  if (argvPath) {
    candidates.add(argvPath);
  }

  if (typeof Bun !== 'undefined' && Array.isArray(Bun.argv)) {
    for (const arg of Bun.argv) {
      if (typeof arg === 'string' && arg.length > 0) {
        candidates.add(arg);
      }
    }
  }

  if (candidates.size === 0) {
    return false;
  }

  return patterns.some((pattern) =>
    [...candidates].some((candidate) => candidate.includes(pattern)),
  );
}

function isClientBuildSubprocess(): boolean {
  if (process.env.INKIBRA_CLIENT_BUILD_SUBPROCESS === '1') {
    return true;
  }

  const candidates = new Set<string>();

  const argvPath = process.argv.at(1);
  if (argvPath) {
    candidates.add(argvPath);
  }

  if (typeof Bun !== 'undefined') {
    if (typeof Bun.main === 'string' && Bun.main.length > 0) {
      candidates.add(Bun.main);
    }

    if (Array.isArray(Bun.argv)) {
      for (const arg of Bun.argv) {
        if (typeof arg === 'string' && arg.length > 0) {
          candidates.add(arg);
        }
      }
    }
  }

  return [...candidates].some((candidate) =>
    candidate.includes('client-build-script.ts'),
  );
}

/**
 * Register plugins based on configuration
 */
function registerPlugins(
  config: {
    packageDir: string;
    plugins: ResolvedPreloadPlugins;
    paths: Required<PreloadPaths>;
  },
  context: 'server' | 'buildClients',
) {
  const { plugins, paths, packageDir } = config;

  // Always register loadSchemas if enabled
  if (plugins.loadSchemas) {
    plugin(loadSchemasPlugin);
  }

  if (plugins.codeMode && context === 'server') {
    plugin(plugins.codeMode);
  }

  // Register assetsPath if enabled
  if (plugins.assetsPath) {
    plugin(
      assetsPathPlugin({
        assetsPath: paths.assets,
        outdir: paths.outdir,
        publicPath: paths.assetsPublicPath,
      }),
    );
  }

  // Register clientStub for server context (new buildConfig pattern)
  if (plugins.clientStub && context === 'server') {
    plugin(clientStubPlugin());
  }

  // Register legacy clientBuild only for server context (deprecated)
  if (plugins.clientBuild && context === 'server') {
    console.warn(
      '[Preload] clientBuild plugin is deprecated. ' +
        'Migrate to buildConfig pattern with getClientManifest().',
    );
    plugin(
      clientBuildPlugin({
        outdir: paths.outdir,
        publicPath: paths.publicPath,
        buildScriptPath: `${packageDir}/build-clients.ts`,
        assetsPath: paths.assets,
        assetsPublicPath: paths.assetsPublicPath,
        splitting: plugins.splitting,
        splittingOverrides: plugins.splittingOverrides,
        formatOverrides: plugins.formatOverrides,
        minifyOverrides: plugins.minifyOverrides,
      }),
    );
  }

  // Register vanilla-extract plugins for server context
  // Priority: noop > precompiled > ssr (only one should be enabled)
  if (plugins.vanillaExtractNoop && context === 'server') {
    if (isClientBuildSubprocess()) {
      console.log('[Preload] Skipping vanilla-extract noop in client build');
    } else {
      // Noop plugin - redirects VE imports to stubs, no build support needed
      plugin(vanillaExtractNoopPlugin());
      console.log(
        '[Preload] Vanilla-extract noop plugin enabled (no VE build support)',
      );
    }
  } else if (plugins.vanillaExtractPrecompiled && context === 'server') {
    plugin(createVanillaExtractPrecompiledPlugin(plugins.vanillaExtractOutdir));
    console.log('[Preload] Vanilla-extract precompiled plugin enabled');
  } else if (plugins.vanillaExtractSsr && context === 'server') {
    if (plugins.vanillaExtractSearchDirs.length === 0) {
      console.warn(
        '[Preload] vanillaExtractSsr enabled but no searchDirs specified',
      );
    }
    plugin(
      createVanillaExtractSsrPlugin({
        searchDirs: plugins.vanillaExtractSearchDirs,
        outdir: plugins.vanillaExtractOutdir,
        identifiers: plugins.vanillaExtractIdentifiers,
        verbose: true,
      }),
    );
    console.log('[Preload] Vanilla-extract SSR pre-compile plugin enabled');
  }
}

function resolveCodeModePlugin(
  packageDir: string,
  codeMode: boolean | BunPlugin | undefined,
): BunPlugin | null {
  if (!codeMode) {
    return null;
  }

  if (typeof codeMode === 'object') {
    return codeMode;
  }

  if (codeMode !== true) {
    return null;
  }

  try {
    const packageRequire = createRequire(path.join(packageDir, 'package.json'));
    const module = packageRequire('@inkibra/ai-flow/codemode/plugin') as {
      codeBindingPlugin?: BunPlugin;
    };

    if (module.codeBindingPlugin) {
      return module.codeBindingPlugin;
    }

    console.warn(
      '[Preload] codeMode=true but @inkibra/ai-flow/codemode/plugin did not export codeBindingPlugin',
    );
    return null;
  } catch {
    console.warn(
      `[Preload] codeMode=true but @inkibra/ai-flow/codemode/plugin could not be resolved for ${packageDir}`,
    );
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create and configure a preload for Bun.
 *
 * This function checks if the current script matches any configured patterns
 * and registers the appropriate plugins.
 *
 * @example
 * ```typescript
 * // Simple usage - same plugins for all matched scripts
 * createPreload({
 *   packageDir: import.meta.dir,
 *   matchScripts: ['server', 'dev.ts', '.test.ts'],
 * });
 *
 * // Advanced usage - different plugins for server vs build-clients
 * createPreload({
 *   packageDir: import.meta.dir,
 *   matchScripts: {
 *     server: ['server', 'dev.ts', 'start.ts', '.test.ts'],
 *     buildClients: ['build-clients.ts'],
 *   },
 * });
 * ```
 */
export function createPreload(config: PreloadConfig): void {
  const { packageDir, matchScripts, plugins = {}, paths = {} } = config;

  // Resolve plugin defaults
  const resolvedPlugins: ResolvedPreloadPlugins = {
    loadSchemas: plugins.loadSchemas ?? true,
    codeMode: resolveCodeModePlugin(packageDir, plugins.codeMode),
    assetsPath: plugins.assetsPath ?? true,
    clientStub: plugins.clientStub ?? true, // New default: enabled
    clientBuild: plugins.clientBuild ?? false, // Deprecated: disabled by default
    vanillaExtractNoop: plugins.vanillaExtractNoop ?? false,
    vanillaExtractSsr: plugins.vanillaExtractSsr ?? false,
    vanillaExtractPrecompiled: plugins.vanillaExtractPrecompiled ?? false,
    vanillaExtractSearchDirs: plugins.vanillaExtractSearchDirs ?? [],
    vanillaExtractOutdir:
      plugins.vanillaExtractOutdir ?? 'dist/vanilla-extract',
    vanillaExtractIdentifiers: plugins.vanillaExtractIdentifiers ?? 'debug',
    splitting: plugins.splitting ?? true,
    splittingOverrides: plugins.splittingOverrides ?? {},
    formatOverrides: plugins.formatOverrides ?? {},
    minifyOverrides: plugins.minifyOverrides ?? {},
  };

  // Read package.json for assetsPublicPath override
  let pkgAssetsPublicPath: string | undefined;
  try {
    const pkgPath = path.join(packageDir, 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent) as {
      assetsPublicPath?: string;
    };
    pkgAssetsPublicPath = pkg.assetsPublicPath;
  } catch {
    // Ignore errors reading package.json
  }

  // Resolve path defaults (derive from package.json where possible)
  const resolvedPaths: Required<PreloadPaths> = {
    assets: paths.assets ?? `${packageDir}/assets`,
    outdir: paths.outdir ?? './dist',
    publicPath: paths.publicPath ?? '/dist',
    assetsPublicPath:
      paths.assetsPublicPath ?? pkgAssetsPublicPath ?? '/dist/assets',
  };

  const resolvedConfig = {
    packageDir,
    plugins: resolvedPlugins,
    paths: resolvedPaths,
  };

  // Handle simple array format (all scripts get server treatment)
  if (Array.isArray(matchScripts)) {
    if (matchesScript(matchScripts)) {
      const packageName = packageDir.split('/').pop() || 'unknown';
      console.log(`[Preload] Running preload for ${packageName}`);
      // Set server package dir for client manifest builds
      setServerPackageDir(packageDir);
      registerPlugins(resolvedConfig, 'server');
    }
    return;
  }

  // Handle object format with server/buildClients distinction
  const { server = [], buildClients = [] } = matchScripts;

  if (matchesScript(server)) {
    const packageName = packageDir.split('/').pop() || 'unknown';
    console.log(`[Preload] Running preload for ${packageName} (server)`);
    // Set server package dir for client manifest builds
    setServerPackageDir(packageDir);
    registerPlugins(resolvedConfig, 'server');
    return;
  }

  if (matchesScript(buildClients)) {
    const packageName = packageDir.split('/').pop() || 'unknown';
    console.log(`[Preload] Running preload for ${packageName} (build-clients)`);
    registerPlugins(resolvedConfig, 'buildClients');
    return;
  }
}
