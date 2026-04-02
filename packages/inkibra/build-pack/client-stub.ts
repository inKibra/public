import type { ReactNode } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * App manifest info for OTA updates.
 * Used by iOS app to verify bundle integrity.
 */
export type AppManifestInfo = {
  /** Public URL to the JS bundle */
  url: string;
  /** Short hash (8 chars) for version display */
  hash: string;
  /** Full SHA256 hash (64 chars) for integrity verification */
  fullHash: string;
};

/**
 * Information about a single chunk produced by bundle splitting.
 * Internal type used by getClientAssetTags.
 */
export type ChunkInfo = {
  /** Public URL to the chunk */
  url: string;
  /** Short hash (8 chars) used in filenames for cache busting */
  hash: string;
  /** Full SHA256 hash (64 chars) for integrity verification (e.g., OTA updates) */
  fullHash: string;
  /** Original import path (e.g., './routes/layout') */
  importPath: string;
  /** How Bun classified this output */
  kind: 'entry-point' | 'chunk';
};

/**
 * Complete bundle information including all chunks.
 * Internal type used by build system.
 */
export type ClientBundleInfo = {
  /** Package version from package.json (e.g., "1.2.3") */
  version: string;
  /** Monotonic build timestamp (Date.now() at build time).
   * Used by site-asset-worker for thrash protection during rolling deploys. */
  buildNumber: number;
  /** Main entry script URL */
  entryUrl: string;
  /** Short entry script hash (8 chars) for cache busting */
  entryHash: string;
  /** Full SHA256 hash (64 chars) for integrity verification (e.g., OTA updates) */
  entryFullHash: string;
  /** All chunks with their metadata */
  chunks: ChunkInfo[];
  /**
   * Map from import path to chunk URL for quick lookup.
   * e.g., { './routes/layout': '/dist/chunks/routes-layout.abc123.js' }
   */
  chunkMap: Record<string, string>;
  /** Directories containing source files (relative to package root, for HMR) */
  watchDirs?: string[];
  /** CSS URL (when cssOutput is 'external') */
  cssUrl?: string;
  /** CSS content hash (when cssOutput is 'external') */
  cssHash?: string;
  /** Output format for the entry bundle */
  format?: 'esm' | 'iife';
};

// ============================================================================
// Stub Functions (transformed by clientBuildPlugin)
// ============================================================================

/**
 * Get tag elements for the client bundle.
 *
 * Returns React elements for:
 * - CSS <link rel="stylesheet"> tag (if external CSS is present)
 * - <link rel="modulepreload"> tags for chunks (when code splitting is enabled)
 * - JS <script type="module"> tag for the entry point
 *
 * @example
 * ```tsx
 * import { getClientAssetTags } from './app.client' with { type: 'denzel-client' };
 *
 * <head>
 *   {await getClientAssetTags()}
 * </head>
 * ```
 */
export function getClientAssetTags(): Promise<ReactNode> {
  throw new Error(
    'getClientAssetTags stub called directly - this should be transformed by clientBuildPlugin',
  );
}

/**
 * Get app manifest info for OTA updates.
 *
 * Returns URL and integrity hashes for the JS bundle.
 * Used by iOS app manifest endpoint to enable over-the-air updates.
 *
 * @example
 * ```tsx
 * import { getClientAppManifestInfo } from './app.client' with { type: 'denzel-client' };
 *
 * const info = await getClientAppManifestInfo();
 * return res.json({
 *   version: info.hash.slice(0, 8),
 *   url: info.url,
 *   hash: info.fullHash,
 * });
 * ```
 */
export function getClientAppManifestInfo(): Promise<AppManifestInfo> {
  throw new Error(
    'getClientAppManifestInfo stub called directly - this should be transformed by clientBuildPlugin',
  );
}
