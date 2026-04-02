/**
 * Client Manifest Management
 *
 * Provides on-demand client bundle building with mtime checking.
 * In production, fetches manifest from a remote URL.
 * In development, builds on-demand when sources change.
 *
 * IMPORTANT: Builds are executed in a subprocess to avoid module caching
 * conflicts with vanilla-extract's compile() function.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import type { ClientBuildConfig } from './client-config';
import {
  getAssetBuildMode,
  isHmrEnabled,
  resolveClientPlugins,
} from './client-config';
import type { ClientBundleInfo } from './client-stub';
import { hmrRegistry } from './hmr';
import { getSourcesMtime, isManifestStale } from './mtime-check';

// Path to the build script (resolved at runtime)
const BUILD_SCRIPT_PATH = path.join(import.meta.dir, 'client-build-script.ts');

// ============================================================================
// Server Package Dir
// ============================================================================

/**
 * The package directory of the server process (set by createPreload).
 * Used to determine where to output client builds and what version to use.
 */
let serverPackageDir: string | undefined;

/**
 * Set the server package directory.
 * Called by createPreload() at server startup.
 *
 * @internal
 */
export function setServerPackageDir(dir: string): void {
  serverPackageDir = dir;
  console.log(`[Manifest] Server package dir set to: ${dir}`);
}

/**
 * Get the server package directory.
 * Throws if not set (createPreload must be called first).
 */
export function getServerPackageDir(): string {
  if (!serverPackageDir) {
    throw new Error(
      '[Manifest] Server package dir not set. ' +
        'Make sure createPreload() is called with packageDir before using getClientManifest().',
    );
  }
  return serverPackageDir;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Options for getClientManifest.
 *
 * Most configuration comes from the clientConfig (exported from .client.tsx).
 * Only environment-specific values need to be passed here.
 */
export type ClientManifestOptions = {
  /** Environment variables to inject into the build */
  envDefines: Record<string, string | undefined>;

  /**
   * Request hostname (e.g., "example.com") or `'no-site-worker'`.
   * In ship mode, used to fetch from the site-asset-worker at
   * `https://{hostname}/{clientDir}/manifest.json` (or manifestPath override)
   * before building locally.
   * If the worker has a cached manifest with a matching version, the local
   * build is skipped entirely (fast startup).
   * Pass `'no-site-worker'` for servers that will never have a site-asset-worker
   * (e.g., storybook, examples) to skip the worker fetch entirely.
   */
  hostname: string | 'no-site-worker';

  /** Force rebuild even if manifest is fresh */
  force?: boolean;
  /** Minify output (default: production only) */
  minify?: boolean;
  /** Source map generation (default: 'inline' in dev, 'none' in prod) */
  sourcemap?: 'none' | 'inline';
  /** Override manifest path (relative to hostname) */
  manifestPath?: string;
  /** Require worker manifest in ship mode (no local fallback) */
  requireManifest?: boolean;
};

/**
 * Package.json structure (relevant fields)
 */
type PackageJson = {
  name?: string;
  version?: string;
  assetsPublicPath?: string;
};

// ============================================================================
// Legacy Types (for backwards compatibility)
// ============================================================================

/**
 * @deprecated Use ClientBuildConfig + ClientManifestOptions instead
 */
export type GetClientManifestOptions = {
  clientDir: string;
  entryPoint: string;
  envDefines: Record<string, string | undefined>;
  format?: 'esm' | 'iife';
  splitting?: boolean;
  minify?: boolean;
  sourcemap?: 'none' | 'inline';
  packageDir?: string;
  outputDir?: string;
  assetsPath?: string;
  sourcePatterns: string[];
  force?: boolean;
  hostname: string | 'no-site-worker';
};

// ============================================================================
// Internal State
// ============================================================================

/** Cache of fetched production manifests */
const prodManifestCache = new Map<string, ClientBundleInfo>();

/** In-flight build promises to prevent duplicate builds */
const buildPromises = new Map<string, Promise<ClientBundleInfo>>();

/** Cache of package.json reads */
const packageJsonCache = new Map<string, PackageJson>();

/** Track which frontends have been registered with HMR registry */
const hmrRegisteredFrontends = new Set<string>();

/** Cache of mtime check results to avoid repeated checks */
const mtimeCacheInvalidated = new Set<string>();

/**
 * Track which clients have been built since this server process started.
 * First request for each client forces a rebuild (ignores disk cache).
 * This ensures fresh builds on server restart without needing an explicit hook.
 */
const initializedClients = new Set<string>();

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Find package.json by walking up from a file path.
 */
function findPackageDir(fromPath: string): string {
  let dir = path.dirname(fromPath);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find package.json from ${fromPath}`);
}

/**
 * Read and cache package.json.
 */
function readPackageJson(packageDir: string): PackageJson {
  const cached = packageJsonCache.get(packageDir);
  if (cached) return cached;

  const pkgPath = path.join(packageDir, 'package.json');
  const content = fs.readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(content) as PackageJson;
  packageJsonCache.set(packageDir, pkg);
  return pkg;
}

/**
 * Read manifest from disk.
 */
async function readManifestFromDisk(
  manifestPath: string,
): Promise<ClientBundleInfo | null> {
  try {
    const content = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(content) as ClientBundleInfo;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Fetch manifest from production URL.
 */
async function fetchProductionManifest(
  url: string,
): Promise<ClientBundleInfo | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Manifest] Failed to fetch ${url}: ${response.status}`);
      return null;
    }
    return (await response.json()) as ClientBundleInfo;
  } catch (error) {
    console.warn(`[Manifest] Error fetching ${url}:`, error);
    return null;
  }
}

/**
 * Build the client in a subprocess and return the manifest.
 */
async function buildClientNew(
  clientConfig: ClientBuildConfig,
  options: ClientManifestOptions,
  sourcePackageDir: string,
  serverPackageDir: string,
  outputDir: string,
  publicPath: string,
  assetsPublicPath: string,
  version: string,
): Promise<ClientBundleInfo> {
  console.log(`[Manifest] Building ${clientConfig.clientDir} in subprocess...`);

  const buildMode = getAssetBuildMode();
  const minify = options.minify ?? buildMode === 'ship';
  const sourcemap =
    options.sourcemap ?? (buildMode === 'ship' ? 'none' : 'inline');
  const splitting = clientConfig.splitting ?? true;
  const format = clientConfig.format ?? 'esm';
  const plugins = resolveClientPlugins(clientConfig.plugins);

  if (!clientConfig.entryPoint) {
    throw new Error(
      `[Manifest] No entryPoint in clientConfig for ${clientConfig.clientDir}. ` +
        'Make sure you import buildConfig from the .client.tsx file.',
    );
  }

  // Build CLI arguments
  // Assets come from source package, output goes to server package
  const cmd = [
    'bun',
    'run',
    BUILD_SCRIPT_PATH,
    '--entry-point',
    clientConfig.entryPoint,
    '--output-dir',
    outputDir,
    '--public-path',
    publicPath,
    '--package-dir',
    sourcePackageDir,
    '--assets-path',
    path.join(sourcePackageDir, 'assets'),
    '--assets-outdir',
    path.join(serverPackageDir, 'dist'),
    '--assets-public-path',
    assetsPublicPath,
    '--sourcemap',
    sourcemap,
    '--format',
    format,
    '--env-defines',
    JSON.stringify(options.envDefines),
    '--plugins',
    JSON.stringify(plugins),
  ];

  // Always pass version for manifest version tracking
  cmd.push('--version', version);

  if (minify) {
    cmd.push('--minify');
  }
  if (splitting) {
    cmd.push('--splitting');
  }
  if (clientConfig.inlineCss) {
    cmd.push('--inline-css');
  }
  if (clientConfig.otaManifest) {
    cmd.push('--ota-manifest');
  }

  console.log('[Manifest] Spawning build process...');

  const proc = Bun.spawn({
    cmd,
    cwd: sourcePackageDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      INKIBRA_CLIENT_BUILD_SUBPROCESS: '1',
    },
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`[Manifest] Build process exited with code ${exitCode}`);
  }

  // Read the manifest that was just written
  const manifestPath = path.join(outputDir, 'manifest.json');
  const manifest = await readManifestFromDisk(manifestPath);

  if (!manifest) {
    throw new Error(
      `Build completed but manifest not found at ${manifestPath}`,
    );
  }

  console.log(`[Manifest] Built ${clientConfig.clientDir} successfully`);
  return manifest;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the client manifest, building if necessary.
 *
 * In ship mode, fetches from the site-asset-worker at
 * `https://{hostname}/{clientDir}/manifest.json`. If the worker has a
 * cached manifest with a matching version, the local build is skipped.
 *
 * In development, checks source file mtimes and rebuilds if stale.
 *
 * @example
 * ```typescript
 * // tempo.server.tsx
 * import { buildConfig } from './tempo.client.tsx';
 * import { getClientManifest, getClientAssetTags } from '@inkibra/build-pack';
 *
 * const manifest = await getClientManifest(buildConfig, {
 *   envDefines: { NODE_ENV },
 *   hostname: req.hostname,
 * });
 *
 * // In render:
 * {getClientAssetTags(manifest)}
 * ```
 */
export async function getClientManifest(
  clientConfig: ClientBuildConfig,
  options: ClientManifestOptions,
): Promise<ClientBundleInfo>;

/**
 * @deprecated Use the new signature: getClientManifest(clientConfig, options)
 */
export async function getClientManifest(
  options: GetClientManifestOptions,
): Promise<ClientBundleInfo>;

export async function getClientManifest(
  configOrOptions: ClientBuildConfig | GetClientManifestOptions,
  maybeOptions?: ClientManifestOptions,
): Promise<ClientBundleInfo> {
  // Handle both signatures
  let clientConfig: ClientBuildConfig;
  let options: ClientManifestOptions;
  let isLegacy = false;

  if (maybeOptions !== undefined) {
    // New signature: getClientManifest(clientConfig, options)
    clientConfig = configOrOptions as ClientBuildConfig;
    options = maybeOptions;
  } else if ('sourcePatterns' in configOrOptions) {
    // Legacy signature: getClientManifest(options)
    isLegacy = true;
    const legacyOptions = configOrOptions as GetClientManifestOptions;
    clientConfig = {
      clientDir: legacyOptions.clientDir,
      entryPoint: legacyOptions.entryPoint,
      splitting: legacyOptions.splitting,
      format: legacyOptions.format,
    };
    options = {
      envDefines: legacyOptions.envDefines,
      hostname: legacyOptions.hostname,
      force: legacyOptions.force,
      minify: legacyOptions.minify,
      sourcemap: legacyOptions.sourcemap,
    };
  } else {
    // New signature requires options with hostname
    throw new Error(
      '[Manifest] getClientManifest requires options with hostname. ' +
        'Usage: getClientManifest(buildConfig, { envDefines: {...}, hostname: req.hostname })',
    );
  }

  const cacheKey = options.manifestPath
    ? `${clientConfig.clientDir}:${options.manifestPath}`
    : clientConfig.clientDir;
  const buildMode = getAssetBuildMode();
  const requireManifest =
    options.requireManifest ??
    (buildMode === 'ship' && options.hostname !== 'no-site-worker');

  // Ship mode: fetch from worker and cache (or build once on first request)
  if (buildMode === 'ship') {
    // Check local cache first
    const cached = prodManifestCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Try fetching from site-asset-worker (skip if no worker configured)
    if (options.hostname !== 'no-site-worker') {
      const manifestPath =
        options.manifestPath ?? `${clientConfig.clientDir}/manifest.json`;
      const normalizedManifestPath = manifestPath.replace(/^\//, '');
      const manifestUrl = `https://${options.hostname}/${normalizedManifestPath}`;

      // Get local version for comparison
      if (!clientConfig.entryPoint) {
        throw new Error(
          `[Manifest] No entryPoint in clientConfig for ${clientConfig.clientDir}. ` +
            'Make sure you import buildConfig from the .client.tsx file.',
        );
      }
      const packageDir = findPackageDir(clientConfig.entryPoint);
      const pkg = readPackageJson(packageDir);
      const localVersion = pkg.version ?? '0.0.0';

      const manifest = await fetchProductionManifest(manifestUrl);
      if (manifest && manifest.version === localVersion) {
        console.log(
          `[Manifest] Using cached manifest from worker for ${clientConfig.clientDir} (v${localVersion})`,
        );
        prodManifestCache.set(cacheKey, manifest);
        return manifest;
      }
      if (manifest) {
        console.log(
          `[Manifest] Version mismatch for ${clientConfig.clientDir}: worker has v${manifest.version}, local is v${localVersion}`,
        );
        if (requireManifest) {
          throw new Error(
            `[Manifest] Worker manifest version mismatch for ${clientConfig.clientDir}: worker has v${manifest.version}, local is v${localVersion}`,
          );
        }
      } else {
        console.log(
          `[Manifest] Worker returned no manifest for ${clientConfig.clientDir} (${manifestUrl})`,
        );
        if (requireManifest) {
          throw new Error(
            `[Manifest] Worker returned no manifest for ${clientConfig.clientDir} (${manifestUrl})`,
          );
        }
      }
    }

    // Fall through to local build
  }

  // Derive paths from entryPoint and server package
  if (!clientConfig.entryPoint) {
    throw new Error(
      `[Manifest] No entryPoint in clientConfig for ${clientConfig.clientDir}. ` +
        'Make sure you import buildConfig from the .client.tsx file.',
    );
  }

  // Source package - where the client code lives (for assets, etc.)
  const sourcePackageDir = findPackageDir(clientConfig.entryPoint);

  // Server package - where we output builds and get version from
  const serverPackageDir = getServerPackageDir();
  const serverPkg = readPackageJson(serverPackageDir);
  const version = serverPkg.version ?? '0.0.0';

  // Output to server's dist folder (not source package)
  const outputDir = path.join(serverPackageDir, 'dist', clientConfig.clientDir);
  const publicPath = `/dist/${clientConfig.clientDir}`;
  const assetsPublicPath = serverPkg.assetsPublicPath ?? '/dist/assets';
  const manifestPath = path.join(outputDir, 'manifest.json');

  // Check if this is the first request for this client since server startup
  const isFirstRequestSinceStartup = !initializedClients.has(cacheKey);
  if (isFirstRequestSinceStartup) {
    initializedClients.add(cacheKey);
    console.log(
      `[Manifest] First request for ${clientConfig.clientDir} since startup - forcing rebuild`,
    );
  }

  // Check if cache was explicitly invalidated (e.g., by HMR or clearManifestCache)
  const wasCacheInvalidated = mtimeCacheInvalidated.has(cacheKey);
  if (wasCacheInvalidated) {
    mtimeCacheInvalidated.delete(cacheKey);
    console.log(
      `[Manifest] Cache invalidated for ${clientConfig.clientDir} - forcing rebuild`,
    );
  }

  // Check if we need to rebuild
  // Force rebuild on first request since startup (ignores disk cache)
  let needsRebuild =
    options.force || isFirstRequestSinceStartup || wasCacheInvalidated;

  if (!needsRebuild) {
    // Subsequent requests: check if manifest exists and is fresh
    const existing = await readManifestFromDisk(manifestPath);
    if (existing) {
      // Check mtime of files in watchDirs (relative to source package)
      const watchDirs = existing.watchDirs;
      if (watchDirs && watchDirs.length > 0) {
        // Convert watchDirs to glob patterns
        const sourcePatterns = watchDirs.map((dir) => `${dir}/**/*.{ts,tsx}`);
        const sourcesMtime = await getSourcesMtime(
          sourcePatterns,
          sourcePackageDir,
        );
        needsRebuild = await isManifestStale(manifestPath, sourcesMtime);
      } else if (isLegacy) {
        // Legacy: use sourcePatterns from options
        const legacyOptions = configOrOptions as GetClientManifestOptions;
        const sourcesMtime = await getSourcesMtime(
          legacyOptions.sourcePatterns,
          sourcePackageDir,
        );
        needsRebuild = await isManifestStale(manifestPath, sourcesMtime);
      } else {
        // No watchDirs and not legacy - use existing manifest
        needsRebuild = false;
      }

      if (!needsRebuild) {
        return existing;
      }
    } else {
      // No manifest exists, need to build
      needsRebuild = true;
    }
  }

  // Prevent duplicate builds
  const existingPromise = buildPromises.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const buildPromise = buildClientNew(
    clientConfig,
    options,
    sourcePackageDir,
    serverPackageDir,
    outputDir,
    publicPath,
    assetsPublicPath,
    version,
  );
  buildPromises.set(cacheKey, buildPromise);

  try {
    const manifest = await buildPromise;

    // Register with HMR registry if in HMR mode
    if (isHmrEnabled() && !hmrRegisteredFrontends.has(cacheKey)) {
      const watchDirs = manifest.watchDirs;

      hmrRegistry.register({
        entryPoint: clientConfig.entryPoint!,
        name: clientConfig.clientDir,
        watchDirs: watchDirs ?? [clientConfig.clientDir],
        rebuild: async () => {
          // Mark for forced rebuild on next request
          mtimeCacheInvalidated.add(cacheKey);
          // Clear the manifest cache to force re-read after rebuild
          prodManifestCache.delete(cacheKey);

          // Trigger rebuild
          const rebuilt = await buildClientNew(
            clientConfig,
            options,
            sourcePackageDir,
            serverPackageDir,
            outputDir,
            publicPath,
            assetsPublicPath,
            version,
          );

          return rebuilt;
        },
      });

      hmrRegisteredFrontends.add(cacheKey);
      console.log(`[HMR Registry] Registered: ${clientConfig.clientDir}`);
    }

    // In ship mode, cache the manifest after first build
    if (getAssetBuildMode() === 'ship') {
      prodManifestCache.set(cacheKey, manifest);
    }

    return manifest;
  } finally {
    buildPromises.delete(cacheKey);
  }
}

/**
 * Clear the production manifest cache.
 * Useful for testing or forcing a refresh.
 */
export function clearManifestCache(clientDir?: string): void {
  if (clientDir) {
    prodManifestCache.delete(clientDir);
    mtimeCacheInvalidated.add(clientDir);
  } else {
    prodManifestCache.clear();
    // Mark all for invalidation
    for (const key of hmrRegisteredFrontends) {
      mtimeCacheInvalidated.add(key);
    }
  }
}

/**
 * Clear the HMR mtime cache for a specific frontend.
 * Called by HMR registry when triggering rebuilds.
 * @internal
 */
export function clearMtimeCache(clientDir: string): void {
  mtimeCacheInvalidated.add(clientDir);
}

/**
 * Transform a client manifest into React elements for <head>.
 *
 * Returns:
 * - CSS <link rel="stylesheet"> tag (if external CSS is present)
 * - <link rel="modulepreload"> tags for chunks
 * - JS <script type="module"> tag for the entry point
 */
export function getClientAssetTags(manifest: ClientBundleInfo): ReactNode[] {
  const tags: ReactNode[] = [];

  // CSS link (if external CSS exists)
  if (manifest.cssUrl) {
    tags.push(
      createElement('link', {
        key: 'css',
        rel: 'stylesheet',
        href: manifest.cssUrl,
      }),
    );
  }

  // Modulepreload for chunks (handle both 'chunks' and legacy 'outputs' property names)
  const chunks = manifest.chunks ?? (manifest as any).outputs ?? [];
  for (const chunk of chunks) {
    if (chunk.kind === 'chunk') {
      tags.push(
        createElement('link', {
          key: `preload-${chunk.hash}`,
          rel: 'modulepreload',
          href: chunk.url,
        }),
      );
    }
  }

  // Entry script
  tags.push(
    createElement('script', {
      key: 'entry',
      type: 'module',
      src: manifest.entryUrl,
    }),
  );

  return tags;
}

/**
 * Get app manifest info for OTA updates (iOS).
 */
export function getClientAppManifestInfo(manifest: ClientBundleInfo) {
  return {
    url: manifest.entryUrl,
    hash: manifest.entryHash,
    fullHash: manifest.entryFullHash,
  };
}
