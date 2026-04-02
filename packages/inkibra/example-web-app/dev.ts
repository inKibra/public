/**
 * Development Server with Hot Module Replacement (HMR)
 *
 * This file uses denzel-bun's createDevServer for HMR support with:
 * - File watching for source changes
 * - WebSocket-based update notifications
 * - React Fast Refresh for instant component updates
 *
 * Usage:
 *   bun dev.ts
 *
 * What this enables:
 *   - React Fast Refresh: Edit components, see changes instantly
 *   - HMR via WebSocket: Server pushes updates to the browser
 *   - Bundle splitting: Each strategy component is a separate chunk
 *   - State preservation: React state survives component updates
 */

import * as path from 'node:path';
import { createDevServer } from '@inkibra/denzel-bun';
import {
  logServerStartup,
  serverConfig,
  setupGracefulShutdown,
} from './server/server';

// ============================================================================
// Development Server Configuration
// ============================================================================

/**
 * Create dev server with HMR enabled.
 *
 * Key features:
 * - File watching on app/ and frontend/ directories
 * - WebSocket endpoint at /_hmr for browser connection
 * - Automatic rebuild via HMR registry when files change
 *
 * How it works:
 * 1. Frontends auto-register via build-pack's clientBuildPlugin template
 * 2. When files change, server finds affected frontends via registry
 * 3. Server triggers rebuild and gets new bundle info with chunk URLs
 * 4. Server sends 'bundle-update' with new URLs to connected clients
 * 5. Clients import new bundles and trigger React Refresh
 */
const dev = createDevServer({
  ...serverConfig,
  port: serverConfig.port ?? 8080,

  hmr: {
    // Watch the app routes and frontend directories
    watchDirs: [
      path.resolve(import.meta.dir, './app'),
      path.resolve(import.meta.dir, './frontend'),
    ],

    // Debounce rapid file changes
    debounceMs: 100,

    // Use HMR registry for automatic frontend rebuilds
    // Frontends register themselves when getClientAssetTags() is called
    useRegistry: true,
  },
});

// ============================================================================
// Startup
// ============================================================================

logServerStartup(dev.port, true);
setupGracefulShutdown(dev.server);

console.log('[HMR] WebSocket endpoint available at /_hmr');
console.log('[HMR] Connect from browser with: connectHmr()');

// ============================================================================
// Default Export
// ============================================================================

export default dev;
