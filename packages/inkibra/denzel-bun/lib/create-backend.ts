/**
 * Backend - Unified handler collection for HTTP + internal calls
 *
 * Aggregates handler providers into a backend that provides:
 * - fetch() for HTTP request handling (Bun.serve)
 * - apiHandlers with typed execute() methods for direct calls
 * - streamHandlers for EventStream routes
 *
 * HTTP concerns (context codecs, body parsing, cookies) are handled here,
 * not in handler providers.
 */

import { Logger, type LogLevelLiterals } from '@inkibra/logger';
import {
  type AnyApiRoute,
  type AnyApiRouteHandler,
  type AnyContextCodec,
  type AnyEventStreamHandler,
  type AnyEventStreamRoute,
  CONTEXT_DECODE_WARNINGS_SYMBOL,
  type ContextDecodeWarning,
  type EventStreamChannelFactory,
  type EventStreamEventTypes,
  type EventStreamRouteArgs,
  type EventStreamYieldedEvent,
  formatEventStreamEvent,
  type Result,
  type RouteHandlerArgs,
  splitApiHandlerResult,
  type TransactionCycle,
  type TransactionRuntime,
} from '@inkibra/router';
import { decodeQuery } from '@inkibra/router/constants';
import {
  type JwtConfig,
  readContextFromRequest,
  writeContextToResponse,
} from './context-transport';
import { buildRequestContext } from './request-context';
import { runWithTransactionCycle } from './request-transaction';
import { createErrorResponse, createResponseContext } from './response-context';

// ============================================================================
// Types
// ============================================================================

/**
 * Compile-time assertion helper that validates a handler map's keys match route names.
 *
 * - Returns `unknown` when valid (so it doesn't affect the original type)
 * - Returns `never` when invalid, causing the containing type to error
 */
type AssertHandlerNamesMatch<
  T extends Record<string, { route: { name: string } }>,
> = string extends keyof T
  ? unknown
  : T extends { [K in keyof T]: { route: { name: K } } }
    ? unknown
    : never;

/**
 * Stream handler name assertion (uses .route.name like API handlers)
 */
type AssertStreamHandlerNamesMatch<
  T extends Record<string, { route: { name: string } }>,
> = string extends keyof T
  ? unknown
  : T extends { [K in keyof T]: { route: { name: K } } }
    ? unknown
    : never;

/**
 * Backend configuration
 *
 * IMPORTANT: Use explicit keys, NOT spread, to preserve type information:
 *
 * ✅ Good:
 * ```typescript
 * apiHandlers: {
 *   login: loginHandlerProvider(deps),
 *   logout: logoutHandlerProvider(deps),
 * }
 * ```
 *
 * ❌ Bad (loses type info):
 * ```typescript
 * apiHandlers: {
 *   ...loginHandlerProvider(deps),
 *   ...logoutHandlerProvider(deps),
 * }
 * ```
 */
export type BackendConfig<
  TApiHandlers extends Record<string, AnyApiRouteHandler>,
  TStreamHandlers extends Record<string, AnyEventStreamHandler> = Record<
    string,
    never
  >,
> = {
  /** Optional backend name (used for logger name/bindings) */
  name?: string;
  /** Optional logger (if omitted, a default logger is created) */
  logger?: Logger;
  /** Log level for the default logger (ignored when logger is provided) */
  logLevel?: LogLevelLiterals;
  /** API handlers - use explicit keys (route name as key) */
  apiHandlers: TApiHandlers;
  /** EventStream handlers - use explicit keys (handler name as key) */
  streamHandlers?: TStreamHandlers;
  /** Channel factory for EventStream routes */
  channelFactory?: EventStreamChannelFactory;
  /**
   * JWT config for secure: 'signed' context codecs.
   * Required if any route uses a codec with secure: 'signed'.
   */
  jwtConfig?: JwtConfig;
  /**
   * Optional transaction runtime for request-scoped DB transactions.
   *
   * When provided, each API request opens a transaction cycle in 'http' mode:
   * - Handler receives tx-bound driver and effects via handlerContext.__txCycle
   * - On success: transaction commits, then staged effects flush
   * - On error: transaction rolls back, effects are discarded
   *
   * See command-computer-spec §24.5a.
   */
  transactionRuntime?: TransactionRuntime;
} & AssertHandlerNamesMatch<TApiHandlers> &
  AssertStreamHandlerNamesMatch<TStreamHandlers>;

/**
 * Backend instance - preserves literal keys from handler types
 */
export type Backend<
  TApiHandlers extends Record<string, AnyApiRouteHandler>,
  TStreamHandlers extends Record<string, AnyEventStreamHandler> = Record<
    string,
    never
  >,
> = {
  /**
   * Type marker for AnyBackend compatibility
   * @internal
   */
  readonly __brand: 'Backend';
  /**
   * HTTP request handler - for Bun.serve
   *
   * Matches the request path against registered handlers and executes.
   */
  fetch: (request: Request) => Promise<Response>;

  /**
   * Typed API handlers - use .execute(args, ctx) for direct calls
   */
  apiHandlers: TApiHandlers;

  /**
   * Typed stream handlers
   */
  streamHandlers: TStreamHandlers;

  /**
   * List of registered API handler names
   */
  apiHandlerNames: (keyof TApiHandlers & string)[];

  /**
   * List of registered stream handler names
   */
  streamHandlerNames: (keyof TStreamHandlers & string)[];
};

/**
 * Any backend - for use when specific handler types don't matter
 * (e.g., in createRouter where we just need fetch())
 */
export type AnyBackend = {
  readonly __brand: 'Backend';
  fetch: (request: Request) => Promise<Response>;
  apiHandlers: Record<string, AnyApiRouteHandler>;
  streamHandlers: Record<string, AnyEventStreamHandler>;
  apiHandlerNames: string[];
  streamHandlerNames: string[];
};

/**
 * Registered EventStream handler - for external APIs
 * (Internal implementation uses InternalEventStreamHttpHandler)
 */
export type RegisteredEventStreamHandler = {
  /** Route name */
  name: string;
  /** Route path */
  path: string;
  /** URLPattern for matching */
  urlPattern: URLPattern;
  /** Handle an HTTP request */
  handle: (
    request: Request,
    pathParams: Record<string, string>,
    channelFactory?: EventStreamChannelFactory,
  ) => Promise<Response>;
};

/**
 * Internal HTTP wrapper - created by backend for each API handler
 */
type InternalHttpHandler = {
  route: AnyApiRoute;
  urlPattern: URLPattern;
  handle: (
    request: Request,
    pathParams: Record<string, string>,
  ) => Promise<Response>;
};

/**
 * Internal HTTP wrapper - created by backend for each EventStream handler
 */
type InternalEventStreamHttpHandler = {
  route: AnyEventStreamRoute;
  urlPattern: URLPattern;
  handle: (
    request: Request,
    pathParams: Record<string, string>,
    channelFactory?: EventStreamChannelFactory,
  ) => Promise<Response>;
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create internal HTTP wrapper for a handler
 *
 * Handles all HTTP concerns:
 * - Context codec reading from cookies/headers
 * - Body parsing (JSON/FormData)
 * - Context codec writing to cookies
 * - Response generation
 */
function createHttpWrapper(
  handler: AnyApiRouteHandler,
  logger: Logger,
  jwtConfig?: JwtConfig,
  transactionRuntime?: TransactionRuntime,
): InternalHttpHandler {
  const route = handler.route;
  const urlPattern = new URLPattern({ pathname: route.path });
  const routeLogger = logger.child({
    component: 'api',
    route: route.name,
    method: route.method,
    path: route.path,
  });

  // Collect all codecs from route
  const allCodecs: Record<string, AnyContextCodec> = {
    ...(route.contextCodec ?? {}),
    ...(route.createsContextCodec ?? {}),
  };

  return {
    route,
    urlPattern,

    handle: async (
      request: Request,
      pathParams: Record<string, string>,
    ): Promise<Response> => {
      const requestContext = buildRequestContext(request, pathParams);
      const responseContext = createResponseContext();

      // Build handler context from decoded codecs
      const handlerContext: Record<string, unknown> = {};
      const decodeWarningsByCodec: Record<string, ContextDecodeWarning[]> = {};

      // Read context from request using route's codecs
      if (route.contextCodec) {
        for (const [key, codec] of Object.entries(
          route.contextCodec as Record<string, AnyContextCodec>,
        )) {
          const readResult = await readContextFromRequest(
            requestContext,
            codec,
            jwtConfig,
          );

          if (!readResult.success) {
            if (readResult.error !== 'not_found') {
              routeLogger.warn('Context decode error', {
                contextKey: key,
                codec: codec.name,
                error: readResult.error,
                ...(readResult.error === 'parse_error'
                  ? { message: readResult.message }
                  : {}),
                ...(readResult.error === 'validation_error'
                  ? { errors: readResult.errors }
                  : {}),
                requestId: request.headers.get('X-Request-ID') ?? undefined,
              });
            }

            const decodeWarning: ContextDecodeWarning =
              readResult.error === 'not_found'
                ? { type: 'ContextNotFound' }
                : readResult.error === 'parse_error'
                  ? { type: 'ContextParseError', message: readResult.message }
                  : {
                      type: 'ContextValidationError',
                      errors: readResult.errors,
                    };

            decodeWarningsByCodec[key] = [decodeWarning];
            handlerContext[key] = codec.defaultValue;
          } else {
            handlerContext[key] = readResult.value;
          }
        }
      }

      (handlerContext as Record<PropertyKey, unknown>)[
        CONTEXT_DECODE_WARNINGS_SYMBOL
      ] = decodeWarningsByCodec;

      // Parse body
      let body: unknown;
      let files: Record<string, File | File[]> | undefined;

      if (route.method !== 'GET' && route.method !== 'HEAD') {
        const contentType = request.headers.get('Content-Type') ?? '';

        if (route.hasFileInput && contentType.includes('multipart/form-data')) {
          try {
            const formData = await request.formData();
            files = {};

            if (route.fileInput) {
              for (const fieldName of Object.keys(route.fileInput)) {
                const fileData = formData.getAll(fieldName);
                if (fileData.length === 1) {
                  files[fieldName] = fileData[0] as File;
                } else if (fileData.length > 1) {
                  files[fieldName] = fileData as File[];
                }
              }
            }

            const bodyField = formData.get('__body__');
            if (bodyField && typeof bodyField === 'string') {
              body = JSON.parse(bodyField);
            }
          } catch (parseError) {
            routeLogger.warn('Failed to parse multipart form data', {
              requestId: request.headers.get('X-Request-ID') ?? undefined,
              err: parseError,
            });
            return createErrorResponse('Failed to parse form data', 400, {
              cause:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
            });
          }
        } else if (contentType.includes('application/json')) {
          try {
            const text = await request.text();
            if (text) {
              body = JSON.parse(text);
            }
          } catch (parseError) {
            routeLogger.warn('Failed to parse JSON body', {
              requestId: request.headers.get('X-Request-ID') ?? undefined,
              err: parseError,
            });
            return createErrorResponse('Failed to parse JSON body', 400, {
              cause:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
            });
          }
        }
      }

      const url = new URL(request.url);
      const pathQuery = decodeQuery(Object.fromEntries(url.searchParams));

      const args = {
        pathParams,
        pathQuery,
        body,
        files,
      } as RouteHandlerArgs<AnyApiRoute>;

      // Execute handler (optionally within a transaction cycle)
      let handlerResult: unknown;
      let txCycle: TransactionCycle | undefined;

      try {
        if (transactionRuntime) {
          txCycle = await transactionRuntime.begin({ mode: 'http' });

          // Run handler within AsyncLocalStorage scope so
          // getRequestTransactionCycle() returns the cycle
          handlerResult = await runWithTransactionCycle(txCycle, () =>
            handler.execute(args, handlerContext),
          );

          // Commit on success (flushes staged effects)
          await txCycle.commit();
        } else {
          handlerResult = await handler.execute(args, handlerContext);
        }
      } catch (handlerError) {
        // Rollback transaction on error (discards staged effects)
        if (txCycle) {
          try {
            await txCycle.rollback();
          } catch (rollbackError) {
            routeLogger.warn('Transaction rollback failed', {
              err: rollbackError,
            });
          }
        }

        routeLogger.error('API handler threw', {
          requestId: request.headers.get('X-Request-ID') ?? undefined,
          err: handlerError,
        });
        return createErrorResponse(
          'Internal server error',
          500,
          process.env.NODE_ENV === 'development'
            ? {
                cause:
                  handlerError instanceof Error
                    ? handlerError.message
                    : String(handlerError),
              }
            : undefined,
        );
      }

      // Extract result and optional created context from handler response.
      const { result, context: createdContext } =
        splitApiHandlerResult(handlerResult);

      // Write context to response using route's codecs
      for (const [key, codec] of Object.entries(allCodecs)) {
        const valueToWrite = createdContext?.[key] ?? handlerContext[key];

        if (valueToWrite !== undefined) {
          await writeContextToResponse(
            responseContext,
            codec,
            valueToWrite,
            jwtConfig,
          );
        }
      }

      return responseContext.toJsonResponse(result, {
        status: (result as { statusCode?: number }).statusCode ?? 200,
      });
    },
  };
}

/**
 * Create internal HTTP wrapper for an EventStream handler
 *
 * Handles all HTTP concerns:
 * - Context codec reading from cookies/headers
 * - SSE response stream creation
 * - Event formatting and streaming
 */
function createEventStreamHttpWrapper(
  handler: AnyEventStreamHandler,
  logger: Logger,
  jwtConfig?: JwtConfig,
): InternalEventStreamHttpHandler {
  const route = handler.route;
  const urlPattern = new URLPattern({ pathname: route.path });
  const routeLogger = logger.child({
    component: 'event-stream',
    route: route.name,
    path: route.path,
  });

  return {
    route,
    urlPattern,

    handle: async (
      request: Request,
      pathParams: Record<string, string>,
      channelFactory?: EventStreamChannelFactory,
    ): Promise<Response> => {
      const requestContext = buildRequestContext(request, pathParams);

      // 1. Read context using route's codecs with scope-based transport
      const ctx: Record<string, unknown> = {};
      const decodeWarningsByCodec: Record<string, ContextDecodeWarning[]> = {};

      if (route.contextCodec) {
        for (const [key, codec] of Object.entries(
          route.contextCodec as Record<string, AnyContextCodec>,
        )) {
          const readResult = await readContextFromRequest(
            requestContext,
            codec,
            jwtConfig,
          );

          if (!readResult.success) {
            if (readResult.error !== 'not_found') {
              routeLogger.warn('Context decode error', {
                contextKey: key,
                codec: codec.name,
                error: readResult.error,
                ...(readResult.error === 'parse_error'
                  ? { message: readResult.message }
                  : {}),
                ...(readResult.error === 'validation_error'
                  ? { errors: readResult.errors }
                  : {}),
                requestId: request.headers.get('X-Request-ID') ?? undefined,
              });
            }

            const decodeWarning: ContextDecodeWarning =
              readResult.error === 'not_found'
                ? { type: 'ContextNotFound' }
                : readResult.error === 'parse_error'
                  ? { type: 'ContextParseError', message: readResult.message }
                  : {
                      type: 'ContextValidationError',
                      errors: readResult.errors,
                    };

            decodeWarningsByCodec[key] = [decodeWarning];
            ctx[key] = codec.defaultValue;
          } else {
            ctx[key] = readResult.value;
          }
        }
      }

      (ctx as Record<PropertyKey, unknown>)[CONTEXT_DECODE_WARNINGS_SYMBOL] =
        decodeWarningsByCodec;

      // 2. Parse query params
      const url = new URL(request.url);
      const pathQuery = decodeQuery(Object.fromEntries(url.searchParams));

      // 3. Build handler args
      const args = {
        pathParams,
        pathQuery,
      } as EventStreamRouteArgs<AnyEventStreamRoute>;

      // 4. Create SSE response stream
      // Matching the old working Express/api-base implementation
      const HEARTBEAT_INTERVAL = 5000; // 5 seconds

      // Track stream state
      let isStreamActive = true;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      // biome-ignore lint/suspicious/noExplicitAny: Required for flexible context typing
      let generator: AsyncGenerator<any, any, unknown> | null = null;

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          // Helper to write and ensure immediate send
          const write = (data: string) => {
            if (!isStreamActive) {
              routeLogger.debug('Attempted write to closed stream');
              return false;
            }
            try {
              controller.enqueue(encoder.encode(data));
              return true;
            } catch (error) {
              routeLogger.error('Write error', { err: error });
              return false;
            }
          };

          // Send initial connection event (actual event, not just comment!)
          // This matches the old api-base EventStream class behavior
          const connectionEvent = formatEventStreamEvent({
            type: 'connection',
            data: { status: 'connected', timestamp: Date.now() },
          });
          routeLogger.debug('Sending connection event');
          write(connectionEvent);

          // Set up heartbeat interval - sends actual events like the old impl
          heartbeatTimer = setInterval(() => {
            if (isStreamActive) {
              const heartbeatEvent = formatEventStreamEvent({
                type: 'heartbeat',
                data: { timestamp: Date.now() },
              });
              routeLogger.trace('Sending heartbeat');
              write(heartbeatEvent);
            }
          }, HEARTBEAT_INTERVAL);

          try {
            // Run the handler generator
            generator = handler.execute(args, ctx, channelFactory);

            routeLogger.debug('Starting handler generator');

            let result = await generator.next();
            routeLogger.debug('First generator.next() returned', {
              done: result.done,
              hasValue: result.value !== undefined,
            });

            while (!result.done && isStreamActive) {
              // Yield events
              const event =
                result.value as EventStreamYieldedEvent<EventStreamEventTypes>;

              // For business events, send WITHOUT event: line so they go to onmessage
              // The event type is embedded in the JSON payload as { event, data }
              // This matches what the client's onmessage handler expects
              const formatted = `data: ${JSON.stringify({
                event: String(event.event),
                data: event.data,
              })}\n\n`;

              routeLogger.trace('Sending business event', {
                eventType: event.event,
              });

              if (!write(formatted)) {
                routeLogger.debug('Write failed, breaking loop');
                break;
              }

              routeLogger.trace('Waiting for next generator value');
              result = await generator.next();
              routeLogger.trace('generator.next() returned', {
                done: result.done,
                hasValue: result.value !== undefined,
              });
            }

            // Generator returned - send completion
            if (result.done) {
              const completionResult = result.value as Result<unknown, unknown>;
              routeLogger.debug('Generator completed', {
                isOk: completionResult?.isOk,
              });

              if (completionResult?.isOk) {
                const completeEvent = formatEventStreamEvent({
                  type: '__complete',
                  data: completionResult,
                });
                write(completeEvent);
              } else if (completionResult) {
                const errorEvent = formatEventStreamEvent({
                  type: '__error',
                  data: completionResult,
                });
                write(errorEvent);
              }
            }
          } catch (error) {
            routeLogger.error('EventStream handler error', { err: error });

            // Send error event
            const errorEvent = formatEventStreamEvent({
              type: '__error',
              data: {
                type: 'Err',
                error: {
                  code: 'HANDLER_ERROR',
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              },
            });
            write(errorEvent);
          } finally {
            routeLogger.debug('Cleaning up');
            isStreamActive = false;
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        },

        cancel(reason) {
          // Client disconnected
          routeLogger.debug('Stream cancelled by client', { reason });
          isStreamActive = false;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          // Try to close the generator gracefully
          if (generator) {
            generator.return(undefined).catch((error) => {
              routeLogger.error('Error closing generator', { err: error });
            });
          }
        },
      });

      // 5. Return SSE response
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no', // Disable nginx buffering
          'Access-Control-Allow-Origin': '*',
        },
      });
    },
  };
}

/**
 * Create a backend from handler providers
 *
 * Returns a typed backend where apiHandlers preserve their execute() method.
 *
 * @example
 * ```typescript
 * const backend = createBackend({
 *   apiHandlers: {
 *     login: loginHandlerProvider(deps),
 *     listBoards: listBoardsHandlerProvider(deps),
 *   },
 *   streamHandlers: {
 *     boardUpdates: boardUpdatesHandler(deps),
 *   },
 *   channelFactory,
 * });
 *
 * // HTTP handling
 * const response = await backend.fetch(request);
 *
 * // Direct calls
 * const result = await backend.apiHandlers.login.execute(args, ctx);
 * ```
 */
export function createBackend<
  TApiHandlers extends Record<string, AnyApiRouteHandler>,
  TStreamHandlers extends Record<string, AnyEventStreamHandler> = Record<
    string,
    never
  >,
>(
  config: BackendConfig<TApiHandlers, TStreamHandlers>,
): Backend<TApiHandlers, TStreamHandlers> {
  const { apiHandlers, channelFactory, jwtConfig, transactionRuntime } = config;
  const streamHandlers = (config.streamHandlers ?? {}) as TStreamHandlers;

  const backendName = config.name ?? 'Backend';
  const logger =
    config.logger?.child({
      component: 'denzel-bun-backend',
      backend: backendName,
    }) ??
    Logger.createLogger(
      backendName,
      {
        component: 'denzel-bun-backend',
        backend: backendName,
      },
      config.logLevel ?? 'warn',
    );

  logger.info('Creating backend', {
    apiHandlerNames: Object.keys(apiHandlers),
    streamHandlerNames: Object.keys(streamHandlers),
  });

  // Create internal HTTP wrappers for API handlers
  const httpWrappers: InternalHttpHandler[] = Object.values(apiHandlers).map(
    (handler) =>
      createHttpWrapper(
        handler as AnyApiRouteHandler,
        logger,
        jwtConfig,
        transactionRuntime,
      ),
  );

  // Create internal HTTP wrappers for EventStream handlers
  const streamWrappers: InternalEventStreamHttpHandler[] = Object.values(
    streamHandlers,
  ).map((handler) =>
    createEventStreamHttpWrapper(
      handler as AnyEventStreamHandler,
      logger,
      jwtConfig,
    ),
  );

  /**
   * Match a request to an API handler
   */
  function matchApiHandler(
    request: Request,
  ): { wrapper: InternalHttpHandler; params: Record<string, string> } | null {
    const url = new URL(request.url);

    for (const wrapper of httpWrappers) {
      // Check method first (fast)
      if (wrapper.route.method !== request.method) continue;

      // Then check path
      const match = wrapper.urlPattern.exec(url.pathname, url.origin);
      if (match) {
        return {
          wrapper,
          params: (match.pathname.groups ?? {}) as Record<string, string>,
        };
      }
    }

    return null;
  }

  /**
   * Match a request to an EventStream handler
   */
  function matchStreamHandler(request: Request): {
    wrapper: InternalEventStreamHttpHandler;
    params: Record<string, string>;
  } | null {
    // EventStream requests are GET with Accept: text/event-stream
    if (request.method !== 'GET') return null;
    const accept = request.headers.get('Accept') ?? '';
    if (!accept.includes('text/event-stream')) return null;

    const url = new URL(request.url);

    for (const wrapper of streamWrappers) {
      const match = wrapper.urlPattern.exec(url.pathname, url.origin);
      if (match) {
        return {
          wrapper,
          params: (match.pathname.groups ?? {}) as Record<string, string>,
        };
      }
    }

    return null;
  }

  return {
    __brand: 'Backend' as const,
    apiHandlerNames: Object.keys(apiHandlers) as (keyof TApiHandlers &
      string)[],
    streamHandlerNames: Object.keys(streamHandlers) as (keyof TStreamHandlers &
      string)[],

    // Original handlers - preserved from input
    apiHandlers,
    streamHandlers: streamHandlers as TStreamHandlers,

    fetch: async (request: Request): Promise<Response> => {
      // Try EventStream handlers first (more specific Accept header)
      const streamMatch = matchStreamHandler(request);
      if (streamMatch) {
        return streamMatch.wrapper.handle(
          request,
          streamMatch.params,
          channelFactory,
        );
      }

      // Try API handlers
      const apiMatch = matchApiHandler(request);
      if (apiMatch) {
        return apiMatch.wrapper.handle(request, apiMatch.params);
      }

      // No match - 404
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

// ============================================================================
// Re-export for convenience
// ============================================================================

export { buildRequestContext };
