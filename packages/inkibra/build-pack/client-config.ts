/**
 * Client Build Configuration
 *
 * Types and utilities for defining client build configuration.
 * The buildConfig is exported from .client.tsx files and extracted
 * by the clientStubPlugin for server-side use.
 */

// ============================================================================
// Asset Build Mode
// ============================================================================

/**
 * Asset build modes for client bundles.
 *
 * - `ship`: Build on first request, cache forever, no rebuilds. Supports
 *   remote asset worker URL for production deployments.
 * - `rebuild`: Build on-demand with mtime checking. Default in development.
 * - `hmr`: Build on-demand + register with HMR registry + React Refresh.
 *   Enables hot module replacement for rapid development.
 *
 * Controlled by `ASSET_BUILD_MODE` environment variable, or defaults based
 * on `NODE_ENV`:
 * - `NODE_ENV=production` → `ship`
 * - Otherwise → `rebuild`
 */
export type AssetBuildMode = 'ship' | 'rebuild' | 'hmr';

/**
 * Get the current asset build mode.
 *
 * Priority:
 * 1. `ASSET_BUILD_MODE` environment variable (if set)
 * 2. `NODE_ENV=production` → `ship`
 * 3. Otherwise → `rebuild`
 *
 * @example
 * ```bash
 * # Development with HMR
 * ASSET_BUILD_MODE=hmr bun dev.ts
 *
 * # Development without HMR (default)
 * bun dev.ts
 *
 * # Production
 * NODE_ENV=production bun start.ts
 * ```
 */
export function getAssetBuildMode(): AssetBuildMode {
  const envMode = process.env.ASSET_BUILD_MODE;
  if (envMode === 'ship' || envMode === 'rebuild' || envMode === 'hmr') {
    return envMode;
  }
  return process.env.NODE_ENV === 'production' ? 'ship' : 'rebuild';
}

/**
 * Check if the current build mode enables HMR.
 */
export function isHmrEnabled(): boolean {
  return getAssetBuildMode() === 'hmr';
}

/**
 * Check if the current build mode is production (ship).
 */
export function isShipMode(): boolean {
  return getAssetBuildMode() === 'ship';
}

// ============================================================================
// Types
// ============================================================================

/**
 * Plugin configuration for client builds.
 */
export type ClientBuildPlugins = {
  /** Enable vanilla-extract CSS processing (default: true) */
  vanillaExtract?: boolean;
  /** Enable asset path resolution (default: true) */
  assetsPath?: boolean;
  /** Enable typia schema loading (default: true) */
  loadSchemas?: boolean;
  /** Enable React Refresh for HMR (default: false in manifest-first builds) */
  reactRefresh?: boolean;
};

/**
 * Client build configuration.
 *
 * Exported from .client.tsx files and extracted by clientStubPlugin.
 * The server imports this config without loading browser code.
 *
 * @example
 * ```typescript
 * // tempo.client.tsx
 * import { defineClientBuild } from '@inkibra/build-pack/client-config';
 *
 * export const buildConfig = defineClientBuild({
 *   clientDir: 'tempo',
 *   plugins: {
 *     vanillaExtract: true,
 *     assetsPath: true,
 *   },
 * });
 *
 * // Browser code below...
 * ```
 */
export type ClientBuildConfig = {
  /**
   * Directory name for this client (e.g., 'tempo', 'admin').
   * Used for output paths: dist/{clientDir}/
   */
  clientDir: string;

  /**
   * Plugin configuration.
   * @default { vanillaExtract: true, assetsPath: true, loadSchemas: true }
   */
  plugins?: ClientBuildPlugins;

  /**
   * Enable code splitting.
   * @default true
   */
  splitting?: boolean;

  /**
   * Output format.
   * @default 'esm'
   */
  format?: 'esm' | 'iife';

  /**
   * Inline CSS into the JS bundle instead of extracting to a separate file.
   * Useful for IIFE builds where you want a single self-contained bundle.
   * @default false
   */
  inlineCss?: boolean;

  /**
   * Generate an OTA (Over-The-Air) manifest for native app updates.
   * When enabled, the manifest includes: hash, url, version, notes.
   * @default false
   */
  otaManifest?: boolean;

  /**
   * Release notes for OTA manifest.
   * Only used when `otaManifest` is true.
   */
  otaNotes?: string;

  /**
   * Entry point path (absolute).
   * Injected by clientStubPlugin - do not set manually.
   * @internal
   */
  entryPoint?: string;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Define a client build configuration.
 *
 * This is a type helper that returns the config as-is.
 * The clientStubPlugin extracts this config for server-side use.
 *
 * @example
 * ```typescript
 * // tempo.client.tsx
 * import { defineClientBuild } from '@inkibra/build-pack/client-config';
 *
 * export const buildConfig = defineClientBuild({
 *   clientDir: 'tempo',
 *   plugins: { vanillaExtract: true },
 * });
 * ```
 */
export function defineClientBuild(
  config: ClientBuildConfig,
): ClientBuildConfig {
  return config;
}

/**
 * Default plugin configuration.
 */
export const defaultClientPlugins: Required<ClientBuildPlugins> = {
  vanillaExtract: true,
  assetsPath: true,
  loadSchemas: true,
  reactRefresh: false,
};

/**
 * Resolve plugin configuration with defaults.
 *
 * When `ASSET_BUILD_MODE=hmr`, React Refresh is automatically enabled
 * unless explicitly disabled in the config.
 */
export function resolveClientPlugins(
  plugins?: ClientBuildPlugins,
): Required<ClientBuildPlugins> {
  const hmrEnabled = isHmrEnabled();
  return {
    ...defaultClientPlugins,
    ...plugins,
    // Auto-enable React Refresh in HMR mode unless explicitly disabled
    // This must come AFTER spreading plugins to ensure the computed value
    // isn't overwritten by { reactRefresh: undefined }
    reactRefresh: plugins?.reactRefresh ?? hmrEnabled,
  };
}
