/**
 * HMR (Hot Module Replacement) module for denzel-bun.
 *
 * Provides development server infrastructure with:
 * - File watching for source changes
 * - WebSocket-based update notifications
 * - Integration with React Fast Refresh
 *
 * @example
 * ```typescript
 * import { createDevServer } from '@inkibra/denzel-bun/hmr';
 *
 * const dev = createDevServer({
 *   port: 3000,
 *   fetch: myAppFetch,
 *   hmr: {
 *     watchDirs: ['./app', './frontend'],
 *     onFileChange: async (path) => {
 *       // Rebuild affected modules
 *       await rebuildClient();
 *     },
 *   },
 * });
 *
 * console.log(`Dev server: ${dev.url}`);
 * ```
 */

// Registry (for auto-registration by clientBuildPlugin)
// Re-exported from build-pack to maintain backward compatibility
export { hmrRegistry, type RegisteredFrontend } from '@inkibra/build-pack/hmr';
// Dev Server
export {
  createDevServer,
  createHmrOptions,
  type DevServer,
} from './dev-server';
// Server
export { createHmrServer, type HmrServer } from './server';
// Types
export type {
  DevServerOptions,
  HmrBundleUpdate,
  HmrClientMessage,
  HmrServerMessage,
  HmrServerOptions,
  HmrUpdate,
} from './types';
