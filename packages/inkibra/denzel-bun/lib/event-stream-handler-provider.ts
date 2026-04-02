/**
 * EventStream Handler Provider - Dependency injection wrapper
 *
 * Simple wrapper that takes a handler factory and returns the handler with deps injected.
 * All HTTP concerns (context codecs, SSE streaming) are handled by createBackend.
 */

import type { AnyEventStreamHandler, HandlerRoute } from '@inkibra/router';

// ============================================================================
// Types
// ============================================================================

/**
 * Handler factory - produces a router-level handler when given dependencies
 */
export type EventStreamHandlerFactory<
  H extends AnyEventStreamHandler,
  TDeps,
> = (deps: TDeps) => H;

/**
 * Result of calling a handler provider with deps
 * Returns the handler with route.name preserved for type inference
 */
export type EventStreamHandlerProviderResult<H extends AnyEventStreamHandler> =
  H;

// ============================================================================
// Handler Provider Factory
// ============================================================================

/**
 * Create an EventStream handler provider from a router-level handler factory.
 *
 * This is a simple dependency injection wrapper - it takes a factory function
 * that produces an EventStreamHandler and returns a function that calls it with deps.
 *
 * All HTTP concerns (context codecs, SSE streaming) are handled by
 * createBackend, not the handler provider.
 *
 * @example
 * ```typescript
 * const boardUpdatesHandlerProvider = createEventStreamHandlerProvider(
 *   (deps) =>
 *     createEventStreamHandler({
 *       route: boardUpdatesRoute,
 *       handler: async function* (args, ctx, channelFactory) {
 *         const board = await deps.boardDal.get(args.pathParams.boardId);
 *         if (!board) {
 *           return Err({ type: 'BoardNotFound' });
 *         }
 *
 *         await using channel = channelFactory.get(boardUpdatesRoute, args);
 *         for await (const event of channel) {
 *           yield event;
 *         }
 *
 *         return Ok({ reason: 'disconnected' });
 *       },
 *     }),
 * );
 *
 * // Use with backend
 * const backend = createBackend({
 *   streamHandlers: {
 *     boardUpdates: boardUpdatesHandlerProvider(deps),
 *   },
 * });
 * ```
 */
export function createEventStreamHandlerProvider<
  H extends AnyEventStreamHandler,
  TDeps,
>(
  handlerFactory: EventStreamHandlerFactory<H, TDeps>,
): (deps: TDeps) => EventStreamHandlerProviderResult<H> {
  return (deps: TDeps): EventStreamHandlerProviderResult<H> => {
    return handlerFactory(deps);
  };
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract route from a handler provider result
 */
export type EventStreamProviderRoute<H> = H extends AnyEventStreamHandler
  ? HandlerRoute<H>
  : never;
