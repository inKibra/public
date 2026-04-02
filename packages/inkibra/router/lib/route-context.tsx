/** @jsxImportSource react */
/**
 * Route Context - Provider and Hooks for Route Implementations
 *
 * Provides typed route implementations to the component tree,
 * enabling dependency injection and easy mocking for tests.
 */

import { createContext, type ReactNode, useContext } from 'react';
import type {
  AnyApiRoute,
  ApiRoute,
  HandlerArguments,
  RouteNamedTypes,
} from './api-route';
import type {
  AnyEventStreamRoute,
  EventStreamRoute,
  EventStreamRouteNamedTypes,
} from './event-stream-route';
import type { Result } from './result';
import type { TransportLevelError } from './transport';
import type { ApiRouteHandler as ApiRouteHandlerBase } from './use-api-hook';

/**
 * Map of API route names to API routes
 */
type ApiRouteMap = Record<string, AnyApiRoute>;

/**
 * Map of EventStream route names to EventStream routes
 */
type EventStreamRouteMap = Record<string, AnyEventStreamRoute>;

/**
 * Route map - union of API and EventStream routes
 */
export type RouteMap = ApiRouteMap & EventStreamRouteMap;

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Extract API route handler type from a route definition
 * Includes name, method, and fn so hooks can access everything from one object.
 */
export type ApiRouteHandler<R extends AnyApiRoute> = R extends ApiRoute<
  infer Path,
  infer T extends RouteNamedTypes<string>
>
  ? ApiRouteHandlerBase<Path, T>
  : never;

/**
 * SSE route handler (factory for SSE client)
 */
export type SseRouteHandler<R extends AnyEventStreamRoute> =
  R extends EventStreamRoute<
    infer _Path,
    infer T extends EventStreamRouteNamedTypes<string>
  >
    ? {
        name: T['Name'];
        connect: (args: {
          pathParams: T['PathParamsType'];
          pathQuery: T['PathQueryType'];
        }) => SseConnection<T['EventTypes']>;
      }
    : never;

/**
 * SSE connection handle
 */
export type SseConnection<TEventTypes> = {
  /** Subscribe to events */
  on: <K extends keyof TEventTypes>(
    event: K,
    handler: (data: TEventTypes[K]) => void,
  ) => void;
  /** Unsubscribe from events */
  off: <K extends keyof TEventTypes>(
    event: K,
    handler: (data: TEventTypes[K]) => void,
  ) => void;
  /** Close the connection */
  close: () => void;
  /** Connection status */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
};

/**
 * Handler for any route type
 */
export type RouteHandler<R extends AnyApiRoute | AnyEventStreamRoute> =
  R extends AnyApiRoute
    ? ApiRouteHandler<R>
    : R extends AnyEventStreamRoute
      ? SseRouteHandler<R>
      : never;

/**
 * Implementation map for a set of routes
 */
export type RouteImplementation<T extends RouteMap> = {
  [K in keyof T]: RouteHandler<T[K]>;
};

/**
 * Partial implementation - for mocking only some routes
 */
export type PartialRouteImplementation<T extends RouteMap> = Partial<
  RouteImplementation<T>
>;

// ============================================================================
// Routes Context
// ============================================================================

/**
 * Context value type
 */
type RoutesContextValue = RouteImplementation<RouteMap> | undefined;

/**
 * The routes context
 */
const RoutesContext = createContext<RoutesContextValue>(undefined);

// ============================================================================
// RoutesProvider Component
// ============================================================================

/**
 * Props for RoutesProvider
 */
export type RoutesProviderProps<T extends RouteMap> = {
  /** Route implementations */
  impl: RouteImplementation<T>;
  /** Children */
  children: ReactNode;
};

/**
 * Provides route implementations to child components
 *
 * @example
 * ```tsx
 * // Full app - implement all routes
 * <RoutesProvider impl={{
 *   getProfile: fetchProvider.createRouteHandlerObject(getProfile),
 *   updateProfile: fetchProvider.createRouteHandlerObject(updateProfile),
 * }}>
 *   <App />
 * </RoutesProvider>
 *
 * // Stories/tests - mock only what's needed
 * <RoutesProvider impl={{
 *   getProfile: {
 *     name: 'getProfile',
 *     fn: async () => Ok({ id: '1', name: 'Test User' }),
 *   },
 * }}>
 *   <ProfilePage />
 * </RoutesProvider>
 * ```
 */
export function RoutesProvider<T extends RouteMap>({
  impl,
  children,
}: RoutesProviderProps<T>): React.ReactElement {
  return (
    <RoutesContext.Provider value={impl as RouteImplementation<RouteMap>}>
      {children}
    </RoutesContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access route implementations
 *
 * @example
 * ```tsx
 * function ProfilePage() {
 *   const routes = useRoutes({ getProfile, updateProfile });
 *
 *   const handleFetch = async () => {
 *     const result = await routes.getProfile.fn({
 *       pathParams: { id: profileId },
 *       pathQuery: {},
 *       body: undefined,
 *     });
 *
 *     if (result.type === 'Ok') {
 *       setProfile(result.value);
 *     }
 *   };
 * }
 * ```
 */
export function useRoutes<T extends RouteMap>(
  requirement: T,
): RouteImplementation<T> {
  const context = useContext(RoutesContext);

  if (context === undefined) {
    throw new Error(
      'useRoutes must be used within a RoutesProvider. ' +
        'Make sure your component is wrapped with <RoutesProvider impl={...}>.',
    );
  }

  // Validate that all required routes are implemented
  const missingRoutes: string[] = [];
  const result: Partial<RouteImplementation<T>> = {};

  for (const routeName of Object.keys(requirement)) {
    const handler = context[routeName];
    if (handler === undefined) {
      missingRoutes.push(routeName);
    } else {
      (result as Record<string, unknown>)[routeName] = handler;
    }
  }

  if (missingRoutes.length > 0) {
    throw new Error(
      `useRoutes: Missing implementations for routes: ${missingRoutes.join(', ')}. ` +
        'Make sure all required routes are provided to RoutesProvider.',
    );
  }

  return result as RouteImplementation<T>;
}

/**
 * Hook to optionally access route implementations
 * Returns undefined if RoutesProvider is not found
 */
export function useRoutesOptional<T extends RouteMap>(
  requirement: T,
): RouteImplementation<T> | undefined {
  const context = useContext(RoutesContext);

  if (context === undefined) {
    return undefined;
  }

  // Check if all required routes are implemented
  const result: Partial<RouteImplementation<T>> = {};

  for (const routeName of Object.keys(requirement)) {
    const handler = context[routeName];
    if (handler === undefined) {
      return undefined;
    }
    (result as Record<string, unknown>)[routeName] = handler;
  }

  return result as RouteImplementation<T>;
}

/**
 * Hook to access a single route's implementation
 *
 * @example
 * ```tsx
 * function ProfileCard() {
 *   const getProfile = useRoute(getProfileRoute);
 *
 *   const handleRefresh = async () => {
 *     const result = await getProfile.fn({
 *       pathParams: { id: profileId },
 *       pathQuery: {},
 *       body: undefined,
 *     });
 *   };
 * }
 * ```
 */
export function useRoute<R extends AnyApiRoute | AnyEventStreamRoute>(
  route: R,
): RouteHandler<R> {
  const context = useContext(RoutesContext);

  if (context === undefined) {
    throw new Error(
      'useRoute must be used within a RoutesProvider. ' +
        'Make sure your component is wrapped with <RoutesProvider impl={...}>.',
    );
  }

  const routeName = route.name;
  const handler = context[routeName];

  if (handler === undefined) {
    throw new Error(
      `useRoute: Route "${routeName}" is not implemented. ` +
        'Make sure it is provided to RoutesProvider.',
    );
  }

  return handler as RouteHandler<R>;
}

// ============================================================================
// Route Implementation Helpers
// ============================================================================

/**
 * Options for implementing a route with additional behavior
 */
export type ImplementRouteOptions<TArgs, TResult> = {
  /** Transform arguments before sending */
  transformArgs?: (args: TArgs) => TArgs;
  /** Transform result after receiving */
  transformResult?: (result: TResult) => TResult;
  /** Called on successful response */
  onSuccess?: (result: TResult, args: TArgs) => void;
  /** Called on error */
  onError?: (error: unknown, args: TArgs) => void;
};

/**
 * Wrap a route handler with additional behavior
 *
 * @example
 * ```typescript
 * const getProfileWithLogging = implementRoute(
 *   getProfile,
 *   fetchProvider.createRouteHandler(getProfile),
 *   {
 *     onSuccess: (result, args) => {
 *       analytics.track('profile_loaded', { id: args.pathParams.id });
 *     },
 *     onError: (error, args) => {
 *       errorReporting.capture(error);
 *     },
 *   },
 * );
 * ```
 */
export function implementRoute<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
>(
  route: ApiRoute<Path, RouteTypes>,
  handler: (
    args: HandlerArguments<Path, RouteTypes>,
  ) => Promise<Result<RouteTypes['ResponseType'], TransportLevelError>>,
  options?: ImplementRouteOptions<
    HandlerArguments<Path, RouteTypes>,
    Result<RouteTypes['ResponseType'], TransportLevelError>
  >,
): ApiRouteHandler<ApiRoute<Path, RouteTypes>> {
  return {
    name: route.name,
    method: route.method,
    fn: async (args) => {
      const transformedArgs = options?.transformArgs
        ? options.transformArgs(args)
        : args;

      try {
        let result = await handler(transformedArgs);

        if (options?.transformResult) {
          result = options.transformResult(result);
        }

        if (result.type === 'Ok') {
          options?.onSuccess?.(result, transformedArgs);
        } else {
          options?.onError?.(result.error, transformedArgs);
        }

        return result;
      } catch (error) {
        options?.onError?.(error, transformedArgs);
        throw error;
      }
    },
  };
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract handler function type from an API route
 */
export type ApiRouteHandlerFn<R extends AnyApiRoute> = R extends ApiRoute<
  infer Path,
  infer T extends RouteNamedTypes<string>
>
  ? (
      args: HandlerArguments<Path, T>,
    ) => Promise<Result<T['ResponseType'], TransportLevelError>>
  : never;
