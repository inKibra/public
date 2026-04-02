/**
 * EventStream Route Definition
 *
 * Type-safe EventStream (SSE) route definitions with schema validation,
 * completion types, and context codec support.
 */

import type { IValidation } from 'typia/lib';
import { encodeQuery } from '../constants/common';
import type { EventStreamEventTypes } from '../constants/event-stream';
import type {
  ContextCodecMap,
  ContextCodecMapDataTypes,
  ContextCodecMapResultTypes,
} from './context-codec';
import type { Result } from './result';

// ============================================================================
// Path Parameter Types
// ============================================================================

/**
 * Path parameter - string or number
 */
type PathParam = string | number;

/**
 * Extract path parameters from a path string
 */
type PathParams<T extends string> =
  T extends `${infer _Start}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof PathParams<Rest>]: PathParam }
    : T extends `${infer _Start}:${infer Param}`
      ? { [K in Param]: PathParam }
      : Record<string, never>;

// ============================================================================
// Route Type Definitions
// ============================================================================

/**
 * Base query type
 */
type TBaseQuery = Record<string, unknown>;

/**
 * Named types for an EventStream route
 */
export type EventStreamRouteNamedTypes<Path extends string> = {
  Name: string;
  PathParamsType: PathParams<Path>;
  PathQueryType: TBaseQuery;
  EventTypes: EventStreamEventTypes;
  CompletionData: unknown;
  CompletionError: unknown;
};

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Arguments passed to an EventStream handler
 */
export type EventStreamHandlerArguments<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
> = {
  pathParams: RouteTypes['PathParamsType'];
  pathQuery: RouteTypes['PathQueryType'];
};

/**
 * EventStream event yielded by the handler
 */
export type EventStreamYieldedEvent<TEventTypes extends EventStreamEventTypes> =
  {
    [K in keyof TEventTypes]: {
      event: K;
      data: TEventTypes[K];
    };
  }[keyof TEventTypes];

/**
 * Completion result type - either success or error
 */
export type EventStreamCompletion<TData, TError> = Result<TData, TError>;

/**
 * EventStream handler generator function (server-side)
 *
 * The handler is an async generator that:
 * - `yield` sends events to the client
 * - `return` ends the stream with a typed completion result
 */
export type EventStreamHandlerGeneratorFunction<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
  TContext,
> = (
  args: EventStreamHandlerArguments<Path, RouteTypes>,
  ctx: TContext,
) => AsyncGenerator<
  EventStreamYieldedEvent<RouteTypes['EventTypes']>,
  EventStreamCompletion<
    RouteTypes['CompletionData'],
    RouteTypes['CompletionError']
  >,
  unknown
>;

/**
 * EventStream handler object with name and generator function
 */
export type EventStreamHandlerObject<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
  TContext,
> = {
  name: RouteTypes['Name'];
  fn: EventStreamHandlerGeneratorFunction<Path, RouteTypes, TContext>;
};

// ============================================================================
// EventStream Route Schema
// ============================================================================

/**
 * Schema validators for an EventStream route
 */
export type EventStreamRouteSchema<
  TPathParams extends Record<string, PathParam> = Record<string, PathParam>,
  TPathQuery extends TBaseQuery = TBaseQuery,
  TEventTypes extends EventStreamEventTypes = EventStreamEventTypes,
  TCompletionData = unknown,
  TCompletionError = unknown,
> = {
  pathParams: (input: unknown) => IValidation<TPathParams>;
  pathQuery: (input: unknown) => IValidation<TPathQuery>;
  eventTypes: (input: unknown) => IValidation<Partial<TEventTypes>>;
  completionData: (input: unknown) => IValidation<TCompletionData>;
  completionError: (input: unknown) => IValidation<TCompletionError>;
};

/**
 * Any schema type (for generic constraints)
 */
export type AnyEventStreamRouteSchema = EventStreamRouteSchema<
  // biome-ignore lint/suspicious/noExplicitAny: Required for generic schema constraints
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for generic schema constraints
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for generic schema constraints
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for generic schema constraints
  any,
  // biome-ignore lint/suspicious/noExplicitAny: Required for generic schema constraints
  any
>;

/**
 * Define an EventStream route schema with validators
 *
 * @example
 * ```typescript
 * export const renderStatusStreamSchema = defineEventStreamSchema({
 *   pathParams: typia.createValidate<RenderStatus.PathParams>(),
 *   pathQuery: typia.createValidate<RenderStatus.PathQuery>(),
 *   eventTypes: typia.createValidate<Partial<RenderStatus.Events>>(),
 *   completionData: typia.createValidate<RenderStatus.CompletionData>(),
 *   completionError: typia.createValidate<RenderStatus.CompletionError>(),
 * });
 * ```
 */
export function defineEventStreamSchema<
  TPathParams extends Record<string, PathParam>,
  TPathQuery extends TBaseQuery,
  TEventTypes extends EventStreamEventTypes,
  TCompletionData = void,
  TCompletionError = void,
>(schema: {
  pathParams: (input: unknown) => IValidation<TPathParams>;
  pathQuery: (input: unknown) => IValidation<TPathQuery>;
  eventTypes: (input: unknown) => IValidation<Partial<TEventTypes>>;
  completionData?: (input: unknown) => IValidation<TCompletionData>;
  completionError?: (input: unknown) => IValidation<TCompletionError>;
}): EventStreamRouteSchema<
  TPathParams,
  TPathQuery,
  TEventTypes,
  TCompletionData,
  TCompletionError
>;

/**
 * Marker overload for type macro expansion.
 *
 * Usage:
 *   defineEventStreamSchema<{
 *     pathParams: Params;
 *     pathQuery: Query;
 *     eventTypes: Events;
 *     completionData: Done;
 *     completionError: Err;
 *   }>()
 */
export function defineEventStreamSchema<
  TContract extends {
    pathParams: Record<string, PathParam>;
    pathQuery: TBaseQuery;
    eventTypes: EventStreamEventTypes;
    completionData: unknown;
    completionError: unknown;
  },
>(): EventStreamRouteSchema<
  TContract['pathParams'],
  TContract['pathQuery'],
  TContract['eventTypes'],
  TContract['completionData'],
  TContract['completionError']
>;

export function defineEventStreamSchema<
  TPathParams extends Record<string, PathParam>,
  TPathQuery extends TBaseQuery,
  TEventTypes extends EventStreamEventTypes,
  TCompletionData = void,
  TCompletionError = void,
>(schema?: {
  pathParams: (input: unknown) => IValidation<TPathParams>;
  pathQuery: (input: unknown) => IValidation<TPathQuery>;
  eventTypes: (input: unknown) => IValidation<Partial<TEventTypes>>;
  completionData?: (input: unknown) => IValidation<TCompletionData>;
  completionError?: (input: unknown) => IValidation<TCompletionError>;
}): EventStreamRouteSchema<
  TPathParams,
  TPathQuery,
  TEventTypes,
  TCompletionData,
  TCompletionError
> {
  if (!schema) {
    throw new Error(
      'defineEventStreamSchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
    );
  }

  return {
    ...schema,
    completionData:
      schema.completionData ??
      ((input: unknown) => ({ success: true, data: input as TCompletionData })),
    completionError:
      schema.completionError ??
      ((input: unknown) => ({
        success: true,
        data: input as TCompletionError,
      })),
  };
}

// ============================================================================
// EventStream Route Class
// ============================================================================

/**
 * Configuration for creating an EventStream route
 */
export type EventStreamRouteConfig<
  Name extends string,
  Path extends string,
  Schema extends AnyEventStreamRouteSchema,
  TContextCodec extends ContextCodecMap | undefined = undefined,
> = {
  /** Unique name for the route */
  name: Name;
  /** URL path pattern */
  path: Path;
  /** Schema with validators */
  schema: Schema;
  /** Context codecs this route reads (handler receives decoded values) */
  contextCodec?: TContextCodec;
};

/**
 * Extract validated type from a validator function
 */
type ValidatedType<V> = V extends (input: unknown) => IValidation<infer T>
  ? T
  : never;

/**
 * Unwrap Partial<T> to get T
 */
type UnwrapPartial<T> = T extends Partial<infer U> ? U : T;

/**
 * Inferred types from a schema
 */
export type InferredEventStreamRouteTypes<
  Name extends string,
  Schema extends AnyEventStreamRouteSchema,
> = {
  Name: Name;
  PathParamsType: ValidatedType<Schema['pathParams']>;
  PathQueryType: ValidatedType<Schema['pathQuery']>;
  EventTypes: UnwrapPartial<ValidatedType<Schema['eventTypes']>>;
  CompletionData: ValidatedType<Schema['completionData']>;
  CompletionError: ValidatedType<Schema['completionError']>;
};

type EventStreamRouteTypesFromConfig<
  Name extends string,
  Path extends string,
  Schema extends AnyEventStreamRouteSchema,
> = InferredEventStreamRouteTypes<Name, Schema> & {
  PathParamsType: PathParams<Path> &
    InferredEventStreamRouteTypes<Name, Schema>['PathParamsType'];
  PathQueryType: TBaseQuery &
    InferredEventStreamRouteTypes<Name, Schema>['PathQueryType'];
};

/**
 * EventStream Route - represents a Server-Sent Event endpoint
 */
export class EventStreamRoute<
  Path extends string,
  T extends EventStreamRouteNamedTypes<Path>,
  TContextCodec extends ContextCodecMap | undefined = undefined,
> {
  readonly #name: T['Name'];
  readonly #path: Path;
  readonly #pathParamsValidator: (
    input: unknown,
  ) => IValidation<T['PathParamsType']>;
  readonly #pathQueryValidator: (
    input: unknown,
  ) => IValidation<T['PathQueryType']>;
  readonly #eventTypesValidator: (
    input: unknown,
  ) => IValidation<Partial<T['EventTypes']>>;
  readonly #completionDataValidator: (
    input: unknown,
  ) => IValidation<T['CompletionData']>;
  readonly #completionErrorValidator: (
    input: unknown,
  ) => IValidation<T['CompletionError']>;
  readonly #contextCodec: TContextCodec;

  constructor(config: {
    name: T['Name'];
    path: Path;
    pathParamsValidator: (input: unknown) => IValidation<T['PathParamsType']>;
    pathQueryValidator: (input: unknown) => IValidation<T['PathQueryType']>;
    eventTypesValidator: (
      input: unknown,
    ) => IValidation<Partial<T['EventTypes']>>;
    completionDataValidator: (
      input: unknown,
    ) => IValidation<T['CompletionData']>;
    completionErrorValidator: (
      input: unknown,
    ) => IValidation<T['CompletionError']>;
    contextCodec?: TContextCodec;
  }) {
    this.#name = config.name;
    this.#path = config.path;
    this.#pathParamsValidator = config.pathParamsValidator;
    this.#pathQueryValidator = config.pathQueryValidator;
    this.#eventTypesValidator = config.eventTypesValidator;
    this.#completionDataValidator = config.completionDataValidator;
    this.#completionErrorValidator = config.completionErrorValidator;
    this.#contextCodec = config.contextCodec as TContextCodec;
  }

  /** Route name */
  get name(): T['Name'] {
    return this.#name;
  }

  /** URL path pattern */
  get path(): Path {
    return this.#path;
  }

  /** Context codecs this route reads */
  get contextCodec(): TContextCodec {
    return this.#contextCodec;
  }

  /** Validate path parameters */
  validatePathParams(input: unknown): IValidation<T['PathParamsType']> {
    return this.#pathParamsValidator(input);
  }

  /** Validate path query */
  validatePathQuery(input: unknown): IValidation<T['PathQueryType']> {
    return this.#pathQueryValidator(input);
  }

  /** Validate event data */
  validateEvent(input: unknown): IValidation<Partial<T['EventTypes']>> {
    return this.#eventTypesValidator(input);
  }

  /** Validate completion data */
  validateCompletionData(input: unknown): IValidation<T['CompletionData']> {
    return this.#completionDataValidator(input);
  }

  /** Validate completion error */
  validateCompletionError(input: unknown): IValidation<T['CompletionError']> {
    return this.#completionErrorValidator(input);
  }

  /** Construct full path with params and query */
  constructPath(args: {
    pathParams: T['PathParamsType'];
    pathQuery: T['PathQueryType'];
    authorization?: string;
  }): string {
    let fullPath = this.#path as string;
    const queryWithAuth = args.authorization
      ? { ...args.pathQuery, authorization: args.authorization }
      : args.pathQuery;
    const encodedQuery = queryWithAuth ? encodeQuery(queryWithAuth) : '';
    const pathQueryStr = encodedQuery ? `?${encodedQuery}` : '';

    if (args.pathParams !== undefined) {
      for (const [param, value] of Object.entries(
        args.pathParams as Record<string, PathParam>,
      )) {
        fullPath = fullPath.replace(
          `:${param}`,
          encodeURIComponent(`${value}`),
        );
      }
    }

    return `${fullPath}${pathQueryStr}`;
  }

  /**
   * Create a typed handler object for this route
   */
  handle<
    THandlerContext extends TContextCodec extends ContextCodecMap
      ? ContextCodecMapResultTypes<TContextCodec>
      : Record<string, never>,
  >(
    handlerFn: EventStreamHandlerGeneratorFunction<Path, T, THandlerContext>,
  ): EventStreamHandlerObject<Path, T, THandlerContext> {
    return {
      name: this.#name,
      fn: handlerFn,
    };
  }

  /**
   * Create a handler registry entry
   */
  setupHandler<
    THandlerContext extends TContextCodec extends ContextCodecMap
      ? ContextCodecMapResultTypes<TContextCodec>
      : Record<string, never>,
  >(
    handlerFn: EventStreamHandlerGeneratorFunction<Path, T, THandlerContext>,
  ): { [K in T['Name']]: EventStreamHandlerObject<Path, T, THandlerContext> } {
    return {
      [this.#name]: this.handle(handlerFn),
    } as {
      [K in T['Name']]: EventStreamHandlerObject<Path, T, THandlerContext>;
    };
  }
}

// ============================================================================
// Route Factory
// ============================================================================

/**
 * Created EventStream route type
 */
export type CreatedEventStreamRoute<
  Name extends string,
  Path extends string,
  Schema extends AnyEventStreamRouteSchema,
  TContextCodec extends ContextCodecMap | undefined = undefined,
> = EventStreamRoute<
  Path,
  EventStreamRouteTypesFromConfig<Name, Path, Schema>,
  TContextCodec
>;

/**
 * Create a type-safe EventStream route
 *
 * @example
 * ```typescript
 * export namespace RenderStatus {
 *   export type PathParams = { renderJobId: string };
 *   export type PathQuery = {};
 *
 *   export type Events = {
 *     progress: { overall: number; stage: string };
 *     delta: { text: string };
 *   };
 *
 *   export type CompletionData = { output: RenderOutput };
 *   export type CompletionError = { code: string; message: string };
 * }
 *
 * export const renderStatusStream = createEventStreamRoute({
 *   name: 'RenderStatusStream',
 *   path: '/api/render/:renderJobId/status',
 *   schema: renderStatusStreamSchema,
 *   contextCodec: { auth: AuthCodec },
 * });
 * ```
 */
export function createEventStreamRoute<
  const Name extends string,
  const Path extends string,
  Schema extends AnyEventStreamRouteSchema,
  TContextCodec extends ContextCodecMap | undefined = undefined,
>(
  config: EventStreamRouteConfig<Name, Path, Schema, TContextCodec>,
): CreatedEventStreamRoute<Name, Path, Schema, TContextCodec> {
  return new EventStreamRoute<
    Path,
    EventStreamRouteTypesFromConfig<Name, Path, Schema>,
    TContextCodec
  >({
    name: config.name,
    path: config.path,
    pathParamsValidator: config.schema.pathParams,
    pathQueryValidator: config.schema.pathQuery,
    eventTypesValidator: config.schema.eventTypes,
    completionDataValidator: config.schema.completionData,
    completionErrorValidator: config.schema.completionError,
    contextCodec: config.contextCodec,
  });
}

// ============================================================================
// Type Extraction Utilities
// ============================================================================

/**
 * Any EventStream route (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic route constraints
export type AnyEventStreamRoute = EventStreamRoute<string, any, any>;

/**
 * Extract types from an EventStreamRoute instance
 */
export type EventStreamRouteTypes<R> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible type extraction
  R extends EventStreamRoute<infer _Path, infer T, any>
    ? T extends EventStreamRouteNamedTypes<string>
      ? {
          PathParams: T['PathParamsType'];
          PathQuery: T['PathQueryType'];
          EventTypes: T['EventTypes'];
          CompletionData: T['CompletionData'];
          CompletionError: T['CompletionError'];
        }
      : never
    : never;

/**
 * Extract event types from an EventStream route
 * Returns `any` for AnyEventStreamRoute to avoid contravariance issues
 */
export type EventStreamRouteEventTypes<R> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible type extraction
  R extends EventStreamRoute<infer _Path, infer T, any>
    ? unknown extends T['EventTypes']
      ? // biome-ignore lint/suspicious/noExplicitAny: Required for AnyEventStreamRoute
        any
      : T['EventTypes']
    : never;

/**
 * Extract handler arguments from an EventStream route
 * Returns `any` for AnyEventStreamRoute to avoid contravariance issues
 */
export type EventStreamRouteArgs<R> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible type extraction
  R extends EventStreamRoute<infer _Path, infer T, any>
    ? unknown extends T['PathParamsType']
      ? // biome-ignore lint/suspicious/noExplicitAny: Required for AnyEventStreamRoute
        { pathParams: any; pathQuery: any }
      : T extends { PathParamsType: infer P; PathQueryType: infer Q }
        ? { pathParams: P; pathQuery: Q }
        : never
    : never;

/**
 * Extract completion types from an EventStream route
 * Returns `any` for AnyEventStreamRoute to avoid contravariance issues
 */
export type EventStreamRouteCompletion<R> =
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible type extraction
  R extends EventStreamRoute<infer _Path, infer T, any>
    ? unknown extends T['CompletionData']
      ? // biome-ignore lint/suspicious/noExplicitAny: Required for AnyEventStreamRoute
        EventStreamCompletion<any, any>
      : T extends { CompletionData: infer D; CompletionError: infer E }
        ? EventStreamCompletion<D, E>
        : never
    : never;

/**
 * Extract execute-context data type from an EventStream route.
 */
export type EventStreamRouteContextType<R> = R extends EventStreamRoute<
  infer _Path,
  infer _T,
  infer TContextCodec
>
  ? TContextCodec extends ContextCodecMap
    ? ContextCodecMapDataTypes<TContextCodec>
    : Record<string, never>
  : never;

/**
 * Extract handler-facing context result type from an EventStream route.
 */
export type EventStreamRouteContextResultType<R> = R extends EventStreamRoute<
  infer _Path,
  infer _T,
  infer TContextCodec
>
  ? TContextCodec extends ContextCodecMap
    ? ContextCodecMapResultTypes<TContextCodec>
    : Record<string, never>
  : never;
