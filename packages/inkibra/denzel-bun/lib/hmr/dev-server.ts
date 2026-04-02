/**
 * Dev Server - Wraps Bun.serve with HMR support.
 *
 * Provides a simple way to create a development server with:
 * - Hot Module Replacement via WebSocket
 * - File watching and rebuild triggers
 * - Automatic reconnection handling
 */

import type { Server } from 'bun';
import { createHmrServer, type HmrServer } from './server';
import type { DevServerOptions, HmrServerOptions } from './types';

/**
 * Result of creating a dev server.
 */
export interface DevServer {
  /** The underlying Bun server instance */
  server: Server<unknown>;

  /** The HMR server instance (if HMR is enabled) */
  hmr: HmrServer | null;

  /** Server URL */
  url: string;

  /** Server port */
  port: number;

  /** Stop the server and HMR watchers */
  stop: () => void;
}

/**
 * Creates a development server with optional HMR support.
 *
 * @example
 * ```typescript
 * import { createDevServer } from '@inkibra/denzel-bun';
 * import { serverConfig } from './server/server';
 *
 * const dev = createDevServer({
 *   ...serverConfig,
 *   hmr: {
 *     watchDirs: ['./app', './frontend'],
 *     onFileChange: async (path) => {
 *       await rebuildClient();
 *     },
 *   },
 * });
 *
 * console.log(`Dev server running at ${dev.url}`);
 * ```
 */
export function createDevServer(options: DevServerOptions): DevServer {
  const port = options.port ?? 3000;
  const hostname = options.hostname ?? 'localhost';

  // Create HMR server if configured
  const hmrServer = options.hmr ? createHmrServer(options.hmr) : null;

  // Create the Bun server
  const server = Bun.serve({
    port,
    hostname,
    development: true, // Enable Bun's dev mode features

    fetch(req, server) {
      const url = new URL(req.url);

      // Handle HMR WebSocket upgrade
      if (hmrServer && url.pathname === '/_hmr') {
        const upgraded = server.upgrade(req, { data: {} });
        if (upgraded) {
          // Bun handles the response for upgraded connections
          return;
        }
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Pass to application fetch handler
      return options.fetch(req, server);
    },

    websocket: hmrServer?.websocket ?? {
      open() {},
      close() {},
      message() {},
    },
  });

  const url = `http://${hostname}:${server.port}`;

  return {
    server,
    hmr: hmrServer,
    url,
    port: server.port ?? port,

    stop() {
      hmrServer?.stop();
      server.stop();
    },
  };
}

/**
 * Helper to create HMR options with sensible defaults.
 *
 * @example
 * ```typescript
 * const hmrOptions = createHmrOptions({
 *   watchDirs: ['./app'],
 *   onFileChange: rebuildClient,
 * });
 * ```
 */
export function createHmrOptions(
  options: Partial<HmrServerOptions> & Pick<HmrServerOptions, 'watchDirs'>,
): HmrServerOptions {
  return {
    debounceMs: 50,
    fileFilter: (filename) => /\.(tsx?|jsx?)$/.test(filename),
    ...options,
  };
}
