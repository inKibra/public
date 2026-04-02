/**
 * API Route Handler - Router-level handler abstraction
 *
 * Execute context remains raw context values for transport/query callers.
 * Handler context is resolved ctxResult per context codec.
 */

import type {
  AnyApiRoute,
  HandlerResult,
  RouteContextResultType,
  RouteContextType,
  RouteCreatesContextCodecMap,
  RouteHandlerArgs,
  RouteResponse,
} from './api-route';
import {
  type AnyContextCodec,
  CONTEXT_DECODE_WARNINGS_SYMBOL,
  type ContextCodec,
  type ContextDecodeWarning,
  resolveContextResult,
} from './context-codec';
import type { StorageScope } from './transport';

// ============================================================================
// Handler Types
// ============================================================================

/**
 * User-authored handler function type.
 */
export type ApiRouteHandlerFunction<R extends AnyApiRoute, THandlerContext> = (
  args: RouteHandlerArgs<R>,
  ctxResult: THandlerContext,
) => Promise<HandlerResult<RouteResponse<R>, RouteCreatesContextCodecMap<R>>>;

/**
 * Handler configuration.
 */
export type ApiRouteHandlerConfig<R extends AnyApiRoute, THandlerContext> = {
  /** The route this handler is for */
  route: R;
  /** The handler function */
  handler: ApiRouteHandlerFunction<R, THandlerContext>;
};

/**
 * Created handler type.
 */
export type ApiRouteHandler<
  R extends AnyApiRoute,
  TExecuteContext,
  THandlerContext,
> = {
  /** The route this handler is for */
  route: R;
  /** Execute the handler with given args and raw execute context */
  execute: (
    args: RouteHandlerArgs<R>,
    ctx: TExecuteContext,
  ) => Promise<HandlerResult<RouteResponse<R>, RouteCreatesContextCodecMap<R>>>;
  /** Phantom type marker for handler-facing context result */
  readonly _handlerContextType?: THandlerContext;
};

export type ApiHandlerResultEnvelope<T> = {
  result: T;
  context?: Record<string, unknown>;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasApiHandlerResultEnvelope<T>(
  value: unknown,
): value is ApiHandlerResultEnvelope<T> {
  // Check for both 'result' and 'context' keys to distinguish envelopes
  // from plain objects that coincidentally have a 'result' property.
  return (
    isObjectRecord(value) &&
    'result' in value &&
    ('context' in value || Object.keys(value).length === 1)
  );
}

export function splitApiHandlerResult<T>(
  value: ApiHandlerResultEnvelope<T> | T,
): ApiHandlerResultEnvelope<T> {
  if (hasApiHandlerResultEnvelope<T>(value)) {
    return value;
  }

  return {
    result: value,
  };
}

export function unwrapApiHandlerResult<T>(
  value: ApiHandlerResultEnvelope<T> | T,
): T {
  return splitApiHandlerResult(value).result;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create an API route handler.
 */
export function createApiRouteHandler<
  R extends AnyApiRoute,
  TExecuteContext = RouteContextType<R>,
  THandlerContext = RouteContextResultType<R>,
>(
  config: ApiRouteHandlerConfig<R, THandlerContext>,
): ApiRouteHandler<R, TExecuteContext, THandlerContext> {
  return {
    route: config.route,
    execute: async (args, ctx) => {
      const routeContextCodec = config.route.contextCodec as
        | Record<string, AnyContextCodec>
        | undefined;

      if (!routeContextCodec) {
        return config.handler(args, {} as THandlerContext);
      }

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

      const ctxResult = Object.fromEntries(ctxResultEntries) as THandlerContext;
      return config.handler(args, ctxResult);
    },
  };
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Any API route handler (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic route constraints
export type AnyApiRouteHandler = ApiRouteHandler<AnyApiRoute, any, any>;

/**
 * Extract route type from an API handler
 */
export type ApiHandlerRoute<H> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for generic route constraints
  H extends ApiRouteHandler<infer R, any, any> ? R : never;

/**
 * Extract handler-facing context type from an API handler
 */
export type ApiHandlerContext<H> = H extends ApiRouteHandler<
  AnyApiRoute,
  unknown,
  infer C
>
  ? C
  : never;
