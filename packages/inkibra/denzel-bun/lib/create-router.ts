/**
 * createRouter - Unified Server Entry Point
 *
 * Creates a Bun-compatible fetch handler that routes requests to:
 * - Static file directories
 * - API route handlers (from backends)
 * - EventStream handlers (from backends)
 * - SSR frontends (via createAppMountPoint)
 *
 * Context codecs are now on routes - the render function reads them
 * from matched routes using runServerSideRender.
 *
 * Usage:
 * ```typescript
 * const authBackend = createBackend({
 *   apiHandlers: { ...loginHandlerProvider(deps) },
 * });
 *
 * const boardsBackend = createBackend({
 *   apiHandlers: { ...boardHandlersProvider(deps) },
 *   streamHandlers: { ...boardUpdatesProvider(deps) },
 *   channelFactory,
 * });
 *
 * const TempoFrontend = createAppMountPoint({
 *   name: 'TempoFrontend',
 *   mountPath: '/tt',
 *   allowedDomains: ['example.com'],
 *   render: async (request, ctx) => {
 *     // runServerSideRender reads codecs from matched route
 *     return runServerSideRender(...);
 *   },
 * });
 *
 * const router = createRouter({
 *   backends: [authBackend, boardsBackend],
 *   staticDirs: { '/assets': './dist/assets' },
 *   frontends: [TempoFrontend],
 * });
 *
 * export default { port: 3000, fetch: router.fetch };
 * ```
 */

import type { EventStreamChannelFactory } from '@inkibra/router';
import type {
  AppMountPoint,
  AppMountPointContext,
} from './create-app-mount-point';
import type { AnyBackend } from './create-backend';

/**
 * Static directory configuration
 */
export type StaticDirConfig = Record<string, string>;

/**
 * Router configuration
 */
export type RouterConfig = {
  /** Backends (from createBackend) containing API and EventStream handlers */
  backends?: AnyBackend[];

  /** Static file directories: { urlPrefix: fileSystemPath } */
  staticDirs?: StaticDirConfig;

  /** SSR frontends (from createAppMountPoint) */
  frontends?: AppMountPoint[];

  /** EventStream channel factory (fallback if backends don't have one) */
  channelFactory?: EventStreamChannelFactory;

  /** Custom 404 handler */
  notFoundHandler?: (request: Request) => Response | Promise<Response>;

  /** Custom error handler */
  errorHandler?: (
    error: unknown,
    request: Request,
  ) => Response | Promise<Response>;
};

/**
 * Created router instance
 */
export type Router = {
  /** Fetch handler for Bun.serve */
  fetch: (request: Request) => Promise<Response>;

  /** Get all registered API handlers */

  /** Get all registered EventStream handlers */

  /** Get all registered frontends */
  getFrontends: () => AppMountPoint[];

  /** Get all backends */
  getBackends: () => AnyBackend[];
};

// ============================================================================
// Static File Serving
// ============================================================================

/**
 * Check if a path matches a static directory and return the file path
 */
function matchStaticDir(
  pathname: string,
  staticDirs: StaticDirConfig,
): { filePath: string; prefix: string } | null {
  for (const [prefix, dir] of Object.entries(staticDirs)) {
    if (pathname.startsWith(prefix)) {
      const relativePath = pathname.slice(prefix.length);
      const filePath = `${dir}${relativePath}`;
      return { filePath, prefix };
    }
  }
  return null;
}

/**
 * Serve a static file with appropriate caching headers.
 * In development, JavaScript files use no-cache to support HMR.
 * In production, all files use aggressive caching (assuming content hashing).
 */
async function serveStaticFile(filePath: string): Promise<Response | null> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return null;
    }

    // Determine cache control based on environment and file type
    const isDev = process.env.NODE_ENV !== 'production';
    const isJavaScript = filePath.endsWith('.js') || filePath.endsWith('.mjs');

    let cacheControl: string;
    if (isDev && isJavaScript) {
      // In dev mode, disable caching for JS files to ensure HMR works
      // no-cache = must revalidate with server (server can return 304 if unchanged)
      // no-store = don't store in cache at all (more aggressive)
      cacheControl = 'no-cache, no-store, must-revalidate';
    } else {
      // Production or non-JS files: aggressive caching with content hashing
      cacheControl = 'public, max-age=31536000, immutable';
    }

    return new Response(file, {
      headers: {
        'Content-Type': file.type,
        'Cache-Control': cacheControl,
      },
    });
  } catch {
    return null;
  }
}

// ============================================================================
// Domain Routing
// ============================================================================

/**
 * Get hostname from request, preferring `X-Forwarded-Host` when present.
 *
 * **Security assumption:** `X-Forwarded-Host` is trusted unconditionally.
 * This server must be deployed behind a trusted reverse proxy that controls
 * this header. If the server is exposed directly to the internet, an attacker
 * could spoof this header to match a different frontend's domain and bypass
 * domain-based routing isolation.
 */
function getHostname(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const firstHost = forwardedHost
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.length > 0);
    if (firstHost) {
      try {
        return new URL(`http://${firstHost}`).hostname;
      } catch {
        return firstHost;
      }
    }
  }

  const url = new URL(request.url);
  return url.hostname;
}

/**
 * Find frontend that matches the request
 */
function matchFrontend(
  request: Request,
  frontends: AppMountPoint[],
): AppMountPoint | null {
  const hostname = getHostname(request);
  const url = new URL(request.url);
  const pathname = url.pathname;

  for (const frontend of frontends) {
    // Check domain match (case-insensitive)
    const hostnameLC = hostname.toLowerCase();
    if (!frontend.allowedDomains.some((d) => d.toLowerCase() === hostnameLC)) {
      continue;
    }

    // Check mount path match
    // Handle "/" mount path matching both "/" and "" (empty path)
    const mountPathRaw = frontend.mountPath;
    const mountPath =
      mountPathRaw === '' || mountPathRaw === '/'
        ? '/'
        : mountPathRaw.replace(/\/+$/, '');
    if (mountPath === '/') {
      // Root mount matches everything
      return frontend;
    }
    // Match exact path or path with trailing content
    if (pathname === mountPath || pathname.startsWith(mountPath + '/')) {
      return frontend;
    }

    // Check domain asset match
    if (frontend.domainAssets) {
      const assetKey = pathname.startsWith('/') ? pathname.slice(1) : pathname;
      if (assetKey in frontend.domainAssets) {
        return frontend;
      }
    }
  }

  return null;
}

/**
 * Build minimal context for the render function.
 * Full context (from route codecs) is built by runServerSideRender.
 */
function buildMinimalContext(request: Request): AppMountPointContext {
  return {
    hostname: getHostname(request),
  };
}

// ============================================================================
// createRouter
// ============================================================================

/**
 * Create a unified router for Bun.serve
 */
export function createRouter(config: RouterConfig): Router {
  const {
    backends = [],
    staticDirs = {},
    frontends = [],
    channelFactory: _channelFactory,
    notFoundHandler = () => new Response('Not Found', { status: 404 }),
    errorHandler = (error, request) => {
      const url = new URL(request.url);
      // Structured error logging with request context
      console.error('[Router] Request error', {
        path: url.pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return new Response('Internal Server Error', { status: 500 });
    },
  } = config;

  // Main fetch handler
  const fetch = async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // 1. Check static files first (fastest path)
      const staticMatch = matchStaticDir(pathname, staticDirs);
      if (staticMatch) {
        const response = await serveStaticFile(staticMatch.filePath);
        if (response) {
          return response;
        }
      }

      // 2. Try backends (API and EventStream routes)
      // Each backend handles its own routing; first non-404 wins
      for (const backend of backends) {
        const response = await backend.fetch(request);
        // If backend returned non-404, use that response
        if (response.status !== 404) {
          return response;
        }
      }

      // 3. Check frontends (domain + path routing)
      const matchedFrontend = matchFrontend(request, frontends);
      if (matchedFrontend) {
        // Build minimal context (hostname only)
        // Full context from route codecs is built by runServerSideRender
        const ctx = buildMinimalContext(request);

        // Check for domain asset first
        if (matchedFrontend.domainAssets) {
          const assetKey = pathname.startsWith('/')
            ? pathname.slice(1)
            : pathname;
          const asset = matchedFrontend.domainAssets[assetKey];

          if (asset) {
            // Static asset path
            if (typeof asset === 'string') {
              const response = await serveStaticFile(asset);
              if (response) {
                return response;
              }
            }

            // Dynamic asset handler
            if (typeof asset === 'function') {
              return await asset(request, ctx);
            }
          }
        }

        // Render the frontend
        // The render function uses runServerSideRender which reads
        // codecs from matched routes after route matching
        return await matchedFrontend.render(request, ctx);
      }

      // 4. Not found
      return await notFoundHandler(request);
    } catch (error) {
      return await errorHandler(error, request);
    }
  };

  return {
    fetch,
    getFrontends: () => frontends,
    getBackends: () => backends,
  };
}
