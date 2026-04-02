/**
 * HMR (Hot Module Replacement) types for denzel-bun dev server.
 *
 * These types define the WebSocket protocol between the dev server
 * and browser clients for communicating module updates.
 */

import type { ClientBundleInfo } from '@inkibra/build-pack';

/**
 * Bundle update info sent to clients after a rebuild.
 */
export interface HmrBundleUpdate {
  /** The frontend name (e.g., 'example') */
  frontendName: string;
  /** The entry point path (e.g., './frontend/example.client.tsx') */
  entryPoint: string;
  /** The new bundle info with chunk URLs */
  bundleInfo: ClientBundleInfo;
}

/**
 * Messages sent from the HMR server to connected clients.
 */
export type HmrServerMessage =
  | { type: 'connected' }
  | { type: 'update'; timestamp: number; updates: HmrUpdate[] }
  | { type: 'bundle-update'; timestamp: number; bundles: HmrBundleUpdate[] }
  | { type: 'full-reload'; reason?: string }
  | { type: 'error'; message: string; stack?: string };

/**
 * A single module update notification.
 */
export interface HmrUpdate {
  /** The import path that changed (e.g., './routes/layout') */
  path: string;
  /** Optional: the type of change detected */
  changeType?: 'change' | 'rename' | 'delete';
}

/**
 * Messages sent from clients to the HMR server.
 * Currently unused but reserved for future features like:
 * - Client acknowledgment of updates
 * - Error reporting from client
 */
export type HmrClientMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string };

/**
 * Options for creating an HMR server instance.
 */
export interface HmrServerOptions {
  /** Directories to watch for file changes */
  watchDirs: string[];

  /** Debounce delay in milliseconds (default: 50) */
  debounceMs?: number;

  /**
   * Callback invoked when a file changes.
   * Use this to trigger rebuilds before notifying clients.
   * @deprecated Use useRegistry: true instead for automatic frontend rebuilds
   */
  onFileChange?: (path: string) => void | Promise<void>;

  /**
   * Filter function to determine if a file change should trigger HMR.
   * Default: matches .ts, .tsx, .js, .jsx files
   */
  fileFilter?: (filename: string) => boolean;

  /**
   * Use the HMR registry for automatic frontend rebuilds.
   * When enabled, frontends registered via build-pack's clientBuildPlugin
   * will be automatically rebuilt when their watch directories change.
   * The server will send 'bundle-update' messages with new chunk URLs.
   */
  useRegistry?: boolean;
}

/**
 * Options for creating a dev server with HMR support.
 */
export interface DevServerOptions {
  /** Port to listen on */
  port?: number;

  /** Hostname to bind to (default: 'localhost') */
  hostname?: string;

  /** The fetch handler for the application */
  fetch: (req: Request, server: unknown) => Response | Promise<Response>;

  /** HMR configuration (optional - if omitted, HMR is disabled) */
  hmr?: HmrServerOptions;

  /** Static file serving configuration */
  static?: {
    /** Directory to serve static files from */
    dir: string;
    /** URL path prefix (default: '/') */
    prefix?: string;
  };
}
