import type { AnyContextCodec } from '@inkibra/router/lib/context-codec';
import {
  createEventStreamRoute,
  defineEventStreamSchema,
} from '@inkibra/router/lib/event-stream-route';
import type { ConstructEventStreamEventTypes } from '../index';

function asValid<T>(input: unknown) {
  return {
    success: true as const,
    data: input as T,
  };
}

export namespace StreamConstructRuntimeEvents {
  export type PathParams = {
    constructId: string;
  };
  export type PathQuery = {
    cursor?: string;
  };
  export type EventTypes = ConstructEventStreamEventTypes;
  export type CompletionData = {
    reason: 'disconnected';
  };
  export type CompletionError =
    | { type: 'ConstructNotFound' }
    | { type: 'RuntimeEventStreamUnavailable' }
    | { type: 'Unauthenticated' }
    | { type: 'Forbidden' };
}

export type CreateConstructBackendStreamRoutesOptions = {
  authCodec: AnyContextCodec;
  basePath?: string;
};

export function createConstructBackendStreamRoutes(
  options: CreateConstructBackendStreamRoutesOptions,
) {
  const basePath = options.basePath ?? '/api/inkibra/ai-construct/constructs';

  const streamConstructRuntimeEventsSchema = defineEventStreamSchema({
    pathParams: asValid<StreamConstructRuntimeEvents.PathParams>,
    pathQuery: asValid<StreamConstructRuntimeEvents.PathQuery>,
    eventTypes: asValid<Partial<StreamConstructRuntimeEvents.EventTypes>>,
    completionData: asValid<StreamConstructRuntimeEvents.CompletionData>,
    completionError: asValid<StreamConstructRuntimeEvents.CompletionError>,
  });

  return {
    streamConstructRuntimeEvents: createEventStreamRoute({
      name: 'streamConstructRuntimeEvents',
      path: `${basePath}/:constructId/runtime/events`,
      schema: streamConstructRuntimeEventsSchema,
      contextCodec: { auth: options.authCodec },
    }),
  };
}

export type ConstructBackendStreamRoutes = ReturnType<
  typeof createConstructBackendStreamRoutes
>;
