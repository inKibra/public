import {
  type ApiRoute,
  decodeQuery,
  EventStream,
  type HandlerFunctionForRoute,
  type HandlerObjectForRoute,
  type RouteNamedTypes,
  SerializableResult,
  type SseHandlerGeneratorFunction,
  type SseHandlerObject,
  type SseRoute,
  type SseRouteNamedTypes,
  StatusCode,
} from '@inkibra/api-base';
import { ErrorDescriptor } from '@inkibra/error-base';
import type { Logger } from '@inkibra/logger';
import { Brand } from '@inkibra/observable-cache';
import type { RequestHandler, Response, Router } from 'express';
import type { Result } from 'neverthrow';
import type {
  INTERNAL_SERVER_ERROR_DESCRIPTOR,
  REQUEST_VALIDATION_ERROR_DESCRIPTOR,
  RESPONSE_VALIDATION_ERROR_DESCRIPTOR,
  UNCAUGHT_SERVER_ERROR_DESCRIPTOR,
} from './error-descriptors';
import { fromAnyError } from './error-utils';
import {
  getBodyFromMulterFiles,
  type ParsedFiles,
  parseMulterFilesToTypedFormData,
} from './parse-files';
import { guardAsyncMiddleware, type TRequest } from './safe-express';
import { StreamResponseAdapter } from './stream-response';

const ensureDefined = <T>(value: T, context: string): NonNullable<T> => {
  if (value === undefined) {
    throw ErrorDescriptor.create<INTERNAL_SERVER_ERROR_DESCRIPTOR>(
      'INTERNAL_SERVER_ERROR',
      `Internal server error: ${context}`,
      { context },
    );
  }
  return value as NonNullable<T>;
};

export type ContextDataBase = {
  logger: Logger;
};

export type ContextErrorBase = SerializableResult.ErrWithStatusCode<
  ErrorDescriptor<string, string, unknown>,
  StatusCode
>;

export interface ContextHandler<
  ContextData,
  ContextError extends ContextErrorBase,
> {
  (
    logger: Logger,
    req: TRequest,
    res: Response,
  ): Promise<Result<ContextData, ContextError>>;
}

export class Context<
  ContextData extends ContextDataBase,
  ContextError extends ContextErrorBase,
> {
  public readonly cloudProjectName: string;
  public readonly contextName: string;
  public readonly router: Router;
  public readonly logger: Logger;
  public readonly middlewares: RequestHandler[];
  public readonly handler: ContextHandler<ContextData, ContextError>;

  public constructor(
    logger: Logger,
    cloudProjectName: string,
    contextName: string,
    router: Router,
    middlewares: RequestHandler[],
    handler: ContextHandler<ContextData, ContextError>,
  ) {
    this.logger = logger;
    this.logger.trace('Creating new context');
    this.cloudProjectName = cloudProjectName;
    this.contextName = contextName;
    this.router = router;
    this.middlewares = middlewares;
    this.handler = handler;
  }
  public attachAPIRouteHandlerWithMiddlewares<
    Path extends string,
    RouteTypes extends RouteNamedTypes<Path>,
  >(
    route: ApiRoute<Path, RouteTypes, ContextError>,
    additionalMiddlewares: RequestHandler[],
    contextRequestHandler: HandlerObjectForRoute<Path, RouteTypes, ContextData>,
  ): HandlerObjectForRoute<Path, RouteTypes, ContextData> {
    this.logger.trace('Attaching route with middlewares');
    this.router[route.method](
      route.path,
      ...this.middlewares
        .concat(additionalMiddlewares)
        .map((middleware) => guardAsyncMiddleware(this.logger, middleware)),
      async (req: TRequest, res: Response) => {
        const requestId = req.headers['X-Inkibra-Request-ID']
          ? req.headers['X-Inkibra-Request-ID'].toString().replaceAll('-', '')
          : Brand.createId2('request').replaceAll('-', '');
        const trace = `projects/${this.cloudProjectName}/traces/${requestId}`;
        const contextRoutingLogger = this.logger.child({
          component: `${route.name}-context`,
          contextName: this.contextName,
          routeName: route.name,
          routePath: route.path,
          'logging.googleapis.com/trace': trace,
          'logging.googleapis.com/trace_sampled': true,
          trace: trace,
        });
        try {
          // TODO: we should pass the logger to the context handler so that we may set it up with routeName, routePath, context name, etc
          const ctxResult = await this.handler(contextRoutingLogger, req, res);
          if (ctxResult.isErr()) {
            const serializableError = SerializableResult.toErr(
              ensureDefined(
                ctxResult.error,
                `${route.name}-context-handler-error`,
              ),
              StatusCode.INTERNAL_SERVER_ERROR,
            );
            res.setHeader('X-Request-ID', requestId);
            res
              .status(serializableError.statusCode)
              .type('json')
              .send(serializableError);
            return;
          }

          const { params, body, files, query } = req as TRequest & {
            files: ParsedFiles<RouteTypes['FileInputDescriptionType']>;
          };
          const decodedQuery = decodeQuery(query);
          const pathParamsValidationResult = route.validatePathParams(params);
          const pathQueryValidationResult =
            route.pathQueryValidator(decodedQuery);
          ctxResult.value.logger.info('validating body for route from ', {
            files: files === undefined ? 'no files' : 'files',
            body: body === undefined ? 'no body' : 'body',
          });
          const bodyValidationResult = route.validateBody(
            files === undefined ? body : await getBodyFromMulterFiles(files),
          );
          // TODO: validate the manifest of the typed form data

          if (
            pathParamsValidationResult.success &&
            pathQueryValidationResult.success &&
            bodyValidationResult.success
          ) {
            ctxResult.value.logger.info('Handling Denzel Request', {
              routeName: route.name,
              routePath: route.path,
              pathParams: params,
              pathQuery: query,
              pathQueryDecoded: decodedQuery,
              hasBody: body !== undefined,
              hasFiles: files !== undefined,
              ip: req.ip,
              ips: req.ips,
              req,
            });
            const args = {
              pathParams: pathParamsValidationResult.data,
              pathQuery: pathQueryValidationResult.data,
              body: bodyValidationResult.data,
              files: parseMulterFilesToTypedFormData(
                files,
                route.fileInputDescription,
              ),
            };
            try {
              const ret = await contextRequestHandler.fn(args, ctxResult.value);
              const responseValidationResult = route.validateResponse(ret);

              if (responseValidationResult.success) {
                res.setHeader('X-Request-ID', requestId);
                res
                  .type('json')
                  .status(responseValidationResult.data.statusCode)
                  .send(responseValidationResult.data);
                ctxResult.value.logger.info('Responding to Denzel Request', {
                  statusCode: responseValidationResult.data.statusCode,
                  routeName: route.name,
                  routePath: route.path,
                  ip: req.ip,
                  ips: req.ips,
                  req,
                  res,
                });
                return;
              }
              const error =
                ErrorDescriptor.create<RESPONSE_VALIDATION_ERROR_DESCRIPTOR>(
                  'RESPONSE_VALIDATION_ERROR',
                  `Response validation error: ${route.name} ${JSON.stringify(
                    responseValidationResult.errors,
                    null,
                    4,
                  )}`,
                  {
                    route: route.name,
                    output: ret,
                    errors: responseValidationResult.errors,
                  },
                );
              const serializableError = SerializableResult.toErr(
                ensureDefined(error, `${route.name}-response-validation-error`),
                StatusCode.INTERNAL_SERVER_ERROR,
              );
              res
                .status(serializableError.statusCode)
                .type('json')
                .send(serializableError);
              ctxResult.value.logger.warn(
                'Responding to Denzel Request (Response Validation Error)',
                {
                  statusCode: StatusCode.INTERNAL_SERVER_ERROR,
                  error: serializableError,
                  routeName: route.name,
                  routePath: route.path,
                  ip: req.ip,
                  ips: req.ips,
                  req,
                  res,
                },
              );
              return;
            } catch (handlerError) {
              ctxResult.value.logger.error(
                'Uncaught Error Handling Context Request',
                handlerError,
              );
              throw handlerError;
            }
          }
          const error =
            ErrorDescriptor.create<REQUEST_VALIDATION_ERROR_DESCRIPTOR>(
              'REQUEST_VALIDATION_ERROR',
              `Request validation error: ${route.name}`,
              {
                route: route.name,
                input: {
                  pathParams: params,
                  pathQuery: query,
                  pathQueryDecoded: decodedQuery,
                  body,
                },
                pathParamsValidationResult,
                pathQueryValidationResult,
                bodyValidationResult,
              },
            );
          const serializableError = SerializableResult.toErr(
            ensureDefined(error, `${route.name}-request-validation-error`),
            StatusCode.BAD_REQUEST,
          );
          res.setHeader('X-Request-ID', requestId);
          res
            .type('json')
            .status(serializableError.statusCode)
            .send(serializableError);
          return ctxResult.value.logger.warn(
            'Responding to Denzel Request (Request Validation Error)',
            {
              statusCode: StatusCode.BAD_REQUEST,
              error: serializableError,
              routeName: route.name,
              routePath: route.path,
              ip: req.ip,
              ips: req.ips,
              req,
              res,
            },
          );
        } catch (error) {
          // TODO: better way to return errors in development but not in production with details
          const safeError = fromAnyError(error);
          const safeErrorWithCode =
            ErrorDescriptor.create<UNCAUGHT_SERVER_ERROR_DESCRIPTOR>(
              'UNCAUGHT_SERVER_ERROR',
              `Uncaught server error: ${route.name} ${safeError.message}`,
              { route: route.name, error: safeError },
            );
          const serializableCaughtError = SerializableResult.toErr(
            ensureDefined(
              safeErrorWithCode,
              `${route.name}-uncaught-server-error`,
            ),
            StatusCode.INTERNAL_SERVER_ERROR,
          );
          contextRoutingLogger.error('Uncaught Error Handling Denzel Request', {
            error,
            req,
            res,
            routeName: route.name,
            routePath: route.path,
            ip: req.ip,
            ips: req.ips,
          });
          res.setHeader('X-Request-ID', requestId);
          res
            .status(serializableCaughtError.statusCode)
            .type('json')
            .send(serializableCaughtError);
          return;
        }
      },
    );
    return contextRequestHandler;
  }

  public attachAPIRouteHandlerWithMiddlewaresV2<
    Path extends string,
    RouteTypes extends RouteNamedTypes<Path>,
  >(
    route: ApiRoute<Path, RouteTypes, ContextError>,
    additionalMiddlewares: RequestHandler[],
    contextRequestHandler: HandlerFunctionForRoute<
      Path,
      RouteTypes,
      ContextData
    >,
  ): {
    [K in RouteTypes['Name']]: HandlerObjectForRoute<
      Path,
      RouteTypes,
      ContextData
    >;
  } {
    this.logger.trace('Attaching route with middlewares');
    this.router[route.method](
      route.path,
      ...this.middlewares
        .concat(additionalMiddlewares)
        .map((middleware) => guardAsyncMiddleware(this.logger, middleware)),
      async (req: TRequest, res: Response) => {
        const requestId = req.headers['X-Inkibra-Request-ID']
          ? req.headers['X-Inkibra-Request-ID'].toString().replaceAll('-', '')
          : Brand.createId2('request').replaceAll('-', '');
        const trace = `projects/${this.cloudProjectName}/traces/${requestId}`;
        const contextRoutingLogger = this.logger.child({
          component: `${route.name}-context`,
          contextName: this.contextName,
          routeName: route.name,
          routePath: route.path,
          'logging.googleapis.com/trace': trace,
          'logging.googleapis.com/trace_sampled': true,
          trace: trace,
        });
        try {
          // TODO: we should pass the logger to the context handler so that we may set it up with routeName, routePath, context name, etc
          const ctxResult = await this.handler(contextRoutingLogger, req, res);
          if (ctxResult.isErr()) {
            const serializableError = SerializableResult.toErr(
              ensureDefined(
                ctxResult.error,
                `${route.name}-context-handler-error-v2`,
              ),
              StatusCode.INTERNAL_SERVER_ERROR,
            );
            res
              .status(serializableError.statusCode)
              .type('json')
              .send(serializableError);
            return;
          }

          const { params, body, files, query } = req as TRequest & {
            files: ParsedFiles<RouteTypes['FileInputDescriptionType']>;
          };
          const decodedQuery = decodeQuery(query);
          const pathParamsValidationResult = route.validatePathParams(params);
          const pathQueryValidationResult =
            route.pathQueryValidator(decodedQuery);
          ctxResult.value.logger.info('validating body for route from ', {
            files: files === undefined ? 'no files' : 'files',
            body: body === undefined ? 'no body' : 'body',
          });
          const bodyValidationResult = route.validateBody(
            files === undefined ? body : await getBodyFromMulterFiles(files),
          );
          // TODO: validate the manifest of the typed form data

          if (
            pathParamsValidationResult.success &&
            pathQueryValidationResult.success &&
            bodyValidationResult.success
          ) {
            ctxResult.value.logger.info('Handling Denzel Request', {
              routeName: route.name,
              routePath: route.path,
              pathParams: params,
              pathQuery: query,
              pathQueryDecoded: decodedQuery,
              hasBody: body !== undefined,
              hasFiles: files !== undefined,
              ip: req.ip,
              ips: req.ips,
              req,
            });
            const args = {
              pathParams: pathParamsValidationResult.data,
              pathQuery: pathQueryValidationResult.data,
              body: bodyValidationResult.data,
              files: parseMulterFilesToTypedFormData(
                files,
                route.fileInputDescription,
              ),
            };
            try {
              const ret = await contextRequestHandler(args, ctxResult.value);
              const responseValidationResult = route.validateResponse(ret);

              if (responseValidationResult.success) {
                res.setHeader('X-Request-ID', requestId);
                res
                  .type('json')
                  .status(responseValidationResult.data.statusCode)
                  .send(responseValidationResult.data);
                ctxResult.value.logger.info('Responding to Denzel Request', {
                  statusCode: responseValidationResult.data.statusCode,
                  routeName: route.name,
                  routePath: route.path,
                  ip: req.ip,
                  ips: req.ips,
                  req,
                  res,
                });
                return;
              }
              const error =
                ErrorDescriptor.create<RESPONSE_VALIDATION_ERROR_DESCRIPTOR>(
                  'RESPONSE_VALIDATION_ERROR',
                  `Response validation error: ${route.name} ${JSON.stringify(
                    responseValidationResult.errors,
                    null,
                    4,
                  )}`,
                  {
                    route: route.name,
                    output: ret,
                    errors: responseValidationResult.errors,
                  },
                );
              const serializableError = SerializableResult.toErr(
                ensureDefined(
                  error,
                  `${route.name}-response-validation-error-v2`,
                ),
                StatusCode.INTERNAL_SERVER_ERROR,
              );
              res
                .status(serializableError.statusCode)
                .type('json')
                .send(serializableError);
              ctxResult.value.logger.warn(
                'Responding to Denzel Request (Response Validation Error)',
                {
                  statusCode: StatusCode.INTERNAL_SERVER_ERROR,
                  error: serializableError,
                  routeName: route.name,
                  routePath: route.path,
                  ip: req.ip,
                  ips: req.ips,
                  req,
                  res,
                },
              );
              return;
            } catch (handlerError) {
              ctxResult.value.logger.error(
                'Uncaught Error Handling Context Request',
                handlerError,
              );
              throw handlerError;
            }
          }
          const error =
            ErrorDescriptor.create<REQUEST_VALIDATION_ERROR_DESCRIPTOR>(
              'REQUEST_VALIDATION_ERROR',
              `Request validation error: ${route.name}`,
              {
                route: route.name,
                input: {
                  pathParams: params,
                  pathQuery: query,
                  pathQueryDecoded: decodedQuery,
                  body,
                },
                pathParamsValidationResult,
                pathQueryValidationResult,
                bodyValidationResult,
              },
            );
          const serializableError = SerializableResult.toErr(
            ensureDefined(error, `${route.name}-request-validation-error-v2`),
            StatusCode.BAD_REQUEST,
          );
          res.setHeader('X-Request-ID', requestId);
          res
            .type('json')
            .status(serializableError.statusCode)
            .send(serializableError);
          return ctxResult.value.logger.warn(
            'Responding to Denzel Request (Request Validation Error)',
            {
              statusCode: StatusCode.BAD_REQUEST,
              error: serializableError,
              routeName: route.name,
              routePath: route.path,
              ip: req.ip,
              ips: req.ips,
              req,
              res,
            },
          );
        } catch (error) {
          // TODO: better way to return errors in development but not in production with details
          const safeError = fromAnyError(error);
          const safeErrorWithCode =
            ErrorDescriptor.create<UNCAUGHT_SERVER_ERROR_DESCRIPTOR>(
              'UNCAUGHT_SERVER_ERROR',
              `Uncaught server error: ${route.name} ${safeError.message}`,
              { route: route.name, error: safeError },
            );
          const serializableCaughtError = SerializableResult.toErr(
            ensureDefined(
              safeErrorWithCode,
              `${route.name}-uncaught-server-error-v2`,
            ),
            StatusCode.INTERNAL_SERVER_ERROR,
          );
          contextRoutingLogger.error('Uncaught Error Handling Denzel Request', {
            error,
            req,
            res,
            routeName: route.name,
            routePath: route.path,
            ip: req.ip,
            ips: req.ips,
          });
          res.setHeader('X-Request-ID', requestId);
          res
            .status(serializableCaughtError.statusCode)
            .type('json')
            .send(serializableCaughtError);
          return;
        }
      },
    );
    return {
      [route.name]: { fn: contextRequestHandler, name: route.name },
    } as {
      [K in RouteTypes['Name']]: HandlerObjectForRoute<
        Path,
        RouteTypes,
        ContextData
      >;
    };
  }

  public attachSSERouteHandlerWithMiddlewares<
    Path extends string,
    RouteTypes extends SseRouteNamedTypes<Path>,
  >(
    route: SseRoute<Path, RouteTypes>,
    additionalMiddlewares: RequestHandler[],
    contextRequestHandler: SseHandlerGeneratorFunction<
      Path,
      RouteTypes,
      ContextData
    >,
  ): {
    [K in RouteTypes['Name']]: SseHandlerObject<Path, RouteTypes, ContextData>;
  } {
    this.logger.trace('Attaching SSE route with middlewares');
    this.router.get(
      route.path,
      ...this.middlewares
        .concat(additionalMiddlewares)
        .map((middleware) => guardAsyncMiddleware(this.logger, middleware)),
      async (req: TRequest, res: Response) => {
        const requestId = req.headers['X-Inkibra-Request-ID']
          ? req.headers['X-Inkibra-Request-ID'].toString().replaceAll('-', '')
          : Brand.createId2('request').replaceAll('-', '');
        const trace = `projects/${this.cloudProjectName}/traces/${requestId}`;
        const contextRoutingLogger = this.logger.child({
          component: `${route.name}-sse-context`,
          contextName: this.contextName,
          routeName: route.name,
          routePath: route.path,
          'logging.googleapis.com/trace': trace,
          'logging.googleapis.com/trace_sampled': true,
          trace: trace,
        });

        try {
          const ctxResult = await this.handler(contextRoutingLogger, req, res);
          if (ctxResult.isErr()) {
            const serializableError = SerializableResult.toErr(
              ensureDefined(
                ctxResult.error,
                `${route.name}-sse-context-handler-error`,
              ),
              StatusCode.INTERNAL_SERVER_ERROR,
            );
            res
              .status(serializableError.statusCode)
              .type('json')
              .send(serializableError);
            return;
          }

          const { params, query } = req;
          const decodedQuery = decodeQuery(query);
          const pathParamsValidationResult = route.validatePathParams(params);
          const pathQueryValidationResult =
            route.validatePathQuery(decodedQuery);

          if (
            pathParamsValidationResult.success &&
            pathQueryValidationResult.success
          ) {
            ctxResult.value.logger.info('Handling SSE Request', {
              routeName: route.name,
              routePath: route.path,
              pathParams: params,
              pathQuery: query,
              pathQueryDecoded: decodedQuery,
              ip: req.ip,
              ips: req.ips,
            });

            const args = {
              pathParams: pathParamsValidationResult.data,
              pathQuery: pathQueryValidationResult.data,
            };

            // Set request ID header before creating EventStream (which sends headers)
            res.setHeader('X-Request-ID', requestId);

            // Create EventStream for SSE
            const eventStream = new EventStream<RouteTypes['EventTypes']>(
              new StreamResponseAdapter(res),
              contextRoutingLogger,
            );

            try {
              const generator = contextRequestHandler(args, ctxResult.value);
              req.on('close', () => {
                ctxResult.value.logger.info('SSE Request Closed by Client', {
                  routeName: route.name,
                  routePath: route.path,
                });
                if (eventStream.isActive()) {
                  eventStream.forceClose();
                }
                generator.return().catch((error) => {
                  ctxResult.value.logger.error(
                    'Error Closing SSE Generator after client closed',
                    error,
                  );
                });
              });
              for await (const event of generator) {
                eventStream.send(event.event, event.data);
              }
              eventStream.close();
              ctxResult.value.logger.info('SSE Handler Completed', {
                routeName: route.name,
                routePath: route.path,
                ip: req.ip,
                ips: req.ips,
              });
            } catch (handlerError) {
              ctxResult.value.logger.error(
                'Uncaught Error Handling SSE Request',
                handlerError,
              );
              if (eventStream.isActive()) {
                eventStream.forceClose();
              }
              throw handlerError;
            }
            return;
          }

          const error =
            ErrorDescriptor.create<REQUEST_VALIDATION_ERROR_DESCRIPTOR>(
              'REQUEST_VALIDATION_ERROR',
              `Request validation error: Could not validate request for ${route.name}`,
              {
                route: route.name,
                input: {
                  pathParams: params,
                  pathQuery: query,
                  pathQueryDecoded: decodedQuery,
                },
                pathParamsValidationResult,
                pathQueryValidationResult,
              },
            );
          const serializableError = SerializableResult.toErr(
            ensureDefined(error, `${route.name}-sse-request-validation-error`),
            StatusCode.BAD_REQUEST,
          );
          res.setHeader('X-Request-ID', requestId);
          res
            .type('json')
            .status(serializableError.statusCode)
            .send(serializableError);
          return ctxResult.value.logger.warn(
            'Responding to SSE Request (Request Validation Error)',
            {
              statusCode: StatusCode.BAD_REQUEST,
              error: serializableError,
              routeName: route.name,
              routePath: route.path,
              ip: req.ip,
              ips: req.ips,
            },
          );
        } catch (error) {
          const safeError = fromAnyError(error);
          const safeErrorWithCode =
            ErrorDescriptor.create<UNCAUGHT_SERVER_ERROR_DESCRIPTOR>(
              'UNCAUGHT_SERVER_ERROR',
              `Uncaught server error: Error handling SSE request for ${route.name}`,
              { route: route.name, error: safeError },
            );
          const serializableCaughtError = SerializableResult.toErr(
            ensureDefined(
              safeErrorWithCode,
              `${route.name}-sse-uncaught-server-error`,
            ),
            StatusCode.INTERNAL_SERVER_ERROR,
          );

          contextRoutingLogger.error('Uncaught Error Handling SSE Request', {
            error,
            req,
            res,
            routeName: route.name,
            routePath: route.path,
            ip: req.ip,
            ips: req.ips,
          });

          // For SSE connections, headers may already be sent
          if (!res.headersSent) {
            res.setHeader('X-Request-ID', requestId);
            res
              .status(serializableCaughtError.statusCode)
              .type('json')
              .send(serializableCaughtError);
            return;
          }

          // Headers already sent (SSE started), send error event through the stream
          try {
            res.write('event: error\n');
            res.write(
              `data: ${JSON.stringify({
                error: 'server_error',
                message: safeError.message,
                code: serializableCaughtError.statusCode,
              })}\n\n`,
            );
          } catch (writeError) {
            // If we can't write the error, just log it
            contextRoutingLogger.error(
              'Failed to send SSE error event',
              writeError,
            );
          }

          // End the response
          res.end();
        }
      },
    );
    return {
      [route.name]: { fn: contextRequestHandler, name: route.name },
    } as {
      [K in RouteTypes['Name']]: SseHandlerObject<
        Path,
        RouteTypes,
        ContextData
      >;
    };
  }
}
