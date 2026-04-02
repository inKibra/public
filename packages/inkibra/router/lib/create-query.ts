/**
 * createQuery - Query factory with map/select/reduce pattern
 *
 * Queries define:
 * - apiRoutes: Which API route DEFINITIONS this query uses (not handlers)
 * - map: How to map input args to API calls + cache selections
 * - reduce: Optional client-side transform
 * - config: Refetch strategies
 *
 * Execution happens via runQuery helper which binds actual handlers.
 */

import type { FilterExpression } from '@inkibra/query-cache';
import type { AnyApiRoute, RouteHandlerArgs, RouteResponse } from './api-route';
import type { Result } from './result';
import type { TransportLevelError } from './transport';

// ============================================================================
// Types
// ============================================================================

/**
 * Selection for a single entity
 */
export type SingleSelection = {
  type: string;
  id: string;
};

/**
 * Selection for a list of entities (with DSL query)
 */
export type ListSelection = {
  type: string;
  filter?: Record<string, FilterExpression>;
  sort?: 'asc' | 'desc';
  sortKey?: string;
  before?: string;
  after?: string;
  limit?: number;
};

export type Selection = SingleSelection | ListSelection;

/**
 * Handle + Select pair for a single API route in the map
 */
export type RouteMapping<R extends AnyApiRoute, Ctx> = {
  /** Arguments to pass to the API handler */
  handle: [RouteHandlerArgs<R>, Ctx];
  /** Cache selection for this result */
  select: Selection;
};

/**
 * Query configuration
 */
export type QueryConfig = {
  /** Time in ms before data is considered stale (default: 0) */
  staleTime?: number;
  /** Refetch when window regains focus */
  refetchOnFocus?: boolean;
  /** Refetch when network reconnects */
  refetchOnReconnect?: boolean;
  /** Polling interval in ms (false to disable) */
  refetchInterval?: number | false;
};

/**
 * Query definition config - uses route DEFINITIONS, not handlers
 */
export type QueryDefinition<
  TApiRoutes extends Record<string, AnyApiRoute>,
  TArgs,
  TResult,
  TCtx,
> = {
  /** API route definitions this query uses */
  apiRoutes: TApiRoutes;

  /** Map input args to API calls + selections */
  map: (
    args: TArgs,
    ctx: TCtx,
  ) => {
    [K in keyof TApiRoutes]: RouteMapping<TApiRoutes[K], TCtx>;
  };

  /** Optional transform of results (client-side) */
  reduce?: (results: QueryExecutionResults<TApiRoutes>) => TResult;

  /** Query configuration */
  config?: QueryConfig;
};

/**
 * Created query type - a plan that can be executed via runQuery
 *
 * TApiRoutes is preserved to allow type-safe constraint checking
 */
export type Query<
  TArgs,
  TResult,
  TCtx,
  TApiRoutes extends Record<string, AnyApiRoute> = Record<string, AnyApiRoute>,
> = {
  /** Unique name derived from apiRoutes keys */
  readonly name: string;

  /** Query configuration */
  readonly config: Required<QueryConfig>;

  /** The route keys this query requires */
  readonly routeKeys: ReadonlyArray<keyof TApiRoutes>;

  /** Create a new query with overridden config */
  with(
    overrideConfig: Partial<QueryConfig>,
  ): Query<TArgs, TResult, TCtx, TApiRoutes>;

  /** Get cache key for given args */
  getKey(
    args: TArgs,
    ctx?: TCtx,
    options?: { optimisticScopes?: Array<string> | 'global' | false },
  ): string;

  /** Get selections for given args/context */
  getSelections(args: TArgs, ctx: TCtx): Selection[];

  /** Internal: the query definition */
  readonly _definition: QueryDefinition<TApiRoutes, TArgs, TResult, TCtx>;
};

export type QueryExecutionResult<R extends AnyApiRoute> = Result<
  RouteResponse<R>,
  TransportLevelError
>;

export type QueryExecutionResults<
  TApiRoutes extends Record<string, AnyApiRoute>,
> = {
  [K in keyof TApiRoutes]: QueryExecutionResult<TApiRoutes[K]>;
};

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: Required<QueryConfig> = {
  staleTime: 0,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  refetchInterval: false,
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a query definition (plan)
 *
 * The query is a static plan that defines:
 * - Which routes it needs (by definition, not handler)
 * - How to map args to API calls
 * - How to transform results
 *
 * Execution happens via runQuery which binds actual handlers.
 *
 * @example
 * ```typescript
 * // Define a query plan with route definitions
 * export const boardDataQuery = createQuery({
 *   apiRoutes: {
 *     board: getBoardRoute,      // Route definition
 *     cards: listCardsRoute,     // Route definition
 *   },
 *
 *   map: (args: { boardId: string }, ctx) => ({
 *     board: {
 *       handle: [{ pathParams: { boardId: args.boardId } }, ctx],
 *       select: { type: 'Board', id: args.boardId },
 *     },
 *     cards: {
 *       handle: [{ pathParams: { boardId: args.boardId } }, ctx],
 *       select: { type: 'Card', filter: { boardId: { op: 'eq', value: args.boardId } } },
 *     },
 *   }),
 *
 *   reduce: (results) => ({
 *     board: results.board,
 *     cards: results.cards,
 *   }),
 *
 *   config: { staleTime: 60_000 },
 * });
 *
 * // In a page component (runQuery is provided by router):
 * const [promise, optimistic] = runQuery(boardDataQuery, { boardId });
 * ```
 */
export function createQuery<
  TApiRoutes extends Record<string, AnyApiRoute>,
  TArgs,
  TResult = QueryExecutionResults<TApiRoutes>,
  TCtx = unknown,
>(
  definition: QueryDefinition<TApiRoutes, TArgs, TResult, TCtx>,
): Query<TArgs, TResult, TCtx, TApiRoutes> {
  // Derive name from apiRoutes keys
  const name = Object.keys(definition.apiRoutes).sort().join('+');
  const routeKeys = Object.keys(definition.apiRoutes) as Array<
    keyof TApiRoutes
  >;

  const config: Required<QueryConfig> = {
    ...DEFAULT_CONFIG,
    ...definition.config,
  };

  const query: Query<TArgs, TResult, TCtx, TApiRoutes> = {
    name,
    config,
    routeKeys,

    with(overrideConfig) {
      return createQuery({
        ...definition,
        config: { ...config, ...overrideConfig },
      });
    },

    getKey(args, _ctx, options) {
      return JSON.stringify({
        name,
        args,
        optimisticScopes: options?.optimisticScopes,
      });
    },

    getSelections(args, ctx) {
      const mapping = definition.map(args, ctx);
      return Object.values(mapping).map(
        (m) => (m as RouteMapping<AnyApiRoute, TCtx>).select,
      );
    },

    _definition: definition,
  };

  return query;
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract the args type from a query
 */
export type QueryArgs<Q> = Q extends Query<
  infer A,
  unknown,
  unknown,
  Record<string, AnyApiRoute>
>
  ? A
  : never;

/**
 * Extract the result type from a query
 */
export type QueryResult<Q> = Q extends Query<
  unknown,
  infer R,
  unknown,
  Record<string, AnyApiRoute>
>
  ? R
  : never;

/**
 * Extract the context type from a query
 */
export type QueryContext<Q> = Q extends Query<
  unknown,
  unknown,
  infer C,
  Record<string, AnyApiRoute>
>
  ? C
  : never;

/**
 * Extract the required API routes from a query
 */
export type QueryApiRoutes<Q> = Q extends Query<
  unknown,
  unknown,
  unknown,
  infer R
>
  ? R
  : never;

/**
 * Check if a query's required routes are available in the provided implementations
 */
export type QueryRoutesAvailable<
  Q extends AnyQuery,
  TAvailable extends Record<string, AnyApiRoute>,
> = keyof QueryApiRoutes<Q> extends keyof TAvailable ? true : false;

/**
 * Any query (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic constraints
export type AnyQuery = Query<any, any, any, any>;
