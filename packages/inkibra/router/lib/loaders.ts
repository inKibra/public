/**
 * Loader Definitions
 *
 * Loaders define how to fetch data for app routes. They are configuration
 * objects that can be used by both client and server to load data.
 */

import type {
  CacheableObject,
  ObservableCache,
} from '@inkibra/observable-cache';
import type { ApiRoute, HandlerArguments, RouteNamedTypes } from './api-route';
import type { Result } from './result';

// ============================================================================
// Loader Configuration
// ============================================================================

/**
 * Isomorphic loader configuration - can run on client or server
 *
 * @template TParams - Route params type (from app route)
 * @template TResult - The result type of the loader
 */
export type IsomorphicLoaderConfig<
  TParams,
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
> = {
  /** The API route to call */
  apiRoute: ApiRoute<Path, RouteTypes>;
  /** Map app route params to API route arguments */
  mapParams: (params: TParams) => HandlerArguments<Path, RouteTypes>;
  /** Optional: update cache with result */
  updateCache?: (
    cache: ObservableCache<CacheableObject>,
    result: RouteTypes['ResponseType'],
    params: TParams,
  ) => void;
};

/**
 * Define an isomorphic loader that calls an API route
 *
 * @example
 * ```typescript
 * const profileLoader = defineIsomorphicLoader({
 *   apiRoute: getProfile,
 *   mapParams: (p: { id: string }) => ({
 *     pathParams: { id: p.id },
 *     pathQuery: {},
 *     body: undefined,
 *   }),
 *   updateCache: (cache, result, params) => {
 *     if (result.type === 'Ok') {
 *       cache.input.next(result.value);
 *     }
 *   },
 * });
 * ```
 */
export function defineIsomorphicLoader<
  TParams,
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
>(
  config: IsomorphicLoaderConfig<TParams, Path, RouteTypes>,
): IsomorphicLoaderConfig<TParams, Path, RouteTypes> {
  return config;
}

// ============================================================================
// Server-Only Loader
// ============================================================================

/**
 * Server loader configuration - only runs on server
 *
 * Use for loaders that need server-only resources (database, etc.)
 */
export type ServerLoaderConfig<TParams, TResult, TContext> = {
  /** Load data on the server */
  load: (params: TParams, ctx: TContext) => Promise<TResult> | TResult;
  /** Optional: update cache with result */
  updateCache?: (
    cache: ObservableCache<CacheableObject>,
    result: TResult,
    params: TParams,
  ) => void;
};

/**
 * Define a server-only loader
 *
 * Server loaders cause a full page refresh when navigated to on the client.
 *
 * @example
 * ```typescript
 * const blogPostLoader = defineServerLoader<
 *   { slug: string },
 *   BlogPost,
 *   AppContext
 * >({
 *   load: async (params, ctx) => {
 *     return ctx.blogService.getPost(params.slug);
 *   },
 * });
 * ```
 */
export function defineServerLoader<TParams, TResult, TContext>(
  config: ServerLoaderConfig<TParams, TResult, TContext>,
): ServerLoaderConfig<TParams, TResult, TContext> {
  return config;
}

// ============================================================================
// Loader Type Utilities
// ============================================================================

/**
 * Any isomorphic loader config
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for base type
export type AnyIsomorphicLoader = IsomorphicLoaderConfig<any, any, any>;

/**
 * Any server loader config
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for base type
export type AnyServerLoader = ServerLoaderConfig<any, any, any>;

/**
 * Any loader type
 */
export type AnyLoader = AnyIsomorphicLoader | AnyServerLoader;

/**
 * Extract result type from an isomorphic loader
 */
export type IsomorphicLoaderResult<T> = T extends IsomorphicLoaderConfig<
  unknown,
  infer _Path,
  infer RouteTypes extends RouteNamedTypes<string>
>
  ? RouteTypes['ResponseType']
  : never;

/**
 * Extract result type from a server loader
 */
export type ServerLoaderResult<T> = T extends ServerLoaderConfig<
  unknown,
  infer R,
  unknown
>
  ? R
  : never;

/**
 * Type guard - check if loader is isomorphic
 */
export function isIsomorphicLoader(
  loader: AnyLoader,
): loader is AnyIsomorphicLoader {
  return 'apiRoute' in loader;
}

/**
 * Type guard - check if loader is server-only
 */
export function isServerLoader(loader: AnyLoader): loader is AnyServerLoader {
  return 'load' in loader && !('apiRoute' in loader);
}

// ============================================================================
// Cache Helpers
// ============================================================================

/**
 * Helper to extract the Ok value from a SerializableResult
 */
export function extractOkValue<T>(
  result: { type: 'Ok'; value: T } | { type: 'Err'; error: unknown },
): T | undefined {
  if (result.type === 'Ok') {
    return result.value;
  }
  return undefined;
}

/**
 * Helper to update cache with cacheable objects from a result
 */
export function updateCacheWithResult(
  cache: ObservableCache<CacheableObject>,
  result: unknown,
): void {
  if (result && typeof result === 'object') {
    // If result has an id and type, it's a cacheable object
    if ('id' in result && 'type' in result) {
      cache.input.next(result as CacheableObject);
    }
    // If result is an array, process each item
    if (Array.isArray(result)) {
      const cacheables = result.filter(
        (item): item is CacheableObject =>
          item && typeof item === 'object' && 'id' in item && 'type' in item,
      );
      if (cacheables.length > 0) {
        cache.input.next(cacheables);
      }
    }
  }
}

// ============================================================================
// Loader Execution (Client)
// ============================================================================

/**
 * Execute an isomorphic loader on the client
 */
export async function executeLoaderOnClient<
  TParams,
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
>(
  loader: IsomorphicLoaderConfig<TParams, Path, RouteTypes>,
  params: TParams,
  handler: (
    args: HandlerArguments<Path, RouteTypes>,
  ) => Promise<RouteTypes['ResponseType']>,
  cache?: ObservableCache<CacheableObject>,
): Promise<Result<RouteTypes['ResponseType'], unknown>> {
  try {
    const args = loader.mapParams(params);
    const result = await handler(args);

    if (cache && loader.updateCache) {
      loader.updateCache(cache, result, params);
    }

    return { type: 'Ok', value: result, isOk: true, isErr: false };
  } catch (error) {
    return { type: 'Err', error, isOk: false, isErr: true };
  }
}

// ============================================================================
// Loader Execution (Server)
// ============================================================================

/**
 * Execute an isomorphic loader on the server (direct call, no HTTP)
 */
export async function executeLoaderOnServer<
  TParams,
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TContext,
>(
  loader: IsomorphicLoaderConfig<TParams, Path, RouteTypes>,
  params: TParams,
  handlerRegistry: {
    get: (routeName: string) =>
      | {
          fn: (
            args: HandlerArguments<Path, RouteTypes>,
            ctx: TContext,
          ) => Promise<RouteTypes['ResponseType']>;
        }
      | undefined;
  },
  ctx: TContext,
  cache?: ObservableCache<CacheableObject>,
): Promise<Result<RouteTypes['ResponseType'], unknown>> {
  try {
    const args = loader.mapParams(params);
    const handler = handlerRegistry.get(loader.apiRoute.name);

    if (!handler) {
      return {
        type: 'Err',
        error: new Error(`Handler not found: ${loader.apiRoute.name}`),
        isOk: false,
        isErr: true,
      };
    }

    const result = await handler.fn(args, ctx);

    if (cache && loader.updateCache) {
      loader.updateCache(cache, result, params);
    }

    return { type: 'Ok', value: result, isOk: true, isErr: false };
  } catch (error) {
    return { type: 'Err', error, isOk: false, isErr: true };
  }
}
