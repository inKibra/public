/** @jsxImportSource react */
/**
 * App Router Component
 *
 * Provides routing for React applications with:
 * - Nested layouts via <Outlet /> context pattern
 * - Multiple loaders with dependency resolution
 * - Server-aware navigation (triggers HTML refresh for server loaders)
 * - Type-safe pendingTransition prop based on skeleton presence
 *
 * Usage:
 * - Router takes only `routes` prop
 * - All other config (source, implementations, contextGetter) comes from RouterProvider
 * - Use runServerSideRender (server) or hydrate (client) to wrap Router in provider
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { AnyApiRoute } from './api-route';
import type { ApiRouteHandler } from './api-route-handler';
import {
  generateOutletId,
  type OutletComponent,
  type OutletProps,
  type PendingTransitionWithoutSkeleton,
  type PendingTransitionWithSkeleton,
  type ReactComponent,
  type RouteEntryConstraint,
} from './app-route';
import type { CapabilityImplementation } from './capability';
import type {
  ContextCodecMap,
  ContextCodecMapDataTypes,
  ContextCodecMapResultTypes,
  ContextResult,
} from './context-codec';
import type { LocationSource } from './location-source';
import { buildCheckpointUrl } from './location-source';
import { QueryClient } from './query-client';
import type { SerializableResult } from './result';
import {
  isLazyComponent,
  isPlainComponent,
  isStaticComponent,
  isStrategyComponent,
  type LazyComponentRef,
  preloadComponent,
  type RouteComponent,
  resolveComponent,
} from './strategy';
import type { StorageScope } from './transport';

// ============================================================================
// Types
// ============================================================================

/**
 * Route entry for Router configuration
 * Generic over both route and component to preserve full type information
 *
 * Component can be:
 * - strategy.sync(() => import(...)) - Separate chunk, loaded in <head>
 * - strategy.lazy(() => import(...)) - Separate chunk, loaded on demand
 * - strategy.static(() => import(...)) - SSR-only, preserved as HTML
 * - Plain ComponentType (backwards compatibility)
 */
export type RouteEntry<
  TRoute extends RouteEntryConstraint = RouteEntryConstraint,
  // biome-ignore lint/suspicious/noExplicitAny: Loose constraints allow specific types through
  TComponent extends RouteComponent<any> = RouteComponent<any>,
> = {
  appRoute: TRoute;
  component: TComponent;
};

/**
 * Convert a union to an intersection
 * { a: X } | { b: Y } => { a: X } & { b: Y }
 */
type UnionToIntersection<U> = (
  U extends unknown
    ? (k: U) => void
    : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Extract all API routes from a routes array
 * Merges all apiRoutes from all route entries into a single map
 */
export type ExtractAllApiRoutes<TRoutes extends readonly RouteEntry[]> =
  TRoutes[number]['appRoute'] extends { apiRoutes: infer A } ? A : never;

/**
 * Union of all API routes from a routes array (for implementation requirements)
 */
export type AllApiRoutesUnion<TRoutes extends readonly RouteEntry[]> =
  TRoutes[number]['appRoute']['apiRoutes'][keyof TRoutes[number]['appRoute']['apiRoutes']];

/**
 * Merge all apiRoutes from all routes into a single map
 * Uses UnionToIntersection to combine { a: X } | { b: Y } => { a: X, b: Y }
 */
export type MergedApiRoutes<TRoutes extends readonly RouteEntry[]> =
  UnionToIntersection<TRoutes[number]['appRoute']['apiRoutes']>;

/**
 * Extract context type from a route's contextCodec
 */
type RouteContextType<R extends AnyApiRoute> = R extends {
  contextCodec: infer C;
}
  ? C extends ContextCodecMap
    ? ContextCodecMapDataTypes<C>
    : Record<string, never>
  : Record<string, never>;

type RouteContextResultType<R extends AnyApiRoute> = R extends {
  contextCodec: infer C;
}
  ? C extends ContextCodecMap
    ? ContextCodecMapResultTypes<C>
    : Record<string, never>
  : Record<string, never>;

/**
 * Required API implementations based on all routes
 * Maps each route name to ApiRouteHandler objects (not bare functions)
 * Router will extract context requirements from handler.route and call execute(args, ctx)
 */
export type RequiredApiImplementations<TRoutes extends readonly RouteEntry[]> =
  {
    [K in keyof MergedApiRoutes<TRoutes>]: MergedApiRoutes<TRoutes>[K] extends AnyApiRoute
      ? ApiRouteHandler<
          MergedApiRoutes<TRoutes>[K],
          RouteContextType<MergedApiRoutes<TRoutes>[K]>,
          RouteContextResultType<MergedApiRoutes<TRoutes>[K]>
        >
      : never;
  };

/**
 * Extract all context codecs from a routes array
 * Combines inherited (from apiRoutes) and additional context codecs
 */
export type ExtractAllContextCodecs<TRoutes extends readonly RouteEntry[]> =
  TRoutes[number]['appRoute'] extends {
    apiRoutes: infer A;
    additionalContextCodecs?: infer C;
  }
    ? (A extends Record<string, { contextCodec?: infer AC }> ? AC : never) | C
    : never;

// ============================================================================
// Required Context Extraction
// ============================================================================

/**
 * Extract all context codec maps from API routes in a routes array
 * Gets both contextCodec (read) and createsContextCodec (write) from all API routes
 */
type ExtractApiRouteCodecs<TApiRoutes> = TApiRoutes extends Record<
  string,
  infer R
>
  ? R extends { contextCodec?: infer C; createsContextCodec?: infer CC }
    ?
        | (C extends ContextCodecMap ? C : never)
        | (CC extends ContextCodecMap ? CC : never)
    : never
  : never;

/**
 * Extract all context codec maps from a single route entry
 * Filters out empty/never codec maps
 */
type ExtractRouteCodecs<TRoute> = TRoute extends {
  apiRoutes?: infer A;
  additionalContextCodecs?: infer C;
}
  ?
      | NonEmptyCodecMap<ExtractApiRouteCodecs<A>>
      | NonEmptyCodecMap<C extends ContextCodecMap ? C : never>
  : never;

/**
 * Filter out empty codec maps (Record<string, never> or never)
 */
type NonEmptyCodecMap<T> = T extends Record<string, never>
  ? never
  : T extends never
    ? never
    : T;

/**
 * Merge all context codec maps from all routes
 * Produces a union of all codec maps, then intersected to merge keys
 * Falls back to empty record if no codecs found
 */
export type MergedContextCodecs<TRoutes extends readonly RouteEntry[]> =
  UnionToIntersection<
    ExtractRouteCodecs<TRoutes[number]['appRoute']>
  > extends ContextCodecMap
    ? UnionToIntersection<ExtractRouteCodecs<TRoutes[number]['appRoute']>>
    : Record<string, never>;

/**
 * Required context for server-side rendering
 * Maps codec names to their data types - keys are required, values can be undefined
 *
 * This ensures you don't forget to pass a context that routes need,
 * while allowing undefined values when context is not available.
 *
 * Usage with runServerSideRender:
 * ```typescript
 * const { html } = await runServerSideRender(..., {
 *   context: { session: sessionData },  // TypeScript enforces session key exists
 * });
 *
 * // Error: missing 'session' key
 * context: {}
 *
 * // OK: explicitly says no session
 * context: { session: undefined }
 * ```
 */
export type RequiredContext<TRoutes extends readonly RouteEntry[]> = {
  [K in keyof ContextCodecMapDataTypes<MergedContextCodecs<TRoutes>>]:
    | ContextCodecMapDataTypes<MergedContextCodecs<TRoutes>>[K]
    | undefined;
};

/**
 * Filter a codec map to only include codecs with a specific scope.
 * Applied BEFORE union-to-intersection to preserve literal scope types.
 */
type FilterCodecMapByScope<
  TMap,
  TScope extends StorageScope,
> = TMap extends ContextCodecMap
  ? {
      [K in keyof TMap as TMap[K]['scope'] extends TScope ? K : never]: TMap[K];
    }
  : never;

/**
 * Extract codecs from a single route, filtered by scope.
 * Filtering happens at the individual route level where scope is still a literal.
 */
type ExtractRouteCodecsByScope<TRoute, TScope extends StorageScope> =
  | FilterCodecMapByScope<
      NonEmptyCodecMap<
        ExtractApiRouteCodecs<
          TRoute extends { apiRoutes?: infer A } ? A : never
        >
      >,
      TScope
    >
  | FilterCodecMapByScope<
      NonEmptyCodecMap<
        TRoute extends { additionalContextCodecs?: infer C }
          ? C extends ContextCodecMap
            ? C
            : never
          : never
      >,
      TScope
    >;

/**
 * Merge codecs from all routes, filtered by scope.
 * Filter first (preserves literal scope), then merge.
 */
type MergedCodecsByScope<
  TRoutes extends readonly RouteEntry[],
  TScope extends StorageScope,
> = UnionToIntersection<
  ExtractRouteCodecsByScope<TRoutes[number]['appRoute'], TScope>
> extends ContextCodecMap
  ? UnionToIntersection<
      ExtractRouteCodecsByScope<TRoutes[number]['appRoute'], TScope>
    >
  : Record<string, never>;

/**
 * Required context grouped by scope (session/device)
 * Derived directly from routes - filters by scope BEFORE merging to preserve literal types
 */
export type RequiredContextByScope<TRoutes extends readonly RouteEntry[]> = {
  session: {
    [K in keyof MergedCodecsByScope<TRoutes, 'session'>]:
      | MergedCodecsByScope<TRoutes, 'session'>[K]['_dataType']
      | undefined;
  };
  device: {
    [K in keyof MergedCodecsByScope<TRoutes, 'device'>]:
      | MergedCodecsByScope<TRoutes, 'device'>[K]['_dataType']
      | undefined;
  };
};

/**
 * Read context function - stateless context reader
 *
 * @param storageScope - Where the context is stored ('session' | 'device')
 * @param appName - The app name (used as key prefix)
 * @param codecName - The context codec name
 * @returns The parsed context value, or undefined if not found
 */
export type ReadContextFn = (
  storageScope: StorageScope,
  appName: string,
  codecName: string,
) => unknown;

/**
 * Codec registry entry - metadata about a context codec
 */
export type CodecRegistryEntry = {
  /** Storage scope for this codec */
  scope: StorageScope;
  /** Default value from the codec, used when context is not found */
  defaultValue?: unknown;
};

/**
 * Codec registry - maps codec names to their metadata
 * Extracted from app routes at hydrate/render time
 */
export type CodecRegistry = Record<string, CodecRegistryEntry>;

/**
 * API implementations map
 * Keys are route names, values are ApiRouteHandler objects
 * Router calls handler.execute(args, ctx) where ctx is built from readContext
 */
export type ApiImplementations = Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: Implementations have dynamic signatures
  ApiRouteHandler<AnyApiRoute, any, any>
>;

/**
 * EventStream implementations map
 * Keys are route names, values are event stream handlers
 */
export type EventStreamImplementations = Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: Implementations have dynamic signatures
  { name: string; getBus: (...args: any[]) => any }
>;

/**
 * Router Provider configuration
 * Passed to runServerSideRender (server) or hydrate (client)
 */
export type RouterProviderConfig = {
  /** Location source - handles server/client location state */
  source: LocationSource;
  /** API route implementations */
  apiImplementations: ApiImplementations;
  /** EventStream route implementations */
  eventStreamImplementations: EventStreamImplementations;
  /** Context reader function */
  readContext: ReadContextFn;
  /** App name (used for context key prefixing) */
  appName: string;
  /** Codec registry - extracted from app routes */
  codecRegistry: CodecRegistry;
  /**
   * Initial loader data from SSR (for hydration).
   * When provided, skips loader execution on first render.
   * Keyed by route name.
   */
  initialLoaderData?: Record<string, SerializableResult<unknown, unknown>>;
  /** Base path prefix (e.g., for micro-frontends) */
  basePath?: string;
  /** Custom checkpoint handler (defaults to history.pushState on client) */
  onCheckpoint?: (url: string) => void;
  /** Root error boundary component */
  rootErrorBoundary?: ReactComponent<{ error: unknown; reset: () => void }>;
  /** QueryClient for caching and invalidation */
  queryClient?: QueryClient;
};

/**
 * Router configuration - generic over routes for type extraction
 */
export type RouterConfig<TRoutes extends readonly RouteEntry[] = RouteEntry[]> =
  {
    /** Flat array of route entries - router builds tree from path.parent relationships */
    routes: TRoutes;
  };

/**
 * Navigation options
 */
export type NavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

/**
 * Navigation function type
 */
export type NavigateFn = (path: string, options?: NavigateOptions) => void;

/**
 * Route match result
 */
export type RouteMatch = {
  route: RouteEntryConstraint;
  /** The resolved React component (ready to render) */
  component: ReactComponent;
  /** The original strategy component reference (for static detection) */
  strategyComponent: RouteComponent;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
};

/**
 * Registered capabilities from parent to child
 */
type RegisteredCapabilities = Record<
  string,
  CapabilityImplementation<unknown, unknown>
>;

/**
 * Outlet context value - includes element and capabilities
 */
type OutletContextValue = {
  element: React.ReactNode;
  capabilities: RegisteredCapabilities;
};

/**
 * Outlet registry value - holds child elements and capability receivers by outlet name
 */
type OutletRegistryValue = {
  /** Child elements keyed by outlet name */
  childElements: Map<string, React.ReactNode>;
  /** Callback to register capabilities from outlet component */
  registerCapabilities: (
    name: string,
    capabilities: RegisteredCapabilities,
  ) => void;
};

/**
 * Static parent context value - tells outlets whether to render as placeholders
 */
type StaticParentContextValue = {
  /** Whether the parent route is static */
  isStatic: boolean;
  /** The app ID for generating outlet IDs */
  appId: string;
  /** The current route path for generating outlet IDs */
  routePath: string;
};

/**
 * Portal registry value - manages portal targets for static parents
 */
type PortalRegistryValue = {
  /** Register a portal target */
  registerPortal: (outletId: string, element: React.ReactNode) => void;
  /** Unregister a portal target */
  unregisterPortal: (outletId: string) => void;
};

// ============================================================================
// Contexts
// ============================================================================

/**
 * Outlet context - provides the matched child element and capabilities
 */
const OutletContext = createContext<OutletContextValue | null>(null);

/**
 * Outlet registry context - allows outlet components to read their child elements
 * and register capabilities
 */
const OutletRegistryContext = createContext<OutletRegistryValue>({
  childElements: new Map(),
  registerCapabilities: () => {},
});

/**
 * Static parent context - tells outlets whether to render as placeholders
 */
const StaticParentContext = createContext<StaticParentContextValue>({
  isStatic: false,
  appId: '',
  routePath: '',
});

/**
 * Portal registry context - manages portals for dynamic children of static parents
 */
const PortalRegistryContext = createContext<PortalRegistryValue>({
  registerPortal: () => {},
  unregisterPortal: () => {},
});

/**
 * Checkpoint function type
 */
export type CheckpointFn = () => string;

/**
 * Router context - provides navigation and current route info
 */
type RouterContextValue = {
  navigate: NavigateFn;
  checkpoint: CheckpointFn;
  currentPath: string;
  isPending: boolean;
  mountPath?: string;
};

const RouterContext = createContext<RouterContextValue | null>(null);

// Export RouterContext for V2 compatibility
export { RouterContext, type RouterContextValue };

/**
 * Router Provider context - provides config to Router
 */
type RouterProviderContextValue = RouterProviderConfig;

const RouterProviderContext = createContext<RouterProviderContextValue | null>(
  null,
);

export { RouterProviderContext };

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the current outlet (child route element) if any
 */
export function useOutlet(): React.ReactNode | null {
  const context = useContext(OutletContext);
  return context?.element ?? null;
}

/**
 * Get router navigation functions
 */
export function useNavigate(): NavigateFn {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useNavigate must be used within a Router');
  }
  return context.navigate;
}

/**
 * Get whether a navigation transition is pending
 */
export function useIsPending(): boolean {
  const context = useContext(RouterContext);
  return context?.isPending ?? false;
}

/**
 * Get the current path
 */
export function useCurrentPath(): string {
  const context = useContext(RouterContext);
  return context?.currentPath ?? '/';
}

/**
 * Get the checkpoint function for creating shareable URLs
 */
export function useCheckpoint(): CheckpointFn {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useCheckpoint must be used within a Router');
  }
  return context.checkpoint;
}

/**
 * Get the app's mount path prefix (e.g. '/app', '/tp').
 * Use this to resolve mount-relative paths from $paths.getPath() to full browser URLs,
 * for example in isActive checks against useCurrentPath().
 */
export function useMountPath(): string {
  const context = useContext(RouterContext);
  return context?.mountPath ?? '';
}

/**
 * Match the current browser path against a $paths node and return its typed params,
 * or null if the current path doesn't match.
 *
 * Useful in parent layout components that need to read params belonging to a
 * child route (e.g. a boards layout reading the active :boardId for sidebar highlighting).
 *
 * @example
 * const currentBoardId = useCurrentParams(appRoutes.$paths.boards[':boardId'])?.boardId;
 */
export function useCurrentParams<
  TParams extends Record<string, string>,
>(pathNode: {
  pattern: string;
  __nodeCtx: { params: TParams };
}): TParams | null {
  const currentPath = useCurrentPath();
  const mountPath = useMountPath();
  const normalizedPath =
    mountPath && currentPath.startsWith(mountPath)
      ? currentPath.slice(mountPath.length)
      : currentPath;
  const patternParts = pathNode.pattern.split('/').filter(Boolean);
  const pathParts = normalizedPath.split('/').filter(Boolean);
  if (pathParts.length < patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const p = pathParts[i];
    if (!pp || !p) return null;
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = p;
    } else if (pp !== p) {
      return null;
    }
  }
  return params as TParams;
}

/**
 * Get the router provider config (internal use)
 */
function useRouterProviderConfig(): RouterProviderContextValue {
  const context = useContext(RouterProviderContext);
  if (!context) {
    throw new Error('Router must be used within a RouterProvider');
  }
  return context;
}

// ============================================================================
// RouterProvider Component
// ============================================================================

/**
 * RouterProvider - wraps Router with configuration
 *
 * Used internally by runServerSideRender (server) and hydrate (client).
 * Not typically used directly by app code.
 */
export function RouterProvider({
  children,
  ...config
}: RouterProviderConfig & { children: React.ReactNode }): React.ReactNode {
  const queryClient = useMemo(
    () => config.queryClient ?? new QueryClient(),
    [config.queryClient],
  );

  return (
    <RouterProviderContext.Provider value={{ ...config, queryClient }}>
      {children}
    </RouterProviderContext.Provider>
  );
}

// ============================================================================
// Outlet Component
// ============================================================================

/**
 * Outlet component - renders the matched child route
 *
 * Uses context to avoid re-rendering parent layouts when child changes.
 * Only the Outlet re-renders, not the surrounding layout.
 */
export function Outlet(): React.ReactNode {
  const outlet = useOutlet();
  return outlet;
}

// ============================================================================
// Route Matching
// ============================================================================

/**
 * Build route tree from flat array using path.parent relationships
 */
function buildRouteTree(
  routes: RouteEntry[],
): Map<RouteEntryConstraint, RouteEntry[]> {
  const tree = new Map<RouteEntryConstraint, RouteEntry[]>();

  // Second pass: build parent -> children map
  for (const entry of routes) {
    const parent = entry.appRoute.path.parent;
    if (parent) {
      // Find the parent route entry
      const parentEntry = routes.find((r) => r.appRoute.path === parent);
      if (parentEntry) {
        const children = tree.get(parentEntry.appRoute) ?? [];
        children.push(entry);
        tree.set(parentEntry.appRoute, children);
      }
    }
  }

  return tree;
}

/**
 * Match a path against routes and return the match chain (parent to child)
 *
 * Routes with targetOutlet: null are "top-level" routes that don't nest.
 * Routes with targetOutlet: 'name' render inside their parent's named outlet.
 *
 * The chain is built by walking up the parent chain, stopping when:
 * - We hit a route with targetOutlet: null (the "root" of this outlet tree)
 * - We run out of parents
 */
function matchPath(path: string, routes: RouteEntry[]): RouteMatch[] {
  // Try to match against all routes
  for (const entry of routes) {
    const match = entry.appRoute.match(path);
    if (match) {
      // Build the chain from root to this route
      const routeChain: RouteEntryConstraint[] = [entry.appRoute];

      // Only walk up parent chain if this route targets an outlet
      // Routes with targetOutlet: null are top-level (don't nest)
      if (entry.appRoute.path.targetOutlet !== null) {
        let currentPath = entry.appRoute.path;

        while (currentPath.parent) {
          // Look for a route registered at this parent path
          const parentEntry = routes.find(
            (r) => r.appRoute.path === currentPath.parent,
          );

          if (parentEntry) {
            // Found a parent route - add it to the chain
            routeChain.unshift(parentEntry.appRoute);

            // If this parent has targetOutlet: null, stop here
            // (it's the "root" of this outlet tree)
            if (parentEntry.appRoute.path.targetOutlet === null) {
              break;
            }

            // Continue walking up
            currentPath = parentEntry.appRoute.path;
          } else {
            // No route at this path (might be an outlet context path)
            // Continue walking up to find the next registered route
            currentPath = currentPath.parent;
          }
        }
      }

      // Create matches for each route in the chain
      const chain: RouteMatch[] = [];
      for (const route of routeChain) {
        const routeEntry = routes.find((r) => r.appRoute === route);
        if (routeEntry) {
          // Get component from routeEntry.component
          // For strategy components (sync/lazy/static), resolve from preload cache
          let component: ReactComponent;
          const routeComponent = routeEntry.component;

          if (isStrategyComponent(routeComponent)) {
            // Resolve from preload cache (must be preloaded before matching)
            // Type assertion: we expect function components from strategy components
            component = resolveComponent(routeComponent) as ReactComponent;
          } else if (isPlainComponent(routeComponent)) {
            // Plain component - use directly (backwards compatibility)
            // Type assertion: RouteComponent allows ComponentType, but ReactComponent is function-only
            component = routeComponent as ReactComponent;
          } else {
            throw new Error(
              'Route "' +
                route.name +
                '" has no valid component. ' +
                'Use strategy.sync/lazy/static to define a component.',
            );
          }

          chain.push({
            route: routeEntry.appRoute,
            component,
            strategyComponent: routeComponent,
            params: match.params as Record<string, string>,
            query: match.query,
          });
        }
      }

      return chain;
    }
  }

  return [];
}

// ============================================================================
// Loader Execution
// ============================================================================

/**
 * Execute loader for a route match (new simplified single-loader system)
 *
 * @param route - The matched route
 * @param params - Path params from URL
 * @param query - Query params from URL
 * @param rawContext - Raw context values from storage
 * @param apiImplementations - API route implementations
 * @returns The loader result, or undefined if no loader
 */
async function executeLoader(
  route: RouteEntryConstraint,
  params: Record<string, string>,
  query: Record<string, string | undefined>,
  rawContext: Record<string, unknown>,
  rawContextResult: Record<string, ContextResult<unknown, unknown, unknown>>,
  apiImplementations: ApiImplementations,
): Promise<SerializableResult<unknown, unknown> | undefined> {
  const loaderConfig = route.loader;
  if (!loaderConfig) return undefined;

  // Server-only loader - skip on client, return undefined
  if (loaderConfig.load === 'server') {
    // On client, server loaders should have been pre-populated via initialLoaderData
    return undefined;
  }

  // Isomorphic loader - execute on client
  // Context is passed as raw data (not wrapped in Result)
  try {
    const result = await loaderConfig.load(apiImplementations, {
      params,
      query,
      ctx: rawContext,
      ctxResult: rawContextResult,
    });
    return result;
  } catch (error) {
    // Return error as SerializableResult
    return {
      type: 'Err',
      error: error instanceof Error ? { message: error.message } : error,
      statusCode: 500,
    } as SerializableResult<unknown, unknown>;
  }
}

// ============================================================================
// Server-Side Loader Execution
// ============================================================================

/**
 * Configuration for running server-side loaders
 */
export type RunServerLoadersConfig = {
  /** Array of route entries to match against */
  routes: RouteEntry[];
  /** URL to match (can be full URL or just pathname) */
  url: string;
  /** API route implementations */
  apiImplementations: ApiImplementations;
  /** Context object for loaders */
  ctx: Record<string, unknown>;
  /** Context results object for loaders */
  ctxResult?: Record<string, ContextResult<unknown, unknown, unknown>>;
};

/**
 * Result of running server-side loaders
 */
export type ServerLoaderResults = {
  /** Loader results keyed by route name */
  loaderData: Record<string, SerializableResult<unknown, unknown>>;
  /** The matched route chain (parent to child) */
  matches: RouteMatch[];
};

/**
 * Run server-side loaders for SSR
 *
 * Matches the URL against routes, then executes loaders for each
 * matched route in the chain (parent → child).
 *
 * @example
 * ```typescript
 * const { loaderData, matches } = await runServerLoaders({
 *   routes: appRoutes,
 *   url: request.url,
 *   implementations: backend.forRequest(ctx),
 * });
 * ```
 */
export async function runServerLoaders(
  config: RunServerLoadersConfig,
): Promise<ServerLoaderResults> {
  const { routes, url, apiImplementations, ctx, ctxResult = {} } = config;

  // Parse URL to get pathname
  let pathname: string;
  try {
    const parsed = new URL(url, 'http://localhost');
    pathname = parsed.pathname;
  } catch {
    pathname = url;
  }

  // Match URL against routes to get the chain
  const matches = matchPath(pathname, routes);

  // Loader results keyed by route name
  const loaderData: Record<string, SerializableResult<unknown, unknown>> = {};

  // Execute loader for each matched route in order
  for (const match of matches) {
    const result = await executeLoader(
      match.route,
      match.params,
      match.query,
      ctx,
      ctxResult,
      apiImplementations,
    );

    // Store result by route name (only if loader exists)
    if (result !== undefined) {
      loaderData[match.route.name] = result;
    }
  }

  return { loaderData, matches };
}

/**
 * Match a URL path against routes (exported for advanced use cases)
 */
export { matchPath };

// ============================================================================
// Route Renderer
// ============================================================================

type RouteRendererProps = {
  matches: RouteMatch[];
  matchIndex: number;
  loaderDataMap: Map<
    RouteEntryConstraint,
    SerializableResult<unknown, unknown> | undefined
  >;
  implementationsMap: Map<RouteEntryConstraint, Record<string, unknown>>;
  eventStreamsMap: Map<RouteEntryConstraint, Record<string, unknown>>;
  ctx: Record<string, unknown>;
  ctxResult: Record<string, ContextResult<unknown, unknown, unknown>>;
  pendingTransition: 'incoming' | 'outgoing' | false;
  revalidate: () => Promise<void>;
  navigate: NavigateFn;
  checkpoint: CheckpointFn;
  parentCapabilities: RegisteredCapabilities;
};

// ============================================================================
// Saved Static HTML Context
// ============================================================================

/**
 * Context for storing rescued static HTML content.
 * When we clear a portal target that contains nested static elements,
 * we save their innerHTML here so StaticRouteWrapper can retrieve it.
 */
type SavedStaticHtmlMap = Map<string, string>;

const SavedStaticHtmlContext = createContext<SavedStaticHtmlMap>(new Map());

/**
 * Rescues static HTML content from a DOM element before it gets cleared.
 * Finds all elements with data-static-on-client="true" and saves their innerHTML.
 */
function rescueStaticHtml(
  target: HTMLElement,
  savedMap: SavedStaticHtmlMap,
): void {
  const staticElements = target.querySelectorAll(
    '[data-static-on-client="true"]',
  );
  staticElements.forEach((el) => {
    if (el.id && el.innerHTML) {
      savedMap.set(el.id, el.innerHTML);
    }
  });
}

// ============================================================================
// Static Route Wrapper
// ============================================================================

type StaticRouteWrapperProps = {
  id: string;
  children: React.ReactNode;
};

/**
 * Wrapper for static routes that preserves SSR HTML on the client.
 *
 * On server: renders children normally wrapped in a container
 * On client: reads existing HTML from DOM and preserves it
 *
 * This is similar to createStaticOnClient but integrated into the router.
 *
 * Note: We memoize the dangerouslySetInnerHTML object to work around a
 * React 19 regression where createPortal doesn't work with DOM elements
 * created by dangerouslySetInnerHTML if the __html object changes.
 * See: https://github.com/facebook/react/issues/31600
 */
function StaticRouteWrapper({
  id,
  children,
}: StaticRouteWrapperProps): React.ReactNode {
  const isServer = typeof window === 'undefined';
  const savedStaticHtml = useContext(SavedStaticHtmlContext);

  // Capture the HTML once on initial client render, memoize it
  // This must be called unconditionally to satisfy Rules of Hooks
  // First check the saved map (for rescued content), then fall back to DOM
  const memoizedHtml = useMemo(() => {
    if (isServer) {
      return { __html: '' };
    }
    // Check saved map first (for content rescued before portal clearing)
    const savedHtml = savedStaticHtml.get(id);
    if (savedHtml !== undefined) {
      return { __html: savedHtml };
    }
    // Fall back to reading from DOM
    const existingHtml = document.getElementById(id)?.innerHTML ?? '';
    return { __html: existingHtml };
  }, [id, isServer, savedStaticHtml]);

  if (isServer) {
    // Server: render children normally, wrapped in container with ID
    return (
      <div id={id} data-static-on-client="true">
        {children}
      </div>
    );
  }

  // Client: use memoized HTML to prevent React 19 from re-rendering innerHTML
  // which would invalidate any portal containers inside it
  return (
    <div
      id={id}
      data-static-on-client="true"
      suppressHydrationWarning={true}
      dangerouslySetInnerHTML={memoizedHtml}
    />
  );
}

// ============================================================================
// Stable Outlet Component
// ============================================================================

/**
 * Create a stable outlet component that reads from registry context
 * and accepts capabilities via props
 *
 * This component is created once per outlet name and cached.
 * It reads its child element from OutletRegistryContext dynamically,
 * allowing React to handle updates via the normal prop/context flow.
 *
 * For static parents:
 * - On SSR: renders a placeholder div with data-outlet-id attribute
 * - On client: the placeholder is used by PortalRenderer to inject children
 */
function createStableOutletComponent(name: string): OutletComponent {
  const StableOutlet: React.FC<OutletProps> = ({ capabilities = {} }) => {
    const registry = useContext(OutletRegistryContext);
    const staticParent = useContext(StaticParentContext);
    const childElement = registry.childElements.get(name) ?? null;

    // Register capabilities so child routes can access them
    // This updates the ref synchronously during render
    registry.registerCapabilities(name, capabilities as RegisteredCapabilities);

    // Provide capabilities via context for child routes
    const outletValue = useMemo(
      () => ({
        element: childElement,
        capabilities: capabilities as RegisteredCapabilities,
      }),
      [childElement, capabilities],
    );

    // If parent is static, render with placeholder wrapper
    if (staticParent.isStatic) {
      const outletId = generateOutletId(
        staticParent.appId,
        staticParent.routePath,
        name,
      );

      // On SSR: render placeholder div with child inside
      // On client: the static parent preserves this HTML, and
      // PortalRenderer will inject the React child via portal
      return (
        <div data-outlet-id={outletId} id={outletId}>
          <OutletContext.Provider value={outletValue}>
            {childElement}
          </OutletContext.Provider>
        </div>
      );
    }

    // Normal outlet rendering (non-static parent)
    return (
      <OutletContext.Provider value={outletValue}>
        {childElement}
      </OutletContext.Provider>
    );
  };

  StableOutlet.displayName = `Outlet(${name})`;
  return StableOutlet;
}

function RouteRenderer({
  matches,
  matchIndex,
  loaderDataMap,
  implementationsMap,
  eventStreamsMap,
  ctx,
  ctxResult,
  pendingTransition,
  revalidate,
  navigate,
  checkpoint,
  parentCapabilities,
}: RouteRendererProps): React.ReactNode {
  const currentMatch = matches[matchIndex];
  const providerConfig = useRouterProviderConfig();

  // Check if parent route is static (for portal rendering on client)
  const parentMatch = matchIndex > 0 ? matches[matchIndex - 1] : null;
  const isParentStatic = parentMatch
    ? parentMatch.strategyComponent !== undefined &&
      isStaticComponent(parentMatch.strategyComponent)
    : false;

  // Cache for stable outlet components - created once per outlet name
  const outletComponentsRef = useRef<Map<string, OutletComponent>>(new Map());

  // Store registered outlet capabilities for passing to children
  // Updated by outlet components when they render with capabilities props
  const outletCapabilitiesRef = useRef<Map<string, RegisteredCapabilities>>(
    new Map(),
  );

  // Callback for outlet components to register their capabilities
  const registerCapabilities = useCallback(
    (name: string, capabilities: RegisteredCapabilities) => {
      outletCapabilitiesRef.current.set(name, capabilities);
    },
    [],
  );

  // Build the child element (next match in chain)
  // Capabilities are read from the ref which is updated by outlet components
  const mainCapabilities = outletCapabilitiesRef.current.get('main') ?? {};

  const childElement =
    currentMatch && matchIndex < matches.length - 1 ? (
      <RouteRenderer
        matches={matches}
        matchIndex={matchIndex + 1}
        loaderDataMap={loaderDataMap}
        implementationsMap={implementationsMap}
        eventStreamsMap={eventStreamsMap}
        ctx={ctx}
        ctxResult={ctxResult}
        pendingTransition={pendingTransition}
        revalidate={revalidate}
        navigate={navigate}
        checkpoint={checkpoint}
        parentCapabilities={mainCapabilities}
      />
    ) : null;

  // Create outlet registry value for context
  // Child elements are keyed by outlet name
  const registryValue = useMemo<OutletRegistryValue>(
    () => ({
      childElements: new Map([['main', childElement]]),
      registerCapabilities,
    }),
    [childElement, registerCapabilities],
  );

  // Create getOutlet function - returns stable cached outlet components
  // Component identity is preserved across renders
  const getOutlet = useCallback(
    (name = 'main') => {
      // Return cached component if it exists
      let component = outletComponentsRef.current.get(name);
      if (!component) {
        // Create and cache a new stable outlet component
        component = createStableOutletComponent(name);
        outletComponentsRef.current.set(name, component);
      }
      return component;
    },
    [], // Empty deps - getOutlet itself is stable
  );

  // Create capabilities object from parent's registered capabilities
  const capabilities = useMemo(() => {
    if (!currentMatch) return {};

    const requestedCapabilities = currentMatch.route.requestsCapabilities ?? [];
    const result: RegisteredCapabilities = {};

    for (const capDef of requestedCapabilities) {
      const impl = parentCapabilities[capDef.name];
      if (impl) {
        result[capDef.name] = impl;
      }
    }

    return result;
  }, [currentMatch, parentCapabilities]);

  // Create outlet context value with default empty capabilities
  const outletValue = useMemo(
    () => ({
      element: childElement,
      capabilities: {},
    }),
    [childElement],
  );

  // Check if this route is static (uses strategy.static)
  // Must be computed before early return to satisfy hook rules
  const isCurrentRouteStatic = currentMatch
    ? currentMatch.strategyComponent !== undefined &&
      isStaticComponent(currentMatch.strategyComponent)
    : false;

  // Compute outlet ID for portal registration (if parent is static)
  const targetOutletName = currentMatch?.route.path.targetOutlet ?? 'main';
  const portalOutletId =
    isParentStatic && parentMatch
      ? generateOutletId(
          providerConfig.appName,
          parentMatch.route.path.pattern,
          targetOutletName,
        )
      : null;

  // Create static parent context value (must be before early return)
  const staticParentValue = useMemo<StaticParentContextValue>(
    () => ({
      isStatic: isCurrentRouteStatic,
      appId: providerConfig.appName,
      routePath: currentMatch?.route.path.pattern ?? '',
    }),
    [
      isCurrentRouteStatic,
      providerConfig.appName,
      currentMatch?.route.path.pattern,
    ],
  );

  // Early return after all hooks
  if (!currentMatch) return null;

  const { route, component: Component, params, query } = currentMatch;
  const loaderData = loaderDataMap.get(route);
  const apiRoutes = implementationsMap.get(route) ?? {};
  const eventStreams = eventStreamsMap.get(route) ?? {};

  // Compute emptyOutlets - outlets defined by this route that have no child targeting them
  const definedOutlets = Object.keys(route.path.outlets ?? {});
  const childTargetOutlets = new Set(
    matches
      .slice(matchIndex + 1)
      .map((m) => m.route.path.targetOutlet)
      .filter((t): t is string => t !== null),
  );
  const emptyOutlets = definedOutlets.filter(
    (outlet) => !childTargetOutlets.has(outlet),
  );

  // Determine pendingTransition based on skeleton presence
  const hasSkeleton = route.skeleton !== undefined;
  const effectivePendingTransition = hasSkeleton
    ? ((pendingTransition === 'incoming'
        ? false
        : pendingTransition) as PendingTransitionWithSkeleton)
    : (pendingTransition as PendingTransitionWithoutSkeleton);

  // Generate a stable ID for static routes
  // Format: {appName}:static-{pattern}:{serializedParams}
  const staticRouteId = isCurrentRouteStatic
    ? `${providerConfig.appName}:static-${route.path.pattern}:${JSON.stringify(params)}`
    : null;

  // Render the component with props including capabilities and getOutlet
  const componentElement = (
    <Component
      apiRoutes={apiRoutes}
      eventStreams={eventStreams}
      loaderData={loaderData}
      ctx={ctx}
      ctxResult={ctxResult}
      capabilities={capabilities}
      getOutlet={getOutlet}
      params={params}
      query={query}
      navigate={navigate}
      checkpoint={checkpoint}
      pendingTransition={effectivePendingTransition}
      revalidate={revalidate}
      emptyOutlets={emptyOutlets}
    />
  );

  // For static routes: wrap with container and handle SSR/client differently
  const element =
    isCurrentRouteStatic && staticRouteId ? (
      <StaticRouteWrapper id={staticRouteId}>
        {componentElement}
      </StaticRouteWrapper>
    ) : (
      componentElement
    );

  // Wrap with error boundary if defined
  const wrappedElement = route.errorBoundary ? (
    <ErrorBoundaryWrapper
      ErrorBoundary={route.errorBoundary}
      children={element}
    />
  ) : (
    element
  );

  // The complete element with all context providers
  const completeElement = (
    <StaticParentContext.Provider value={staticParentValue}>
      <OutletRegistryContext.Provider value={registryValue}>
        <OutletContext.Provider value={outletValue}>
          {wrappedElement}
        </OutletContext.Provider>
      </OutletRegistryContext.Provider>
    </StaticParentContext.Provider>
  );

  // On client with static parent: render via portal into the placeholder
  // On SSR or non-static parent: render normally in the tree
  const isClient = typeof window !== 'undefined';

  if (isParentStatic && isClient && portalOutletId) {
    // Use portal to render into the static parent's outlet placeholder
    const target = document.getElementById(portalOutletId);
    if (target) {
      return createPortal(completeElement, target);
    }
    // Placeholder not found - this shouldn't happen if SSR worked correctly
    // Fall through to normal rendering
  }

  return completeElement;
}

// ============================================================================
// Error Boundary Wrapper
// ============================================================================

type ErrorBoundaryWrapperProps = {
  ErrorBoundary: ReactComponent<{ error: unknown; reset: () => void }>;
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: unknown | null;
};

class ErrorBoundaryWrapper extends React.Component<
  ErrorBoundaryWrapperProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryWrapperProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { ErrorBoundary, children } = this.props;
    const { error } = this.state;

    if (error !== null) {
      return <ErrorBoundary error={error} reset={this.reset} />;
    }

    return children;
  }
}

// ============================================================================
// Portal Renderer (for dynamic children of static parents)
// ============================================================================

/**
 * PortalRenderer manages portals for dynamic children of static parents.
 *
 * When a parent route is static (uses strategy.static), its outlets render
 * placeholder divs. On the client, the static parent's React tree doesn't run
 * (it uses createStaticOnClient to preserve SSR HTML). The PortalRenderer
 * renders the dynamic children via React portals into those placeholder divs.
 */
function PortalRenderer({
  portals,
}: {
  portals: Map<string, React.ReactNode>;
}): React.ReactNode {
  const [mounted, setMounted] = useState(false);

  // Only render portals on client after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof window === 'undefined') {
    return null;
  }

  const portalElements: React.ReactNode[] = [];

  portals.forEach((element, outletId) => {
    const target = document.getElementById(outletId);
    if (target) {
      portalElements.push(
        <React.Fragment key={outletId}>
          {createPortal(element, target)}
        </React.Fragment>,
      );
    }
  });

  return <>{portalElements}</>;
}

// ============================================================================
// Router Component
// ============================================================================

/**
 * Main Router component
 *
 * Takes only `routes` as prop. All other config comes from RouterProvider
 * (set up by runServerSideRender or hydrate).
 *
 * @example
 * ```tsx
 * // Just pass routes - everything else comes from provider
 * <Router routes={appRoutes} />
 * ```
 */
export function Router({ routes }: RouterConfig): React.ReactNode {
  // Get config from provider
  const config = useRouterProviderConfig();
  const {
    source,
    apiImplementations,
    eventStreamImplementations,
    readContext,
    appName,
    codecRegistry,
    initialLoaderData,
    basePath = '',
    onCheckpoint,
    rootErrorBoundary: RootErrorBoundary,
  } = config;

  // Use source for initial path
  const [currentPath, setCurrentPath] = useState(() => source.getPath());

  // Track if we've used initial loader data (for hydration)
  const hasUsedInitialData = useRef(false);

  const [isPending, startTransition] = useTransition();

  // Initialize matches synchronously (required for SSR - useEffect doesn't run during renderToString)
  const [matches, setMatches] = useState<RouteMatch[]>(() => {
    const path = source.getPath();
    const normalizedPath = basePath
      ? path.replace(new RegExp(`^${basePath}`), '')
      : path;
    return matchPath(normalizedPath, routes);
  });

  // Initialize loader data map from SSR data if available
  const [loaderDataMap, setLoaderDataMap] = useState<
    Map<RouteEntryConstraint, SerializableResult<unknown, unknown> | undefined>
  >(() => {
    if (!initialLoaderData) return new Map();

    // Convert flat loader data (keyed by route name) to per-route map
    const path = source.getPath();
    const normalizedPath = basePath
      ? path.replace(new RegExp(`^${basePath}`), '')
      : path;
    const initialMatches = matchPath(normalizedPath, routes);

    const map = new Map<
      RouteEntryConstraint,
      SerializableResult<unknown, unknown> | undefined
    >();

    for (const match of initialMatches) {
      const loaderResult = initialLoaderData[match.route.name];
      if (loaderResult !== undefined) {
        map.set(
          match.route,
          loaderResult as SerializableResult<unknown, unknown>,
        );
      }
    }

    return map;
  });
  const [pendingTransition, setPendingTransition] = useState<
    'incoming' | 'outgoing' | false
  >(false);

  // Portal targets for dynamic children of static parents
  const [portalTargets, setPortalTargets] = useState<
    Map<string, React.ReactNode>
  >(() => new Map());

  // Saved static HTML content rescued before clearing portal targets
  // This allows nested static components to restore their content
  const [savedStaticHtml] = useState<SavedStaticHtmlMap>(() => new Map());

  // Track if component has mounted (for deferring portal rendering until after hydration)
  const [hasMounted, setHasMounted] = useState(false);

  // Track if portals are enabled (disabled during "unwind" phase before navigation)
  const [portalsEnabled, setPortalsEnabled] = useState(true);

  // Track which portal targets have been cleared (two-phase portal rendering)
  // Phase 1: Identify target, clear in effect
  // Phase 2: Render portal after target is cleared
  const [clearedPortalTargets, setClearedPortalTargets] = useState<Set<string>>(
    () => new Set(),
  );

  const routeTreeRef = useRef<Map<RouteEntryConstraint, RouteEntry[]>>(
    new Map(),
  );

  // Build context + ctxResult by reading all codecs from the registry
  const { context, contextResult } = useMemo(() => {
    const ctx: Record<string, unknown> = {};
    const ctxResult: Record<
      string,
      ContextResult<unknown, unknown, unknown>
    > = {};

    for (const [codecName, entry] of Object.entries(codecRegistry)) {
      const raw = readContext(entry.scope, appName, codecName);

      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        (raw as { type: string }).type === 'Ok' &&
        'value' in raw
      ) {
        const value = (raw as { value: unknown }).value;
        ctx[codecName] = value;
        ctxResult[codecName] = {
          type: 'Ok',
          value,
          decodeWarnings: [],
          warnings: [],
        };
        continue;
      }

      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        (raw as { type: string }).type === 'Err'
      ) {
        const defaultValue = entry.defaultValue;
        ctx[codecName] = defaultValue;
        ctxResult[codecName] = {
          type: 'Ok',
          value: defaultValue,
          decodeWarnings: [{ type: 'ContextNotFound' }],
          warnings: [],
        };
        continue;
      }

      if (raw === undefined) {
        const defaultValue = entry.defaultValue;
        ctx[codecName] = defaultValue;
        ctxResult[codecName] = {
          type: 'Ok',
          value: defaultValue,
          decodeWarnings: [{ type: 'ContextNotFound' }],
          warnings: [],
        };
        continue;
      }

      ctx[codecName] = raw;
      ctxResult[codecName] = {
        type: 'Ok',
        value: raw,
        decodeWarnings: [],
        warnings: [],
      };
    }

    return { context: ctx, contextResult: ctxResult };
  }, [readContext, appName, codecRegistry]);

  // Build route tree on mount
  useEffect(() => {
    routeTreeRef.current = buildRouteTree(routes);
  }, [routes]);

  // Match routes and run loaders
  const runMatchAndLoad = useCallback(
    async (path: string) => {
      const normalizedPath = basePath
        ? path.replace(new RegExp(`^${basePath}`), '')
        : path;

      const newMatches = matchPath(normalizedPath, routes);

      if (newMatches.length === 0) {
        setMatches([]);
        return;
      }

      // Run loader for each matched route
      const newLoaderDataMap = new Map<
        RouteEntryConstraint,
        SerializableResult<unknown, unknown> | undefined
      >();

      for (const match of newMatches) {
        const loaderResult = await executeLoader(
          match.route,
          match.params,
          match.query,
          context,
          contextResult,
          apiImplementations,
        );

        newLoaderDataMap.set(match.route, loaderResult);
      }

      setMatches(newMatches);
      setLoaderDataMap(newLoaderDataMap);
    },
    [routes, basePath, apiImplementations, context, contextResult],
  );

  // Initial load - runs once on mount (client-side only)
  // If we have initial loader data from SSR, we've already initialized state synchronously above.
  // If not, we need to run loaders on the client.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally runs only on mount
  useEffect(() => {
    // Mark initial data as used (whether we had it or not)
    if (initialLoaderData && !hasUsedInitialData.current) {
      hasUsedInitialData.current = true;
      // State was already initialized synchronously, nothing more to do
      return;
    }

    // No initial loader data - need to run loaders on client
    if (!hasUsedInitialData.current) {
      hasUsedInitialData.current = true;
      runMatchAndLoad(currentPath);
    }
  }, []);

  // Track mount state - portals for static children are deferred until after hydration
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Navigation function - uses source for navigation
  const navigate = useCallback<NavigateFn>(
    (path, options = {}) => {
      const fullPath = basePath + path;

      // Check if current route has static parent with portal children
      // If so, we need to "unwind" (disable portals) before navigating
      // to avoid React reconciler errors during unmount
      const currentHasStaticPortals =
        typeof window !== 'undefined' &&
        matches.length > 1 &&
        matches.some((_match, i) => {
          if (i === 0) return false;
          const parentMatch = matches[i - 1];
          return (
            parentMatch?.strategyComponent !== undefined &&
            isStaticComponent(parentMatch.strategyComponent)
          );
        });

      if (currentHasStaticPortals && portalsEnabled) {
        // Phase 1: Disable portals and force React to commit synchronously
        flushSync(() => {
          setPortalsEnabled(false);
        });
        // Phase 2: Re-enable portals and continue with navigation
        // (portals are now unmounted cleanly)
        setPortalsEnabled(true);
      }

      // First, check for static components and server loaders
      // We need to find matching routes without resolving components yet
      const matchingRoutes: typeof routes = [];
      for (const entry of routes) {
        if (entry.appRoute.match(path)) {
          matchingRoutes.push(entry);
        }
      }

      // Check if any matched route has server-only loaders or static components
      const hasServerLoader = matchingRoutes.some(
        (entry) => entry.appRoute.hasServerLoader,
      );
      const hasStaticComponent = matchingRoutes.some((entry) =>
        isStaticComponent(entry.component),
      );

      if (
        (hasServerLoader || hasStaticComponent) &&
        typeof window !== 'undefined'
      ) {
        // Server loaders and static components require full page refresh (only on client)
        if (options.replace) {
          window.location.replace(fullPath);
        } else {
          window.location.href = fullPath;
        }
        return;
      }

      // Collect lazy components that need preloading
      const lazyComponents = matchingRoutes
        .map((entry) => entry.component)
        .filter((c): c is LazyComponentRef => isLazyComponent(c));

      // Helper function to proceed with navigation
      const proceedWithNavigation = () => {
        // Components are preloaded, proceed with transition
        setPendingTransition('outgoing');

        startTransition(() => {
          // Use source for navigation
          source.navigate(fullPath, options);

          setCurrentPath(path);
          setPendingTransition('incoming');

          runMatchAndLoad(path).then(() => {
            setPendingTransition(false);
          });
        });
      };

      // If there are lazy components to preload, do that first
      if (lazyComponents.length > 0) {
        setPendingTransition('outgoing');
        Promise.all(lazyComponents.map(preloadComponent))
          .then(proceedWithNavigation)
          .catch((err) => {
            console.error('Failed to preload lazy components:', err);
            setPendingTransition(false);
          });
      } else {
        // No lazy components to preload, proceed immediately
        proceedWithNavigation();
      }
    },
    [basePath, routes, runMatchAndLoad, source, matches, portalsEnabled],
  );

  // Checkpoint function - serializes current state for sharing
  const checkpoint = useCallback<CheckpointFn>(() => {
    const checkpointState = source.getCheckpointState();
    const virtualStates = checkpointState.key
      ? [{ key: checkpointState.key, path: checkpointState.path }]
      : [];

    const url = buildCheckpointUrl(basePath + source.getPath(), virtualStates);

    // Call custom handler or default to pushState
    if (onCheckpoint) {
      onCheckpoint(url);
    } else if (typeof window !== 'undefined') {
      window.history.pushState(null, '', url);
    }

    return url;
  }, [source, basePath, onCheckpoint]);

  // Subscribe to source changes (popstate, etc.)
  useEffect(() => {
    const handleSourceChange = () => {
      const path = source.getPath();
      const normalizedPath = basePath
        ? path.replace(new RegExp(`^${basePath}`), '')
        : path;

      setPendingTransition('incoming');
      startTransition(() => {
        setCurrentPath(normalizedPath);
        void runMatchAndLoad(normalizedPath).then(() => {
          setPendingTransition(false);
        });
      });
    };

    return source.subscribe(handleSourceChange);
  }, [basePath, runMatchAndLoad, source]);

  // Build implementations map - extract each route's declared API implementations
  const implementationsMap = useMemo(() => {
    const map = new Map<RouteEntryConstraint, Record<string, unknown>>();
    for (const match of matches) {
      const routeImpls: Record<string, unknown> = {};
      // Get the API routes declared by this route
      const declaredRoutes = match.route.apiRoutes ?? {};
      for (const routeName of Object.keys(declaredRoutes)) {
        const impl = apiImplementations[routeName];
        if (impl) {
          routeImpls[routeName] = impl;
        }
      }
      map.set(match.route, routeImpls);
    }
    return map;
  }, [matches, apiImplementations]);

  // Build eventStreams map - extract each route's declared EventStream implementations
  const eventStreamsMap = useMemo(() => {
    const map = new Map<RouteEntryConstraint, Record<string, unknown>>();
    for (const match of matches) {
      const declaredStreams = match.route.eventStreams ?? {};
      const streamImpls: Record<string, unknown> = {};
      for (const streamName of Object.keys(declaredStreams)) {
        const impl = eventStreamImplementations[streamName];
        if (impl) {
          streamImpls[streamName] = impl;
        } else if (
          typeof window !== 'undefined' &&
          process.env.NODE_ENV !== 'production'
        ) {
          console.warn(
            `[Router] Missing event stream implementation for route "${streamName}"`,
          );
        }
      }
      map.set(match.route, streamImpls);
    }
    return map;
  }, [matches, eventStreamImplementations]);

  // Revalidate loaders for current matches
  const revalidate = useCallback(async () => {
    // Simply re-run the match and load logic for current path
    await runMatchAndLoad(currentPath);
  }, [currentPath, runMatchAndLoad]);

  // Router context value
  const routerContextValue = useMemo<RouterContextValue>(
    () => ({
      navigate,
      checkpoint,
      currentPath,
      isPending,
    }),
    [navigate, checkpoint, currentPath, isPending],
  );

  // Portal registry callbacks
  const portalRegistryValue = useMemo<PortalRegistryValue>(
    () => ({
      registerPortal: (outletId: string, element: React.ReactNode) => {
        setPortalTargets((prev) => {
          const next = new Map(prev);
          next.set(outletId, element);
          return next;
        });
      },
      unregisterPortal: (outletId: string) => {
        setPortalTargets((prev) => {
          const next = new Map(prev);
          next.delete(outletId);
          return next;
        });
      },
    }),
    [],
  );

  // Render content
  let content: React.ReactNode = null;

  if (matches.length > 0) {
    content = (
      <RouteRenderer
        matches={matches}
        matchIndex={0}
        loaderDataMap={loaderDataMap}
        implementationsMap={implementationsMap}
        eventStreamsMap={eventStreamsMap}
        ctx={context}
        ctxResult={contextResult}
        pendingTransition={pendingTransition}
        revalidate={revalidate}
        navigate={navigate}
        checkpoint={checkpoint}
        parentCapabilities={{}}
      />
    );
  }

  // Wrap with root error boundary if provided
  if (RootErrorBoundary) {
    content = (
      <ErrorBoundaryWrapper ErrorBoundary={RootErrorBoundary}>
        {content}
      </ErrorBoundaryWrapper>
    );
  }

  // On client AFTER MOUNT: identify routes whose parent is static and render them as portals
  // These routes won't render through the normal tree because static parents
  // use dangerouslySetInnerHTML which prevents React children from executing
  // We defer this until after mount to avoid hydration mismatch (SSR renders children
  // in the tree, but client renders them via portal)
  //
  // TWO-PHASE PORTAL RENDERING:
  // Phase 1: Identify targets that need clearing (don't render portal yet)
  // Phase 2: After effect clears target, render portal into clean container
  const isClient = typeof window !== 'undefined';
  const staticChildPortals: React.ReactNode[] = [];
  const targetsToClear: Array<{ id: string; target: HTMLElement }> = [];

  if (isClient && hasMounted && portalsEnabled && matches.length > 1) {
    for (let i = 1; i < matches.length; i++) {
      const parentMatch = matches[i - 1];
      const childMatch = matches[i];

      // Skip if matches are undefined (shouldn't happen but TypeScript)
      if (!parentMatch || !childMatch) continue;

      const parentIsStatic =
        parentMatch.strategyComponent !== undefined &&
        isStaticComponent(parentMatch.strategyComponent);

      if (parentIsStatic) {
        // This route's parent is static - render it directly and portal
        const targetOutletName = childMatch.route.path.targetOutlet ?? 'main';
        const portalOutletId = generateOutletId(
          appName,
          parentMatch.route.path.pattern,
          targetOutletName,
        );

        const target = document.getElementById(portalOutletId);
        if (target) {
          // Check if this target has been cleared yet
          if (clearedPortalTargets.has(portalOutletId)) {
            // Phase 2: Target is cleared, safe to render portal
            const portalContent = (
              <SavedStaticHtmlContext.Provider value={savedStaticHtml}>
                <RouteRenderer
                  matches={matches}
                  matchIndex={i}
                  loaderDataMap={loaderDataMap}
                  implementationsMap={implementationsMap}
                  eventStreamsMap={eventStreamsMap}
                  ctx={context}
                  ctxResult={contextResult}
                  pendingTransition={pendingTransition}
                  revalidate={revalidate}
                  navigate={navigate}
                  checkpoint={checkpoint}
                  parentCapabilities={{}}
                />
              </SavedStaticHtmlContext.Provider>
            );
            staticChildPortals.push(
              <React.Fragment key={portalOutletId}>
                {createPortal(portalContent, target)}
              </React.Fragment>,
            );
          } else {
            // Phase 1: Target needs clearing, mark for effect
            targetsToClear.push({ id: portalOutletId, target });
          }
        }
      }
    }
  }

  // Store targets to clear in a ref so effect can access them
  const targetsToClearRef = useRef(targetsToClear);
  targetsToClearRef.current = targetsToClear;

  // Effect: Clear targets and mark them as cleared (triggers re-render for Phase 2)
  // biome-ignore lint/correctness/useExhaustiveDependencies: We use refs to access current values
  useEffect(() => {
    const targets = targetsToClearRef.current;
    if (targets.length === 0) return;

    setClearedPortalTargets((prev) => {
      const newCleared = new Set(prev);
      for (const { id, target } of targets) {
        // Rescue any nested static content before clearing
        rescueStaticHtml(target, savedStaticHtml);
        // Clear the SSR content
        target.replaceChildren();
        newCleared.add(id);
      }
      return newCleared;
    });
  }, [targetsToClear.length, savedStaticHtml]);

  return (
    <RouterContext.Provider value={routerContextValue}>
      <PortalRegistryContext.Provider value={portalRegistryValue}>
        {content}
        {/* Render children of static parents via portal */}
        {staticChildPortals}
        {/* Render portals for dynamic children of static parents */}
        <PortalRenderer portals={portalTargets} />
      </PortalRegistryContext.Provider>
    </RouterContext.Provider>
  );
}

// ============================================================================
// Redirect Component
// ============================================================================

export type RedirectProps = {
  /** Path to redirect to */
  to: string;
  /** If true, replaces current history entry instead of pushing */
  replace?: boolean;
};

/**
 * Redirect component - triggers a client-side redirect when rendered
 *
 * Use this in components to redirect based on conditions (e.g., auth checks).
 * The redirect happens in useEffect after the initial render.
 *
 * @example
 * ```typescript
 * const ProfilePage: FC<ProfilePageProps> = ({ context }) => {
 *   // Redirect to login if not authenticated
 *   if (!context.session) {
 *     return <Redirect to="/login" />;
 *   }
 *
 *   return <div>Welcome, {context.session.username}!</div>;
 * };
 * ```
 */
export function Redirect({
  to,
  replace = false,
}: RedirectProps): React.ReactNode {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);

  // Render nothing while redirecting
  return null;
}

// ============================================================================
// Link Component
// ============================================================================

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  replace?: boolean;
};

/**
 * Link component for client-side navigation
 */
export function Link(linkProps: LinkProps): React.ReactNode {
  const { to, replace = false, children, ...rest } = linkProps;
  const navigate = useNavigate();
  const mountPath = useMountPath();

  // Resolve mount-relative paths for the href attribute so right-click,
  // middle-click, and "Copy link address" produce the full browser URL.
  const resolvedHref =
    mountPath && to.startsWith('/') && !to.startsWith(mountPath)
      ? mountPath + to
      : to;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Let browser handle if modifier key pressed
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        rest.onClick?.(e);
        return;
      }

      // Prevent default and use client-side navigation
      e.preventDefault();
      rest.onClick?.(e);
      navigate(to, { replace });
    },
    [navigate, to, replace, rest.onClick],
  );

  const anchorProps: React.AnchorHTMLAttributes<HTMLAnchorElement> = {
    ...rest,
    href: resolvedHref,
    onClick: handleClick,
  };

  return <a {...anchorProps}>{children}</a>;
}
