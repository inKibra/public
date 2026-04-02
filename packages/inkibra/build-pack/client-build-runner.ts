/**
 * Client Build Runner
 *
 * Provides a clean, explicit API for building client bundles with sensible defaults.
 * Reduces boilerplate in build-clients.ts files while keeping configuration visible.
 *
 * @example
 * ```typescript
 * import { createClientBuildRunner } from '@inkibra/build-pack';
 *
 * await createClientBuildRunner({
 *   packageDir: import.meta.dir,
 *   plugins: {
 *     loadSchemas: true,
 *     assetsPath: true,
 *     reactRefresh: true,
 *   },
 *   splitting: true,
 *   envDefines: {
 *     MY_CUSTOM_VAR: process.env.MY_CUSTOM_VAR,
 *   },
 * }).run();
 * ```
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BunPlugin } from 'bun';
import { isHmrEnabled } from './client-config';
import { createReactRefreshPlugin } from './hmr';
import { assetsPathPlugin } from './plugins/assets-path-plugin';
import type {
  ChunkOutput,
  ClientBuildCliArgs,
  ClientBuildResult,
  ClientBuildResultWithChunks,
} from './plugins/client-build-cli-args';
import { parseClientBuildArgs } from './plugins/client-build-cli-args';
import { loadSchemasPlugin } from './plugins/load-schemas-plugin';
import { vanillaBuildPlugin } from './plugins/vanilla-extract-plugin';

// ============================================================================
// Types
// ============================================================================

/**
 * Plugin configuration - explicit about what's enabled
 */
export type ClientBuildPlugins = {
  /** Enable typia schema loading (default: true) */
  loadSchemas?: boolean;
  /** Enable assets path resolution (default: true) */
  assetsPath?: boolean;
  /** Enable React Refresh for HMR (default: NODE_ENV !== 'production') */
  reactRefresh?: boolean;
  /** Enable vanilla-extract CSS processing (default: true) */
  vanillaExtract?: boolean;
};

/**
 * Path configuration - override defaults if needed
 */
export type ClientBuildPaths = {
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
 * Configuration for createClientBuildRunner
 */
export type ClientBuildRunnerConfig = {
  /** Package directory (typically import.meta.dir) */
  packageDir: string;

  /** Plugin configuration */
  plugins?: ClientBuildPlugins;

  /** Path overrides */
  paths?: ClientBuildPaths;

  /** Enable code splitting (default: false) */
  splitting?: boolean;

  /** Custom environment variables to inject into process.env */
  envDefines?: Record<string, string | undefined>;

  /** Additional Bun plugins */
  additionalPlugins?: BunPlugin[];

  /** Override Bun.build options directly */
  buildOptions?: Partial<Parameters<typeof Bun.build>[0]>;
};

// ============================================================================
// Internal Helpers
// ============================================================================

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Creates a plugin that tracks all resolved source files during build.
 * This allows us to determine which directories to watch for HMR.
 */
function createFileTrackingPlugin(resolvedDirs: Set<string>): BunPlugin {
  return {
    name: 'file-tracker',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Only track relative and absolute paths (not bare imports like 'react')
        if (args.path.startsWith('.') || args.path.startsWith('/')) {
          const resolved = args.path.startsWith('/')
            ? args.path
            : path.resolve(args.resolveDir, args.path);

          // Exclude node_modules
          if (!resolved.includes('node_modules')) {
            resolvedDirs.add(path.dirname(resolved));
          }
        }
        // Return undefined to let Bun handle the actual resolution
        return undefined;
      });
    },
  };
}

/**
 * Convert absolute paths to relative paths from a base directory,
 * and filter to only directories within the package.
 */
function getRelativeWatchDirs(
  absoluteDirs: Set<string>,
  packageDir: string,
): string[] {
  const uniqueDirs = new Set<string>();

  for (const absDir of absoluteDirs) {
    // Only include directories within the package
    if (absDir.startsWith(packageDir)) {
      const relative = path.relative(packageDir, absDir);
      if (relative && !relative.startsWith('..')) {
        // Get the top-level directory (e.g., 'app', 'frontend', 'components')
        const topLevel = relative.split(path.sep)[0];
        if (topLevel) {
          uniqueDirs.add(topLevel);
        }
      }
    }
  }

  return [...uniqueDirs].sort();
}

function getWorkspaceDependencyWatchDirs(packageDir: string): string[] {
  const pkgPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [];
  }

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as typeof pkg;
  } catch {
    return [];
  }

  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };

  const workspaceRoot = path.dirname(packageDir);
  const watchDirs = new Set<string>();

  for (const [name, version] of Object.entries(deps)) {
    if (!name.startsWith('@inkibra/')) continue;
    if (typeof version === 'string' && !version.startsWith('workspace:')) {
      continue;
    }

    const packageName = name.replace('@inkibra/', '');
    const depDir = path.join(workspaceRoot, packageName);
    if (!fs.existsSync(depDir)) {
      continue;
    }

    const relative = path.relative(packageDir, depDir);
    if (relative && relative !== '.') {
      watchDirs.add(relative);
    }
  }

  return [...watchDirs].sort();
}

function outputResult(result: ClientBuildResult | ClientBuildResultWithChunks) {
  console.log('>>>BUILD_RESULT_START>>>');
  console.log(JSON.stringify(result));
  console.log('>>>BUILD_RESULT_END>>>');
}

function writeBundleManifest(
  result: ClientBuildResult | ClientBuildResultWithChunks,
  outputDir: string,
) {
  if (!('entryUrl' in result)) {
    return;
  }
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2));
  console.log('[Build] Bundle manifest written:', manifestPath);
}

function computeHash(content: string): { short: string; full: string } {
  const fullHash = createHash('sha256').update(content).digest('hex');
  return {
    short: fullHash.slice(0, 8),
    full: fullHash,
  };
}

function createInlineCssInjection(cssContent: string, hash: string): string {
  const styleId = `inkibra-inline-css-${hash}`;
  return `;(() => {
  if (typeof document === 'undefined') return;
  const styleId = ${JSON.stringify(styleId)};
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.appendChild(document.createTextNode(${JSON.stringify(cssContent)}));
  (document.head || document.documentElement).appendChild(style);
})();`;
}

function injectInlineCss(content: string, injection: string): string {
  if (!injection) {
    return content;
  }
  const useStrictMatch = content.match(/^\s*(['"])use strict\1;?/);
  if (!useStrictMatch || useStrictMatch.index === undefined) {
    return `${injection}\n${content}`;
  }
  const insertAt = useStrictMatch.index + useStrictMatch[0].length;
  return `${content.slice(0, insertAt)}\n${injection}\n${content.slice(insertAt)}`;
}

function getHashedOutputPath(outputPath: string, shortHash: string): string {
  const parsed = path.parse(outputPath);
  const baseName = parsed.name.replace(/\.[a-z0-9]{8}$/, '');
  return path.join(parsed.dir, `${baseName}.${shortHash}${parsed.ext}`);
}

/**
 * Strip client-stub function exports that shouldn't be in the client bundle.
 * These are server-side functions that throw errors if called directly.
 */
function stripStubExports(content: string): string {
  const stubFunctions = ['getClientAssetTags', 'getClientAppManifestInfo'];
  let result = content;
  for (const fnName of stubFunctions) {
    // Match export statements like:
    // - export { getClientAssetTags };
    // - export{s$1 as getClientAssetTags};
    result = result.replace(
      new RegExp(`export\\s*\\{[^}]*\\b${fnName}\\b[^}]*\\}\\s*;?\\s*`, 'g'),
      '',
    );
  }
  return result;
}

/**
 * Extract the original import path from a chunk's sourcefile.
 */
function extractImportPath(
  output: Awaited<ReturnType<typeof Bun.build>>['outputs'][number],
  entryDir: string,
): string {
  // @ts-expect-error - sourcefile may exist on output
  const sourcefile = output.sourcefile as string | undefined;

  if (sourcefile) {
    const relative = path.relative(entryDir, sourcefile);
    const withoutExt = relative.replace(/\.(tsx?|jsx?)$/, '');
    return withoutExt.startsWith('.') ? withoutExt : `./${withoutExt}`;
  }

  // Fallback: derive from output path
  const basename = path.basename(output.path, '.js');
  const withoutHash = basename.replace(/\.[a-z0-9]+$/, '');
  return `./${withoutHash}`;
}

/**
 * Resolve configuration with defaults
 */
function resolveConfig(config: ClientBuildRunnerConfig) {
  const {
    packageDir,
    plugins = {},
    paths = {},
    splitting = false,
    envDefines = {},
    additionalPlugins = [],
    buildOptions = {},
  } = config;

  // Plugin defaults (auto-enable React Refresh when ASSET_BUILD_MODE=hmr)
  const resolvedPlugins = {
    loadSchemas: plugins.loadSchemas ?? true,
    assetsPath: plugins.assetsPath ?? true,
    reactRefresh: plugins.reactRefresh ?? isHmrEnabled(),
    vanillaExtract: plugins.vanillaExtract ?? true,
  };

  // Path defaults
  const resolvedPaths = {
    assets: paths.assets ?? `${packageDir}/assets`,
    outdir: paths.outdir ?? './dist',
    publicPath: paths.publicPath ?? '/dist',
    assetsPublicPath: paths.assetsPublicPath ?? '/dist/assets',
  };

  return {
    packageDir,
    plugins: resolvedPlugins,
    paths: resolvedPaths,
    splitting,
    envDefines,
    additionalPlugins,
    buildOptions,
  };
}

/**
 * Build the plugins array based on configuration
 */
function buildPluginsArray(
  config: ReturnType<typeof resolveConfig>,
  cliArgs: ClientBuildCliArgs,
): BunPlugin[] {
  const plugins: BunPlugin[] = [];

  // Vanilla-extract should be first to process .css.ts files before other plugins
  if (config.plugins.vanillaExtract) {
    plugins.push(vanillaBuildPlugin);
    console.log('[Build] Vanilla-extract plugin enabled for CSS processing');
  }

  if (config.plugins.loadSchemas) {
    plugins.push(loadSchemasPlugin);
  }

  if (config.plugins.assetsPath) {
    plugins.push(
      assetsPathPlugin({
        assetsPath: cliArgs.assetsPath || config.paths.assets,
        outdir: cliArgs.assetsOutdir || config.paths.outdir,
        publicPath: cliArgs.assetsPublicPath || config.paths.assetsPublicPath,
      }),
    );
  }

  if (config.plugins.reactRefresh) {
    plugins.push(createReactRefreshPlugin());
    console.log('[Build] React Refresh plugin enabled for HMR');
  }

  // Add any additional plugins
  plugins.push(...config.additionalPlugins);

  return plugins;
}

/**
 * Build the Bun.build configuration
 */
function buildBunConfig(
  config: ReturnType<typeof resolveConfig>,
  cliArgs: ClientBuildCliArgs,
  plugins: BunPlugin[],
): Parameters<typeof Bun.build>[0] {
  // Merge standard env with custom defines
  const envDefines = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    ...config.envDefines,
  };

  const bunConfig: Parameters<typeof Bun.build>[0] = {
    entrypoints: [cliArgs.entryPoint],
    sourcemap: cliArgs.sourcemap,
    target: 'browser',
    format: cliArgs.format,
    minify: cliArgs.minify,
    define: {
      global: 'globalThis',
      'process.env': JSON.stringify(envDefines),
      'import.meta.env': JSON.stringify({
        DEV: !isProduction,
        PROD: isProduction,
      }),
    },
    plugins,
    // Apply any direct overrides
    ...config.buildOptions,
  };

  // Configure output directory and splitting
  if (cliArgs.outputDir) {
    bunConfig.outdir = cliArgs.outputDir;
    bunConfig.naming = {
      entry: '[name].[hash].js',
      chunk: 'chunks/[name].[hash].js',
    };
    // Only enable code splitting when explicitly requested
    if (config.splitting || cliArgs.splitting) {
      bunConfig.splitting = true;
    }
  }

  return bunConfig;
}

// ============================================================================
// Build Functions
// ============================================================================

async function buildClient(
  config: ReturnType<typeof resolveConfig>,
  cliArgs: ClientBuildCliArgs,
  options: { writeManifest?: boolean } = {},
) {
  console.log('[Build] Building client', cliArgs.entryPoint);
  console.log('[Build] Output dir:', cliArgs.outputDir);
  console.log('[Build] Public path:', cliArgs.publicPath);

  // Track all resolved directories during build
  const resolvedDirs = new Set<string>();

  const plugins = buildPluginsArray(config, cliArgs);
  // Add file tracking plugin at the start so it sees all resolutions
  plugins.unshift(createFileTrackingPlugin(resolvedDirs));

  const bunConfig = buildBunConfig(config, cliArgs, plugins);
  const bundle = await Bun.build(bunConfig);

  if (!bundle.success) {
    console.error('[Build] Build failed:', bundle.logs);
    for (const log of bundle.logs) {
      console.error(log);
    }
    outputResult({
      success: false,
      entryUrl: '',
      entryHash: '',
      entryFullHash: '',
      outputs: [],
      chunkMap: {},
    });
    process.exit(1);
  }

  // Extract CSS output from vanilla-extract (if any)
  // In outdir mode, vanilla-extract may output CSS as .js assets.
  const cssOutputs = new Set<(typeof bundle.outputs)[number]>();
  const cssContents: string[] = [];

  for (const output of bundle.outputs) {
    if (!output.path.endsWith('.css')) {
      continue;
    }
    cssOutputs.add(output);
    cssContents.push(await output.text());
  }

  for (const output of bundle.outputs) {
    if (output.kind !== 'asset' || output.path.endsWith('.css')) {
      continue;
    }

    const content = await output.text();
    const trimmedContent = content.trim();

    // Detect CSS-like asset payloads while excluding real JavaScript.
    const looksLikeCss =
      /^(\/\*|html|body|\.|#|:root|@media|@keyframes|@font-face|@layer)/.test(
        trimmedContent,
      );
    const looksLikeJs =
      /^(import |export |function |const |var |let |"use strict")/.test(
        trimmedContent,
      );

    if (!looksLikeCss || looksLikeJs) {
      continue;
    }

    cssOutputs.add(output);
    cssContents.push(content);
    console.log('[Build] Found CSS in asset file:', output.path);
  }

  let cssContent = cssContents.join('\n\n');

  const entryDir = path.dirname(cliArgs.entryPoint);
  const outputs: ChunkOutput[] = [];
  let entryUrl = '';
  let entryHash = '';
  let entryFullHash = '';
  const chunkMap: Record<string, string> = {};
  let cssUrl: string | undefined;
  let cssHash: string | undefined;

  // Scan all JS outputs for embedded CSS if we haven't found a CSS file yet
  if (!cssContent) {
    const extractedCss: string[] = [];
    for (const output of bundle.outputs) {
      if (output.kind === 'chunk' || output.kind === 'entry-point') {
        const text = await output.text();
        // Look for vanilla-extract CSS strings in the JS
        const matches = text.match(/\/\* vanilla-extract-css-ns:[\s\S]*?\*\//g);
        if (matches) {
          extractedCss.push(...matches);
          console.log(
            `[Build] Extracted ${matches.length} CSS blocks from ${path.basename(output.path)}`,
          );
        }
      }
    }
    if (extractedCss.length > 0) {
      cssContent = extractedCss.join('\n\n');
    }
  }

  const cssContentHash = cssContent ? computeHash(cssContent) : null;
  const inlineCssInjection =
    cssContent && cliArgs.inlineCss && cssContentHash
      ? createInlineCssInjection(cssContent, cssContentHash.short)
      : '';

  // Write external CSS file if we have CSS content and NOT inlining CSS
  if (cssContent && !cliArgs.inlineCss) {
    if (!cssContentHash) {
      throw new Error('[Build] Missing CSS hash for external CSS output');
    }
    const entryName = path
      .basename(cliArgs.entryPoint, '.tsx')
      .replace('.client', '');
    cssHash = cssContentHash.short;
    const cssFileName = `${entryName}.client.${cssHash}.css`;
    const cssOutputPath = path.join(cliArgs.outputDir, cssFileName);
    await Bun.write(cssOutputPath, cssContent);
    cssUrl = `${cliArgs.publicPath}/${cssFileName}`;
    console.log(`[Build] Wrote CSS to ${cssFileName} -> ${cssUrl}`);
  } else if (cliArgs.inlineCss && cssContent) {
    console.log('[Build] CSS will be inlined in JS bundle');
  }

  // Process all outputs - strip stub exports and optionally CSS, recompute hashes
  for (const output of bundle.outputs) {
    // Skip CSS output files (inline or external CSS handled separately)
    const isCssOutput = output.path.endsWith('.css') || cssOutputs.has(output);

    if (isCssOutput) {
      continue;
    }

    const rawContent = await output.text();
    // Strip server-side stub function exports from client bundle
    let content = stripStubExports(rawContent);
    if (output.kind === 'entry-point') {
      content = injectInlineCss(content, inlineCssInjection);
    }

    const hash = computeHash(content);

    let outputPath = output.path;
    if (output.kind === 'entry-point' && cliArgs.inlineCss) {
      outputPath = getHashedOutputPath(output.path, hash.short);
    }

    // Rewrite the file with processed content
    await Bun.write(outputPath, content);

    const relativePath = path.relative(cliArgs.outputDir, outputPath);
    const url = `${cliArgs.publicPath}/${relativePath}`;
    const importPath = extractImportPath(output, entryDir);

    if (output.kind === 'entry-point') {
      entryUrl = url;
      entryHash = hash.short;
      entryFullHash = hash.full;
    }

    outputs.push({
      path: relativePath,
      url,
      hash: hash.short,
      fullHash: hash.full,
      importPath,
      kind: output.kind as 'entry-point' | 'chunk',
    });

    if (output.kind === 'chunk') {
      chunkMap[importPath] = url;
    }

    console.log(`  ${output.kind}: ${relativePath} -> ${url}`);
  }

  // Compute watch directories from tracked paths and workspace deps
  const watchDirs = Array.from(
    new Set([
      ...getRelativeWatchDirs(resolvedDirs, config.packageDir),
      ...getWorkspaceDependencyWatchDirs(config.packageDir),
    ]),
  ).sort();
  console.log(
    '[Build] Client built successfully with',
    outputs.length,
    'outputs',
  );
  console.log('[Build] Watch directories:', watchDirs);

  // Build the result object
  const result: Record<string, unknown> = {
    success: true,
    version: cliArgs.version ?? '0.0.0',
    buildNumber: Date.now(),
    entryUrl,
    entryHash,
    entryFullHash,
    format: cliArgs.format,
    // Use 'chunks' for ClientBundleInfo compatibility (getClientAssetTags expects this)
    chunks: outputs,
    // Also include 'outputs' for backwards compatibility with ClientBuildResultWithChunks
    outputs,
    chunkMap,
    watchDirs,
    cssUrl,
    cssHash,
  };

  // Add OTA-specific fields when generating OTA manifest
  if (cliArgs.otaManifest) {
    result.hash = entryFullHash;
    result.url = entryUrl;
    result.notes = ''; // Can be populated via otaNotes in config
    console.log('[Build] Generated OTA manifest fields:', {
      hash: entryFullHash,
      url: entryUrl,
      version: cliArgs.version,
    });
  }

  outputResult(result as ClientBuildResultWithChunks);
  if (options.writeManifest) {
    writeBundleManifest(
      result as ClientBuildResultWithChunks,
      cliArgs.outputDir,
    );
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a client build runner with explicit configuration.
 *
 * @example
 * ```typescript
 * await createClientBuildRunner({
 *   packageDir: import.meta.dir,
 *   plugins: {
 *     loadSchemas: true,
 *     assetsPath: true,
 *     reactRefresh: true,
 *   },
 *   splitting: true,
 * }).run();
 * ```
 */
export function createClientBuildRunner(config: ClientBuildRunnerConfig) {
  const resolvedConfig = resolveConfig(config);

  async function runWithArgs(
    cliArgs: ClientBuildCliArgs,
    options: { writeManifest?: boolean } = {},
  ) {
    console.log('[Build] Building client', cliArgs.entryPoint);
    console.log('[Build] Config:', {
      plugins: resolvedConfig.plugins,
      paths: resolvedConfig.paths,
      splitting: resolvedConfig.splitting,
      envDefines: Object.keys(resolvedConfig.envDefines),
    });

    if (!cliArgs.outputDir) {
      throw new Error(
        '[Build] --output-dir is required. Single-file output mode is no longer supported.',
      );
    }

    await buildClient(resolvedConfig, cliArgs, options);
  }

  return {
    /**
     * Run the client build.
     * Parses CLI arguments and executes the appropriate build mode.
     */
    async run() {
      const cliArgs = parseClientBuildArgs(process.argv.slice(2));

      try {
        await runWithArgs(cliArgs);
      } catch (error) {
        console.error('[Build] Build failed with error:', error);
        process.exit(1);
      }
    },

    /**
     * Run the client build with explicit args.
     */
    async runWithArgs(
      cliArgs: ClientBuildCliArgs,
      options: { writeManifest?: boolean } = {},
    ) {
      try {
        await runWithArgs(cliArgs, options);
      } catch (error) {
        console.error('[Build] Build failed with error:', error);
        process.exit(1);
      }
    },

    /**
     * Get the resolved configuration (useful for debugging)
     */
    getConfig() {
      return resolvedConfig;
    },
  };
}
