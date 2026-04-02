/**
 * Query Runtime - Page-facing helpers for query/mutation execution
 *
 * Provides:
 * - useQuery(ctx, query, params, opts?) → [promise, optimistic?]
 * - mutation(plan, opts?) → { run, isPending, result }
 *
 * The runtime binds static query/mutation plans to actual API handlers
 * and executes them with proper caching and optimistic updates.
 */

import { createQueryCache, type QueryCache } from '@inkibra/query-cache';
import { useSyncExternalStore } from 'react';
import type { AnyApiRoute } from './api-route';
import type {
  AnyMutation,
  Mutation,
  MutationApiRoutes,
  MutationMapping,
} from './create-mutation';
import type {
  AnyQuery,
  Query,
  QueryApiRoutes,
  QueryExecutionResults,
  RouteMapping,
  Selection,
} from './create-query';
import { buildQueryKey, QueryClient } from './query-client';

// ============================================================================
// Query Runtime Symbol
// ============================================================================

/**
 * Symbol used to attach query runtime to ctx.
 * Hidden from normal object enumeration, keeps ctx clean for users.
 */
export const QUERY_RUNTIME = Symbol('query-runtime');

/**
 * Query runtime context attached to ctx via QUERY_RUNTIME symbol.
 * Contains everything needed for useQuery/useMutation to work.
 */
export type QueryRuntimeContext<
  TApis extends ApiImplementationsMap = ApiImplementationsMap,
> = {
  client: QueryClient;
  apiImplementations: TApis;
  pageScope: string;
  ctx: unknown;
};

/**
 * Type helper to add query runtime to a context type.
 */
export type WithQueryRuntime<
  TCtx,
  TApis extends ApiImplementationsMap,
> = TCtx & {
  [QUERY_RUNTIME]: QueryRuntimeContext<TApis>;
};

// ============================================================================
// Types
// ============================================================================

/** Options for runQuery */
export type RunQueryOptions = {
  /** Override stale time (default from query config) */
  staleTime?: number;
  /** Use global optimistic overlays only (default: includes page scope) */
  globalOptimistic?: boolean;
};

/** Query result tuple: [promise, optimisticValue?] */
export type QueryResultTuple<T> = [Promise<T>, T | undefined];

/** Options for mutation binding */
export type MutationBindOptions = {
  /** Default scope for optimistic updates ('global' | string) */
  defaultScope?: 'global' | string;
};

/** Options for mutation execution */
export type MutationRunOptions = {
  /** Override optimistic scope */
  globalOptimistic?: boolean;
};

/** Bound mutation controller */
export type BoundMutation<TArgs, TResult> = {
  /** Execute the mutation */
  run: (args: TArgs, opts?: MutationRunOptions) => Promise<TResult>;
  /** Whether a mutation is currently in-flight */
  isPending: boolean;
  /** Last result (optimistic while pending, committed after settle) */
  result: TResult | undefined;
};

/**
 * API implementations map - maps route names to their handlers
 */
export type ApiImplementationsMap = Record<
  string,
  {
    route: AnyApiRoute;
    execute(args: unknown, ctx: unknown): Promise<unknown>;
  }
>;

/**
 * Type to verify that all required routes from a query are available
 */
export type HasRequiredRoutes<
  TRequired extends Record<string, AnyApiRoute>,
  TAvailable extends ApiImplementationsMap,
> = keyof TRequired extends keyof TAvailable ? true : false;

// ============================================================================
// Query Runtime Factory
// ============================================================================

/**
 * Create query runtime helpers bound to API implementations and context.
 *
 * The returned helpers enforce at compile-time that queries/mutations
 * only use routes that are available in the page's apiImplementations.
 *
 * **IMPORTANT: `runQuery` must be called at component render time (top-level
 * in a component body, not in event handlers or effects).** It uses React's
 * `useSyncExternalStore` internally to subscribe to optimistic updates, so
 * it must be called unconditionally during render to comply with hook rules.
 *
 * @example
 * ```typescript
 * const { runQuery, mutation } = createQueryRuntime({
 *   ctx: { session },
 *   pageScope: 'board-page',
 *   apiImplementations,
 * });
 *
 * // In component (at top level, not in callbacks):
 * const [boardsPromise, boardsOptimistic] = runQuery(boardsQuery, { status: 'active' });
 * const updateBoard = mutation(updateBoardMutation);
 * ```
 */
export function createQueryRuntime<TCtx, TApis extends ApiImplementationsMap>(
  context: {
    ctx: TCtx;
    pageScope?: string;
    apiImplementations: TApis;
  },
  clientOrCache?: QueryClient | QueryCache,
): {
  /**
   * Execute a query, returns [promise, optimisticValue?]
   *
   * Type-safe: only accepts queries whose required routes exist in apiImplementations.
   *
   * **Must be called at component render time (top-level, not in callbacks).**
   * Uses `useSyncExternalStore` to subscribe to optimistic updates.
   */
  runQuery: <TArgs, TResult, TRoutes extends Record<string, AnyApiRoute>>(
    query: Query<TArgs, TResult, TCtx, TRoutes> &
      (keyof TRoutes extends keyof TApis ? unknown : never),
    args: TArgs,
    options?: RunQueryOptions,
  ) => QueryResultTuple<TResult>;

  /**
   * Bind a mutation for execution
   *
   * Type-safe: only accepts mutations whose required routes exist in apiImplementations
   */
  mutation: <TArgs, TResult, TRoutes extends Record<string, AnyApiRoute>>(
    mutationPlan: Mutation<TArgs, TResult, TCtx, TRoutes> &
      (keyof TRoutes extends keyof TApis ? unknown : never),
    options?: MutationBindOptions,
  ) => BoundMutation<TArgs, TResult>;

  /** Direct cache access (for advanced use) */
  cache: QueryCache;

  /** The underlying QueryClient */
  client: QueryClient;
} {
  // Accept either a QueryClient or QueryCache
  const client =
    clientOrCache instanceof QueryClient
      ? clientOrCache
      : new QueryClient(clientOrCache ?? createQueryCache());
  const actualCache =
    clientOrCache instanceof QueryClient
      ? createQueryCache()
      : (clientOrCache ?? createQueryCache());

  // Compute scopes for reading: ['global'] or ['global', pageScope]
  const getScopes = (globalOnly: boolean): string[] | 'global' => {
    if (globalOnly || !context.pageScope) return 'global';
    return ['global', context.pageScope];
  };

  /**
   * Execute a query by binding handlers from apiImplementations.
   * Returns a snapshot [promise, optimisticValue] - does NOT subscribe to updates.
   *
   * For live optimistic updates, use the `useQuery` hook instead.
   */
  function runQuery<
    TArgs,
    TResult,
    TRoutes extends Record<string, AnyApiRoute>,
  >(
    query: Query<TArgs, TResult, TCtx, TRoutes>,
    args: TArgs,
    options?: RunQueryOptions,
  ): QueryResultTuple<TResult> {
    const scopes = getScopes(options?.globalOptimistic ?? false);
    const staleTime = options?.staleTime ?? query.config.staleTime;

    // Get the mapping
    const definition = query._definition;
    const mapping = definition.map(args, context.ctx);

    // Execute all handlers in parallel
    const committedPromise = (async () => {
      const results: Record<string, unknown> = {};

      const handlerPromises = Object.entries(mapping).map(
        async ([key, routeMapping]) => {
          const handler = context.apiImplementations[key];
          if (!handler) {
            throw new Error(
              `runQuery: No handler for route "${key}". ` +
                `Available: ${Object.keys(context.apiImplementations).join(', ')}`,
            );
          }

          const [handlerArgs, handlerCtx] = (
            routeMapping as RouteMapping<AnyApiRoute, TCtx>
          ).handle;
          const selection = (routeMapping as RouteMapping<AnyApiRoute, TCtx>)
            .select;
          const queryName = `${query.name}:${key}`;

          // Execute via client for caching/deduplication
          const result = await client.fetchQuery(handler, handlerArgs, {
            selection,
            queryName,
            optimisticScopes: scopes,
            staleTime,
            context: handlerCtx,
          });

          results[key] = result;
        },
      );

      await Promise.all(handlerPromises);

      // Apply reduce if provided
      if (definition.reduce) {
        return definition.reduce(results as QueryExecutionResults<TRoutes>);
      }

      return results as TResult;
    })();

    // Try to get optimistic value synchronously from cache
    let optimisticValue: TResult | undefined;
    const selections = query.getSelections(args, context.ctx);
    if (selections.length > 0) {
      const firstSelection = selections[0] as Selection;
      const cachedData = client.getData<TResult>(firstSelection, scopes);
      if (cachedData !== undefined) {
        optimisticValue = cachedData;
      }
    }

    return [committedPromise, optimisticValue];
  }

  /**
   * Bind a mutation for execution
   */
  function mutation<
    TArgs,
    TResult,
    TRoutes extends Record<string, AnyApiRoute>,
  >(
    mutationPlan: Mutation<TArgs, TResult, TCtx, TRoutes>,
    options?: MutationBindOptions,
  ): BoundMutation<TArgs, TResult> {
    let isPending = false;
    let result: TResult | undefined;

    const defaultScope = options?.defaultScope ?? 'global';

    const run = async (
      args: TArgs,
      runOptions?: MutationRunOptions,
    ): Promise<TResult> => {
      isPending = true;
      const scope = runOptions?.globalOptimistic ? 'global' : defaultScope;

      try {
        const definition = mutationPlan._definition;
        const mapping = definition.map(args, context.ctx);

        // Apply optimistic overlays if configured
        if (mutationPlan._optimistic) {
          for (const routeMapping of Object.values(mapping)) {
            const selections = (
              routeMapping as MutationMapping<AnyApiRoute, TCtx>
            ).select;
            const selectionsArray = Array.isArray(selections)
              ? selections
              : [selections];

            for (const select of selectionsArray) {
              const currentData = client.getData(
                select,
                scope === 'global' ? 'global' : [scope],
              );
              const optimisticData = mutationPlan._optimistic(
                args,
                currentData,
              );
              const key = buildQueryKey(
                mutationPlan.name,
                select,
                args,
                scope === 'global' ? 'global' : [scope],
              );
              client.applyOptimistic(key, select, optimisticData, scope);
            }
          }
        }

        // Execute all handlers sequentially (mutations preserve order)
        const results: Record<string, unknown> = {};
        for (const [key, routeMapping] of Object.entries(mapping)) {
          const handler = context.apiImplementations[key];
          if (!handler) {
            throw new Error(
              `mutation: No handler for route "${key}". ` +
                `Available: ${Object.keys(context.apiImplementations).join(', ')}`,
            );
          }

          const [handlerArgs, handlerCtx] = (
            routeMapping as MutationMapping<AnyApiRoute, TCtx>
          ).handle;
          const handlerResult = await handler.execute(
            handlerArgs,
            handlerCtx as Record<string, unknown>,
          );
          results[key] = handlerResult;

          // Clear optimistic overlays and invalidate affected selections
          const selections = (
            routeMapping as MutationMapping<AnyApiRoute, TCtx>
          ).select;
          const selectionsArray = Array.isArray(selections)
            ? selections
            : [selections];
          for (const select of selectionsArray) {
            client.clearOptimistic(
              select,
              scope === 'global' ? 'global' : scope,
            );
            client.invalidateBySelection(select);
          }
        }

        result = results as TResult;
        return result;
      } finally {
        isPending = false;
      }
    };

    // Return a getter-based object so isPending/result are always current
    return {
      run,
      get isPending() {
        return isPending;
      },
      get result() {
        return result;
      },
    };
  }

  return {
    runQuery: runQuery as ReturnType<
      typeof createQueryRuntime<TCtx, TApis>
    >['runQuery'],
    mutation: mutation as ReturnType<
      typeof createQueryRuntime<TCtx, TApis>
    >['mutation'],
    cache: actualCache,
    client,
  };
}

// ============================================================================
// Type Helpers
// ============================================================================

/** Extract required route keys from a query */
export type RequiredRoutesOf<Q> = Q extends AnyQuery
  ? QueryApiRoutes<Q>
  : never;

/** Extract required route keys from a mutation */
export type RequiredMutationRoutesOf<M> = M extends AnyMutation
  ? MutationApiRoutes<M>
  : never;

/** Check if a query can be executed with given implementations */
export type CanRunQuery<
  Q extends AnyQuery,
  TApis extends ApiImplementationsMap,
> = keyof QueryApiRoutes<Q> extends keyof TApis ? true : false;

/** Check if a mutation can be executed with given implementations */
export type CanRunMutation<
  M extends AnyMutation,
  TApis extends ApiImplementationsMap,
> = keyof MutationApiRoutes<M> extends keyof TApis ? true : false;

// ============================================================================
// useQuery Hook
// ============================================================================

/**
 * React hook for executing queries with live optimistic updates.
 *
 * Uses useSyncExternalStore internally to subscribe to cache/overlay changes,
 * so the component re-renders when optimistic data changes.
 *
 * @example
 * ```typescript
 * const [tasksPromise, optimisticTasks] = useQuery(
 *   ctx,
 *   tasksQuery,
 *   { boardId },
 *   { staleTime: 30000 }
 * );
 * ```
 */
export function useQuery<
  TCtx,
  TApis extends ApiImplementationsMap,
  TArgs,
  TResult,
  TQueryCtx,
  TRoutes extends Record<string, AnyApiRoute>,
>(
  ctx: WithQueryRuntime<TCtx, TApis>,
  query: Query<TArgs, TResult, TQueryCtx, TRoutes> &
    (keyof TRoutes extends keyof TApis ? unknown : never),
  args: TArgs,
  options?: RunQueryOptions,
): QueryResultTuple<TResult> {
  const runtime = ctx[QUERY_RUNTIME];
  if (!runtime) {
    throw new Error(
      'useQuery: ctx is missing QUERY_RUNTIME. ' +
        'Make sure you are using ctx from page props.',
    );
  }

  const { client, apiImplementations, pageScope } = runtime;
  // Cast to query's expected context type
  const userCtx = runtime.ctx as TQueryCtx;

  // Compute scopes
  const globalOnly = options?.globalOptimistic ?? false;
  const scopes: string[] | 'global' =
    globalOnly || !pageScope ? 'global' : ['global', pageScope];

  // Get selections for subscription
  const selections = query.getSelections(args, userCtx);
  const firstSelection =
    selections.length > 0 ? (selections[0] as Selection) : undefined;

  // Subscribe to selection changes using useSyncExternalStore for live optimistic updates
  const optimisticValue = useSyncExternalStore<TResult | undefined>(
    (onStoreChange) => {
      if (!firstSelection) return () => {};
      return client.subscribeToSelection<TResult>(firstSelection, scopes, {
        onDataChange: () => onStoreChange(),
      });
    },
    () => {
      if (!firstSelection) return undefined;
      return client.getSelectionSnapshot<TResult>(firstSelection, scopes);
    },
    () => {
      // Server snapshot - no optimistic data on server
      return undefined;
    },
  );

  // Execute the query (fetch)
  const staleTime = options?.staleTime ?? query.config.staleTime;
  const definition = query._definition;
  const mapping = definition.map(args, userCtx);

  const committedPromise = (async () => {
    const results: Record<string, unknown> = {};

    const handlerPromises = Object.entries(mapping).map(
      async ([key, routeMapping]) => {
        const handler = apiImplementations[key];
        if (!handler) {
          throw new Error(
            `useQuery: No handler for route "${key}". ` +
              `Available: ${Object.keys(apiImplementations).join(', ')}`,
          );
        }

        const [handlerArgs, handlerCtx] = (
          routeMapping as RouteMapping<AnyApiRoute, unknown>
        ).handle;
        const selection = (routeMapping as RouteMapping<AnyApiRoute, unknown>)
          .select;
        const queryName = `${query.name}:${key}`;

        const result = await client.fetchQuery(handler, handlerArgs, {
          selection,
          queryName,
          optimisticScopes: scopes,
          staleTime,
          context: handlerCtx,
        });

        results[key] = result;
      },
    );

    await Promise.all(handlerPromises);

    if (definition.reduce) {
      return definition.reduce(results as QueryExecutionResults<TRoutes>);
    }

    return results as TResult;
  })();

  return [committedPromise, optimisticValue];
}
