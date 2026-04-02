/**
 * createMutation - Mutation factory with cache integration
 *
 * Mutations define:
 * - apiRoutes: Which API route DEFINITIONS this mutation uses (not handlers)
 * - map: How to map input args to API calls + cache selections
 * - optimistic: Optional optimistic update logic
 *
 * Execution happens via mutation() helper which binds actual handlers.
 */

import type { AnyApiRoute, RouteHandlerArgs, RouteResponse } from './api-route';
import type { Selection } from './create-query';

// ============================================================================
// Types
// ============================================================================

/**
 * Mutation mapping for a single API route
 */
export type MutationMapping<R extends AnyApiRoute, Ctx> = {
  /** Arguments to pass to the API handler */
  handle: [RouteHandlerArgs<R>, Ctx];
  /**
   * Cache selection(s) for what this mutation affects.
   * Accepts one or many selections to support updating multiple query scopes.
   */
  select: Selection | Selection[];
};

/**
 * Optimistic update function
 */
export type OptimisticUpdateFn<TArgs, TData> = (
  args: TArgs,
  currentData: TData | undefined,
) => TData;

/**
 * Mutation definition config - uses route DEFINITIONS, not handlers
 */
export type MutationDefinition<
  TApiRoutes extends Record<string, AnyApiRoute>,
  TArgs,
  _TResult,
  TCtx,
> = {
  /** API route definitions this mutation uses */
  apiRoutes: TApiRoutes;

  /** Map input args to API calls + selections */
  map: (
    args: TArgs,
    ctx: TCtx,
  ) => {
    [K in keyof TApiRoutes]: MutationMapping<TApiRoutes[K], TCtx>;
  };

  /** Optional optimistic update (before server response) */
  optimistic?: OptimisticUpdateFn<TArgs, unknown>;
};

/**
 * Created mutation type - a plan that can be executed via mutation() helper
 *
 * TApiRoutes is preserved to allow type-safe constraint checking
 */
export type Mutation<
  TArgs,
  TResult,
  TCtx,
  TApiRoutes extends Record<string, AnyApiRoute> = Record<string, AnyApiRoute>,
> = {
  /** Unique name derived from apiRoutes keys */
  readonly name: string;

  /** The route keys this mutation requires */
  readonly routeKeys: ReadonlyArray<keyof TApiRoutes>;

  /** Get the selections this mutation affects */
  getAffectedSelections(args: TArgs, ctx: TCtx): Selection[];

  /** Internal: the mutation definition */
  readonly _definition: MutationDefinition<TApiRoutes, TArgs, TResult, TCtx>;

  /** Internal: optimistic update function */
  readonly _optimistic?: OptimisticUpdateFn<TArgs, unknown>;
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a mutation definition (plan)
 *
 * The mutation is a static plan that defines:
 * - Which routes it needs (by definition, not handler)
 * - How to map args to API calls
 * - How to apply optimistic updates
 *
 * Execution happens via mutation() helper which binds actual handlers.
 *
 * @example
 * ```typescript
 * // Define a mutation plan with route definitions
 * export const updateCardMutation = createMutation({
 *   apiRoutes: { updateCard: updateCardRoute }, // Route definition
 *
 *   map: (args: { cardId: string; data: CardUpdate }, ctx) => ({
 *     updateCard: {
 *       handle: [{ pathParams: { cardId: args.cardId }, body: args.data }, ctx],
 *       select: { type: 'Card', id: args.cardId },
 *     },
 *   }),
 *
 *   optimistic: (args, current) => ({ ...current, ...args.data }),
 * });
 *
 * // In a page component (mutation is provided by router):
 * const updateCard = mutation(updateCardMutation, { defaultScope: 'page' });
 * await updateCard.run({ cardId, data: { title: 'New title' } });
 * ```
 */
export function createMutation<
  TApiRoutes extends Record<string, AnyApiRoute>,
  TArgs,
  TResult = {
    [K in keyof TApiRoutes]: RouteResponse<TApiRoutes[K]>;
  },
  TCtx = unknown,
>(
  definition: MutationDefinition<TApiRoutes, TArgs, TResult, TCtx>,
): Mutation<TArgs, TResult, TCtx, TApiRoutes> {
  // Derive name from apiRoutes keys
  const name = `mutation:${Object.keys(definition.apiRoutes).sort().join('+')}`;
  const routeKeys = Object.keys(definition.apiRoutes) as Array<
    keyof TApiRoutes
  >;

  const mutation: Mutation<TArgs, TResult, TCtx, TApiRoutes> = {
    name,
    routeKeys,

    getAffectedSelections(args, ctx) {
      const mapping = definition.map(args, ctx);
      const selections: Selection[] = [];
      for (const routeMapping of Object.values(mapping)) {
        const select = (routeMapping as MutationMapping<AnyApiRoute, TCtx>)
          .select;
        if (Array.isArray(select)) {
          selections.push(...select);
        } else {
          selections.push(select);
        }
      }
      return selections;
    },

    _definition: definition,
    _optimistic: definition.optimistic,
  };

  return mutation;
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract the args type from a mutation
 */
export type MutationArgs<M> = M extends Mutation<
  infer A,
  unknown,
  unknown,
  Record<string, AnyApiRoute>
>
  ? A
  : never;

/**
 * Extract the result type from a mutation
 */
export type MutationResult<M> = M extends Mutation<
  unknown,
  infer R,
  unknown,
  Record<string, AnyApiRoute>
>
  ? R
  : never;

/**
 * Extract the context type from a mutation
 */
export type MutationContext<M> = M extends Mutation<
  unknown,
  unknown,
  infer C,
  Record<string, AnyApiRoute>
>
  ? C
  : never;

/**
 * Extract the required API routes from a mutation
 */
export type MutationApiRoutes<M> = M extends Mutation<
  unknown,
  unknown,
  unknown,
  infer R
>
  ? R
  : never;

/**
 * Check if a mutation's required routes are available in the provided implementations
 */
export type MutationRoutesAvailable<
  M extends AnyMutation,
  TAvailable extends Record<string, AnyApiRoute>,
> = keyof MutationApiRoutes<M> extends keyof TAvailable ? true : false;

/**
 * Any mutation (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic constraints
export type AnyMutation = Mutation<any, any, any, any>;
