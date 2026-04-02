/**
 * Location Sources
 *
 * Idempotent sources for Router location state.
 * Same API works on server and client - sources handle environment detection internally.
 */

// ============================================================================
// Types
// ============================================================================

export type LocationSource = {
  /** Get current path */
  getPath(): string;

  /** Get current query parameters */
  getQuery(): Record<string, string>;

  /** Navigate to a new path */
  navigate(path: string, options?: { replace?: boolean }): void;

  /** Subscribe to location changes (no-op on server) */
  subscribe(callback: () => void): () => void;

  /** Get state for checkpoint serialization */
  getCheckpointState(): { key?: string; path: string };
};

// ============================================================================
// Environment Detection
// ============================================================================

const isServer = typeof window === 'undefined';

// ============================================================================
// URL Parsing Helpers
// ============================================================================

function parseUrl(url: string): {
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
} {
  // Handle both full URLs and path-only strings
  try {
    const parsed = new URL(url, 'http://localhost');
    return {
      pathname: parsed.pathname,
      search: parsed.search,
      searchParams: parsed.searchParams,
    };
  } catch {
    // Fallback for malformed URLs
    const [pathname, search = ''] = url.split('?');
    return {
      pathname: pathname || '/',
      search: search ? `?${search}` : '',
      searchParams: new URLSearchParams(search),
    };
  }
}

function searchParamsToRecord(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

// ============================================================================
// Segment Source
// ============================================================================

/**
 * Creates a segment source - URL path is source of truth.
 *
 * @param initialUrl - The initial URL (from request on server, window.location on client)
 * @returns LocationSource that uses browser history on client
 */
export function createSegmentSource(initialUrl: string): LocationSource {
  const { pathname: initialPath, searchParams } = parseUrl(initialUrl);
  const initialQuery = searchParamsToRecord(searchParams);

  // Server: static state
  if (isServer) {
    return {
      getPath: () => initialPath,
      getQuery: () => initialQuery,
      navigate: () => {
        // No-op on server
      },
      subscribe: () => () => {
        // No-op cleanup
      },
      getCheckpointState: () => ({ path: initialPath }),
    };
  }

  // Client: use window.location and history
  return {
    getPath: () => window.location.pathname,
    getQuery: () =>
      searchParamsToRecord(new URLSearchParams(window.location.search)),
    navigate: (path, options = {}) => {
      if (options.replace) {
        window.history.replaceState(null, '', path);
      } else {
        window.history.pushState(null, '', path);
      }
      // Dispatch popstate-like event for subscribers
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    subscribe: (callback) => {
      window.addEventListener('popstate', callback);
      return () => window.removeEventListener('popstate', callback);
    },
    getCheckpointState: () => ({
      path: window.location.pathname + window.location.search,
    }),
  };
}

// ============================================================================
// Virtual Source
// ============================================================================

/**
 * Creates a virtual source - memory is source of truth.
 *
 * @param initialUrl - The initial URL to parse for initial state (from `?key=/path`)
 * @param key - The query parameter key for this virtual source
 * @returns LocationSource that stores state in memory
 */
export function createVirtualSource(
  initialUrl: string,
  key: string,
): LocationSource {
  const { searchParams } = parseUrl(initialUrl);

  // Parse initial path from query param: ?panel=/playlist/rock
  const initialPath = searchParams.get(key) || '/';
  const initialQuery: Record<string, string> = {};

  // Internal state
  let currentPath = initialPath;
  let currentQuery = initialQuery;
  const subscribers = new Set<() => void>();

  const notifySubscribers = () => {
    subscribers.forEach((cb) => cb());
  };

  return {
    getPath: () => currentPath,
    getQuery: () => currentQuery,
    navigate: (path, _options = {}) => {
      // Parse path for query string
      const { pathname, searchParams: pathParams } = parseUrl(path);
      currentPath = pathname;
      currentQuery = searchParamsToRecord(pathParams);
      notifySubscribers();
    },
    subscribe: (callback) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    getCheckpointState: () => ({
      key,
      path: currentPath,
    }),
  };
}

// ============================================================================
// Checkpoint URL Builder
// ============================================================================

/**
 * Builds a checkpoint URL from a base path and virtual source states.
 *
 * @param basePath - The base URL path
 * @param virtualStates - Array of { key, path } from virtual sources
 * @returns Full URL with virtual states serialized as query params
 */
export function buildCheckpointUrl(
  basePath: string,
  virtualStates: Array<{ key: string; path: string }>,
): string {
  const { pathname, searchParams } = parseUrl(basePath);

  // Add virtual states as query params
  for (const { key, path } of virtualStates) {
    searchParams.set(key, path);
  }

  const search = searchParams.toString();
  return search ? `${pathname}?${search}` : pathname;
}
