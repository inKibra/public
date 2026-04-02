/**
 * HMR (Hot Module Replacement) build plugins for @inkibra/build-pack.
 *
 * Provides Bun plugins for enabling React Fast Refresh in development:
 * - `createReactRefreshPlugin()` - Transforms components for HMR
 * - `createHmrRuntimePlugin()` - Injects HMR client connection
 *
 * @example
 * ```typescript
 * import { createReactRefreshPlugin, createHmrRuntimePlugin } from '@inkibra/build-pack/hmr';
 *
 * // In dev build script
 * await Bun.build({
 *   entrypoints: ['./src/client.tsx'],
 *   plugins: [
 *     createReactRefreshPlugin(),
 *     createHmrRuntimePlugin(),
 *   ],
 * });
 * ```
 */

export {
  createHmrRuntimePlugin,
  createReactRefreshPlugin,
  type ReactRefreshPluginOptions,
} from './plugin';

// HMR Registry (shared between build-pack and denzel-bun)
export { hmrRegistry, type RegisteredFrontend } from './registry';
