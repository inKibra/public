/**
 * Site Asset Worker
 *
 * Cloudflare Worker for caching and serving client assets and manifests
 * across multiple origins with stale-while-revalidate caching.
 *
 * @example
 * ```bash
 * # Deploy the worker
 * bun run packages/inkibra/build-pack/workers/site-asset-worker/cli.ts deploy \
 *   --config-file packages/inkibra/my-web-app/workers/site-asset-worker.json
 *
 * # Dry run to see generated wrangler.toml
 * bun run packages/inkibra/build-pack/workers/site-asset-worker/cli.ts dry-run \
 *   --config-file packages/inkibra/my-web-app/workers/site-asset-worker.json
 *
 * # Tail logs
 * bun run packages/inkibra/build-pack/workers/site-asset-worker/cli.ts tail \
 *   --config-file packages/inkibra/my-web-app/workers/site-asset-worker.json
 * ```
 */

export { runSiteAssetWorkerCli } from './cli';
export * from './config';
export { ManifestLock } from './worker';
