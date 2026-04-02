import type { IValidation } from 'typia/lib';
import { encodeQuery } from '../constants';
import type { SseEventTypes } from '../constants/sse-event';

/**
 * Represents a path parameter which can be a string or a number.
 */
type PathParam = string | number;

/**
 * PathParams is a recursive type that parses a path string and creates an object type
 * where each property is a path parameter and its value is a PathParam type.
 */
type PathParams<T extends string> =
  T extends `${infer _Start}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof PathParams<Rest>]: PathParam }
    : T extends `${infer _Start}:${infer Param}`
      ? { [K in Param]: PathParam }
      : Record<string, never>;

/**
 * TBaseQuery is a type that represents a query parameter.
 */
type TBaseQuery = Record<string, unknown>;

/**
 * SseRouteNamedTypes is an type that defines the types for an SSE route.
 */
export type SseRouteNamedTypes<Path extends string> = {
  Name: string;
  PathParamsType: PathParams<Path>;
  PathQueryType: TBaseQuery;
  EventTypes: SseEventTypes;
};

/**
 * SseHandlerArguments represents the arguments passed to an SSE handler function.
 */
export type SseHandlerArguments<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
> = {
  pathParams: RouteTypes['PathParamsType'];
  pathQuery: RouteTypes['PathQueryType'];
};

/**
 * SseHandlerGeneratorFunction represents a generator handler function for an SSE route.
 */
export type SseHandlerGeneratorFunction<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
  ContextData,
> = (
  args: SseHandlerArguments<Path, RouteTypes>,
  ctx: ContextData,
) => AsyncGenerator<
  {
    [K in keyof RouteTypes['EventTypes']]: {
      event: K;
      data: RouteTypes['EventTypes'][K];
    };
  }[keyof RouteTypes['EventTypes']],
  void,
  unknown
>;

/**
 * SseHandlerObject represents a handler object for an SSE route.
 */
export type SseHandlerObject<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
  ContextData,
> = {
  name: RouteTypes['Name'];
  fn: SseHandlerGeneratorFunction<Path, RouteTypes, ContextData>;
};

/**
 * The SseRoute class defines Server-Sent Event routes with full type safety.
 */
export class SseRoute<Path extends string, T extends SseRouteNamedTypes<Path>> {
  readonly #name: T['Name'];
  readonly #path: Path;
  readonly #pathParamsValidator: (
    input: unknown,
  ) => IValidation<T['PathParamsType']>;
  readonly #pathQueryValidator: (
    input: unknown,
  ) => IValidation<T['PathQueryType']>;
  readonly #eventTypesValidator: (
    data: unknown,
  ) => IValidation<Partial<T['EventTypes']>>;

  /**
   * Constructs a new instance of the SseRoute class.
   */
  public constructor({
    name,
    path,
    pathParamsValidator,
    pathQueryValidator,
    eventTypesValidator,
  }: {
    name: T['Name'];
    path: Path;
    pathParamsValidator: (input: unknown) => IValidation<T['PathParamsType']>;
    pathQueryValidator: (input: unknown) => IValidation<T['PathQueryType']>;
    eventTypesValidator: (
      data: unknown,
    ) => IValidation<Partial<T['EventTypes']>>;
  }) {
    this.#name = name;
    this.#path = path;
    this.#pathParamsValidator = pathParamsValidator;
    this.#pathQueryValidator = pathQueryValidator;
    this.#eventTypesValidator = eventTypesValidator;
  }

  /**
   * Getter for the name of the route.
   */
  public get name() {
    return this.#name;
  }

  /**
   * Getter for the path of the route.
   */
  public get path() {
    return this.#path;
  }

  /**
   * Validates the path parameters.
   */
  public validatePathParams(maybePathParams: unknown) {
    return this.#pathParamsValidator(maybePathParams);
  }

  /**
   * Validates the path query parameters.
   */
  public validatePathQuery(maybePathQuery: unknown) {
    return this.#pathQueryValidator(maybePathQuery);
  }

  /**
   * Validates an event before sending.
   */
  public validateEvent(data: unknown) {
    return this.#eventTypesValidator(data);
  }

  /**
   * Constructs the relative path of the route by replacing path parameters with their actual values.
   */
  public constructPath({
    pathParams,
    pathQuery,
    authorization,
  }: {
    pathParams: T['PathParamsType'];
    pathQuery: T['PathQueryType'];
    authorization?: string;
  }) {
    let fullPath = this.path as string;
    const encodedQuery = pathQuery
      ? encodeQuery({ ...pathQuery, authorization })
      : '';
    const pathQueryStr = encodedQuery ? `?${encodedQuery}` : '';
    if (pathParams !== undefined) {
      Object.keys(pathParams as Record<string, PathParam>).forEach((param) => {
        const value = (pathParams as Record<string, PathParam>)[param];
        fullPath = fullPath.replace(
          `:${param}`,
          encodeURIComponent(`${value}`),
        );
      });
      return `${fullPath}${pathQueryStr}`;
    }
    return `${fullPath}${pathQueryStr}`;
  }

  /**
   * Creates a handler object for the SSE route.
   */
  public handle<ContextData>(
    handlerFunction: SseHandlerGeneratorFunction<Path, T, ContextData>,
  ): SseHandlerObject<Path, T, ContextData> {
    return {
      fn: handlerFunction,
      name: this.name,
    };
  }

  /**
   * Creates a handler object for the SSE route with typed key.
   */
  public setupHandler<ContextData>(
    handlerFunction: SseHandlerGeneratorFunction<Path, T, ContextData>,
  ): { [K in T['Name']]: SseHandlerObject<Path, T, ContextData> } {
    return {
      [this.name]: this.handle(handlerFunction),
    } as { [K in T['Name']]: SseHandlerObject<Path, T, ContextData> };
  }
}
