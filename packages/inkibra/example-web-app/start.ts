/**
 * Production Server Entry Point
 *
 * Starts the server in production mode (no HMR).
 *
 * Usage:
 *   bun start.ts
 *   # or via package.json:
 *   bun run start
 */

import {
  logServerStartup,
  serverConfig,
  setupGracefulShutdown,
} from './server/server';

// ============================================================================
// Start Production Server
// ============================================================================

const server = Bun.serve(serverConfig);

logServerStartup(server.port!, false);
setupGracefulShutdown(server);

// ============================================================================
// Default Export
// ============================================================================

export default serverConfig;
