/**
 * Server Entry Point
 *
 * Uses @inkibra/denzel-bun's createRouter for unified routing.
 * Backends are created in ./backends/index.ts to avoid circular dependencies.
 *
 * This file exports the server configuration for reuse by dev.ts (HMR mode).
 */

import { createRouter } from '@inkibra/denzel-bun';
import { ExampleFrontend } from '../frontend/example.server';
import {
  authBackend,
  blogBackend,
  boardBackend,
  chatBackend,
  redis,
} from './backends';

// ============================================================================
// Configuration
// ============================================================================

const PORT = Number(process.env.PORT) || 8080;

// ============================================================================
// Create Router
// ============================================================================

export const router = createRouter({
  // Backends containing API and EventStream handlers
  backends: [authBackend, boardBackend, chatBackend, blogBackend],

  // Static files
  staticDirs: {
    '/dist': './dist',
  },

  // SSR frontends (each has its own contextCodecs)
  frontends: [ExampleFrontend],

  // Custom 404 handler
  notFoundHandler: () =>
    new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    }),

  // Custom error handler
  errorHandler: (error) => {
    console.error('Server error:', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  },
});

// ============================================================================
// Server Configuration (exported for dev.ts)
// ============================================================================

/**
 * Server configuration that can be extended by dev.ts.
 * Uses Bun's default export pattern for `bun run server.ts`.
 */
export const serverConfig = {
  port: PORT,
  fetch: router.fetch,
};

// ============================================================================
// Logging Helper
// ============================================================================

export function logServerStartup(port: number, isDev = false) {
  const mode = isDev ? '🔥 DEV' : '🚀 PROD';
  console.log(`${mode} Server running at http://localhost:${port}`);
  console.log(
    `📋 API handlers: ${authBackend.apiHandlerNames.length + boardBackend.apiHandlerNames.length + chatBackend.apiHandlerNames.length}`,
  );
  console.log(
    `📡 Stream handlers: ${boardBackend.streamHandlerNames.length + chatBackend.streamHandlerNames.length}`,
  );
  console.log(
    `🌐 Frontends: ${router
      .getFrontends()
      .map((f) => f.name)
      .join(', ')}`,
  );
  if (isDev) {
    console.log('⚡ React Fast Refresh enabled');
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export function setupGracefulShutdown(server: ReturnType<typeof Bun.serve>) {
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    server.stop();
    redis.close();
    process.exit(0);
  });
}

// ============================================================================
// Default Export (for `bun run server/server.ts`)
// ============================================================================

export default serverConfig;
