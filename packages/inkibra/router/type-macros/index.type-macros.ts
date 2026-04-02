// biome-ignore lint/style/noRestrictedImports: typia is allowed in type-macro files
import typia from 'typia';
import type { RouteSchemaContract } from '../lib/api-route';

type LoaderSchemaContract = {
  response: unknown;
  error: unknown;
};

type ContextSchemaContract = {
  data: unknown;
  warning: unknown;
  error: unknown;
};

type EventStreamSchemaContract = {
  pathParams: Record<string, unknown>;
  pathQuery: Record<string, unknown>;
  eventTypes: Record<string, unknown>;
  completionData: unknown;
  completionError: unknown;
};

type CapabilitySchemaContract = {
  request: unknown;
  response: unknown;
};

type AppSchemaContract = {
  config: unknown;
};

export function defineRouteSchema<T extends RouteSchemaContract>() {
  return {
    pathParams: typia.createValidate<T['pathParams']>(),
    pathQuery: typia.createValidate<T['pathQuery']>(),
    body: typia.createValidate<T['body']>(),
    response: typia.createValidate<T['response']>(),
  };
}

export function defineLoaderSchema<T extends LoaderSchemaContract>() {
  return {
    response: typia.createValidate<T['response']>(),
    error: typia.createValidate<T['error']>(),
  };
}

export function defineContextSchema<T extends ContextSchemaContract>() {
  return {
    dataValidator: typia.createValidate<T['data']>(),
  };
}

export function definePathParamsSchema<TParam>() {
  return {
    param: typia.createValidate<TParam>(),
  };
}

export function defineEventStreamSchema<T extends EventStreamSchemaContract>() {
  return {
    pathParams: typia.createValidate<T['pathParams']>(),
    pathQuery: typia.createValidate<T['pathQuery']>(),
    eventTypes: typia.createValidate<Partial<T['eventTypes']>>(),
    completionData: typia.createValidate<T['completionData']>(),
    completionError: typia.createValidate<T['completionError']>(),
  };
}

export function defineCapabilitySchema<T extends CapabilitySchemaContract>() {
  return {
    request: typia.createValidate<T['request']>(),
    response: typia.createValidate<T['response']>(),
  };
}

export function defineAppSchema<T extends AppSchemaContract>() {
  return {
    config: typia.createValidate<T['config']>(),
  };
}
