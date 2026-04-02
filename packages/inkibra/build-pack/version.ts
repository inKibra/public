/**
 * Package version utilities for asset management.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Get the package version from package.json.
 * Falls back to ASSET_VERSION env var if set.
 */
export async function getPackageVersion(packageDir: string): Promise<string> {
  const override = process.env.ASSET_VERSION;
  if (override) return override;

  const pkgJsonPath = path.join(packageDir, 'package.json');
  try {
    const content = await Bun.file(pkgJsonPath).text();
    const pkg = JSON.parse(content) as { version?: string };
    if (!pkg.version) {
      throw new Error(`No version found in ${pkgJsonPath}`);
    }
    return pkg.version;
  } catch (error) {
    throw new Error(
      `Failed to read version from ${pkgJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get the package version synchronously from package.json.
 * Falls back to ASSET_VERSION env var if set.
 */
export function getPackageVersionSync(packageDir: string): string {
  const override = process.env.ASSET_VERSION;
  if (override) return override;

  const pkgJsonPath = path.join(packageDir, 'package.json');
  try {
    const content = fs.readFileSync(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as { version?: string };
    if (!pkg.version) {
      throw new Error(`No version found in ${pkgJsonPath}`);
    }
    return pkg.version;
  } catch (error) {
    throw new Error(
      `Failed to read version from ${pkgJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get the base path for versioned assets.
 * @param version - Package version (e.g., "1.2.3")
 * @returns Asset base path (e.g., "/assets/1.2.3")
 */
export function getAssetBasePath(version: string): string {
  return process.env.ASSET_BASE ?? `/assets/${version}`;
}

/**
 * Cached server version to avoid repeated file reads.
 */
let cachedServerVersion: string | undefined;

/**
 * Get the server version.
 *
 * Priority:
 * 1. ASSET_VERSION env var (for CI/CD override)
 * 2. Cached version from previous call
 * 3. Version from server package.json (set via setServerPackageDir)
 *
 * This is used by the manifest handler to support version-aware caching
 * with the site-asset-worker.
 */
export function getServerVersion(): string {
  // Check env override first
  const override = process.env.ASSET_VERSION;
  if (override) return override;

  // Return cached if available
  if (cachedServerVersion) return cachedServerVersion;

  // Try to get from server package dir (set by createPreload)
  try {
    // Import dynamically to avoid circular dependency
    const { getServerPackageDir } = require('./client-manifest');
    const packageDir = getServerPackageDir();
    cachedServerVersion = getPackageVersionSync(packageDir);
    return cachedServerVersion;
  } catch {
    // Fallback to unknown if server package dir not set
    return 'unknown';
  }
}

/**
 * Set the server version explicitly.
 * Useful for testing or when not using createPreload.
 */
export function setServerVersion(version: string): void {
  cachedServerVersion = version;
}
