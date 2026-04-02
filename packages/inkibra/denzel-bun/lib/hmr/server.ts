/**
 * HMR Server - File watcher and WebSocket broadcaster.
 *
 * Watches specified directories for file changes and broadcasts
 * update notifications to connected browser clients via WebSocket.
 */

import * as path from 'node:path';
import { hmrRegistry } from '@inkibra/build-pack/hmr';
import type { ServerWebSocket } from 'bun';
import { type FSWatcher, watch } from 'fs';
import type {
  HmrBundleUpdate,
  HmrServerMessage,
  HmrServerOptions,
  HmrUpdate,
} from './types';

/**
 * Default file filter - matches TypeScript and JavaScript files.
 */
const DEFAULT_FILE_FILTER = (filename: string): boolean =>
  /\.(tsx?|jsx?)$/.test(filename);

/**
 * HMR Server instance returned by createHmrServer.
 */
export interface HmrServer {
  /** Set of connected WebSocket clients */
  clients: Set<ServerWebSocket<unknown>>;

  /** Broadcast a message to all connected clients */
  broadcast: (msg: HmrServerMessage) => void;

  /** WebSocket handlers for Bun.serve */
  websocket: {
    open: (ws: ServerWebSocket<unknown>) => void;
    close: (ws: ServerWebSocket<unknown>) => void;
    message: (ws: ServerWebSocket<unknown>, message: string | Buffer) => void;
  };

  /** Stop watching for file changes */
  stop: () => void;
}

/**
 * Creates an HMR server that watches directories and broadcasts updates.
 *
 * @example
 * ```typescript
 * const hmr = createHmrServer({
 *   watchDirs: ['./app', './frontend'],
 *   onFileChange: async (path) => {
 *     await rebuildAffectedModule(path);
 *   },
 * });
 *
 * // Use hmr.websocket in Bun.serve
 * Bun.serve({
 *   websocket: hmr.websocket,
 *   // ...
 * });
 * ```
 */
export function createHmrServer(options: HmrServerOptions): HmrServer {
  const clients = new Set<ServerWebSocket<unknown>>();
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingUpdates = new Map<string, HmrUpdate>();

  const fileFilter = options.fileFilter ?? DEFAULT_FILE_FILTER;
  const debounceMs = options.debounceMs ?? 50;

  /**
   * Broadcast a message to all connected clients.
   */
  function broadcast(msg: HmrServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      try {
        client.send(data);
      } catch {
        // Client disconnected, will be cleaned up on close
        clients.delete(client);
      }
    }
  }

  /**
   * Process pending updates after debounce period.
   */
  async function processPendingUpdates(): Promise<void> {
    if (pendingUpdates.size === 0) return;

    const updates = Array.from(pendingUpdates.values());
    pendingUpdates.clear();

    const timestamp = Date.now();

    // If using registry, find affected frontends and rebuild them
    if (options.useRegistry) {
      const bundleUpdates: HmrBundleUpdate[] = [];
      const rebuiltFrontends = new Set<string>();

      // Find all affected frontends and track which files changed
      const affectedFrontendsMap = new Map<string, Set<string>>();

      for (const update of updates) {
        const affected = hmrRegistry.findAffectedFrontends(update.path);
        for (const frontend of affected) {
          if (!affectedFrontendsMap.has(frontend.entryPoint)) {
            affectedFrontendsMap.set(frontend.entryPoint, new Set());
          }
          affectedFrontendsMap.get(frontend.entryPoint)?.add(update.path);
          rebuiltFrontends.add(frontend.entryPoint);
        }
      }

      // Rebuild each affected frontend once
      for (const entryPoint of rebuiltFrontends) {
        const frontend = hmrRegistry.get(entryPoint);
        if (!frontend) continue;

        try {
          const bundleInfo = await hmrRegistry.rebuildFrontend(entryPoint);
          if (bundleInfo) {
            // Filter chunks to only include ones related to changed files
            // Use path matching against the chunkMap and importPath
            const changedPaths =
              affectedFrontendsMap.get(entryPoint) || new Set();

            // Try to find matching chunks for the changed files
            const matchedChunks = bundleInfo.chunks.filter((chunk) => {
              // Always include entry-point
              if (chunk.kind === 'entry-point') return true;

              // Include chunk if its import path matches any changed file path
              for (const changedPath of changedPaths) {
                // Normalize the changed path: "app/routes/boards/board.tsx" -> "routes/boards/board"
                // Remove the leading directory (e.g., "app/") and file extension
                const normalizedChanged = changedPath
                  .replace(/^[^/]+\//, '') // Remove first directory segment
                  .replace(/\.(tsx?|jsx?)$/, ''); // Remove extension

                // Normalize the import path: "./routes/boards/board" -> "routes/boards/board"
                const normalizedImport = chunk.importPath.replace(/^\.\//, '');

                // Exact match for precise chunk identification
                if (normalizedImport === normalizedChanged) {
                  return true;
                }

                // Check if the import path ends with the changed path
                if (normalizedImport.endsWith(`/${normalizedChanged}`)) {
                  return true;
                }

                // Also check if changed path contains the import path (file in chunk's module tree)
                if (normalizedChanged.includes(normalizedImport)) {
                  return true;
                }
              }
              return false;
            });

            // If we couldn't match any specific chunks, send all chunks
            // The client will compare hashes and only reload what actually changed
            const hasNonEntryMatches = matchedChunks.some(
              (c) => c.kind !== 'entry-point',
            );
            const chunksToSend = hasNonEntryMatches
              ? matchedChunks
              : bundleInfo.chunks;

            bundleUpdates.push({
              frontendName: frontend.name,
              entryPoint: frontend.entryPoint,
              bundleInfo: {
                ...bundleInfo,
                chunks: chunksToSend,
              },
            });
          }
        } catch (err) {
          console.error(`[HMR] Failed to rebuild ${frontend.name}:`, err);
          broadcast({
            type: 'error',
            message: `Failed to rebuild ${frontend.name}`,
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      }

      // If we rebuilt any frontends, send bundle updates
      if (bundleUpdates.length > 0) {
        broadcast({
          type: 'bundle-update',
          timestamp,
          bundles: bundleUpdates,
        });
        console.log('[HMR] Sent bundle updates');
      } else if (rebuiltFrontends.size === 0) {
        // No frontends registered yet - send path updates as fallback
        broadcast({
          type: 'update',
          timestamp,
          updates,
        });
        console.log('[HMR] Sent path update (no registered frontends)');
      }

      return;
    }

    // Legacy mode: Call onFileChange for each update
    if (options.onFileChange) {
      for (const update of updates) {
        try {
          await options.onFileChange(update.path);
        } catch (err) {
          console.error(`[HMR] Error processing ${update.path}:`, err);
          broadcast({
            type: 'error',
            message: `Failed to process ${update.path}`,
            stack: err instanceof Error ? err.stack : undefined,
          });
          // Continue processing other updates
        }
      }
    }

    // Broadcast update to clients
    broadcast({
      type: 'update',
      timestamp,
      updates,
    });

    console.log('[HMR] Sent update');
  }

  /**
   * Handle a file change event.
   * @param watchedDir - The directory being watched (e.g., '/path/to/app')
   * @param eventType - The type of event ('change', 'rename')
   * @param filename - The filename relative to watchedDir (e.g., 'routes/board.tsx')
   */
  function handleFileChange(
    watchedDir: string,
    eventType: string,
    filename: string | null,
  ): void {
    if (!filename) return;
    if (!fileFilter(filename)) return;

    // Extract the directory name from the watched path (cross-platform)
    // e.g., '/Users/.../app' or 'C:\Users\...\app' -> 'app'
    const dirName = path.basename(watchedDir);

    // Build the full relative path including the directory name (cross-platform)
    // e.g., 'app/routes/boards/board.tsx'
    // Normalize to forward slashes for consistent comparison
    const relativePath = path.join(dirName, filename).replace(/\\/g, '/');

    // Queue the update
    pendingUpdates.set(relativePath, {
      path: relativePath,
      changeType: eventType === 'rename' ? 'rename' : 'change',
    });

    // Debounce to batch rapid changes
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void processPendingUpdates();
    }, debounceMs);
  }

  // Start watching directories
  for (const dir of options.watchDirs) {
    try {
      const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
        handleFileChange(dir, eventType, filename);
      });
      watchers.push(watcher);
      console.log(`[HMR] Watching: ${dir}`);
    } catch (err) {
      console.error(`[HMR] Failed to watch ${dir}:`, err);
    }
  }

  return {
    clients,
    broadcast,

    websocket: {
      open(ws: ServerWebSocket<unknown>): void {
        clients.add(ws);
        ws.send(
          JSON.stringify({ type: 'connected' } satisfies HmrServerMessage),
        );
        console.log(`[HMR] Client connected (${clients.size} total)`);
      },

      close(ws: ServerWebSocket<unknown>): void {
        clients.delete(ws);
        console.log(`[HMR] Client disconnected (${clients.size} remaining)`);
      },

      message(_ws: ServerWebSocket<unknown>, _message: string | Buffer): void {
        // Currently we don't process client messages
        // Reserved for future features like error reporting
      },
    },

    stop(): void {
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.length = 0;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      console.log('[HMR] Stopped watching');
    },
  };
}
