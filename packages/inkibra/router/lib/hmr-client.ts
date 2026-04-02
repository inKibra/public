/**
 * HMR Client Runtime - Browser-side Hot Module Replacement.
 *
 * This module connects to the dev server's WebSocket endpoint and handles
 * module updates by:
 * 1. Invalidating the strategy cache for changed modules
 * 2. Re-importing the updated modules with cache busting
 * 3. Triggering React Fast Refresh to update components without losing state
 *
 * HMR is automatically initialized when you call `hydrate()` from
 * `@inkibra/router/react` in development mode. You don't need to
 * manually call `connectHmr()` or `initReactRefresh()` anymore.
 *
 * @example
 * ```typescript
 * // HMR auto-initializes when hydrate() is called in dev mode
 * import { hydrate } from '@inkibra/router/react';
 * await hydrate({ ... });
 *
 * // Manual initialization (advanced use cases only)
 * import { connectHmr } from '@inkibra/router/hmr-client';
 * await connectHmr();
 * ```
 */

import { invalidateByPath } from './strategy';

/**
 * HMR connection state.
 */
type HmrConnectionState = 'disconnected' | 'connecting' | 'connected';

/**
 * Bundle info from the server.
 */
interface BundleInfo {
  entryUrl: string;
  entryHash: string;
  chunks: Array<{
    url: string;
    hash: string;
    importPath: string;
    kind: 'entry-point' | 'chunk';
  }>;
  chunkMap: Record<string, string>;
}

/**
 * Bundle update from the server.
 */
interface HmrBundleUpdate {
  frontendName: string;
  entryPoint: string;
  bundleInfo: BundleInfo;
}

/**
 * HMR message from server.
 */
interface HmrServerMessage {
  type: 'connected' | 'update' | 'bundle-update' | 'full-reload' | 'error';
  timestamp?: number;
  updates?: Array<{ path: string }>;
  bundles?: HmrBundleUpdate[];
  reason?: string;
  message?: string;
}

/**
 * React Refresh runtime interface.
 * We dynamically import this to avoid bundling in production.
 */
interface RefreshRuntimeType {
  injectIntoGlobalHook: (globalObject: typeof globalThis) => void;
  performReactRefresh: () => void;
  hasUnrecoverableErrors: () => boolean;
  register?: (type: any, id: string) => void;
  createSignatureFunctionForTransform?: () => (type: any) => any;
}

// Module-level state
let ws: WebSocket | null = null;
let connectionState: HmrConnectionState = 'disconnected';
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let RefreshRuntime: RefreshRuntimeType | null = null;
let hmrUpdateCounter = 0; // Counter for aggressive cache busting

// Configuration
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_BASE = 1000;
const RECONNECT_DELAY_MAX = 30000;

/**
 * Initialize React Fast Refresh runtime.
 *
 * This is automatically called by `hydrate()` in development mode.
 * You only need to call this manually for advanced use cases where
 * you're not using the standard hydrate() flow.
 */
export async function initReactRefresh(): Promise<void> {
  if (RefreshRuntime) return;

  try {
    // Dynamic import to avoid bundling in production
    // @ts-expect-error - react-refresh/runtime doesn't have types
    const runtime = await import('react-refresh/runtime');
    RefreshRuntime = runtime.default || runtime;

    if (!RefreshRuntime) {
      console.warn('[HMR] React Refresh runtime not available');
      return;
    }

    // Inject into global hooks
    RefreshRuntime.injectIntoGlobalHook(window);

    // Expose RefreshRuntime globally so delegating stubs can find it
    // The stubs in app-shell.tsx check window.RefreshRuntime to know when to delegate
    (window as any).RefreshRuntime = RefreshRuntime;

    // Check if delegating stubs already exist (set by app-shell.tsx)
    const hasStubs = typeof (window as any).$RefreshReg$ === 'function';
    if (!hasStubs) {
      // Fallback: set up functions directly if stubs weren't created
      // biome-ignore lint/suspicious/noExplicitAny: React Refresh global type
      (window as any).$RefreshReg$ = (type: any, id: string) => {
        if (RefreshRuntime?.register) {
          RefreshRuntime.register(type, id);
        }
      };
      // biome-ignore lint/suspicious/noExplicitAny: React Refresh global type
      (window as any).$RefreshSig$ =
        RefreshRuntime.createSignatureFunctionForTransform ||
        (() => (type: unknown) => type);
    }

    console.log('[HMR] React Refresh initialized');
  } catch (err) {
    console.warn('[HMR] React Refresh not available:', err);
  }
}

/**
 * Calculate reconnection delay with exponential backoff.
 */
function getReconnectDelay(): number {
  const delay = Math.min(
    RECONNECT_DELAY_BASE * 2 ** reconnectAttempts,
    RECONNECT_DELAY_MAX,
  );
  return delay + Math.random() * 1000; // Add jitter
}

/**
 * Handle an HMR update message from the server (legacy path-based updates).
 */
async function handleUpdate(msg: HmrServerMessage): Promise<void> {
  if (!msg.updates || msg.updates.length === 0) return;

  console.log('[HMR] Path update received');

  const timestamp = msg.timestamp || Date.now();

  for (const update of msg.updates) {
    // Invalidate the strategy cache
    const invalidated = invalidateByPath(update.path);

    if (invalidated) {
      try {
        // Re-import with cache busting
        await import(`${update.path}?t=${timestamp}`);
      } catch (err) {
        console.error(`[HMR] Failed to reimport ${update.path}:`, err);
        // If reimport fails, trigger full reload
        window.location.reload();
        return;
      }
    }
  }

  // Trigger React Refresh
  if (RefreshRuntime) {
    if (RefreshRuntime.hasUnrecoverableErrors()) {
      console.warn('[HMR] Unrecoverable errors detected, reloading...');
      window.location.reload();
      return;
    }

    RefreshRuntime.performReactRefresh();
    console.log('[HMR] React components refreshed');
  }
}

/**
 * Handle a bundle update message from the server.
 * This is the preferred path - the server rebuilds affected frontends
 * and sends new chunk URLs that we can directly import.
 */
async function handleBundleUpdate(msg: HmrServerMessage): Promise<void> {
  if (!msg.bundles || msg.bundles.length === 0) return;

  console.log('[HMR] Bundle update received');

  for (const bundle of msg.bundles) {
    const { frontendName, bundleInfo } = bundle;

    try {
      // NOTE: Don't clear preload cache - components need to stay preloaded
      // for React Refresh to work. The cache-busted imports will load new code,
      // and React Refresh will register new component definitions, but the
      // strategy system can keep using existing preload cache entries.

      // Import all chunks with cache busting
      // This is crucial for code-split components - we need to re-import
      // the chunks that contain changed components so they get re-registered
      // with React Refresh's $RefreshReg$
      const timestamp = msg.timestamp || Date.now();

      // Increment counter for this update cycle
      hmrUpdateCounter++;

      // Cache busting with timestamp + counter
      // Combined with server-side Cache-Control: no-cache headers,
      // this ensures browsers always fetch fresh modules in development
      const cacheBuster = `t=${timestamp}&n=${hmrUpdateCounter}`;

      // Import only code-split chunks (NOT entry-point)
      // Entry-point chunks contain hydration/initialization code that shouldn't re-run
      // We only want to re-import the route/component chunks to get fresh component definitions

      // Import only code-split chunks
      const chunksToImport = bundleInfo.chunks.filter(
        (chunk) => chunk.kind === 'chunk',
      );

      const chunkPromises = chunksToImport.map(async (chunk) => {
        const chunkUrl = `${chunk.url}?${cacheBuster}`;
        try {
          await import(/* @vite-ignore */ chunkUrl);
        } catch (err) {
          console.error('[HMR] Failed to load chunk:', err);
        }
      });

      await Promise.all(chunkPromises);
    } catch (err) {
      console.error(`[HMR] Failed to load bundle ${frontendName}:`, err);
      // If bundle import fails, trigger full reload
      window.location.reload();
      return;
    }
  }

  // Trigger React Refresh after all bundles are loaded
  if (RefreshRuntime) {
    if (RefreshRuntime.hasUnrecoverableErrors()) {
      console.warn('[HMR] Unrecoverable errors detected, reloading...');
      window.location.reload();
      return;
    }

    try {
      RefreshRuntime.performReactRefresh();
      console.log('[HMR] React components refreshed');
    } catch (err) {
      console.error('[HMR] performReactRefresh() failed:', err);
    }
  } else {
    console.warn(
      '[HMR] RefreshRuntime not available, cannot refresh components',
    );
  }
}

/**
 * Handle WebSocket messages.
 */
async function handleMessage(event: MessageEvent): Promise<void> {
  let msg: HmrServerMessage;

  try {
    msg = JSON.parse(event.data);
  } catch {
    console.error('[HMR] Invalid message:', event.data);
    return;
  }

  switch (msg.type) {
    case 'connected':
      console.log('[HMR] Connected to dev server');
      reconnectAttempts = 0;
      break;

    case 'bundle-update':
      await handleBundleUpdate(msg);
      break;

    case 'update':
      await handleUpdate(msg);
      break;

    case 'full-reload':
      console.log('[HMR] Full reload requested');
      window.location.reload();
      break;

    case 'error':
      console.error('[HMR] Server error:', msg.message);
      break;

    default:
      console.warn('[HMR] Unknown message type:', msg);
  }
}

/**
 * Attempt to reconnect to the HMR server.
 */
function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(
      '[HMR] Max reconnection attempts reached. Reload the page manually.',
    );
    return;
  }

  const delay = getReconnectDelay();
  console.log(`[HMR] Reconnecting in ${Math.round(delay / 1000)}s...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempts++;
    connect();
  }, delay);
}

/**
 * Connect to the HMR WebSocket server.
 */
function connect(): void {
  if (connectionState === 'connected' || connectionState === 'connecting') {
    return;
  }

  connectionState = 'connecting';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/_hmr`;

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      connectionState = 'connected';
    };

    ws.onmessage = handleMessage;

    ws.onerror = (err) => {
      console.error('[HMR] WebSocket error:', err);
    };

    ws.onclose = () => {
      connectionState = 'disconnected';
      ws = null;
      console.log('[HMR] Disconnected from dev server');
      scheduleReconnect();
    };
  } catch (err) {
    console.error('[HMR] Failed to connect:', err);
    connectionState = 'disconnected';
    scheduleReconnect();
  }
}

/**
 * Disconnect from the HMR server.
 */
export function disconnectHmr(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  connectionState = 'disconnected';
  reconnectAttempts = 0;
}

/**
 * Connect to the HMR dev server.
 *
 * This is automatically called by `hydrate()` in development mode.
 * You only need to call this manually for advanced use cases where
 * you're not using the standard hydrate() flow.
 *
 * @example
 * ```typescript
 * // Manual initialization (advanced use cases only)
 * import { connectHmr } from '@inkibra/router/hmr-client';
 * await connectHmr();
 * ```
 */
export async function connectHmr(): Promise<void> {
  // Only run in browser
  if (typeof window === 'undefined') {
    return;
  }

  // Initialize React Refresh first
  await initReactRefresh();

  // Expose diagnostic helper for debugging
  // biome-ignore lint/suspicious/noExplicitAny: Diagnostic helper needs window access
  (window as any).logHmrDiagnostics = () => {
    console.group('[HMR Diagnostics]');
    console.log('RefreshRuntime:', RefreshRuntime ? '✓' : '✗');
    console.log('Connection:', connectionState);
    // biome-ignore lint/suspicious/noExplicitAny: Internal React Refresh implementation detail
    if (RefreshRuntime && (RefreshRuntime as any)._familiesByType) {
      // biome-ignore lint/suspicious/noExplicitAny: Internal React Refresh implementation detail
      console.log(
        'Components:',
        (RefreshRuntime as any)._familiesByType.size || 0,
      );
    }
    console.groupEnd();
  };

  // Connect to WebSocket
  connect();
}

/**
 * Get the current HMR connection state.
 */
export function getHmrConnectionState(): HmrConnectionState {
  return connectionState;
}

/**
 * Check if HMR is connected.
 */
export function isHmrConnected(): boolean {
  return connectionState === 'connected';
}
