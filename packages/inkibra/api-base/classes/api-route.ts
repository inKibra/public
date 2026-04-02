import type { IValidation } from 'typia/lib';
import {
  type AllFilesOptional,
  encodeQuery,
  type FileInputDescription,
  type StatusCode,
} from '../constants';
import type { HttpMethod } from '../constants/http-method';
import type { SerializableResult } from '../constants/serializable-result';
import type { TypedFormData } from './typed-form-data';

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
 * It can be a string, number, boolean, undefined, or an array of strings, numbers, or booleans.
 */
type TBaseQuery = Record<string, unknown>;

/**
 * TBaseBody is a type that represents the body of a request.
 * It is of unknown type.
 */
type TBaseBody = unknown;

/**
 * TBaseResponse is a type that represents a response.
 * It is a SerializableResult of unknown type.
 */
export type TBaseResponse = SerializableResult<unknown, unknown>;

/**
 * RouteNamedTypes is an interface that defines the types for a route.
 * It includes the name of the route, the HTTP method, the path,
 * the type of path parameters, the type of query parameters, the type of the body,
 * and the type of the response.
 *
 * @template Path - The URL path of the route. It can include path parameters, denoted by a colon prefix (e.g., '/user/:id').
 */
export interface RouteNamedTypes<Path extends string> {
  Name: string;
  Method: HttpMethod;
  PathParamsType: PathParams<Path>;
  PathQueryType: TBaseQuery;
  BodyType: TBaseBody;
  FileInputDescriptionType: FileInputDescription | undefined;
  ResponseType: TBaseResponse;
}

/**
 * HandlerArguments is a type that represents the arguments passed to a handler function for a route.
 * It includes the body, files (if any), path parameters, and query parameters of the route.
 *
 * @template Path - The URL path of the route. It can include path parameters, denoted by a colon prefix (e.g., '/user/:id').
 * @template RouteTypes - The types for a route. It extends RouteNamedTypes with the path as a parameter.
 *
 * @property {BodyType} body - The body of the route.
 * @property {FileManifestType | undefined} files - The files of the route, if any.
 * @property {PathParamsType} pathParams - The path parameters of the route.
 * @property {PathQueryType} pathQuery - The query parameters of the route.
 */
export type HandlerArguments<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
> = {
  body: RouteTypes['BodyType'];
  files: RouteTypes['FileInputDescriptionType'] extends FileInputDescription
    ? AllFilesOptional<RouteTypes['FileInputDescriptionType']> extends true
      ? TypedFormData<RouteTypes['FileInputDescriptionType']> | undefined
      : TypedFormData<RouteTypes['FileInputDescriptionType']>
    : undefined;
  pathParams: RouteTypes['PathParamsType'];
  pathQuery: RouteTypes['PathQueryType'];
};

/**
 * HandlerFunctionForRoute is a type that represents a handler function for a route.
 * It takes in an object of arguments and a context data, and returns a promise of the response type.
 *
 * @template Path - The URL path of the route. It can include path parameters, denoted by a colon prefix (e.g., '/user/:id').
 * @template RouteTypes - The types for a route. It extends RouteNamedTypes with the path as a parameter.
 * @template ContextData - The data for the context in which the handler function is executed.
 *
 * @param {HandlerArguments<RouteTypes>} args - An object that includes the body, path parameters, and query parameters of the route.
 * @param {ContextData} ctx - The context data for the handler function.
 *
 * @returns {Promise<ResponseType>} A promise that resolves to the response type of the route.
 */
export type HandlerFunctionForRoute<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  ContextData,
> = (
  args: HandlerArguments<Path, RouteTypes>,
  ctx: ContextData,
) => Promise<RouteTypes['ResponseType']>;

/**
 * HandlerObjectForRoute is a type that represents a handler function for a route.
 * It takes in an object of arguments and a context data, and returns an object with the name of the route and the handler function.
 *
 * @template Path - The URL path of the route. It can include path parameters, denoted by a colon prefix (e.g., '/user/:id').
 * @template RouteTypes - The types for a route. It extends RouteNamedTypes with the path as a parameter.
 * @template ContextData - The data for the context in which the handler function is executed.
 *
 * @returns {Promise<{name: RouteTypes['Name'], fn: HandlerFunctionForRoute}>} A promise that resolves to an object with the name of the route and the handler function.
 */
export type HandlerObjectForRoute<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  ContextData,
> = {
  name: RouteTypes['Name'];
  fn: HandlerFunctionForRoute<Path, RouteTypes, ContextData>;
};

/**
 * The Route class is a blueprint for defining HTTP routes in an application.
 * It encapsulates all the necessary details about a route such as its name, HTTP method, path, and expected response.
 * It also includes schemas for validating path parameters, query parameters, request body, and response.
 *
 * @property {string} Path - The URL path of the route. It can include path parameters, denoted by a colon prefix (e.g., '/user/:id').
 * @property {ExpectedResponseType} ExpectedResponseType - An object type representing the expected structure of the response. It should be a subtype of TBaseResponse.
 * @template T - An object that includes the following properties:
 * @property {string} T.Name - A string that uniquely identifies the route.
 * @property {HttpMethod} T.Method - The HTTP method (GET, POST, PUT, DELETE, etc.) that the route responds to.
 * @property {Object} T.PathParamsType - An object type derived from the path string, where each property is a path parameter and its value is a PathParam type.
 * @property {Object} T.PathQueryType - An object type representing the expected structure of the query parameters in the route. It should be a subtype of TBaseQuery.
 * @property {Object} T.BodyType - An object type representing the expected structure of the request body. It should be a subtype of TBaseBody.
 * @property {Object} T.ResponseType - An object type representing the expected structure of the response. It should be a subtype of TBaseResponseStatusCodeMap and a record of ExpectedStatusCode to TBaseResponse.
 * @property {StatusCode} T.ExpectedStatusCode - The expected HTTP status code of the response. Default is StatusCode.OK.
 */
export class ApiRoute<
  Path extends string,
  T extends RouteNamedTypes<Path>,
  TContextLevelErrors extends
    | SerializableResult.ErrWithStatusCode<unknown, StatusCode>
    | never = never,
> {
  readonly #name: T['Name'];
  readonly #method: T['Method'];
  readonly #path: Path;
  readonly #pathParamsValidator: (
    input: unknown,
  ) => IValidation<T['PathParamsType']>;
  /**
   * Validates the path query.
   * @param input - The path query to parse.
   */
  public readonly pathQueryValidator: (
    input: unknown,
  ) => IValidation<T['PathQueryType']>;
  readonly #bodyValidator: (input: unknown) => IValidation<T['BodyType']>;
  readonly #fileInputDescription: T['FileInputDescriptionType'];
  readonly #responseValidator: (
    input: unknown,
  ) => IValidation<T['ResponseType'] | TContextLevelErrors>;

  /**
   * Constructs a new instance of the Route class.
   */
  public constructor({
    name,
    method,
    path,
    pathParamsValidator,
    pathQueryValidator,
    bodyValidator,
    fileInputDescription,
    responseValidator,
  }: {
    name: T['Name'];
    method: T['Method'];
    path: Path;
    pathParamsValidator: (input: unknown) => IValidation<T['PathParamsType']>;
    pathQueryValidator: (input: unknown) => IValidation<T['PathQueryType']>;
    bodyValidator: (input: unknown) => IValidation<T['BodyType']>;
    fileInputDescription: T['FileInputDescriptionType'];
    responseValidator: (
      input: unknown,
    ) => IValidation<T['ResponseType'] | TContextLevelErrors>;
  }) {
    this.#name = name;
    this.#method = method;
    this.#path = path;
    this.#pathParamsValidator = pathParamsValidator;
    this.pathQueryValidator = pathQueryValidator;
    this.#bodyValidator = bodyValidator;
    this.#fileInputDescription = fileInputDescription;
    this.#responseValidator = responseValidator;
  }

  /**
   * Getter for the name of the route.
   * @returns The name of the route.
   */
  public get name() {
    return this.#name;
  }

  /**
   * Getter for the HTTP method of the route.
   * @returns The HTTP method of the route.
   */
  public get method() {
    return this.#method;
  }

  /**
   * Getter for the path of the route.
   * @returns {Path} The path of the route.
   */
  public get path() {
    return this.#path;
  }
  /**
   * Getter for the file input description of the route.
   */
  public get fileInputDescription() {
    return this.#fileInputDescription;
  }

  /**
   * Validates the path parameters or throws an error if they are invalid.
   * @param maybePathParams - The path parameters to parse.
   * @returns The parsed path parameters.
   */
  public validatePathParams(maybePathParams: unknown) {
    return this.#pathParamsValidator(maybePathParams);
  }

  /**
   * Validates the body or throws an error if it is invalid.
   * @param maybeBody - The body to parse.
   * @returns The parsed body.
   */
  public validateBody(maybeBody: unknown) {
    return this.#bodyValidator(maybeBody);
  }

  /**
   * Validates the response or throws an error if it is invalid.
   * @param maybeResponse - The response to parse.
   * @returns The parsed response.
   */
  public validateResponse(maybeResponse: unknown) {
    return this.#responseValidator(maybeResponse);
  }

  /**
   * Getter for response validator.
   */
  public get responseValidator() {
    return this.#responseValidator;
  }

  /**
   * Constructs the relative path of the route by replacing path parameters with their actual values.
   * This method does not take into account any query parameters.
   *
   * @returns The constructed path.
   */
  public constructPath({
    pathParams,
    pathQuery,
  }: {
    pathParams: T['PathParamsType'];
    pathQuery: T['PathQueryType'];
  }) {
    let fullPath = this.path as string;
    const pathQueryStr = pathQuery ? `?${encodeQuery(pathQuery)}` : '';
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
   * This is a convenience method for creating a handler object for the route.
   *
   * @param {HandlerFunctionForRoute} handlerFunction - The handler function for the route.
   * @returns {HandlerObjectForRoute} The registry compatible handler as an object.
   */
  public handle<ContextData>(
    handlerFunction: HandlerFunctionForRoute<Path, T, ContextData>,
  ): HandlerObjectForRoute<Path, T, ContextData> {
    return {
      fn: handlerFunction,
      name: this.name,
    };
  }

  /**
   * This is a convenience method for creating a handler object for the route.
   * @param handlerFunction
   * @returns
   */
  public setupHandler<ContextData>(
    handlerFunction: HandlerFunctionForRoute<Path, T, ContextData>,
  ): { [K in T['Name']]: HandlerObjectForRoute<Path, T, ContextData> } {
    return {
      [this.name]: this.handle(handlerFunction),
    } as { [K in T['Name']]: HandlerObjectForRoute<Path, T, ContextData> };
  }
}
