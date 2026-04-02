import { createEventStreamHandler } from '@inkibra/router/lib/event-stream-handler';
import { Err } from '@inkibra/router/lib/result';
import type { ConstructBackend } from './backend';
import type { ConstructImpulseRegistry } from './impulses';
import type {
  ConstructBackendStreamRoutes,
  StreamConstructRuntimeEvents,
} from './stream-routes';

export type CreateConstructBackendStreamHandlersOptions<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse = ReturnType<typeof Err<{ type: 'Unauthenticated' }>>,
> = {
  backend: ConstructBackend<TAuth, TImpulses, TAuthResponse>;
  routes: ConstructBackendStreamRoutes;
  streamRuntimeEvents: (args: {
    constructId: string;
    auth: TAuth;
    cursor?: string;
  }) => AsyncGenerator<
    {
      [K in keyof StreamConstructRuntimeEvents.EventTypes]: {
        event: K;
        data: StreamConstructRuntimeEvents.EventTypes[K];
      };
    }[keyof StreamConstructRuntimeEvents.EventTypes],
    import('@inkibra/router/lib/result').Result<
      StreamConstructRuntimeEvents.CompletionData,
      StreamConstructRuntimeEvents.CompletionError
    >,
    unknown
  >;
};

export function createConstructBackendStreamHandlers<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse = ReturnType<typeof Err<{ type: 'Unauthenticated' }>>,
>(
  options: CreateConstructBackendStreamHandlersOptions<
    TAuth,
    TImpulses,
    TAuthResponse
  >,
) {
  return {
    streamConstructRuntimeEvents: createEventStreamHandler({
      route: options.routes.streamConstructRuntimeEvents,
      handler: async function* (args, ctx: { auth: unknown }) {
        const authResult = await options.backend.auth.require(ctx);
        if (!authResult.ok) {
          return Err({ type: 'Unauthenticated' as const });
        }

        let constructId: string;
        try {
          constructId = await options.backend.getConstructId({
            pathParams: args.pathParams as Record<string, string>,
            pathQuery: args.pathQuery as Record<string, string | undefined>,
            auth: authResult.auth,
          });
        } catch {
          return Err({ type: 'ConstructNotFound' as const });
        }

        return yield* options.streamRuntimeEvents({
          constructId,
          auth: authResult.auth,
          cursor: args.pathQuery.cursor,
        });
      },
    }),
  };
}
