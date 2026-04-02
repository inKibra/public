/**
 * EventStream Handler - Router-level handler abstraction
 *
 * Execute context remains raw context values for transport/query callers.
 * Handler context is resolved ctxResult per context codec.
 */

import {
  type AnyContextCodec,
  CONTEXT_DECODE_WARNINGS_SYMBOL,
  type ContextCodec,
  type ContextDecodeWarning,
  resolveContextResult,
} from './context-codec';
import type { EventStreamChannelFactory } from './event-stream-channel';
import type {
  AnyEventStreamRoute,
  EventStreamRouteArgs,
  EventStreamRouteCompletion,
  EventStreamRouteContextResultType,
  EventStreamRouteContextType,
  EventStreamRouteEventTypes,
  EventStreamYieldedEvent,
} from './event-stream-route';
import type { StorageScope } from './transport';

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Handler generator function type.
 */
export type EventStreamHandlerFunction<
  R extends AnyEventStreamRoute,
  THandlerContext,
> = (
  args: EventStreamRouteArgs<R>,
  ctxResult: THandlerContext,
  channelFactory?: EventStreamChannelFactory,
) => AsyncGenerator<
  EventStreamYieldedEvent<EventStreamRouteEventTypes<R>>,
  EventStreamRouteCompletion<R>,
  unknown
>;

/**
 * Handler configuration.
 */
export type EventStreamHandlerConfig<
  R extends AnyEventStreamRoute,
  THandlerContext,
> = {
  /** The route this handler is for */
  route: R;
  /** The handler generator function */
  handler: EventStreamHandlerFunction<R, THandlerContext>;
};

/**
 * Created handler type.
 */
export type EventStreamHandler<
  R extends AnyEventStreamRoute,
  TExecuteContext,
  THandlerContext,
> = {
  /** The route this handler is for */
  route: R;
  /** Execute the handler with given args and raw execute context */
  execute: (
    args: EventStreamRouteArgs<R>,
    ctx: TExecuteContext,
    channelFactory?: EventStreamChannelFactory,
  ) => AsyncGenerator<
    EventStreamYieldedEvent<EventStreamRouteEventTypes<R>>,
    EventStreamRouteCompletion<R>,
    unknown
  >;
  /** Phantom type marker for handler-facing context result */
  readonly _handlerContextType?: THandlerContext;
};

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create an EventStream handler.
 */
export function createEventStreamHandler<
  R extends AnyEventStreamRoute,
  TExecuteContext = EventStreamRouteContextType<R>,
  THandlerContext = EventStreamRouteContextResultType<R>,
>(
  config: EventStreamHandlerConfig<R, THandlerContext>,
): EventStreamHandler<R, TExecuteContext, THandlerContext> {
  return {
    route: config.route,
    execute: async function* (args, ctx, channelFactory) {
      const routeContextCodec = config.route.contextCodec as
        | Record<string, AnyContextCodec>
        | undefined;

      let ctxResult = {} as THandlerContext;

      if (routeContextCodec) {
        const rawCtx = (ctx ?? {}) as Record<string, unknown>;
        const decodeWarningsByCodec = (
          ctx as
            | {
                [CONTEXT_DECODE_WARNINGS_SYMBOL]?: Record<
                  string,
                  readonly ContextDecodeWarning[]
                >;
              }
            | undefined
        )?.[CONTEXT_DECODE_WARNINGS_SYMBOL];

        const ctxResultEntries = await Promise.all(
          Object.entries(routeContextCodec).map(async ([key, codec]) => {
            const result = await resolveContextResult(
              codec as ContextCodec<
                string,
                StorageScope,
                unknown,
                unknown,
                unknown
              >,
              {
                value: rawCtx[key],
                decodeWarnings: decodeWarningsByCodec?.[key],
              },
            );
            return [key, result] as const;
          }),
        );

        ctxResult = Object.fromEntries(ctxResultEntries) as THandlerContext;
      }

      return yield* config.handler(args, ctxResult, channelFactory);
    },
  };
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Any EventStream handler (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic route constraints
export type AnyEventStreamHandler = EventStreamHandler<
  AnyEventStreamRoute,
  any,
  any
>;

/**
 * Extract route type from a handler
 */
export type HandlerRoute<H> = H extends EventStreamHandler<
  infer R,
  unknown,
  unknown
>
  ? R
  : never;

/**
 * Extract handler-facing context type from a handler
 */
export type HandlerContext<H> = H extends EventStreamHandler<
  AnyEventStreamRoute,
  unknown,
  infer C
>
  ? C
  : never;
