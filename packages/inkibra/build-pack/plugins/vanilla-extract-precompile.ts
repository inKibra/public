/**
 * Vanilla Extract Pre-Compile Plugin
 *
 * Pre-compiles all .css.ts files before server starts, ensuring both
 * server and client use identical class names for hydration.
 *
 * Architecture:
 * 1. Find all .css.ts files in source packages
 * 2. Build them with esbuild + vanilla-extract plugin (using esbuild directly, not Bun.build)
 * 3. Output compiled JS and CSS to cache directory
 * 4. Provide a Bun plugin that redirects .css.ts imports to compiled output
 *
 * Note: We use esbuild directly instead of Bun.build because Bun's CSS parser
 * crashes on modern color functions like oklch(). This is a known Bun bug.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BunPlugin } from 'bun';
import * as esbuild from 'esbuild';
import { vanillaExtractPlugin } from './vanilla-extract-esbuild';

// ============================================================================
// Types
// ============================================================================

export type PrecompileConfig = {
  /** Root directory to search for .css.ts files */
  searchDirs: string[];
  /** Output directory for compiled files */
  outdir: string;
  /** Identifier generation mode - must match client build */
  identifiers?: 'short' | 'debug';
  /** Enable verbose logging */
  verbose?: boolean;
};

export type PrecompileResult = {
  /** Map of source path → compiled JS path */
  manifest: Map<string, string>;
  /** Combined CSS content from all files */
  cssBundle: string;
  /** Path to the CSS bundle file */
  cssBundlePath: string;
  /** Number of files compiled */
  fileCount: number;
};

// ============================================================================
// Internal State
// ============================================================================

/** Cached pre-compile result for fast lookups */
let cachedResult: PrecompileResult | null = null;

// ============================================================================
// Pre-compile Function
// ============================================================================

/**
 * Find all .css.ts files in the given directories
 */
async function findCssFiles(dirs: string[]): Promise<string[]> {
  const files: string[] = [];

  async function walkDir(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.css.ts')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  for (const dir of dirs) {
    await walkDir(dir);
  }

  return files.sort();
}

/**
 * Pre-compile all .css.ts files using esbuild + vanilla-extract
 */
export async function precompileVanillaExtract(
  config: PrecompileConfig,
): Promise<PrecompileResult> {
  const { searchDirs, outdir, identifiers = 'debug', verbose = false } = config;

  const log = verbose ? console.log.bind(console) : () => {};

  log('[VE Precompile] Starting pre-compilation...');
  log('[VE Precompile] Search dirs:', searchDirs);

  // Find all .css.ts files
  const cssFiles = await findCssFiles(searchDirs);

  if (cssFiles.length === 0) {
    log('[VE Precompile] No .css.ts files found');
    return {
      manifest: new Map(),
      cssBundle: '',
      cssBundlePath: '',
      fileCount: 0,
    };
  }

  log(`[VE Precompile] Found ${cssFiles.length} .css.ts files`);

  // Ensure output directory exists
  fs.mkdirSync(outdir, { recursive: true });

  // Build all files with esbuild + vanilla-extract
  // Using esbuild directly (not Bun.build) to avoid Bun's CSS parser bug with oklch()
  const vePlugin = vanillaExtractPlugin({
    identifiers,
  });

  const manifest = new Map<string, string>();
  const allCss: string[] = [];

  // Process each file individually to maintain mapping
  for (const sourcePath of cssFiles) {
    const relativePath = path.relative(process.cwd(), sourcePath);
    const outputName = relativePath
      .replace(/\//g, '_')
      .replace(/\.css\.ts$/, '.css.js');

    try {
      // Use esbuild directly instead of Bun.build to avoid OKLCH CSS parsing bug
      const result = await esbuild.build({
        entryPoints: [sourcePath],
        outdir,
        entryNames: outputName.replace('.js', '.[hash]'),
        platform: 'node',
        format: 'esm',
        bundle: true,
        write: true,
        metafile: true,
        plugins: [vePlugin],
        external: [
          '@vanilla-extract/css',
          '@vanilla-extract/css/fileScope',
          '@vanilla-extract/css/adapter',
          '@vanilla-extract/recipes',
          '@vanilla-extract/sprinkles',
          'react',
          'react-dom',
        ],
      });

      // Find the JS output from metafile
      if (result.metafile) {
        for (const [outputPath, outputInfo] of Object.entries(
          result.metafile.outputs,
        )) {
          if (outputPath.endsWith('.js') && outputInfo.entryPoint) {
            const fullPath = path.resolve(outputPath);
            manifest.set(sourcePath, fullPath);
            log(
              `[VE Precompile] Compiled: ${relativePath} → ${path.basename(fullPath)}`,
            );
          } else if (outputPath.endsWith('.css')) {
            // Read CSS content
            const cssContent = fs.readFileSync(outputPath, 'utf-8');
            if (cssContent.trim()) {
              allCss.push(`/* ${relativePath} */`);
              allCss.push(cssContent);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[VE Precompile] Error compiling ${relativePath}:`, error);
    }
  }

  // Write combined CSS bundle
  const cssBundle = allCss.join('\n\n');
  const cssBundlePath = path.join(outdir, 'vanilla-extract.css');
  if (cssBundle) {
    fs.writeFileSync(cssBundlePath, cssBundle);
    log(`[VE Precompile] CSS bundle written: ${cssBundlePath}`);
  }

  // Write manifest for debugging
  const manifestPath = path.join(outdir, 'manifest.json');
  const manifestObj: Record<string, string> = {};
  for (const [source, compiled] of manifest) {
    manifestObj[source] = compiled;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2));

  log(`[VE Precompile] Compiled ${manifest.size} files`);

  const result: PrecompileResult = {
    manifest,
    cssBundle,
    cssBundlePath,
    fileCount: manifest.size,
  };

  // Cache the result
  cachedResult = result;

  return result;
}

// ============================================================================
// Bun Plugin for Import Redirection
// ============================================================================

/**
 * Create a Bun plugin that redirects .css.ts imports to pre-compiled output
 */
export function createVanillaExtractRedirectPlugin(
  result: PrecompileResult,
): BunPlugin {
  // Build a lookup map with both absolute and relative paths as keys
  const lookupMap = new Map<string, string>();
  for (const [source, compiled] of result.manifest) {
    // Add the original key
    lookupMap.set(source, compiled);
    // Also add the absolute path version
    const absoluteSource = path.resolve(source);
    lookupMap.set(absoluteSource, compiled);
  }

  return {
    name: 'vanilla-extract-redirect',
    setup(build) {
      build.onLoad({ filter: /\.css\.ts$/ }, async (args) => {
        // Try both the raw path and normalized versions
        let compiledPath = lookupMap.get(args.path);

        if (!compiledPath) {
          // Try relative path from cwd
          const relativePath = path.relative(process.cwd(), args.path);
          compiledPath = lookupMap.get(relativePath);
        }

        if (compiledPath && fs.existsSync(compiledPath)) {
          // Read the pre-compiled JS and return it
          const contents = await Bun.file(compiledPath).text();
          return {
            contents,
            loader: 'js',
          };
        }

        // File not in manifest - let it be processed normally
        // This shouldn't happen if precompile ran correctly
        console.warn(`[VE Redirect] File not in manifest: ${args.path}`);
        return undefined;
      });
    },
  };
}

/**
 * Get the cached pre-compile result
 */
export function getCachedPrecompileResult(): PrecompileResult | null {
  return cachedResult;
}

/**
 * Clear the pre-compile cache
 */
export function clearPrecompileCache(): void {
  cachedResult = null;
}

export function loadPrecompiledVanillaExtract(
  outdir: string,
): PrecompileResult {
  const manifestPath = path.join(outdir, 'manifest.json');
  const cssBundlePath = path.join(outdir, 'vanilla-extract.css');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[VE SSR] Missing precompiled manifest at ${manifestPath}. Run the precompile step before starting the server.`,
    );
  }
  const manifestJson = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8'),
  ) as Record<string, string>;
  const manifest = new Map(Object.entries(manifestJson));
  const cssBundle = fs.existsSync(cssBundlePath)
    ? fs.readFileSync(cssBundlePath, 'utf-8')
    : '';

  const result: PrecompileResult = {
    manifest,
    cssBundle,
    cssBundlePath: cssBundle ? cssBundlePath : '',
    fileCount: manifest.size,
  };

  cachedResult = result;
  return result;
}

export function createVanillaExtractPrecompiledPlugin(
  outdir: string,
): BunPlugin {
  const result = loadPrecompiledVanillaExtract(outdir);
  return createVanillaExtractRedirectPlugin(result);
}

// ============================================================================
// Combined Plugin for Preload
// ============================================================================

export type VanillaExtractSsrConfig = {
  /** Directories to search for .css.ts files */
  searchDirs: string[];
  /** Output directory for compiled files (default: dist/vanilla-extract) */
  outdir?: string;
  /** Identifier mode - must match client build (default: debug) */
  identifiers?: 'short' | 'debug';
  /** Enable verbose logging */
  verbose?: boolean;
};

/**
 * Create a combined SSR plugin that:
 * 1. Pre-compiles all .css.ts files on first load
 * 2. Redirects imports to compiled output
 *
 * This ensures server and client use identical class names.
 */
export function createVanillaExtractSsrPlugin(
  config: VanillaExtractSsrConfig,
): BunPlugin {
  const {
    searchDirs,
    outdir = 'dist/vanilla-extract',
    identifiers = 'debug',
    verbose = false,
  } = config;

  let precompilePromise: Promise<PrecompileResult> | null = null;
  let result: PrecompileResult | null = null;

  return {
    name: 'vanilla-extract-ssr-precompile',
    setup(build) {
      // Pre-compile on first .css.ts load
      build.onLoad({ filter: /\.css\.ts$/ }, async (args) => {
        // Start pre-compilation if not already running
        if (!precompilePromise) {
          console.log('[VE SSR] Starting pre-compilation...');
          precompilePromise = precompileVanillaExtract({
            searchDirs,
            outdir,
            identifiers,
            verbose,
          });
        }

        // Wait for pre-compilation to complete
        if (!result) {
          result = await precompilePromise;
          console.log(`[VE SSR] Pre-compiled ${result.fileCount} files`);
        }

        // Redirect to compiled output
        const compiledPath = result.manifest.get(args.path);

        if (compiledPath && fs.existsSync(compiledPath)) {
          const contents = await Bun.file(compiledPath).text();
          return {
            contents,
            loader: 'js',
          };
        }

        // Not in manifest - this file wasn't found during pre-compile
        // This can happen if a new file was added after pre-compile
        console.warn(`[VE SSR] File not pre-compiled: ${args.path}`);
        console.warn('[VE SSR] Restart server to pick up new .css.ts files');

        // Return empty exports to prevent crash
        return {
          contents: '// File not pre-compiled\nexport {};',
          loader: 'js',
        };
      });
    },
  };
}

/**
 * Get CSS content for SSR injection
 * Call this after pre-compilation is complete
 */
export function getPrecompiledCss(): string {
  if (!cachedResult) {
    console.warn('[VE SSR] getPrecompiledCss called before pre-compilation');
    return '';
  }
  return cachedResult.cssBundle;
}

/**
 * Get path to CSS bundle file for <link> tag
 */
export function getPrecompiledCssPath(): string {
  if (!cachedResult) {
    return '';
  }
  return cachedResult.cssBundlePath;
}
