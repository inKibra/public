/**
 * App Route Definition
 *
 * Application routes with typed path params, declared API/EventStream dependencies,
 * and loader configuration.
 */

import type React from 'react';
import type { IValidation } from 'typia/lib';
import type {
  AnyApiRoute,
  ApiRoute,
  HandlerObject,
  RouteContextCodecMap,
  RouteContextResultType,
  RouteContextType,
  RouteNamedTypes,
} from './api-route';
import type { ApiRouteHandler } from './api-route-handler';
import type {
  CapabilityDefinition,
  CapabilityDefinitionMap,
  CapabilityImplementationMap,
  RequestedCapabilitiesMap,
} from './capability';
import type {
  ContextCodecDataType,
  ContextCodecMap,
  ContextCodecMapDataTypes,
  ContextCodecMapResultTypes,
} from './context-codec';
import type {
  AnyEventStreamRoute,
  EventStreamRoute,
  EventStreamRouteNamedTypes,
} from './event-stream-route';
import type { SerializableResult } from './result';
import type { RouteComponent } from './strategy';
import type { EventStreamHandler } from './use-event-stream-hooks';

// ============================================================================
// App Path - URL Pattern with Typed Params (using URLPattern API)
// ============================================================================

/**
 * Virtual outlet configuration for a path
 */
export type VirtualOutletConfig<
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
> = {
  /** Capabilities provided by this virtual outlet */
  capabilities?: TCapabilities;
};

/**
 * Map of virtual outlet configurations
 */
export type VirtualOutletMap = Record<string, VirtualOutletConfig>;

/**
 * App path configuration options
 */
export type AppPathConfig<
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TVirtualOutlets extends VirtualOutletMap = VirtualOutletMap,
> = {
  /** Capabilities provided by the main outlet */
  capabilities?: TCapabilities;
  /** Named virtual outlets with their own capabilities */
  virtualOutlets?: TVirtualOutlets;
};

/**
 * App path configuration - represents a URL pattern with typed params
 *
 * Uses the browser-native URLPattern API for matching:
 * https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API
 */
export type AppPath<
  TParams extends Record<string, unknown>,
  TQuery extends Record<string, string | undefined> = Record<string, never>,
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TVirtualOutlets extends VirtualOutletMap = VirtualOutletMap,
> = {
  /** The raw path pattern (e.g., '/profile/:id') */
  readonly pattern: string;
  /** The underlying URLPattern instance */
  readonly urlPattern: URLPattern;
  /** Parent path (if created via createChild) */
  readonly parent: AnyAppPath | undefined;
  /** Capabilities provided by the main outlet */
  readonly capabilities: TCapabilities;
  /** Named virtual outlets with their own capabilities */
  readonly virtualOutlets: TVirtualOutlets;
  /** Create a child path that extends this path */
  createChild: <
    TChildParams extends Record<string, unknown>,
    TChildQuery extends Record<string, string | undefined> = Record<
      string,
      never
    >,
  >(
    childPattern: string,
    config?: AppPathConfig,
  ) => AppPath<TParams & TChildParams, TQuery & TChildQuery>;
  /** Create a child path for a virtual outlet */
  virtualOutletChild: <
    TOutletName extends keyof TVirtualOutlets,
    TChildParams extends Record<string, unknown>,
    TChildQuery extends Record<string, string | undefined> = Record<
      string,
      never
    >,
  >(
    outletName: TOutletName,
    childPattern: string,
    config?: AppPathConfig,
  ) => AppPath<TParams & TChildParams, TQuery & TChildQuery>;
  /** Create a link URL with params and optional query */
  makeLink: (params: TParams, query?: Partial<TQuery>) => string;
  /** Check if a path matches this pattern and extract params */
  match: (path: string) => { params: TParams; query: Partial<TQuery> } | null;
  /** Extract just the path params from a URL */
  extractParams: (path: string) => TParams | null;
  /** Extract query params from a URL */
  extractQuery: (path: string) => Partial<TQuery>;
  /** Type markers for extraction */
  readonly _params: TParams;
  readonly _query: TQuery;
  readonly _capabilities: TCapabilities;
  readonly _virtualOutlets: TVirtualOutlets;
};

/**
 * Create an app path with typed params and query
 *
 * Uses the native URLPattern API for pattern matching, which provides:
 * - Standard path-to-regexp-like syntax (:param, *, etc.)
 * - Named groups via :param syntax
 * - Optional segments with ?
 * - Native browser/Bun implementation (faster than regex)
 *
 * @example
 * ```typescript
 * const profilePath = createAppPath<{ id: string }>('/profile/:id');
 * const searchPath = createAppPath<
 *   { category: string },
 *   { q?: string; sort?: 'asc' | 'desc' }
 * >('/search/:category');
 *
 * profilePath.makeLink({ id: 'abc123' }); // '/profile/abc123'
 * searchPath.makeLink({ category: 'music' }, { q: 'test' }); // '/search/music?q=test'
 *
 * profilePath.match('/profile/abc123'); // { params: { id: 'abc123' }, query: {} }
 * ```
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API
 */
/**
 * Internal function to create an app path with optional parent and config
 */
function createAppPathInternal<
  TParams extends Record<string, unknown>,
  TQuery extends Record<string, string | undefined> = Record<string, never>,
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TVirtualOutlets extends VirtualOutletMap = VirtualOutletMap,
>(
  pattern: string,
  parent: AnyAppPath | undefined,
  config?: AppPathConfig<TCapabilities, TVirtualOutlets>,
): AppPath<TParams, TQuery, TCapabilities, TVirtualOutlets> {
  // Create URLPattern for matching
  // We use pathname-only matching since we handle query separately
  const urlPattern = new URLPattern({ pathname: pattern });

  const capabilities = (config?.capabilities ?? {}) as TCapabilities;
  const virtualOutlets = (config?.virtualOutlets ?? {}) as TVirtualOutlets;

  const appPath: AppPath<TParams, TQuery, TCapabilities, TVirtualOutlets> = {
    pattern,
    urlPattern,
    parent,
    capabilities,
    virtualOutlets,

    createChild: <
      TChildParams extends Record<string, unknown>,
      TChildQuery extends Record<string, string | undefined> = Record<
        string,
        never
      >,
    >(
      childPattern: string,
      childConfig?: AppPathConfig,
    ): AppPath<TParams & TChildParams, TQuery & TChildQuery> => {
      // Combine parent pattern with child pattern
      // Remove trailing slash from parent, add child
      const parentPattern = pattern.endsWith('/')
        ? pattern.slice(0, -1)
        : pattern;
      const normalizedChild = childPattern.startsWith('/')
        ? childPattern
        : `/${childPattern}`;
      const combinedPattern = `${parentPattern}${normalizedChild}`;

      return createAppPathInternal<
        TParams & TChildParams,
        TQuery & TChildQuery
      >(combinedPattern, appPath as AnyAppPath, childConfig);
    },

    virtualOutletChild: <
      TOutletName extends keyof TVirtualOutlets,
      TChildParams extends Record<string, unknown>,
      TChildQuery extends Record<string, string | undefined> = Record<
        string,
        never
      >,
    >(
      _outletName: TOutletName,
      childPattern: string,
      childConfig?: AppPathConfig,
    ): AppPath<TParams & TChildParams, TQuery & TChildQuery> => {
      // Virtual outlet children use the outlet name as a key prefix
      // The Router will handle routing these to the correct virtual source
      return createAppPathInternal<
        TParams & TChildParams,
        TQuery & TChildQuery
      >(childPattern, appPath as AnyAppPath, childConfig);
    },

    makeLink: (params: TParams, query?: Partial<TQuery>): string => {
      let url = pattern;

      // Replace path params (URLPattern doesn't have a built-in way to construct URLs)
      for (const [key, value] of Object.entries(params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }

      // Add query string
      if (query) {
        const queryEntries = Object.entries(query).filter(
          ([_, v]) => v !== undefined && v !== null && v !== '',
        );
        if (queryEntries.length > 0) {
          const queryString = new URLSearchParams(
            queryEntries as [string, string][],
          ).toString();
          url += `?${queryString}`;
        }
      }

      return url;
    },

    match: (inputPath: string) => {
      const [pathPart, queryPart] = inputPath.split('?');

      // Normalize trailing slash (except for root)
      const normalizedPath =
        pathPart && pathPart.length > 1 && pathPart.endsWith('/')
          ? pathPart.slice(0, -1)
          : pathPart;

      // Use URLPattern.exec for matching
      const result = urlPattern.exec({ pathname: normalizedPath ?? '' });
      if (!result) return null;

      // Extract named groups from pathname
      const params = (result.pathname.groups ?? {}) as TParams;

      // Parse query string separately
      const query = queryPart
        ? (Object.fromEntries(
            new URLSearchParams(queryPart),
          ) as Partial<TQuery>)
        : ({} as Partial<TQuery>);

      return { params, query };
    },

    extractParams: (inputPath: string) => {
      const [pathPart] = inputPath.split('?');

      // Normalize trailing slash
      const normalizedPath =
        pathPart && pathPart.length > 1 && pathPart.endsWith('/')
          ? pathPart.slice(0, -1)
          : pathPart;

      const result = urlPattern.exec({ pathname: normalizedPath ?? '' });
      if (!result) return null;

      return (result.pathname.groups ?? {}) as TParams;
    },

    extractQuery: (inputPath: string) => {
      const [, queryPart] = inputPath.split('?');
      if (!queryPart) return {} as Partial<TQuery>;
      return Object.fromEntries(
        new URLSearchParams(queryPart),
      ) as Partial<TQuery>;
    },

    _params: undefined as unknown as TParams,
    _query: undefined as unknown as TQuery,
    _capabilities: undefined as unknown as TCapabilities,
    _virtualOutlets: undefined as unknown as TVirtualOutlets,
  };

  return appPath;
}

/**
 * Create an app path with typed params, query, capabilities, and virtual outlets
 *
 * @example
 * ```typescript
 * const dashboardPath = createAppPath<{ id: string }>('/dashboard/:id', {
 *   capabilities: {
 *     getCurrentUser,
 *     showConfirmDialog,
 *   },
 *   virtualOutlets: {
 *     sidebar: { capabilities: { closeSidebar } },
 *     modal: { capabilities: { showConfirmDialog } },
 *   },
 * });
 * ```
 */
export function createAppPath<
  TParams extends Record<string, unknown>,
  TQuery extends Record<string, string | undefined> = Record<string, never>,
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TVirtualOutlets extends VirtualOutletMap = VirtualOutletMap,
>(
  pattern: string,
  config?: AppPathConfig<TCapabilities, TVirtualOutlets>,
): AppPath<TParams, TQuery, TCapabilities, TVirtualOutlets> {
  return createAppPathInternal<TParams, TQuery, TCapabilities, TVirtualOutlets>(
    pattern,
    undefined,
    config,
  );
}

// ============================================================================
// Path Tree System (New)
// ============================================================================

/**
 * Validator function type (matches Typia's createValidate output)
 */
type PathValidator<T> = (input: unknown) => IValidation<T>;

/**
 * Path params schema - validates the single param for a param segment
 *
 * @example
 * ```typescript
 * // In schemas.ts
 * export const validateBoardId = typia.createValidate<string>();
 *
 * // When defining segment
 * const boardDetail = boards.addSegment(':id', {
 *   schema: definePathParamsSchema({
 *     param: validateBoardId,
 *   })
 * });
 * ```
 */
export type PathParamsSchema<TParam> = {
  /** Validator for the param value */
  readonly param: PathValidator<TParam>;
};

/**
 * Define a path params schema with typed validator.
 *
 * Since segments are single pieces (e.g., ':id'), there's only one param per segment.
 *
 * @example
 * ```typescript
 * const boardIdSchema = definePathParamsSchema({
 *   param: typia.createValidate<string>(), // or UUID, etc.
 * });
 *
 * const boardDetail = boards.addSegment(':id', {
 *   schema: boardIdSchema,
 * });
 * ```
 */
export function definePathParamsSchema<TParam>(
  schema: PathParamsSchema<TParam>,
): PathParamsSchema<TParam>;

/**
 * Marker overload for type macro expansion.
 *
 * Usage:
 *   definePathParamsSchema<MyParamType>()
 */
export function definePathParamsSchema<TParam>(): PathParamsSchema<TParam>;

export function definePathParamsSchema<TParam>(
  schema?: PathParamsSchema<TParam>,
): PathParamsSchema<TParam> {
  if (!schema) {
    throw new Error(
      'definePathParamsSchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
    );
  }

  return schema;
}

// ============================================================================
// Path Tree Node Types
// ============================================================================

/**
 * Extract param name from a segment string
 * ':id' -> 'id', 'boards' -> never
 */
type ExtractParamName<T extends string> = T extends `:${infer Name}`
  ? Name
  : never;

/**
 * Check if a segment is a param segment
 */
type IsParamSegment<T extends string> = T extends `:${string}` ? true : false;

/**
 * Configuration for a named outlet
 */
export type OutletConfig<
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
> = {
  /** Capabilities available to routes in this outlet */
  capabilities?: TCapabilities;
};

/**
 * Map of outlet names to their configurations
 */
export type OutletDefinitionMap = Record<
  string,
  OutletConfig<CapabilityDefinitionMap>
>;

/**
 * Extract capabilities from an outlet config
 */
type OutletCapabilities<T extends OutletConfig<CapabilityDefinitionMap>> =
  T extends { capabilities: infer C extends CapabilityDefinitionMap }
    ? C
    : Record<string, never>;

/**
 * Configuration for adding a segment
 */
export type SegmentConfig<TParam> = {
  /** Schema for validating the param (if this is a param segment) */
  schema?: PathParamsSchema<TParam>;
  /** Capabilities provided at this level */
  capabilities?: CapabilityDefinitionMap;
  /** Named outlets available at this segment */
  outlets?: OutletDefinitionMap;
};

/**
 * Path tree node - represents a node in the path hierarchy
 *
 * @template TParams - Accumulated path params from root to this node
 * @template TCapabilities - Accumulated capabilities from root to this node
 * @template TOutlets - Named outlets defined at this node
 * @template TTargetOutlet - Which outlet this node's routes render into (null = main/replacement)
 */
export type PathTreeNode<
  TParams extends Record<string, unknown> = Record<string, never>,
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TOutlets extends OutletDefinitionMap = Record<string, never>,
  TTargetOutlet extends string | null = null,
> = {
  /** Brand for type checking */
  readonly __brand: 'PathTreeNode';
  /** The full path pattern from root */
  readonly pattern: string;
  /** The underlying URLPattern instance */
  readonly urlPattern: URLPattern;
  /** Parent node (if created via addSegment) */
  readonly parent: AnyPathTreeNode | undefined;
  /** Accumulated capabilities available to this node and children */
  readonly capabilities: TCapabilities;
  /** Named outlets defined at this node */
  readonly outlets: TOutlets;
  /** Which outlet routes on this node target (null = main/replacement) */
  readonly targetOutlet: TTargetOutlet;
  /** Type marker for params */
  readonly _params: TParams;
  /** Type marker for capabilities */
  readonly _capabilities: TCapabilities;

  /**
   * Add a child segment to this node
   *
   * Routes created from addSegment paths will either:
   * - If this node has targetOutlet=null: Replace parent (navigate away)
   * - If this node has targetOutlet set: Continue in the same outlet
   *
   * @param segment - The segment string (e.g., 'boards', ':id')
   * @param config - Optional segment configuration with schema, capabilities, and outlets
   * @returns A new node with updated params and capabilities
   */
  addSegment: {
    // Overload without config - preserves parent capabilities exactly
    <TSegment extends string>(
      segment: TSegment,
    ): PathTreeNode<
      IsParamSegment<TSegment> extends true
        ? TParams & { [K in ExtractParamName<TSegment>]: string }
        : TParams,
      TCapabilities,
      Record<string, never>,
      TTargetOutlet
    >;
    // Overload with outlets only (no capabilities) - preserves capabilities, defines outlets
    <TSegment extends string, TNewOutlets extends OutletDefinitionMap>(
      segment: TSegment,
      config: { outlets: TNewOutlets },
    ): PathTreeNode<
      IsParamSegment<TSegment> extends true
        ? TParams & { [K in ExtractParamName<TSegment>]: string }
        : TParams,
      TCapabilities,
      TNewOutlets,
      TTargetOutlet
    >;
    // Overload with full config - merges capabilities, can define outlets
    <
      TSegment extends string,
      TParamType,
      TNewCaps extends CapabilityDefinitionMap,
      TNewOutlets extends OutletDefinitionMap,
    >(
      segment: TSegment,
      config: SegmentConfig<TParamType> & {
        capabilities: TNewCaps;
        outlets?: TNewOutlets;
      },
    ): PathTreeNode<
      IsParamSegment<TSegment> extends true
        ? TParams & { [K in ExtractParamName<TSegment>]: TParamType }
        : TParams,
      TCapabilities & TNewCaps,
      TNewOutlets,
      TTargetOutlet
    >;
  };

  /**
   * Enter an outlet context. Routes created from this path will render
   * INSIDE the parent component's named outlet.
   *
   * @param name - The outlet name (must be defined in this node's outlets)
   * @returns A new node scoped to render in that outlet
   *
   * @example
   * ```typescript
   * const dashboard = tree.addSegment('dashboard', {
   *   outlets: { sidebar: { capabilities: { closeSidebar } } }
   * });
   *
   * // Routes on sidebarPath render in dashboard's sidebar outlet
   * const sidebarPath = dashboard.outlet('sidebar');
   * const playlist = sidebarPath.addSegment('playlist');
   * ```
   */
  outlet: <K extends keyof TOutlets & string>(
    name: K,
  ) => PathTreeNode<
    TParams,
    TCapabilities & OutletCapabilities<TOutlets[K]>,
    Record<string, never>,
    K
  >;

  /**
   * Create a link URL with params
   *
   * @param params - The path params to fill in
   * @param query - Optional query params
   * @returns The constructed URL string
   */
  makeLink: (
    params: TParams,
    query?: Record<string, string | undefined>,
  ) => string;

  /**
   * Check if a path matches this pattern and extract params
   *
   * @param path - The URL path to match
   * @returns Params and query if matched, null otherwise
   */
  match: (path: string) => {
    params: TParams;
    query: Record<string, string | undefined>;
  } | null;
};

/**
 * Configuration for creating a path tree
 */
export type PathTreeConfig<
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TOutlets extends OutletDefinitionMap = Record<string, never>,
> = {
  /** Root-level capabilities available to all descendants */
  capabilities?: TCapabilities;
  /** Root-level outlets */
  outlets?: TOutlets;
};

/**
 * Create a path tree starting from root.
 *
 * The tree always starts at '/' - use mountPath in createApp for deployment prefix.
 *
 * @example
 * ```typescript
 * const tree = createPathTree({
 *   capabilities: {
 *     showToast: showToastCapability,
 *   },
 *   outlets: {
 *     sidebar: { capabilities: { closeSidebar } },
 *     modal: {},
 *   }
 * });
 *
 * const login = tree.addSegment('login');
 * const boards = tree.addSegment('boards');
 * const boardDetail = boards.addSegment(':id', {
 *   schema: definePathParamsSchema({
 *     param: validateBoardId,
 *   })
 * });
 *
 * // Routes in sidebar outlet
 * const sidebarPath = tree.outlet('sidebar');
 * const playlist = sidebarPath.addSegment('playlist');
 * ```
 */
export function createPathTree<
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TOutlets extends OutletDefinitionMap = Record<string, never>,
>(
  config?: PathTreeConfig<TCapabilities, TOutlets>,
): PathTreeNode<Record<string, never>, TCapabilities, TOutlets, null> {
  const capabilities = (config?.capabilities ?? {}) as TCapabilities;
  const outlets = (config?.outlets ?? {}) as TOutlets;

  return createPathTreeNode('', undefined, capabilities, outlets, null);
}

/**
 * Internal helper to create a path tree node
 */
function createPathTreeNode<
  TParams extends Record<string, unknown>,
  TCapabilities extends CapabilityDefinitionMap,
  TOutlets extends OutletDefinitionMap,
  TTargetOutlet extends string | null,
>(
  pattern: string,
  parent: AnyPathTreeNode | undefined,
  capabilities: TCapabilities,
  outlets: TOutlets,
  targetOutlet: TTargetOutlet,
): PathTreeNode<TParams, TCapabilities, TOutlets, TTargetOutlet> {
  // Create URLPattern for matching
  // Use root pattern '/' for empty pattern, otherwise use the pattern
  const urlPattern = new URLPattern({ pathname: pattern || '/' });

  const node: PathTreeNode<TParams, TCapabilities, TOutlets, TTargetOutlet> = {
    __brand: 'PathTreeNode',
    pattern: pattern || '/',
    urlPattern,
    parent,
    capabilities,
    outlets,
    targetOutlet,
    _params: undefined as unknown as TParams,
    _capabilities: undefined as unknown as TCapabilities,

    // Implementation handles both overloads
    addSegment: ((
      segment: string,
      config?: SegmentConfig<unknown> & {
        capabilities?: CapabilityDefinitionMap;
        outlets?: OutletDefinitionMap;
      },
    ) => {
      // Build new path pattern
      const newPattern = pattern ? `${pattern}/${segment}` : `/${segment}`;

      // Merge capabilities (or preserve parent if no new ones)
      const newCapabilities = config?.capabilities
        ? { ...capabilities, ...config.capabilities }
        : capabilities;

      // Get outlets for new segment (defaults to empty)
      const newOutlets = config?.outlets ?? {};

      // Create child node - preserves targetOutlet context, sets parent to current node
      return createPathTreeNode(
        newPattern,
        node, // Current node becomes parent
        newCapabilities,
        newOutlets,
        targetOutlet,
      );
      // biome-ignore lint/suspicious/noExplicitAny: Implementation covers both overloads
    }) as any,

    // Enter an outlet context
    outlet: ((name: string) => {
      // Get outlet config
      const outletConfig = outlets[name] ?? {};

      // Merge outlet's capabilities with current capabilities
      const outletCapabilities = outletConfig.capabilities ?? {};
      const mergedCapabilities = { ...capabilities, ...outletCapabilities };

      // Create node scoped to this outlet
      // Pattern stays the same (we're not adding a segment)
      // Outlets reset (can't nest outlets directly)
      // Target outlet is now set
      // Parent is THIS node (the one defining outlets) - so router can find it
      return createPathTreeNode(
        pattern,
        node, // Current node becomes parent (was: parent)
        mergedCapabilities,
        {}, // Reset outlets
        name, // Set target outlet
      );
      // biome-ignore lint/suspicious/noExplicitAny: Implementation type is more specific
    }) as any,

    makeLink: (
      params: TParams,
      query?: Record<string, string | undefined>,
    ): string => {
      let url = pattern || '/';

      // Replace path params
      for (const [key, value] of Object.entries(params)) {
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }

      // Add query string
      if (query) {
        const queryEntries = Object.entries(query).filter(
          ([_, v]) => v !== undefined && v !== null && v !== '',
        );
        if (queryEntries.length > 0) {
          const queryString = new URLSearchParams(
            queryEntries as [string, string][],
          ).toString();
          url += `?${queryString}`;
        }
      }

      return url;
    },

    match: (inputPath: string) => {
      const [pathPart, queryPart] = inputPath.split('?');

      // Normalize trailing slash (except for root)
      const normalizedPath =
        pathPart && pathPart.length > 1 && pathPart.endsWith('/')
          ? pathPart.slice(0, -1)
          : pathPart;

      // Use URLPattern.exec for matching
      const result = urlPattern.exec({ pathname: normalizedPath ?? '' });
      if (!result) return null;

      // Extract named groups from pathname
      const params = (result.pathname.groups ?? {}) as TParams;

      // Parse query string separately
      const query = queryPart
        ? (Object.fromEntries(new URLSearchParams(queryPart)) as Record<
            string,
            string | undefined
          >)
        : ({} as Record<string, string | undefined>);

      return { params, query };
    },
  };

  return node;
}

/**
 * Any path tree node type - use for generic constraints
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for base type constraint
export type AnyPathTreeNode = PathTreeNode<any, any, any, any>;

/**
 * Extract params type from a PathTreeNode
 */
export type PathTreeParams<T> = T extends PathTreeNode<
  infer P,
  infer _C,
  infer _O,
  infer _T
>
  ? P
  : never;

/**
 * Extract capabilities type from a PathTreeNode
 */
export type PathTreeCapabilities<T> = T extends PathTreeNode<
  infer _P,
  infer C,
  infer _O,
  infer _T
>
  ? C
  : CapabilityDefinitionMap;

/**
 * Extract outlets type from a PathTreeNode
 */
export type PathTreeOutlets<T> = T extends PathTreeNode<
  infer _P,
  infer _C,
  infer O,
  infer _T
>
  ? O
  : Record<string, never>;

/**
 * Extract target outlet from a PathTreeNode
 */
export type PathTreeTargetOutlet<T> = T extends PathTreeNode<
  infer _P,
  infer _C,
  infer _O,
  infer TO
>
  ? TO
  : null;

// ============================================================================
// Route Map Types with Name Constraints
// ============================================================================

/**
 * Compile-time assertion that validates route map keys match route names.
 *
 * - Returns `unknown` when valid (so it doesn't affect the original type)
 * - Returns `never` when invalid, causing the containing type to error
 *
 * @example
 * ```typescript
 * // ✅ Valid - key 'login' matches loginRoute.name
 * apiRoutes: { login: loginRoute }
 *
 * // ❌ Invalid - key 'wrongName' doesn't match loginRoute.name 'login'
 * apiRoutes: { wrongName: loginRoute }
 * ```
 */
type AssertRouteNamesMatch<T extends Record<string, { name: string }>> =
  string extends keyof T
    ? unknown
    : T extends { [K in keyof T]: { name: K } }
      ? unknown
      : never;

/**
 * API route map - object with route.name as keys
 */
export type ApiRouteMap = Record<string, AnyApiRoute>;

/**
 * EventStream route map - object with route.name as keys
 */
export type EventStreamRouteMap = Record<string, AnyEventStreamRoute>;

// ============================================================================
// Simplified Loader System
// ============================================================================

/**
 * Convert API route map to callable implementations type
 * Each route becomes a function that takes ctx (unwrapped data) and args
 *
 * The ctx parameter expects unwrapped data, not Results - this enforces
 * that errors were handled before calling the API.
 *
 * @template TApiRoutes - The API routes map
 */
/**
 * API route implementations map - provides ApiRouteHandler objects to loaders
 *
 * Loaders receive full ApiRouteHandler objects with:
 * - route: The route definition (for metadata access)
 * - execute: (args, ctx) => Promise<Result> - the handler function
 *
 * @example
 * ```typescript
 * // In a loader:
 * const result = await api.listBoards.execute(
 *   { pathParams: {}, pathQuery: {}, body: {} },
 *   { session: ctx.session.value }
 * );
 * ```
 */
export type ApiRouteImplementations<TApiRoutes extends ApiRouteMap> = {
  [K in keyof TApiRoutes]: TApiRoutes[K] extends AnyApiRoute
    ? ApiRouteHandler<
        TApiRoutes[K],
        RouteContextType<TApiRoutes[K]>,
        RouteContextResultType<TApiRoutes[K]>
      >
    : never;
};

// ============================================================================
// Simplified Loader System
// ============================================================================

/**
 * Extract context data types from a context codec map
 *
 * Context is always validated before reaching page components.
 * Invalid contexts are replaced with defaultValue.
 * So the type is just the data type, not Result.
 */
export type RouteContextFromCodecs<TContextCodec extends ContextCodecMap> = {
  [K in keyof TContextCodec]: ContextCodecDataType<TContextCodec[K]>;
};

/**
 * Extract context result types from a context codec map.
 */
export type RouteContextResultFromCodecs<
  TContextCodec extends ContextCodecMap,
> = {
  [K in keyof TContextCodec]: ContextCodecMapResultTypes<TContextCodec>[K];
};

/**
 * Utility type to convert a union to an intersection
 * { a: 1 } | { b: 2 } → { a: 1 } & { b: 2 }
 */
export type UnionToIntersection<U> = (
  U extends unknown
    ? (k: U) => void
    : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Filter out undefined/never from a union
 */
export type FilterUndefined<T> = T extends undefined ? never : T;

/**
 * Extract all context codec maps from an ApiRouteMap and merge them
 * This gives us the inherited contexts from all API routes
 *
 * Each API route has a contextCodec like { session: SessionCodec }
 * We extract these and merge them together
 */
export type InheritedContextCodecsFromApiRoutes<
  TApiRoutes extends ApiRouteMap,
> = UnionToIntersection<
  FilterUndefined<RouteContextCodecMap<TApiRoutes[keyof TApiRoutes]>>
>;

/**
 * Combined context type for a loader
 * Includes inherited contexts from API routes + additional contexts
 *
 * - Inherited: Automatically extracted from all apiRoutes' contextCodec
 * - Additional: Explicitly declared via additionalContextCodecs
 *
 * Combined raw context type for a loader.
 */
export type CombinedLoaderContext<
  TApiRoutes extends ApiRouteMap,
  TAdditionalContextCodecs extends ContextCodecMap,
> = RouteContextFromCodecs<
  InheritedContextCodecsFromApiRoutes<TApiRoutes> & TAdditionalContextCodecs
>;

/**
 * Combined ctxResult type for a loader.
 */
export type CombinedLoaderContextResult<
  TApiRoutes extends ApiRouteMap,
  TAdditionalContextCodecs extends ContextCodecMap,
> = RouteContextResultFromCodecs<
  InheritedContextCodecsFromApiRoutes<TApiRoutes> & TAdditionalContextCodecs
>;

/**
 * Unwrapped context data types (for passing to API calls)
 * Each value is the data type, not Result - proves errors were handled
 */
export type UnwrappedContextData<TContextCodec extends ContextCodecMap> =
  ContextCodecMapDataTypes<TContextCodec>;

/**
 * Loader schema - defines the shape of loader results with validators
 * Used for both isomorphic and server loaders to enable typed page props
 * Similar to ApiRouteSchema but only needs response and error validators
 */
export type LoaderSchema<TData, TError> = {
  /** Validator for loader success data */
  response: (input: unknown) => IValidation<TData>;
  /** Validator for loader error data */
  error: (input: unknown) => IValidation<TError>;
};

/**
 * Extract data type from a LoaderSchema
 */
export type LoaderSchemaData<T> = T extends LoaderSchema<infer D, infer _E>
  ? D
  : never;

/**
 * Extract error type from a LoaderSchema
 */
export type LoaderSchemaError<T> = T extends LoaderSchema<infer _D, infer E>
  ? E
  : never;

/**
 * Any loader schema - for constraints
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for base type
export type AnyLoaderSchema = LoaderSchema<any, any>;

/**
 * Define a loader schema with validators for typed data and error
 *
 * @example
 * ```typescript
 * import typia from 'typia';
 *
 * const boardLoaderSchema = defineLoaderSchema({
 *   response: typia.createValidate<Board>(),
 *   error: typia.createValidate<{ type: string }>(),
 * });
 *
 * createAppRoute({
 *   loader: {
 *     schema: boardLoaderSchema,
 *     load: async (api, { params, ctx }) => {
 *       // Return type is enforced to match schema
 *       return api.getBoard(...);
 *     },
 *   },
 * });
 * ```
 */
export function defineLoaderSchema<TData, TError>(schema: {
  response: (input: unknown) => IValidation<TData>;
  error: (input: unknown) => IValidation<TError>;
}): LoaderSchema<TData, TError>;

/**
 * Marker overload for type macro expansion.
 *
 * Usage:
 *   defineLoaderSchema<{ response: Data; error: Err }>()
 */
export function defineLoaderSchema<
  TContract extends {
    response: unknown;
    error: unknown;
  },
>(): LoaderSchema<TContract['response'], TContract['error']>;

export function defineLoaderSchema<TData, TError>(schema?: {
  response: (input: unknown) => IValidation<TData>;
  error: (input: unknown) => IValidation<TError>;
}): LoaderSchema<TData, TError> {
  if (!schema) {
    throw new Error(
      'defineLoaderSchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
    );
  }

  return schema;
}

/**
 * Loader arguments passed to isomorphic loader functions
 */
export type LoaderArgs<TParams, TQuery, TContext, TContextResult> = {
  params: TParams;
  query: TQuery;
  ctx: TContext;
  ctxResult: TContextResult;
};

/**
 * Isomorphic loader function type
 * Receives typed api implementations and loader args, returns a SerializableResult
 *
 * - api: Typed API implementations (ctx param expects unwrapped data)
 * - args.ctx: Combined raw context (inherited + additional)
 * - args.ctxResult: Combined per-context decode/enforcement results
 * - Return type is enforced by the loader schema
 */
export type IsomorphicLoaderFn<
  TApiRoutes extends ApiRouteMap,
  TParams,
  TQuery,
  TContext,
  TContextResult,
  TSchema extends AnyLoaderSchema,
> = (
  api: ApiRouteImplementations<TApiRoutes>,
  args: LoaderArgs<TParams, TQuery, TContext, TContextResult>,
) => Promise<
  SerializableResult<LoaderSchemaData<TSchema>, LoaderSchemaError<TSchema>>
>;

/**
 * Loader configuration - combines schema with either 'server' marker or function
 */
export type LoaderConfig<
  TApiRoutes extends ApiRouteMap,
  TParams,
  TQuery,
  TContext,
  TContextResult,
  TSchema extends AnyLoaderSchema,
> = {
  /** Schema defining the loader result type */
  schema: TSchema;
  /** The loader - 'server' for server-only, or an isomorphic function */
  load:
    | 'server'
    | IsomorphicLoaderFn<
        TApiRoutes,
        TParams,
        TQuery,
        TContext,
        TContextResult,
        TSchema
      >;
};

// ============================================================================
// Route Context - Props for Page Components
// ============================================================================

/**
 * Pending transition state - type varies based on skeleton presence
 */
export type PendingTransitionWithSkeleton = 'outgoing' | false;
export type PendingTransitionWithoutSkeleton = 'incoming' | 'outgoing' | false;

/**
 * Props for outlet components - capabilities passed via JSX
 */
export type OutletProps<
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
> = {
  capabilities?: CapabilityImplementationMap<TCapabilities>;
};

/**
 * Outlet component type returned by getOutlet
 * Accepts capabilities as a prop for React-idiomatic usage
 */
export type OutletComponent<
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
> = React.FC<OutletProps<TCapabilities>>;

/**
 * getOutlet function type - returns a stable Outlet component
 * Capabilities are passed as props on the returned component
 *
 * @example
 * ```tsx
 * // Get main outlet (no args or 'main')
 * const MainOutlet = getOutlet();
 * const MainOutlet = getOutlet('main');
 *
 * // Get named virtual outlet
 * const SidebarOutlet = getOutlet('sidebar');
 *
 * // Render with capabilities
 * <MainOutlet capabilities={{ onAction: handler }} />
 * ```
 */
export type GetOutletFn<
  TCapabilities extends CapabilityDefinitionMap,
  TVirtualOutlets extends VirtualOutletMap,
> = {
  /** Get the main outlet (no args) */
  (): OutletComponent<TCapabilities>;
  /** Get the main outlet by name */
  (name: 'main'): OutletComponent<TCapabilities>;
  /** Get a virtual outlet by name */
  <TOutletName extends keyof TVirtualOutlets & string>(
    name: TOutletName,
  ): OutletComponent<
    TVirtualOutlets[TOutletName] extends { capabilities: infer C }
      ? C extends CapabilityDefinitionMap
        ? C
        : CapabilityDefinitionMap
      : CapabilityDefinitionMap
  >;
};

/**
 * Route context props provided to page components
 */
export type RouteContextNew<
  TApiRoutes extends ApiRouteMap,
  TEventStreams extends EventStreamRouteMap,
  TLoaderResult,
  TCapabilities extends CapabilityDefinitionMap = CapabilityDefinitionMap,
  TVirtualOutlets extends VirtualOutletMap = VirtualOutletMap,
  TRequestedCapabilities extends
    readonly CapabilityDefinition[] = readonly CapabilityDefinition[],
  THasSkeleton extends boolean = false,
> = {
  /** Typed API route implementations (keyed by route name from config) */
  apiRoutes: {
    [K in keyof TApiRoutes]: TApiRoutes[K] extends ApiRoute<
      infer _Path,
      infer Types extends RouteNamedTypes<string>
    >
      ? HandlerObject<string, Types, void>
      : never;
  };
  /** Typed EventStream route factories (keyed by route name from config) */
  eventStreams: {
    [K in keyof TEventStreams]: TEventStreams[K] extends EventStreamRoute<
      infer _Path,
      infer Types extends EventStreamRouteNamedTypes<string>
    >
      ? { name: Types['Name']; connect: () => void }
      : never;
  };
  /** Loader result from the route's loader function */
  loaderData: TLoaderResult;
  /** Capabilities provided by parent (based on requestsCapabilities) */
  capabilities: RequestedCapabilitiesMap<TRequestedCapabilities>;
  /** Get outlet function - returns stable outlet components */
  getOutlet: GetOutletFn<TCapabilities, TVirtualOutlets>;
  /** Path params from URL */
  params: Record<string, string>;
  /** Query params from URL */
  query: Record<string, string | undefined>;
  /** Navigation function */
  navigate: (path: string, options?: { replace?: boolean }) => void;
  /** Checkpoint function - serializes all virtual outlet states to URL */
  checkpoint: () => string;
  /** Pending transition state - type varies based on skeleton presence */
  pendingTransition: THasSkeleton extends true
    ? PendingTransitionWithSkeleton
    : PendingTransitionWithoutSkeleton;
  /** Revalidate the loader */
  revalidate: () => Promise<void>;
};

// ============================================================================
// App Route Configuration
// ============================================================================

/**
 * Any app path type
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for base type
export type AnyAppPath = AppPath<any, any, any, any>;

/**
 * React component type (for skeleton and error boundary)
 */
// biome-ignore lint/suspicious/noExplicitAny: React component type
export type ReactComponent<TProps = any> = (props: TProps) => React.ReactNode;

/**
 * Configuration for creating an app route
 */
export type AppRouteOptions<
  TName extends string,
  TPath extends AnyPathTreeNode,
  TApiRoutes extends ApiRouteMap,
  TEventStreams extends EventStreamRouteMap,
  TAdditionalContextCodecs extends ContextCodecMap,
  TLoaderSchema extends AnyLoaderSchema,
  TRequestsCapabilities extends
    readonly CapabilityDefinition[] = readonly CapabilityDefinition[],
> = {
  /** Route name for identification (literal type preserved) */
  name: TName;
  /** The path tree node for this route */
  path: TPath;
  /**
   * API routes this page depends on (for mutations, refetches)
   * Keys must match route.name (enforced at compile time)
   * Context codecs required by these routes are automatically inherited
   */
  apiRoutes?: TApiRoutes & AssertRouteNamesMatch<TApiRoutes>;
  /**
   * EventStream routes this page depends on (for real-time updates)
   * Keys must match route.name (enforced at compile time)
   */
  eventStreams?: TEventStreams & AssertRouteNamesMatch<TEventStreams>;
  /**
   * Additional context codecs beyond what API routes require
   * These are merged with inherited contexts from apiRoutes
   */
  additionalContextCodecs?: TAdditionalContextCodecs;
  /**
   * Loader configuration - schema and load function/marker
   * - schema: Defines the result type (required for type safety)
   * - load: 'server' for server-only, or an isomorphic function
   *
   * ctx receives combined raw context (inherited + additional)
   * ctxResult receives per-codec decode/enforcement outcomes
   */
  loader?: LoaderConfig<
    TApiRoutes,
    PathTreeParams<TPath>,
    Record<string, string | undefined>, // Query params - will be schema-based later
    CombinedLoaderContext<TApiRoutes, TAdditionalContextCodecs>,
    CombinedLoaderContextResult<TApiRoutes, TAdditionalContextCodecs>,
    TLoaderSchema
  >;
  /** Capabilities this route requests from parent (TypeScript validates against parent path) */
  requestsCapabilities?: TRequestsCapabilities;
  /** Optional skeleton component shown during loading */
  skeleton?: ReactComponent;
  /** Optional error boundary component */
  errorBoundary?: ReactComponent<{ error: unknown; reset: () => void }>;
  /** Delay in ms before showing skeleton (avoid flash for fast loads) */
  loadingDelay?: number;
  /** Optional index route flag */
  index?: boolean;
  /**
   * The component to render for this route.
   *
   * Can be:
   * - A regular component (sync, bundled with main)
   * - strategy.lazy(() => import('./component')) - lazy loaded, separate chunk
   * - strategy.static(() => import('./component')) - server-only, no client JS
   *
   * @example
   * ```typescript
   * import { strategy } from '@inkibra/router';
   *
   * // Sync (default)
   * component: MyComponent,
   *
   * // Lazy - separate chunk
   * component: strategy.lazy(() => import('./my-component')),
   *
   * // Static - server only
   * component: strategy.static(() => import('./my-component')),
   * ```
   */
  // biome-ignore lint/suspicious/noExplicitAny: Component props vary by route
  component?: RouteComponent<any>;
};

/**
 * App route configuration object
 */
export type AppRouteConfig<
  TName extends string,
  TPath extends AnyPathTreeNode,
  TApiRoutes extends ApiRouteMap,
  TEventStreams extends EventStreamRouteMap,
  TAdditionalContextCodecs extends ContextCodecMap,
  TLoaderSchema extends AnyLoaderSchema | undefined,
  TRequestsCapabilities extends
    readonly CapabilityDefinition[] = readonly CapabilityDefinition[],
> = {
  /** Route name (literal type preserved) */
  name: TName;
  /** The path tree node configuration */
  path: TPath;
  /** API routes this page depends on (keyed by route name) */
  apiRoutes: TApiRoutes;
  /** EventStream routes this page depends on (keyed by route name) */
  eventStreams: TEventStreams;
  /** Additional context codecs beyond what API routes require */
  additionalContextCodecs: TAdditionalContextCodecs;
  /** Loader configuration - schema and load function/marker */
  loader: TLoaderSchema extends AnyLoaderSchema
    ?
        | LoaderConfig<
            TApiRoutes,
            PathTreeParams<TPath>,
            Record<string, string | undefined>, // Query params - will be schema-based later
            CombinedLoaderContext<TApiRoutes, TAdditionalContextCodecs>,
            CombinedLoaderContextResult<TApiRoutes, TAdditionalContextCodecs>,
            TLoaderSchema
          >
        | undefined
    : undefined;
  /** Capabilities this route requests from parent */
  requestsCapabilities: TRequestsCapabilities;
  /** Skeleton component */
  skeleton: ReactComponent | undefined;
  /** Error boundary component */
  errorBoundary:
    | ReactComponent<{ error: unknown; reset: () => void }>
    | undefined;
  /** Loading delay in ms */
  loadingDelay: number;
  /** Whether this is an index route */
  index: boolean;
  /** Whether this route has a server loader */
  hasServerLoader: boolean;
  /**
   * The component to render for this route.
   * Can be a sync component, lazy component ref, or static component ref.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Component props vary by route
  component: RouteComponent<any> | undefined;
  /** Get the path pattern */
  getPath: () => string;
  /** Create a link (delegates to path.makeLink) */
  makeLink: TPath['makeLink'];
  /** Match a URL (delegates to path.match) */
  match: TPath['match'];
};

/**
 * Create an app route with a path, API dependencies, EventStreams, context, and loader
 *
 * API routes and EventStream routes are passed as objects where:
 * - Keys must match the route's `.name` property (enforced at compile time)
 * - Context codecs required by API routes are automatically inherited
 *
 * @example
 * ```typescript
 * const profileLoaderSchema = defineLoaderSchema<Profile, { type: 'NotFound' }>();
 *
 * const ProfileRoute = createAppRoute({
 *   name: 'Profile',
 *   path: profilePath,
 *   apiRoutes: { getProfile: getProfileRoute },  // getProfile requires 'session'
 *   additionalContextCodecs: { theme: ThemeCodec },  // Extra context
 *   loader: {
 *     schema: profileLoaderSchema,
 *     load: async (api, { params, ctx }) => {
 *       // ctx.session - inherited from getProfileRoute
 *       // ctx.theme - from additionalContextCodecs
 *       if (ctx.session.isErr) {
 *         return SerializableResult.toErr(ctx.session.error);
 *       }
 *       // api.getProfile expects unwrapped data, not Results
 *       return api.getProfile(
 *         { session: ctx.session.value },  // Unwrap to prove error handled
 *         { pathParams: { userId: params.id }, pathQuery: {}, body: {} },
 *       );
 *     },
 *   },
 *   skeleton: ProfileSkeleton,
 *   errorBoundary: ProfileError,
 * });
 * ```
 */
export function createAppRoute<
  TName extends string,
  TPath extends AnyPathTreeNode,
  TApiRoutes extends ApiRouteMap = Record<string, never>,
  TEventStreams extends EventStreamRouteMap = Record<string, never>,
  TAdditionalContextCodecs extends ContextCodecMap = Record<string, never>,
  TLoaderSchema extends AnyLoaderSchema | undefined = undefined,
  TRequestsCapabilities extends
    readonly CapabilityDefinition[] = readonly CapabilityDefinition[],
>(
  options: AppRouteOptions<
    TName,
    TPath,
    TApiRoutes,
    TEventStreams,
    TAdditionalContextCodecs,
    TLoaderSchema extends AnyLoaderSchema ? TLoaderSchema : AnyLoaderSchema,
    TRequestsCapabilities
  >,
): AppRouteConfig<
  TName,
  TPath,
  TApiRoutes,
  TEventStreams,
  TAdditionalContextCodecs,
  TLoaderSchema,
  TRequestsCapabilities
> {
  const {
    name,
    path,
    apiRoutes = {} as TApiRoutes,
    eventStreams = {} as TEventStreams,
    additionalContextCodecs = {} as TAdditionalContextCodecs,
    loader,
    requestsCapabilities = [] as unknown as TRequestsCapabilities,
    skeleton,
    errorBoundary,
    loadingDelay = 200,
    index = false,
    component,
  } = options;

  return {
    name,
    path,
    apiRoutes,
    eventStreams,
    additionalContextCodecs,
    // biome-ignore lint/suspicious/noExplicitAny: Type narrowing handled by generics
    loader: loader as any,
    requestsCapabilities,
    skeleton,
    errorBoundary,
    loadingDelay,
    index,
    hasServerLoader: loader?.load === 'server',
    component,
    getPath: () => path.pattern,
    makeLink: path.makeLink,
    match: path.match,
  };
}

// ============================================================================
// Type Extraction Utilities
// ============================================================================

/**
 * Extract path params type from an AppPath
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for extraction
export type PathParams<T> = T extends AppPath<infer P, any> ? P : never;

/**
 * Extract query params type from an AppPath
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for extraction
export type PathQuery<T> = T extends AppPath<any, infer Q> ? Q : never;

/**
 * Extract capabilities from an AppPath
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for extraction
export type PathCapabilities<T> = T extends AppPath<any, any, infer C>
  ? C
  : CapabilityDefinitionMap;

/**
 * Extract virtual outlets from an AppPath
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for extraction
export type PathVirtualOutlets<T> = T extends AppPath<any, any, any, infer V>
  ? V
  : VirtualOutletMap;

/**
 * Extract path params from an AppRouteConfig
 */
export type RouteParams<T> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  T extends AppRouteConfig<any, infer P, any, any, any, any>
    ? PathTreeParams<P>
    : never;

/**
 * Extract query params from an AppRouteConfig
 * Note: Currently returns generic type, will be schema-based later
 */
export type RouteQueryParams<T> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  T extends AppRouteConfig<any, any, any, any, any, any>
    ? Record<string, string | undefined>
    : never;

/**
 * Extract API routes map from an AppRouteConfig
 */
export type RouteApiRoutes<T> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  T extends AppRouteConfig<any, any, infer A extends ApiRouteMap, any, any, any>
    ? A
    : never;

/**
 * Extract EventStream routes map from an AppRouteConfig
 */
export type RouteEventStreams<T> = T extends AppRouteConfig<
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  infer S extends EventStreamRouteMap,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any
>
  ? S
  : never;

/**
 * Extract capabilities from an AppRouteConfig's path tree node
 */
export type RouteCapabilities<T> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  T extends AppRouteConfig<any, infer P, any, any, any, any>
    ? PathTreeCapabilities<P>
    : CapabilityDefinitionMap;

/**
 * Extract virtual outlets from an AppRouteConfig's path
 * Note: PathTreeNode doesn't support virtual outlets yet, returns empty map
 */
export type RouteVirtualOutlets<T> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  T extends AppRouteConfig<any, any, any, any, any, any>
    ? VirtualOutletMap // PathTreeNode doesn't have virtual outlets yet
    : VirtualOutletMap;

/**
 * Extract additional context codec map from an AppRouteConfig
 */
export type RouteAdditionalContextCodecs<T> = T extends AppRouteConfig<
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  infer C extends ContextCodecMap,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any
>
  ? C
  : never;

/**
 * Extract loader schema from an AppRouteConfig
 */
export type RouteLoaderSchema<T> = T extends AppRouteConfig<
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any,
  infer S extends AnyLoaderSchema | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: Required for extraction
  any
>
  ? S
  : never;

/**
 * Extract loader data type from an AppRouteConfig
 */
export type RouteLoaderData<T> = RouteLoaderSchema<T> extends LoaderSchema<
  infer D,
  infer _E
>
  ? D
  : unknown;

/**
 * Extract loader error type from an AppRouteConfig
 */
export type RouteLoaderError<T> = RouteLoaderSchema<T> extends LoaderSchema<
  infer _D,
  infer E
>
  ? E
  : unknown;

/**
 * Extract full loader result type (SerializableResult) from an AppRouteConfig
 */
export type RouteLoaderResult<T> = SerializableResult<
  RouteLoaderData<T>,
  RouteLoaderError<T>
>;

/**
 * Extract whether route has a skeleton defined
 */
export type RouteHasSkeleton<T> = T extends { skeleton: ReactComponent }
  ? true
  : false;

/**
 * EventStream implementations map type
 * Maps event stream route names to their connect functions
 */
export type EventStreamImplementations<
  TEventStreams extends EventStreamRouteMap,
> = {
  [K in keyof TEventStreams]: TEventStreams[K] extends EventStreamRoute<
    infer Path,
    infer Types
  >
    ? Types extends EventStreamRouteNamedTypes<Path>
      ? EventStreamHandler<Path, Types>
      : never
    : never;
};

/**
 * Page props type derived from an AppRouteConfig
 *
 * Use this to type your page components based on their route definition:
 *
 * @example
 * ```typescript
 * import { RoutePageProps } from '@inkibra/router';
 * import { boardDetailAppRoute } from '../routes';
 *
 * type BoardPageProps = RoutePageProps<typeof boardDetailAppRoute>;
 *
 * const BoardPage = (props: BoardPageProps) => {
 *   // props.params.boardId - typed from path
 *   // props.loaderData - typed from loader schema
 *   // props.apiRoutes.updateBoard(...) - typed API calls
 *   return <div>...</div>;
 * };
 * ```
 */
export type RoutePageProps<
  // biome-ignore lint/suspicious/noExplicitAny: Permissive constraint for page props extraction
  T extends AppRouteConfig<any, any, any, any, any, any, any>,
> = {
  /** Typed API route implementations for mutations */
  apiRoutes: ApiRouteImplementations<RouteApiRoutes<T>>;
  /** Typed EventStream connections for real-time */
  eventStreams: EventStreamImplementations<RouteEventStreams<T>>;
  /** Loader result - SerializableResult with typed data and error from loader schema */
  loaderData: RouteLoaderResult<T>;
  /** Context data - combined from API routes and additional context codecs */
  ctx: RouteContextFromCodecs<
    InheritedContextCodecsFromApiRoutes<RouteApiRoutes<T>> &
      RouteAdditionalContextCodecs<T>
  >;
  /** Context results - per-codec decode/enforcement outcomes */
  ctxResult: RouteContextResultFromCodecs<
    InheritedContextCodecsFromApiRoutes<RouteApiRoutes<T>> &
      RouteAdditionalContextCodecs<T>
  >;
  /** Path params from URL - typed from route path definition */
  params: RouteParams<T>;
  /** Query params from URL - typed from route path definition */
  query: RouteQueryParams<T>;
  /** Navigation function */
  navigate: (path: string, options?: { replace?: boolean }) => void;
  /** Get outlet function - returns stable outlet components for nested routes */
  getOutlet: GetOutletFn<RouteCapabilities<T>, RouteVirtualOutlets<T>>;
  /** Checkpoint function - serializes virtual outlet states to URL */
  checkpoint: () => string;
  /** Pending transition state - varies based on skeleton presence */
  pendingTransition: RouteHasSkeleton<T> extends true
    ? PendingTransitionWithSkeleton
    : PendingTransitionWithoutSkeleton;
  /** Revalidate the loader data */
  revalidate: () => Promise<void>;
  /**
   * List of outlet names that have no child route rendering in them.
   * Use this to show fallback/default content when outlets are empty.
   *
   * @example
   * ```tsx
   * const Layout = ({ emptyOutlets, getOutlet }) => {
   *   const MainOutlet = getOutlet('main');
   *   return (
   *     <MainOutlet
   *       fallback={emptyOutlets.includes('main') ? <Home /> : undefined}
   *     />
   *   );
   * };
   * ```
   */
  emptyOutlets: string[];
};

// ============================================================================
// Any App Route Type
// ============================================================================

/**
 * Any app route config - use for generic constraints
 */
export type AnyAppRoute = AppRouteConfig<
  string,
  AnyPathTreeNode,
  ApiRouteMap,
  EventStreamRouteMap,
  ContextCodecMap,
  AnyLoaderSchema | undefined,
  readonly CapabilityDefinition[]
>;

export type RouteEntryConstraint = Omit<AnyAppRoute, 'loader'> & {
  loader?: {
    load: ((...args: any[]) => any) | 'server';
    schema: AnyLoaderSchema;
  };
};

// ============================================================================
// Route Collection Utilities
// ============================================================================

/**
 * Collection of app routes
 */
export type AppRouteCollection = Record<string, AnyAppRoute>;

/**
 * Match a path against a collection of routes
 */
export function matchRouteInCollection<T extends AppRouteCollection>(
  inputPath: string,
  routes: T,
): {
  key: keyof T;
  route: T[keyof T];
  params: RouteParams<T[keyof T]>;
  query: RouteQueryParams<T[keyof T]>;
} | null {
  for (const [key, route] of Object.entries(routes)) {
    const match = route.match(inputPath);
    if (match) {
      return {
        key: key as keyof T,
        route: route as T[keyof T],
        params: match.params as RouteParams<T[keyof T]>,
        query: match.query as RouteQueryParams<T[keyof T]>,
      };
    }
  }
  return null;
}

// ============================================================================
// Outlet ID Generation (for portal system)
// ============================================================================

/**
 * Generate a stable outlet ID for portal rendering.
 *
 * Format: `${appId}:outlet-${path}:${outletName}`
 *
 * This ID is used to:
 * 1. Mark placeholder divs in SSR output for static components
 * 2. Target those placeholders with React portals on the client
 *
 * @param appId - The app identifier
 * @param path - The route path (e.g., '/blog')
 * @param outletName - The outlet name (e.g., 'createPost')
 * @returns A stable, unique outlet ID
 *
 * @example
 * ```typescript
 * const id = generateOutletId('myapp', '/blog', 'createPost');
 * // Returns: 'myapp:outlet-/blog:createPost'
 * ```
 */
export function generateOutletId(
  appId: string,
  path: string,
  outletName: string,
): string {
  // Normalize path to ensure consistent IDs
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${appId}:outlet-${normalizedPath}:${outletName}`;
}
