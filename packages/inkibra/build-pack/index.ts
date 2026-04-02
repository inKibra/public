// Client build configuration (exported from .client.tsx files)

// Client build runner (new API for reducing boilerplate)
export type {
  ClientBuildPaths,
  ClientBuildPlugins as ClientBuildRunnerPlugins,
  ClientBuildRunnerConfig,
} from './client-build-runner';
export { createClientBuildRunner } from './client-build-runner';
export type {
  AssetBuildMode,
  ClientBuildConfig,
  ClientBuildPlugins,
} from './client-config';
export {
  defaultClientPlugins,
  getAssetBuildMode,
  isHmrEnabled,
  isShipMode,
  resolveClientPlugins,
} from './client-config';
// NOTE: defineClientBuild is intentionally NOT exported here.
// Import it from '@inkibra/build-pack/client-config' in .client.tsx files
// to avoid bundling server-only code into the browser bundle.
// Client manifest (on-demand builds with mtime checking)
export type {
  ClientManifestOptions,
  GetClientManifestOptions,
} from './client-manifest';
export {
  clearManifestCache,
  getClientAppManifestInfo,
  getClientAssetTags,
  getClientManifest,
  getServerPackageDir,
  setServerPackageDir,
} from './client-manifest';
// Client stub exports (types only - functions moved to client-manifest)
export type {
  AppManifestInfo,
  ChunkInfo,
  ClientBundleInfo,
} from './client-stub';
// Generic code binding marker
export { defineCodeBinding } from './code-binding';
// Schema generation
export { generateSchemas } from './generate-schemas';
// HMR (Hot Module Replacement) plugins
export type { ReactRefreshPluginOptions } from './hmr';
export { createHmrRuntimePlugin, createReactRefreshPlugin } from './hmr';
export { getVersionedManifestPath } from './manifest-path';
// Mtime checking utilities
export { getSourcesMtime, isManifestStale } from './mtime-check';
// Plugins
export { assetsPathPlugin } from './plugins/assets-path-plugin';
// CLI args (for build-clients.ts scripts)
export type {
  ChunkOutput,
  ClientBuildCliArgs,
  ClientBuildResult,
  ClientBuildResultWithChunks,
} from './plugins/client-build-cli-args';
export { parseClientBuildArgs } from './plugins/client-build-cli-args';
export { clientBuildPlugin } from './plugins/client-build-plugin';
export { clientStubPlugin } from './plugins/client-stub-plugin';
export { loadSchemasPlugin } from './plugins/load-schemas-plugin';
// Vanilla Extract noop plugin (for SSR without build support)
export { vanillaExtractNoopPlugin } from './plugins/vanilla-extract-noop-plugin';
export { vanillaBuildPlugin } from './plugins/vanilla-extract-plugin';
// Vanilla Extract SSR pre-compile plugin
export type {
  PrecompileConfig as VanillaExtractPrecompileConfig,
  PrecompileResult as VanillaExtractPrecompileResult,
  VanillaExtractSsrConfig,
} from './plugins/vanilla-extract-precompile';
export {
  clearPrecompileCache as clearVanillaExtractCache,
  createVanillaExtractPrecompiledPlugin,
  createVanillaExtractRedirectPlugin,
  createVanillaExtractSsrPlugin,
  getCachedPrecompileResult as getVanillaExtractPrecompileResult,
  getPrecompiledCss as getVanillaExtractCss,
  getPrecompiledCssPath as getVanillaExtractCssPath,
  loadPrecompiledVanillaExtract,
  precompileVanillaExtract,
} from './plugins/vanilla-extract-precompile';
// Preload runner (new API for reducing boilerplate)
export type {
  PreloadConfig,
  PreloadMatchScripts,
  PreloadPaths,
  PreloadPlugins,
} from './preload-runner';
export { createPreload } from './preload-runner';
// Version utilities
export {
  getAssetBasePath,
  getPackageVersion,
  getPackageVersionSync,
  getServerVersion,
  setServerVersion,
} from './version';
// Versioned assets middleware
export type { VersionedAssetsMiddlewareOptions } from './versioned-assets-middleware';
export {
  connectVersionedAssets,
  createVersionedAssetsMiddleware,
} from './versioned-assets-middleware';
export { runAssetWorkerCli } from './workers/asset-worker/cli';
export type { AssetWorkerConfig } from './workers/asset-worker/config';
// Site asset worker (multi-origin with stale-while-revalidate)
export { runSiteAssetWorkerCli } from './workers/site-asset-worker/cli';
export type {
  SiteAssetWorkerConfig,
  SiteAssetWorkerEnv,
  SiteAssetWorkerHost,
  SiteAssetWorkerOrigin,
} from './workers/site-asset-worker/config';
export {
  buildOriginMappings,
  buildRoutes,
  DEFAULT_CACHE_TTLS,
} from './workers/site-asset-worker/config';
