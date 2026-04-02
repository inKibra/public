/**
 * API Route Handler Provider - Dependency injection wrapper
 *
 * Simple wrapper that takes a handler factory and returns the handler with deps injected.
 * All HTTP concerns (context codecs, body parsing, cookies) are handled by createBackend.
 */

import type { AnyApiRouteHandler, ApiHandlerRoute } from '@inkibra/router';

// ============================================================================
// Types
// ============================================================================

/**
 * Handler factory - produces a router-level handler when given dependencies
 */
export type ApiHandlerFactory<H extends AnyApiRouteHandler, TDeps> = (
  deps: TDeps,
) => H;

/**
 * Result of calling a handler provider with deps
 * Returns the handler with route.name preserved for type inference
 */
export type ApiHandlerProviderResult<H extends AnyApiRouteHandler> = H;

// ============================================================================
// Handler Provider Factory
// ============================================================================

/**
 * Create an API route handler provider from a router-level handler factory.
 *
 * This is a simple dependency injection wrapper - it takes a factory function
 * that produces an ApiRouteHandler and returns a function that calls it with deps.
 *
 * All HTTP concerns (context codecs, cookies, body parsing) are handled by
 * createBackend, not the handler provider.
 *
 * @example
 * ```typescript
 * const loginHandlerProvider = createApiRouteHandlerProvider(
 *   (deps) =>
 *     createApiRouteHandler({
 *       route: loginRoute,
 *       handler: async (args, ctx) => {
 *         const user = await getOrCreateUser(deps.redis, args.body.username);
 *         return {
 *           result: SerializableResult.toOk({ user }, 200),
 *           context: { session: { userId: user.id } },
 *         };
 *       },
 *     }),
 * );
 *
 * // Use with backend
 * const backend = createBackend({
 *   apiHandlers: {
 *     login: loginHandlerProvider(deps),
 *   },
 * });
 * ```
 */
export function createApiRouteHandlerProvider<
  H extends AnyApiRouteHandler,
  TDeps,
>(
  handlerFactory: ApiHandlerFactory<H, TDeps>,
): (deps: TDeps) => ApiHandlerProviderResult<H> {
  return (deps: TDeps): ApiHandlerProviderResult<H> => {
    return handlerFactory(deps);
  };
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract route from a handler provider result
 */
export type ProviderRoute<H> = H extends AnyApiRouteHandler
  ? ApiHandlerRoute<H>
  : never;
