import { createElement as _createElement, Fragment as _Fragment } from 'react';
import type { AppManifestInfo, ClientBundleInfo } from '../client-stub';

// ============================================================================
// Template Variables (replaced by clientBuildPlugin)
// ============================================================================

const NODE_ENV = '__NODE_ENV__' as string;
const BUILD_MODE = '__BUILD_MODE__' as string;
const CLIENT_DIR = '__CLIENT_DIR__' as string;
const OUTPUT_DIR = '__OUTPUT_DIR__' as string;
const CLIENT_PATH = '__CLIENT_PATH__' as string;
const PUBLIC_PATH = '__PUBLIC_PATH__' as string;
const BUILD_SCRIPT_PATH = '__BUILD_SCRIPT_PATH__' as string;
const ASSETS_PATH = '__ASSETS_PATH__' as string;
const ASSETS_OUTDIR = '__ASSETS_OUTDIR__' as string;
const ASSETS_PUBLIC_PATH = '__ASSETS_PUBLIC_PATH__' as string;
const MINIFY = '__MINIFY__' as string;
const SPLITTING = '__SPLITTING__' as string;
const SOURCEMAP = '__SOURCEMAP__' as string;
const FORMAT = '__FORMAT__' as string;

// ============================================================================
// Caches
// ============================================================================

let cachedBundleInfo: ClientBundleInfo | null = null;
let buildPromise: Promise<void> | null = null;
const isDevMode = BUILD_MODE === 'dev' || NODE_ENV !== 'production';
const isShipMode = !isDevMode;

// ============================================================================
// Manifest Loading
// ============================================================================

const MANIFEST_PATH = `${OUTPUT_DIR}/${CLIENT_DIR}/manifest.json`;

function loadBundleInfoFromFile(): ClientBundleInfo {
  const file = Bun.file(MANIFEST_PATH);
  if (!file.size) {
    throw new Error(`Missing manifest at ${MANIFEST_PATH}`);
  }
  // Synchronous read via require for simplicity in this context
  return JSON.parse(
    require('fs').readFileSync(MANIFEST_PATH, 'utf-8'),
  ) as ClientBundleInfo;
}

async function triggerBuild(): Promise<void> {
  const proc = Bun.spawn({
    cmd: [
      'bun',
      'run',
      BUILD_SCRIPT_PATH,
      '--entry-point',
      CLIENT_PATH,
      '--output-dir',
      `${OUTPUT_DIR}/${CLIENT_DIR}`,
      '--public-path',
      `${PUBLIC_PATH}/${CLIENT_DIR}`,
      '--assets-path',
      ASSETS_PATH,
      '--assets-outdir',
      ASSETS_OUTDIR,
      '--assets-public-path',
      ASSETS_PUBLIC_PATH,
      '--sourcemap',
      SOURCEMAP,
      '--format',
      FORMAT,
      ...(MINIFY === 'true' ? ['--minify'] : []),
      ...(SPLITTING === 'true' ? ['--splitting'] : []),
    ],
    cwd: BUILD_SCRIPT_PATH.replace(/\/[^/]+$/, ''),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`Build failed with code ${code}`);
}

async function ensureBuilt(): Promise<void> {
  if (buildPromise) return buildPromise;
  const file = Bun.file(MANIFEST_PATH);
  if (!file.size) {
    buildPromise = triggerBuild().finally(() => {
      buildPromise = null;
    });
    return buildPromise;
  }
}

// In ship mode, load bundle info at startup
if (isShipMode) {
  cachedBundleInfo = loadBundleInfoFromFile();
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get tag elements for the client bundle.
 *
 * Returns React elements for:
 * - CSS <link rel="stylesheet"> tag (if external CSS is present)
 * - <link rel="modulepreload"> tags for chunks (when code splitting is enabled)
 * - JS <script type="module"> tag for the entry point
 */
export async function getClientAssetTags() {
  if (!cachedBundleInfo && isDevMode) {
    await ensureBuilt();
  }
  const bundleInfo = cachedBundleInfo ?? loadBundleInfoFromFile();

  const tags = [];

  // Add CSS link if external CSS is present
  if (bundleInfo.cssUrl) {
    tags.push(
      _createElement('link', {
        key: 'client-css',
        rel: 'stylesheet',
        href: bundleInfo.cssUrl,
      }),
    );
  }

  // Add modulepreload links for chunks (enables parallel loading)
  for (const chunk of bundleInfo.chunks) {
    if (chunk.kind === 'chunk') {
      tags.push(
        _createElement('link', {
          key: `preload-${chunk.hash}`,
          rel: 'modulepreload',
          href: chunk.url,
        }),
      );
    }
  }

  // Add main entry script
  tags.push(
    _createElement('script', {
      key: 'client-js',
      type: 'module',
      src: bundleInfo.entryUrl,
    }),
  );

  return tags;
}

/**
 * Get app manifest info for OTA updates.
 *
 * Returns URL and integrity hashes for the JS bundle.
 * Used by iOS app manifest endpoint.
 */
export async function getClientAppManifestInfo(): Promise<AppManifestInfo> {
  if (!cachedBundleInfo && isDevMode) {
    await ensureBuilt();
  }
  const bundleInfo = cachedBundleInfo ?? loadBundleInfoFromFile();

  return {
    url: bundleInfo.entryUrl,
    hash: bundleInfo.entryHash,
    fullHash: bundleInfo.entryFullHash,
  };
}
