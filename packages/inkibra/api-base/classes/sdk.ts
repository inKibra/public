import type { Logger } from '@inkibra/logger';
import type {
  CacheableObject,
  CursorPageInfo as GenericCursorPageInfo,
  ObjectCache,
  ObservableCache,
  SortableKeys,
} from '@inkibra/observable-cache';
import { Brand } from '@inkibra/observable-cache';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MimeType,
  type SerializableResult,
  type StatusCode,
} from '../constants';
import type {
  ApiRoute,
  HandlerArguments,
  HandlerFunctionForRoute,
  RouteNamedTypes,
} from './api-route';
import { createSseClient, type SseClient } from './sse-client';
import type { SseEventBus } from './sse-event-bus';
import type { SseRoute, SseRouteNamedTypes } from './sse-route';
import { TypedFormData } from './typed-form-data';

/**
 * Type definition for the constructor arguments of FetchProvider.
 */
type FetchProviderConstructorArgs = {
  fetch: typeof fetch;
  Request: typeof Request;
  Response: typeof Response;
  Headers: typeof Headers;
  domain: string;
  port: number;
  protocol: 'http:' | 'https:';
  storage?: {
    authorization?: string;
  };
  getStoredAuthorization?: () => Promise<string | undefined>;
  setStoredAuthorization?: (token: string | undefined) => Promise<void>;
  logger: Logger;
  includeCredentials?: boolean;
  /** Optional client ID. If not provided, one will be generated. */
  clientId?: string;
};

/**
 * FetchProvider class provides methods to handle fetch requests.
 */
export class FetchProvider {
  public readonly fetch: FetchProviderConstructorArgs['fetch'];
  public readonly Request: FetchProviderConstructorArgs['Request'];
  public readonly Response: FetchProviderConstructorArgs['Response'];
  public readonly Headers: FetchProviderConstructorArgs['Headers'];
  public readonly storage: FetchProviderConstructorArgs['storage'];
  public readonly domain: FetchProviderConstructorArgs['domain'];
  public readonly port: FetchProviderConstructorArgs['port'];
  public readonly protocol: FetchProviderConstructorArgs['protocol'];
  public readonly includeCredentials: Required<
    FetchProviderConstructorArgs['includeCredentials']
  >;
  public readonly logger: FetchProviderConstructorArgs['logger'];
  public readonly clientId: string;
  public readonly getStoredAuthorization?: FetchProviderConstructorArgs['getStoredAuthorization'];
  public readonly setStoredAuthorization?: FetchProviderConstructorArgs['setStoredAuthorization'];

  /**
   * Constructor for FetchProvider class.
   * @param {FetchProviderConstructorArgs} args - The constructor arguments.
   */
  public constructor({
    fetch,
    Request,
    Response,
    Headers,
    storage,
    domain,
    port,
    protocol,
    includeCredentials = false,
    logger,
    getStoredAuthorization,
    setStoredAuthorization,
    clientId,
  }: FetchProviderConstructorArgs) {
    this.fetch = fetch;
    this.Request = Request;
    this.Response = Response;
    this.Headers = Headers;
    this.storage = storage;
    this.domain = domain;
    this.port = port;
    this.protocol = protocol;
    this.includeCredentials = includeCredentials;
    this.logger = logger;
    this.getStoredAuthorization = getStoredAuthorization;
    this.setStoredAuthorization = setStoredAuthorization;
    this.clientId = clientId ?? Brand.createId2('sdk');
  }

  /**
   * Creates a route handler.
   * @param {ApiRoute} route - The route.
   * @returns {HandlerFunctionForRoute} The handler function for the route.
   */
  public createRouteHandler<
    Path extends string,
    RouteTypes extends RouteNamedTypes<Path>,
    TContextLevelErrors extends
      | SerializableResult.ErrWithStatusCode<unknown, StatusCode>
      | never = never,
  >(
    route: ApiRoute<Path, RouteTypes, TContextLevelErrors>,
  ): HandlerFunctionForRoute<Path, RouteTypes, void> {
    return async (args) => {
      const relativePath = route.constructPath(args);
      const fullPath = `${this.protocol}//${this.domain}:${this.port}${relativePath}`;
      let request: Request;
      const requestId = Brand.createId2('request');
      if (args.files instanceof TypedFormData) {
        request = new this.Request(fullPath, {
          method: route.method,
          body: args.files.serializeWithBody(JSON.stringify(args.body)),
        });
        // We don't have to set the content type here because the Browser automatically sets it
        // and included the boundary in the content type header.
        // request.headers.set('Content-Type', MimeType.MULTIPART_FORM_DATA);
      } else if (args.body === undefined) {
        request = new this.Request(fullPath, { method: route.method });
      } else {
        request = new this.Request(fullPath, {
          method: route.method,
          body: JSON.stringify(args.body),
          credentials: this.includeCredentials ? 'include' : 'same-origin',
        });
        request.headers.set('Content-Type', MimeType.APPLICATION_JSON);
      }
      request.headers.set('X-Inkibra-Client-ID', this.clientId);
      request.headers.set('X-Request-ID', requestId);
      if (this.storage?.authorization) {
        request.headers.set('Authorization', this.storage.authorization);
      }
      if (this.getStoredAuthorization) {
        const storedAuthorization = await this.getStoredAuthorization();
        if (storedAuthorization) {
          request.headers.set('Authorization', storedAuthorization);
        }
      }
      console.debug('Sending Request', {
        requestId,
        routeMethod: route.method,
        routeName: route.name,
        routePath: route.path,
        fullPath,
        routeArgs: { pathParams: args.pathParams, pathQuery: args.pathQuery },
        clientId: this.clientId,
      });

      const response = await this.fetch(request);
      const useAuthorization = response.headers.get('X-Use-Authorization');
      if (useAuthorization && this.storage) {
        this.storage.authorization = useAuthorization;
      }
      if (useAuthorization && this.setStoredAuthorization) {
        await this.setStoredAuthorization(useAuthorization);
      }
      const rawResponseText = await response.text();
      let decodedResponse: unknown;
      try {
        decodedResponse =
          rawResponseText.length > 0 ? JSON.parse(rawResponseText) : null;
      } catch {
        const preview =
          rawResponseText.length > 300
            ? `${rawResponseText.slice(0, 300)}...`
            : rawResponseText;

        this.logger.error('Received non-JSON response body', {
          requestId,
          routeName: route.name,
          routeMethod: route.method,
          routePath: route.path,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') ?? undefined,
          responsePreview: preview,
        });

        throw new Error(
          `Non-JSON response (${response.status} ${response.statusText}) from ${route.method.toUpperCase()} ${route.path}`,
        );
      }
      const parsedResponse = route.validateResponse(decodedResponse);
      console.debug('Got Response', {
        requestId,
        routeName: route.name,
        routeMethod: route.method,
        routePath: route.path,
        routeArgs: args,
        clientId: this.clientId,
        parsedResponse,
      });
      if (parsedResponse.success) {
        if (response.status !== (parsedResponse.data.statusCode as number)) {
          this.logger.error(
            `Invalid Response (Reason: Expected ${parsedResponse.data.statusCode}, Got ${response.status})`,
            {
              requestId,
              routeName: route.name,
              routeMethod: route.method,
              routePath: route.path,
              routeArgs: args,
              clientId: this.clientId,
            },
          );
          throw new Error(
            `Invalid Response (Reason: Expected ${parsedResponse.data.statusCode}, Got ${response.status})`,
          );
        }
        return parsedResponse.data;
      }
      this.logger.error('Invalid Response', {
        errors: parsedResponse.errors,
        decodedResponse,
        requestId,
        routeName: route.name,
        routeMethod: route.method,
        routePath: route.path,
        routeArgs: args,
        clientId: this.clientId,
      });
      throw new Error(
        `Invalid Response (Reason: ${JSON.stringify(
          parsedResponse.errors,
          null,
          4,
        )})`,
      );
    };
  }

  /**
   * Creates an SSE route handler that returns an SseClient instance.
   * @param {SseRoute} route - The SSE route.
   * @param {SseEventBus} eventBus - Optional event bus for mocking/testing.
   * @param {boolean} skipEventSourceConnection - Whether to skip EventSource connection.
   * @returns {SseClient} The SSE client for the route.
   */
  public createSSERouteHandler<
    Path extends string,
    RouteTypes extends SseRouteNamedTypes<Path>,
  >(
    route: SseRoute<Path, RouteTypes>,
    {
      eventBus,
      skipEventSourceConnection,
    }: {
      eventBus?: SseEventBus;
      skipEventSourceConnection?: boolean;
    } = {},
  ): SseClient<Path, RouteTypes> {
    const baseUrl = `${this.protocol}//${this.domain}:${this.port}`;

    return createSseClient(
      route,
      {
        logger: this.logger,
        baseUrl,
        eventSourceOptions: {
          withCredentials: this.includeCredentials,
        },
        authorization:
          this.getStoredAuthorization || this.storage?.authorization,
        skipEventSourceConnection,
      },
      eventBus,
    );
  }
}

/**
 * Creates a client factory function for the SSE route.
 * This is used for client-side SSE client creation.
 */
export function connectSseClientToRoute<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
>(
  route: SseRoute<Path, RouteTypes>,
  clientFactory: (
    route: SseRoute<Path, RouteTypes>,
  ) => SseClient<Path, RouteTypes>,
): {
  [K in RouteTypes['Name']]: {
    name: RouteTypes['Name'];
    fn: () => SseClient<Path, RouteTypes>;
  };
} {
  return {
    [route.name]: {
      name: route.name,
      fn: () => {
        return clientFactory(route);
      },
    },
  } as {
    [K in RouteTypes['Name']]: {
      name: RouteTypes['Name'];
      fn: () => SseClient<Path, RouteTypes>;
    };
  };
}

function useFetcherHook<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TContext = undefined,
>(handler: HandlerFunctionForRoute<Path, RouteTypes, undefined>) {
  const [isLoading, setIsLoading] = useState<
    | {
        input: HandlerArguments<Path, RouteTypes>;
        context: TContext;
      }
    | false
  >(false);
  const [error, setError] = useState<
    Extract<RouteTypes['ResponseType'], { type: 'Err' }>['error'] | undefined
  >(undefined);
  const [data, setData] = useState<
    | {
        value: Extract<RouteTypes['ResponseType'], { type: 'Ok' }>['value'];
        input: HandlerArguments<Path, RouteTypes>;
        context: TContext;
      }
    | undefined
  >(undefined);

  const execute = useCallback(
    async (args: HandlerArguments<Path, RouteTypes>, context: TContext) => {
      setIsLoading({ input: args, context });
      setError(undefined);

      try {
        const response = await handler(args, undefined);

        if (response.type === 'Ok') {
          setData({
            value: response.value,
            input: args,
            context,
          });
          setError(undefined);
          return response;
        }
        setError(response.error);
        setData(undefined);
        return response;
      } catch (err) {
        setError(undefined);
        setData(undefined);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [handler],
  );

  return {
    execute,
    isLoading,
    error,
    data,
  };
}

export function createFetcherHook<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
>(handlerProvider: () => HandlerFunctionForRoute<Path, RouteTypes, undefined>) {
  return <TContext = undefined>() =>
    useFetcherHook<Path, RouteTypes, TContext>(handlerProvider());
}

type CacheSelector<TReturn, Params> = (
  cache: ObjectCache<CacheableObject>,
  params: Params,
) => TReturn;

type CacheLoader<Params> = (
  params: Params,
  cache: ObservableCache<CacheableObject>,
) => Promise<boolean>;

export function createUseCacheLoaderView<Params, TReturn>(
  selector: CacheSelector<TReturn, Params>,
  cacheLoader: CacheLoader<Params>,
) {
  return (cache: ObservableCache<CacheableObject>, params: Params) => {
    const [isLoading, setIsLoading] = useState(false);
    const [cacheData, setCacheData] = useState<TReturn>(() =>
      selector(cache.latest, params),
    );

    // Load data into cache
    useEffect(() => {
      setIsLoading(true);
      void cacheLoader(params, cache)
        .then(() => {
          // Subscribe to cache changes and apply selector
          const subscription = cache.objectObservable.subscribe(
            (latestCache) => {
              const result = selector(latestCache, params);
              setCacheData(result);
            },
          );

          // Initial call with current cache
          const result = selector(cache.latest, params);
          setCacheData(result);

          return subscription;
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, [selector, cacheLoader, params, cache]);

    return [cacheData, isLoading] as const;
  };
}

type AppRoutePathParam = string | number;

type AppRoutePathParams<T extends string> =
  T extends `${infer _Start}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof AppRoutePathParams<Rest>]: AppRoutePathParam }
    : T extends `${infer _Start}:${infer Param}`
      ? { [K in Param]: AppRoutePathParam }
      : Record<string, never>;

type AppRoutePathQuery = Record<string, string>;

type AppRouteConfig<Path extends string, Params, Query> = {
  setPath: (path?: string) => void;
  makeRouteLink: (params: Params, query: Query) => string;
  /**
   * Returns the route segment path for use in React Router route definitions.
   * This is the path relative to the parent route, NOT the full browser path.
   * For matching against browser location, use `matchesLocation()` instead.
   */
  getPath: () => Path;
  /**
   * Checks if a browser location pathname matches this route.
   * Handles the full path including parent route prefixes (e.g., /tt/onboarding).
   * @param location - The browser location pathname (e.g., from useLocation().pathname)
   * @returns true if the location matches this route or is a child of this route
   */
  matchesLocation: (location: string) => boolean;
  /**
   * Returns how specifically this route matches the given location.
   * Higher values indicate more specific matches. Returns 0 if no match.
   * Use this to find the most specific matching route among several candidates.
   * @param location - The browser location pathname
   * @returns The length of the matched path (specificity), or 0 if no match
   */
  getMatchSpecificity: (location: string) => number;
};

type MergeRouteParams<
  Path extends string,
  ParentRoute extends AppRouteConfig<string, any, any> | undefined,
> = AppRoutePathParams<Path> extends Record<string, never>
  ? ParentRoute extends AppRouteConfig<string, infer PP, any>
    ? PP
    : {}
  : AppRoutePathParams<Path> &
      (ParentRoute extends AppRouteConfig<string, infer PP, any> ? PP : {});

export function createAppRoute<
  Path extends string,
  Params extends MergeRouteParams<Path, ParentRoute>,
  Query extends AppRoutePathQuery,
  ParentRoute extends
    | AppRouteConfig<string, any, AppRoutePathQuery>
    | undefined = undefined,
>(
  path: Path,
  parentRoute?: ParentRoute,
): AppRouteConfig<
  ParentRoute extends AppRouteConfig<infer P, any, any> ? `${P}${Path}` : Path,
  Params,
  Query &
    (ParentRoute extends AppRouteConfig<string, any, infer ParentQuery>
      ? ParentQuery
      : {})
> {
  return {
    setPath: (newPath = '') => {
      path = newPath as Path;
    },
    getPath: () =>
      path as ParentRoute extends AppRouteConfig<infer P, any, any>
        ? `${P}${Path}`
        : Path,
    makeRouteLink: (params, query) => {
      const parentPath = parentRoute?.makeRouteLink({}, {}) ?? '';
      let fullPath = `${parentPath}${path}`;
      for (const [key, value] of Object.entries(params)) {
        fullPath = fullPath.replace(`:${key}`, value as string);
      }
      const queryString = new URLSearchParams(query).toString();
      if (queryString) {
        fullPath += `?${queryString}`;
      }
      return fullPath;
    },
    matchesLocation: (location: string) => {
      // Get full path including parent route prefixes
      const parentPath = parentRoute?.makeRouteLink({}, {}) ?? '';
      const fullPath = `${parentPath}${path}`;

      // For root route, check exact match or trailing slash
      if (fullPath === '/' || fullPath === '') {
        return (
          location === '/' ||
          location === fullPath ||
          location === `${fullPath}/`
        );
      }

      // Convert path with params to regex pattern
      // e.g., /feed/compose/:workoutRecapId -> /feed/compose/[^/]+
      const patternPath = fullPath.replace(/:[^/]+/g, '[^/]+');
      const regex = new RegExp(`^${patternPath}(/|$)`);

      return regex.test(location);
    },
    getMatchSpecificity: (location: string) => {
      const parentPath = parentRoute?.makeRouteLink({}, {}) ?? '';
      const fullPath = `${parentPath}${path}`;

      // For root route
      if (fullPath === '/' || fullPath === '') {
        if (
          location === '/' ||
          location === fullPath ||
          location === `${fullPath}/`
        ) {
          return fullPath.length || 1; // Root has specificity 1
        }
        return 0;
      }

      // Convert path with params to regex pattern
      const patternPath = fullPath.replace(/:[^/]+/g, '[^/]+');
      const regex = new RegExp(`^${patternPath}(/|$)`);

      // Return path length (without param placeholders) if matches
      if (regex.test(location)) {
        // Use the static portion length for specificity
        // More specific routes (longer paths) get higher specificity
        return fullPath.replace(/:[^/]+/g, '').length;
      }
      return 0;
    },
  };
}

/**
 * Find all routes that match the given location, sorted by specificity (most specific first).
 * @param location - The browser location pathname
 * @param routes - Array of route configs to check
 * @returns Array of matching routes sorted by specificity (most specific first)
 */
export function findMatchingRoutes<T extends AppRouteConfig<string, any, any>>(
  location: string,
  routes: T[],
): T[] {
  return routes
    .map((route) => ({
      route,
      specificity: route.getMatchSpecificity(location),
    }))
    .filter(({ specificity }) => specificity > 0)
    .sort((a, b) => b.specificity - a.specificity)
    .map(({ route }) => route);
}

export type ExtractAppRoutePathParams<T> = T extends AppRouteConfig<
  string,
  infer Params,
  {}
>
  ? Params
  : never;

export type ExtractAppRouteQueryParams<T> = T extends AppRouteConfig<
  string,
  {},
  infer Query
>
  ? Query
  : never;

/**
 * Cursor pagination configuration for the hook.
 *
 * @typeParam TItem - The item type
 * @typeParam TSortKey - The sort key (constrained to sortable keys of TItem)
 */
export type CursorPaginationConfig<
  TItem extends { id: string },
  TSortKey extends SortableKeys<TItem, keyof TItem> = SortableKeys<
    TItem,
    keyof TItem
  >,
> = {
  /** Sort key (field name) - must be a sortable field (string or number) */
  sortKey: TSortKey;
  /** Sort order - 'desc' for newest first (default), 'asc' for oldest first */
  sortOrder?: 'asc' | 'desc';
  /** Default page size */
  pageSize?: number;
};

/**
 * Simple cursor page info type for hook return values.
 * This is structurally compatible with the generic `CursorPageInfo` from observable-cache.
 *
 * For route definitions, use `CursorPageInfo<TItem, TFilterableKeys, TSortKey>` from
 * `@inkibra/observable-cache` for full type safety.
 */
export type CursorPageInfo<TSortKey extends string = string> = {
  /** The field the cursor is based on */
  sortKey: TSortKey;
  /** Cursor boundaries */
  cursor: {
    /** Value of sort key for the first item */
    first: string;
    /** ID of the first item */
    firstId: string;
    /** Value of sort key for the last item */
    last: string;
    /** ID of the last item */
    lastId: string;
  };
  /** True if more items exist before the first item in this page */
  hasBefore: boolean;
  /** True if more items exist after the last item in this page */
  hasAfter: boolean;
};

// Re-export the generic version for use in route definitions
export type { GenericCursorPageInfo, SortableKeys };

export type CursorPaginationState<TItem extends { id: string }> = {
  /** All loaded items, sorted */
  items: TItem[];
  /** Current page info from last fetch */
  pageInfo: CursorPageInfo | undefined;
  /** Whether we're loading the initial page */
  isLoadingInitial: boolean;
  /** Whether we're loading more items (before or after) */
  isLoadingMore: boolean;
  /** The direction of current loading ('before' or 'after') */
  loadingDirection: 'before' | 'after' | undefined;
  /** Error from last fetch */
  error: unknown | undefined;
  /** Whether there are more items before the current window */
  hasBefore: boolean;
  /** Whether there are more items after the current window */
  hasAfter: boolean;
};

export type CursorPaginationActions<TItem extends { id: string }> = {
  /** Load the initial page of items */
  loadInitial: () => Promise<void>;
  /** Load more items before the current window (older items for desc sort) */
  loadBefore: () => Promise<void>;
  /** Load more items after the current window (newer items for desc sort) */
  loadAfter: () => Promise<void>;
  /** Add items from an external source (e.g., SSE) */
  addItems: (items: TItem[]) => void;
  /** Reset the pagination state */
  reset: () => void;
};

/**
 * Hook for cursor-based pagination.
 *
 * @param fetchPage - Function that fetches a page of items given cursor params
 * @param config - Pagination configuration
 * @returns Pagination state and actions
 *
 * @example
 * ```tsx
 * const { items, loadBefore, loadAfter, hasBefore, hasAfter, isLoadingMore } =
 *   useCursorPagination<Message>(
 *     async (params) => {
 *       const result = await api.getMessages(params);
 *       return result.type === 'Ok'
 *         ? { items: result.value, pageInfo: result.meta.pageInfo }
 *         : { items: [], pageInfo: undefined };
 *     },
 *     { sortKey: 'created', sortOrder: 'desc', pageSize: 50 }
 *   );
 * ```
 */
export function useCursorPagination<TItem extends { id: string }>(
  fetchPage: (params: {
    anchor?: string;
    anchorId?: string;
    direction: 'forward' | 'backward';
    limit: number;
  }) => Promise<{
    items: TItem[];
    pageInfo: CursorPageInfo | undefined;
  }>,
  config: CursorPaginationConfig<TItem>,
): [CursorPaginationState<TItem>, CursorPaginationActions<TItem>] {
  const { sortKey, sortOrder = 'desc', pageSize = 50 } = config;

  const [state, setState] = useState<CursorPaginationState<TItem>>({
    items: [],
    pageInfo: undefined,
    isLoadingInitial: false,
    isLoadingMore: false,
    loadingDirection: undefined,
    error: undefined,
    hasBefore: false,
    hasAfter: false,
  });

  // Ref to hold current state - avoids stale closures in callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  // Sort items helper
  const sortItems = useCallback(
    (items: TItem[]): TItem[] => {
      return [...items].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        let comparison: number;

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          comparison = aVal.localeCompare(bVal);
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
    },
    [sortKey, sortOrder],
  );

  // Merge items helper (deduplicates by id)
  const mergeItems = useCallback(
    (existing: TItem[], newItems: TItem[]): TItem[] => {
      const itemMap = new Map<string, TItem>();

      for (const item of existing) {
        itemMap.set(item.id, item);
      }

      for (const item of newItems) {
        itemMap.set(item.id, item);
      }

      return sortItems(Array.from(itemMap.values()));
    },
    [sortItems],
  );

  // Load initial page
  const loadInitial = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isLoadingInitial: true,
      error: undefined,
    }));

    try {
      const result = await fetchPage({
        direction: 'forward',
        limit: pageSize,
      });

      setState((prev) => ({
        ...prev,
        items: sortItems(result.items),
        pageInfo: result.pageInfo,
        isLoadingInitial: false,
        hasBefore: result.pageInfo?.hasBefore ?? false,
        hasAfter: result.pageInfo?.hasAfter ?? false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoadingInitial: false,
        error,
      }));
    }
  }, [fetchPage, pageSize, sortItems]);

  // Load more items before current window
  const loadBefore = useCallback(async () => {
    // Read from ref to get latest state - avoids stale closure issues
    const currentState = stateRef.current;
    if (
      currentState.isLoadingMore ||
      currentState.isLoadingInitial ||
      !currentState.hasBefore ||
      !currentState.pageInfo
    ) {
      return;
    }

    setState((prev) => ({
      ...prev,
      isLoadingMore: true,
      loadingDirection: 'before',
      error: undefined,
    }));

    try {
      // "Before" means items that come before in the sorted list
      // For ascending: before = smaller values = older = use cursor.first as anchor
      // For descending: before = larger values = older = use cursor.first as anchor
      // Direction 'backward' means items < anchor
      const result = await fetchPage({
        anchor: currentState.pageInfo.cursor.first,
        anchorId: currentState.pageInfo.cursor.firstId,
        direction: 'backward',
        limit: pageSize,
      });

      setState((prev) => ({
        ...prev,
        items: mergeItems(prev.items, result.items),
        pageInfo: result.pageInfo
          ? {
              sortKey: String(sortKey),
              cursor: {
                // After loading "before", update first (oldest) from result
                first: result.pageInfo.cursor.first,
                firstId: result.pageInfo.cursor.firstId,
                // Keep the existing last (newest)
                last: prev.pageInfo?.cursor.last ?? result.pageInfo.cursor.last,
                lastId:
                  prev.pageInfo?.cursor.lastId ?? result.pageInfo.cursor.lastId,
              },
              hasBefore: result.pageInfo.hasBefore,
              hasAfter: prev.pageInfo?.hasAfter ?? result.pageInfo.hasAfter,
            }
          : prev.pageInfo,
        isLoadingMore: false,
        loadingDirection: undefined,
        hasBefore: result.pageInfo?.hasBefore ?? false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoadingMore: false,
        loadingDirection: undefined,
        error,
      }));
    }
  }, [fetchPage, pageSize, mergeItems, sortKey]);

  // Load more items after current window
  const loadAfter = useCallback(async () => {
    // Read from ref to get latest state - avoids stale closure issues
    const currentState = stateRef.current;
    if (
      currentState.isLoadingMore ||
      currentState.isLoadingInitial ||
      !currentState.hasAfter ||
      !currentState.pageInfo
    ) {
      return;
    }

    setState((prev) => ({
      ...prev,
      isLoadingMore: true,
      loadingDirection: 'after',
      error: undefined,
    }));

    try {
      // "After" means items that come after in the sorted list
      // For ascending: after = larger values = newer = use cursor.last as anchor
      // For descending: after = smaller values = newer = use cursor.last as anchor
      // Direction 'forward' means items > anchor
      const result = await fetchPage({
        anchor: currentState.pageInfo.cursor.last,
        anchorId: currentState.pageInfo.cursor.lastId,
        direction: 'forward',
        limit: pageSize,
      });

      setState((prev) => ({
        ...prev,
        items: mergeItems(prev.items, result.items),
        pageInfo: result.pageInfo
          ? {
              sortKey: String(sortKey),
              cursor: {
                // Keep the existing first (oldest)
                first:
                  prev.pageInfo?.cursor.first ?? result.pageInfo.cursor.first,
                firstId:
                  prev.pageInfo?.cursor.firstId ??
                  result.pageInfo.cursor.firstId,
                // After loading "after", update last (newest) from result
                last: result.pageInfo.cursor.last,
                lastId: result.pageInfo.cursor.lastId,
              },
              hasBefore: prev.pageInfo?.hasBefore ?? result.pageInfo.hasBefore,
              hasAfter: result.pageInfo.hasAfter,
            }
          : prev.pageInfo,
        isLoadingMore: false,
        loadingDirection: undefined,
        hasAfter: result.pageInfo?.hasAfter ?? false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoadingMore: false,
        loadingDirection: undefined,
        error,
      }));
    }
  }, [fetchPage, pageSize, mergeItems, sortKey]);

  // Add items from external source (e.g., real-time updates via SSE)
  const addItems = useCallback(
    (newItems: TItem[]) => {
      setState((prev) => {
        const merged = mergeItems(prev.items, newItems);

        // Update pageInfo boundaries if needed
        const firstItem = merged.at(0);
        const lastItem = merged.at(-1);
        if (firstItem && lastItem && prev.pageInfo) {
          return {
            ...prev,
            items: merged,
            pageInfo: {
              ...prev.pageInfo,
              cursor: {
                first: String(firstItem[sortKey]),
                firstId: firstItem.id,
                last: String(lastItem[sortKey]),
                lastId: lastItem.id,
              },
            },
          };
        }

        return {
          ...prev,
          items: merged,
        };
      });
    },
    [mergeItems, sortKey],
  );

  // Reset pagination state
  const reset = useCallback(() => {
    setState({
      items: [],
      pageInfo: undefined,
      isLoadingInitial: false,
      isLoadingMore: false,
      loadingDirection: undefined,
      error: undefined,
      hasBefore: false,
      hasAfter: false,
    });
  }, []);

  // Memoize actions object to prevent unnecessary re-renders in consumers
  const actions = useMemo<CursorPaginationActions<TItem>>(
    () => ({
      loadInitial,
      loadBefore,
      loadAfter,
      addItems,
      reset,
    }),
    [loadInitial, loadBefore, loadAfter, addItems, reset],
  );

  return [state, actions];
}
