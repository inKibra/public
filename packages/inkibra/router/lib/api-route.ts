/**
 * API Route Definition
 *
 * Type-safe API route definitions with schema validation, context codec support,
 * and handler type inference.
 */

import type { IValidation } from 'typia/lib';
import { encodeQuery } from '../constants/common';
import type { HttpMethod } from '../constants/http-method';
import type { MimeType } from '../constants/mime-type';
import type { StatusCode } from '../constants/status-code';
import type {
  AssertValidCodecMap,
  ContextCodecMap,
  ContextCodecMapDataTypes,
  ContextCodecMapErrorTypes,
  ContextCodecMapResultTypes,
} from './context-codec';
import type { Result, SerializableResult } from './result';

// ============================================================================
// Path Parameter Types
// ============================================================================

/**
 * Path parameter - string or number
 */
type PathParam = string | number;

/**
 * Extract path parameters from a path string
 * e.g., '/users/:id/posts/:postId' -> { id: PathParam, postId: PathParam }
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
 * Base body type - undefined (no body) or a record
 */
type TBaseBody = Record<string, unknown> | undefined;

/**
 * Base response type - serializable result
 */
export type TBaseResponse = SerializableResult<unknown, unknown>;

/**
 * Named types for a route
 */
export type RouteNamedTypes<Path extends string> = {
  Name: string;
  Method: HttpMethod;
  PathParamsType: PathParams<Path>;
  PathQueryType: TBaseQuery;
  BodyType: TBaseBody;
  ResponseType: TBaseResponse;
};

// ============================================================================
// File Input Description
// ============================================================================

/**
 * Single file input description
 */
export type SingleFileInput<TMimeType extends MimeType = MimeType> = {
  allowableMimeTypes: TMimeType[];
};

/**
 * Multiple files input description
 */
export type MultipleFilesInput<TMimeType extends MimeType = MimeType> = {
  allowableMimeTypes: TMimeType[];
  maxCount: number;
};

/**
 * File input description for a route
 */
export type FileInputDescription = {
  [name: string]: SingleFileInput | MultipleFilesInput;
};

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Arguments passed to a route handler
 */
export type HandlerArguments<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TFileInput extends FileInputDescription | undefined = undefined,
> = {
  pathParams: RouteTypes['PathParamsType'];
  pathQuery: RouteTypes['PathQueryType'];
  body: RouteTypes['BodyType'];
  files: TFileInput extends FileInputDescription
    ? { [K in keyof TFileInput]: File | File[] }
    : undefined;
};

/**
 * Handler result type - includes optional context creation
 */
export type HandlerResult<
  TResponse,
  TCreatesContextCodec extends ContextCodecMap | undefined,
> = TCreatesContextCodec extends ContextCodecMap
  ? {
      result: TResponse;
      context?: Partial<ContextCodecMapDataTypes<TCreatesContextCodec>>;
    }
  : TResponse;

/**
 * Handler function type
 */
export type HandlerFunction<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TContext,
  TFileInput extends FileInputDescription | undefined = undefined,
  TCreatesContextCodec extends ContextCodecMap | undefined = undefined,
> = (
  args: HandlerArguments<Path, RouteTypes, TFileInput>,
  ctx: TContext,
) => Promise<HandlerResult<RouteTypes['ResponseType'], TCreatesContextCodec>>;

/**
 * Handler object with name and function
 */
export type HandlerObject<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TContext,
  TFileInput extends FileInputDescription | undefined = undefined,
  TCreatesContextCodec extends ContextCodecMap | undefined = undefined,
> = {
  name: RouteTypes['Name'];
  fn: HandlerFunction<
    Path,
    RouteTypes,
    TContext,
    TFileInput,
    TCreatesContextCodec
  >;
};

// ============================================================================
// API Route Schema
// ============================================================================

/**
 * Schema validators for an API route
 */
export type ApiRouteSchema<
  TPathParams extends Record<string, PathParam> = Record<string, PathParam>,
  TPathQuery extends TBaseQuery = TBaseQuery,
  TBody extends TBaseBody = TBaseBody,
  TResponse extends TBaseResponse = TBaseResponse,
> = {
  pathParams: (input: unknown) => IValidation<TPathParams>;
  pathQuery: (input: unknown) => IValidation<TPathQuery>;
  body: (input: unknown) => IValidation<TBody>;
  response: (input: unknown) => IValidation<TResponse>;
};

/**
 * Any schema type (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic schema constraints
export type AnyApiRouteSchema = ApiRouteSchema<any, any, any, any>;

/**
 * Generic route contract used by type macro schema markers.
 */
export type RouteSchemaContract<
  TPathParams extends Record<string, PathParam> = Record<string, PathParam>,
  TPathQuery extends TBaseQuery = TBaseQuery,
  TBody extends TBaseBody = TBaseBody,
  TResponse extends TBaseResponse = TBaseResponse,
> = {
  pathParams: TPathParams;
  pathQuery: TPathQuery;
  body: TBody;
  response: TResponse;
};

/**
 * Define a route schema with validators
 *
 * @example
 * ```typescript
 * export const getProfileSchema = defineRouteSchema({
 *   pathParams: typia.createValidate<GetProfile.PathParams>(),
 *   pathQuery: typia.createValidate<GetProfile.PathQuery>(),
 *   body: typia.createValidate<GetProfile.Body>(),
 *   response: typia.createValidate<GetProfile.Response>(),
 * });
 * ```
 */
export function defineRouteSchema<
  TPathParams extends Record<string, PathParam>,
  TPathQuery extends TBaseQuery,
  TBody extends TBaseBody,
  TResponse extends TBaseResponse,
>(
  schema: ApiRouteSchema<TPathParams, TPathQuery, TBody, TResponse>,
): ApiRouteSchema<TPathParams, TPathQuery, TBody, TResponse>;

/**
 * Marker overload for type macro expansion.
 *
 * Usage:
 *   defineRouteSchema<MyRouteContract>()
 */
export function defineRouteSchema<
  TContract extends RouteSchemaContract,
>(): ApiRouteSchema<
  TContract['pathParams'],
  TContract['pathQuery'],
  TContract['body'],
  TContract['response']
>;

export function defineRouteSchema(
  schema?: AnyApiRouteSchema,
): AnyApiRouteSchema {
  if (!schema) {
    throw new Error(
      'defineRouteSchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
    );
  }

  return schema;
}

// ============================================================================
// API Route Class
// ============================================================================

/**
 * Configuration for creating an API route
 *
 * Context codec keys MUST match the codec's `name` property.
 * This is enforced at compile time via AssertValidCodecMap.
 */
export type ApiRouteConfig<
  Name extends string,
  Path extends string,
  Method extends HttpMethod,
  Schema extends AnyApiRouteSchema,
  TContextCodec extends ContextCodecMap | undefined = undefined,
  TCreatesContextCodec extends ContextCodecMap | undefined = undefined,
  TFileInput extends FileInputDescription | undefined = undefined,
> = {
  /** Unique name for the route */
  name: Name;
  /** HTTP method */
  method: Method;
  /** URL path pattern */
  path: Path;
  /** Schema with validators */
  schema: Schema;
  /** Context codecs this route reads (handler receives decoded values) */
  contextCodec?: TContextCodec;
  /** Context codecs this route can create (handler can return new values) */
  createsContextCodec?: TCreatesContextCodec;
  /** File input description (triggers FormData instead of JSON) */
  fileInput?: TFileInput;
} & (TContextCodec extends ContextCodecMap
  ? AssertValidCodecMap<TContextCodec>
  : unknown) &
  (TCreatesContextCodec extends ContextCodecMap
    ? AssertValidCodecMap<TCreatesContextCodec>
    : unknown);

/**
 * Extract validated type from a validator function
 */
export type ValidatedType<V> = V extends (
  input: unknown,
) => IValidation<infer T>
  ? T
  : never;

/**
 * Inferred types from a schema
 */
export type InferredRouteTypes<
  Name extends string,
  Schema extends AnyApiRouteSchema,
> = {
  Name: Name;
  Method: HttpMethod;
  PathParamsType: ValidatedType<Schema['pathParams']>;
  PathQueryType: ValidatedType<Schema['pathQuery']>;
  BodyType: ValidatedType<Schema['body']>;
  ResponseType: ValidatedType<Schema['response']>;
};

type RouteTypesFromConfig<
  Name extends string,
  Path extends string,
  Method extends HttpMethod,
  Schema extends AnyApiRouteSchema,
> = InferredRouteTypes<Name, Schema> & {
  Method: Method;
  PathParamsType: PathParams<Path> &
    InferredRouteTypes<Name, Schema>['PathParamsType'];
  PathQueryType: TBaseQuery & InferredRouteTypes<Name, Schema>['PathQueryType'];
  BodyType: TBaseBody & InferredRouteTypes<Name, Schema>['BodyType'];
  ResponseType: TBaseResponse &
    InferredRouteTypes<Name, Schema>['ResponseType'];
};

/**
 * API Route - represents an HTTP endpoint
 */
export class ApiRoute<
  Path extends string,
  T extends RouteNamedTypes<Path>,
  TContextCodec extends ContextCodecMap | undefined = undefined,
  TCreatesContextCodec extends ContextCodecMap | undefined = undefined,
  TFileInput extends FileInputDescription | undefined = undefined,
  TContextErrors extends
    | SerializableResult.ErrWithStatusCode<unknown, StatusCode>
    | never = never,
> {
  readonly #name: T['Name'];
  readonly #method: T['Method'];
  readonly #path: Path;
  readonly #pathParamsValidator: (
    input: unknown,
  ) => IValidation<T['PathParamsType']>;
  readonly #pathQueryValidator: (
    input: unknown,
  ) => IValidation<T['PathQueryType']>;
  readonly #bodyValidator: (input: unknown) => IValidation<T['BodyType']>;
  readonly #responseValidator: (
    input: unknown,
  ) => IValidation<T['ResponseType'] | TContextErrors>;
  readonly #contextCodec: TContextCodec;
  readonly #createsContextCodec: TCreatesContextCodec;
  readonly #fileInput: TFileInput;

  constructor(config: {
    name: T['Name'];
    method: T['Method'];
    path: Path;
    pathParamsValidator: (input: unknown) => IValidation<T['PathParamsType']>;
    pathQueryValidator: (input: unknown) => IValidation<T['PathQueryType']>;
    bodyValidator: (input: unknown) => IValidation<T['BodyType']>;
    responseValidator: (
      input: unknown,
    ) => IValidation<T['ResponseType'] | TContextErrors>;
    contextCodec?: TContextCodec;
    createsContextCodec?: TCreatesContextCodec;
    fileInput?: TFileInput;
  }) {
    this.#name = config.name;
    this.#method = config.method;
    this.#path = config.path;
    this.#pathParamsValidator = config.pathParamsValidator;
    this.#pathQueryValidator = config.pathQueryValidator;
    this.#bodyValidator = config.bodyValidator;
    this.#responseValidator = config.responseValidator;
    this.#contextCodec = config.contextCodec as TContextCodec;
    this.#createsContextCodec =
      config.createsContextCodec as TCreatesContextCodec;
    this.#fileInput = config.fileInput as TFileInput;
  }

  /** Route name */
  get name(): T['Name'] {
    return this.#name;
  }

  /** HTTP method */
  get method(): T['Method'] {
    return this.#method;
  }

  /** URL path pattern */
  get path(): Path {
    return this.#path;
  }

  /** Context codecs this route reads */
  get contextCodec(): TContextCodec {
    return this.#contextCodec;
  }

  /** Context codecs this route can create */
  get createsContextCodec(): TCreatesContextCodec {
    return this.#createsContextCodec;
  }

  /** File input description */
  get fileInput(): TFileInput {
    return this.#fileInput;
  }

  /** Whether this route accepts file uploads */
  get hasFileInput(): boolean {
    return this.#fileInput !== undefined;
  }

  /** Validate path parameters */
  validatePathParams(input: unknown): IValidation<T['PathParamsType']> {
    return this.#pathParamsValidator(input);
  }

  /** Validate path query */
  validatePathQuery(input: unknown): IValidation<T['PathQueryType']> {
    return this.#pathQueryValidator(input);
  }

  /** Validate body */
  validateBody(input: unknown): IValidation<T['BodyType']> {
    return this.#bodyValidator(input);
  }

  /** Validate response */
  validateResponse(
    input: unknown,
  ): IValidation<T['ResponseType'] | TContextErrors> {
    return this.#responseValidator(input);
  }

  /** Construct full path with params and query */
  constructPath(args: {
    pathParams: T['PathParamsType'];
    pathQuery: T['PathQueryType'];
  }): string {
    let fullPath = this.#path as string;
    const pathQueryStr = args.pathQuery
      ? `?${encodeQuery(args.pathQuery)}`
      : '';

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
}

// ============================================================================
// Route Factory
// ============================================================================

/**
 * Created API route type
 */
export type CreatedApiRoute<
  Name extends string,
  Path extends string,
  Method extends HttpMethod,
  Schema extends AnyApiRouteSchema,
  TContextCodec extends ContextCodecMap | undefined = undefined,
  TCreatesContextCodec extends ContextCodecMap | undefined = undefined,
  TFileInput extends FileInputDescription | undefined = undefined,
> = ApiRoute<
  Path,
  RouteTypesFromConfig<Name, Path, Method, Schema>,
  TContextCodec,
  TCreatesContextCodec,
  TFileInput
>;

/**
 * Create a type-safe API route
 *
 * @example
 * ```typescript
 * // Route that reads context
 * export const getProfile = createAPIRoute({
 *   name: 'getProfile',
 *   method: HttpMethod.GET,
 *   path: '/api/profiles/:id',
 *   schema: getProfileSchema,
 *   contextCodec: { session: SessionCodec },
 * });
 *
 * // Route that creates context (e.g., login)
 * export const login = createAPIRoute({
 *   name: 'login',
 *   method: HttpMethod.POST,
 *   path: '/api/auth/login',
 *   schema: loginSchema,
 *   createsContextCodec: { session: SessionCodec },
 * });
 *
 * // Route with file uploads
 * export const uploadVideo = createAPIRoute({
 *   name: 'uploadVideo',
 *   method: HttpMethod.POST,
 *   path: '/api/videos',
 *   schema: uploadVideoSchema,
 *   fileInput: {
 *     video: { allowableMimeTypes: [MimeType.VIDEO_MP4] },
 *   },
 *   contextCodec: { session: SessionCodec },
 * });
 * ```
 */
export function createAPIRoute<
  const Name extends string,
  const Path extends string,
  const Method extends HttpMethod,
  Schema extends AnyApiRouteSchema,
  TContextCodec extends ContextCodecMap | undefined = undefined,
  TCreatesContextCodec extends ContextCodecMap | undefined = undefined,
  TFileInput extends FileInputDescription | undefined = undefined,
>(
  config: ApiRouteConfig<
    Name,
    Path,
    Method,
    Schema,
    TContextCodec,
    TCreatesContextCodec,
    TFileInput
  >,
): CreatedApiRoute<
  Name,
  Path,
  Method,
  Schema,
  TContextCodec,
  TCreatesContextCodec,
  TFileInput
> {
  return new ApiRoute<
    Path,
    RouteTypesFromConfig<Name, Path, Method, Schema>,
    TContextCodec,
    TCreatesContextCodec,
    TFileInput
  >({
    name: config.name,
    method: config.method,
    path: config.path,
    pathParamsValidator: config.schema.pathParams,
    pathQueryValidator: config.schema.pathQuery,
    bodyValidator: config.schema.body,
    responseValidator: config.schema.response,
    contextCodec: config.contextCodec,
    createsContextCodec: config.createsContextCodec,
    fileInput: config.fileInput,
  });
}

// ============================================================================
// Type Extraction Utilities
// ============================================================================

/**
 * Any API route (for generic constraints)
 * Must include all 6 type parameters to match ApiRoute class
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic route constraints
export type AnyApiRoute = ApiRoute<string, any, any, any, any, any>;

/**
 * Handler function signature for an API route
 *
 * Extracts the correct args type (including files when applicable) from the route.
 * Used by both RequiredApiImplementations and FetchTransport.createApiHandler
 * to ensure consistent typing across the system.
 *
 * @example
 * ```typescript
 * // Type of handler for loginRoute
 * type LoginHandler = ApiRouteHandlerFn<typeof loginRoute>;
 * // (args: { pathParams: ..., pathQuery: ..., body: LoginRequest, files: undefined }) => Promise<Result<...>>
 * ```
 */
export type ApiRouteHandlerFn<TRoute extends AnyApiRoute> =
  TRoute extends ApiRoute<
    infer Path extends string,
    infer Types extends RouteNamedTypes<string>,
    // biome-ignore lint/suspicious/noExplicitAny: Need to match any context codec types
    any,
    // biome-ignore lint/suspicious/noExplicitAny: Need to match any creates context codec types
    any,
    infer TFileInput extends FileInputDescription | undefined,
    // biome-ignore lint/suspicious/noExplicitAny: Need to match any context errors types
    any
  >
    ? (
        args: HandlerArguments<Path, Types, TFileInput>,
      ) => Promise<Result<unknown, unknown>>
    : never;

/**
 * Extract types from an ApiRoute instance
 */
export type RouteTypes<R> = R extends ApiRoute<
  infer _Path,
  infer T extends RouteNamedTypes<string>,
  infer _TContextCodec,
  infer _TCreatesContextCodec,
  infer _TFileInput,
  infer _TContextErrors
>
  ? {
      PathParams: T['PathParamsType'];
      PathQuery: T['PathQueryType'];
      Body: T['BodyType'];
      Response: T['ResponseType'];
    }
  : never;

/**
 * Extract handler arguments type from a route
 */
export type RouteHandlerArgs<R> = R extends ApiRoute<
  infer Path,
  infer T,
  infer _TContextCodec,
  infer _TCreatesContextCodec,
  infer TFileInput,
  infer _TContextErrors
>
  ? T extends RouteNamedTypes<Path>
    ? HandlerArguments<Path, T, TFileInput>
    : never
  : never;

/**
 * Extract response type from a route
 */
export type RouteResponse<R> = R extends ApiRoute<
  infer _Path,
  infer T,
  infer _TContextCodec,
  infer _TCreatesContextCodec,
  infer _TFileInput,
  infer _TContextErrors
>
  ? T extends { ResponseType: infer R }
    ? R
    : never
  : never;

/**
 * Extract context data type from a route (decoded values the handler receives)
 */
export type RouteContextType<R> = R extends ApiRoute<
  infer _Path,
  infer _T,
  infer TContextCodec,
  infer _TCreatesContextCodec,
  infer _TFileInput,
  infer _TContextErrors
>
  ? TContextCodec extends ContextCodecMap
    ? ContextCodecMapDataTypes<TContextCodec>
    : Record<string, never>
  : never;

/**
 * Extract handler-facing context result type from a route.
 */
export type RouteContextResultType<R> = R extends ApiRoute<
  infer _Path,
  infer _T,
  infer TContextCodec,
  infer _TCreatesContextCodec,
  infer _TFileInput,
  infer _TContextErrors
>
  ? TContextCodec extends ContextCodecMap
    ? ContextCodecMapResultTypes<TContextCodec>
    : Record<string, never>
  : never;

/**
 * Extract context error types from a route (union of all codec errors)
 */
export type RouteContextErrors<R> = R extends ApiRoute<
  infer _Path,
  infer _T,
  infer TContextCodec,
  infer _TCreatesContextCodec,
  infer _TFileInput,
  infer _TContextErrors
>
  ? TContextCodec extends ContextCodecMap
    ? ContextCodecMapErrorTypes<TContextCodec>
    : never
  : never;

/**
 * Extract the context codec map from a route
 */
export type RouteContextCodecMap<R> = R extends ApiRoute<
  infer _Path,
  infer _T,
  infer TContextCodec,
  infer _TCreatesContextCodec,
  infer _TFileInput,
  infer _TContextErrors
>
  ? TContextCodec
  : never;

/**
 * Extract the creates context codec map from a route
 */
export type RouteCreatesContextCodecMap<R> = R extends ApiRoute<
  infer _Path,
  infer _T,
  infer _TContextCodec,
  infer TCreatesContextCodec,
  infer _TFileInput,
  infer _TContextErrors
>
  ? TCreatesContextCodec
  : never;

/**
 * Handler result type - includes optional context creation
 *
 * If the route has createsContextCodec, the handler can return
 * { result, context } where context contains values to write.
 * Otherwise, just return the result directly.
 */
export type ApiHandlerResult<R extends AnyApiRoute> = R extends {
  createsContextCodec: infer TC;
}
  ? TC extends ContextCodecMap
    ? {
        result: RouteResponse<R>;
        context?: Partial<ContextCodecMapDataTypes<TC>>;
      }
    : RouteResponse<R>
  : RouteResponse<R>;
