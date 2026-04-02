import { useEffect, useRef } from 'react';
import type { SseClient } from './sse-client';
import type { SseRouteNamedTypes } from './sse-route';

/**
 * Hook for managing SSE client connections in React components.
 * Automatically handles connection lifecycle, event listeners, and cleanup.
 * The clientFactory is automatically memoized to prevent unnecessary reconnections.
 * Event listeners are stored in a ref to always use the latest handlers without
 * causing reconnections when handlers change.
 * Note: params are internally memoized using a JSON signature so inline objects
 * won't trigger reconnections, but avoid non-serializable values or update this
 * hook to use a different comparison strategy if needed.
 *
 * @param clientFactory - Function that returns an SSE client instance
 * @param params - Connection parameters (null to disable connection)
 * @param eventListeners - Object mapping event names to handler functions
 * @param deps - Optional dependency array for reconnecting when values change
 *
 * @example
 * ```tsx
 * useSseClient(
 *   () => InkibraSocialApiFetcherRegistry.get('RenderStatusStream').fn(),
 *   renderJobId ? { pathParams: { renderJobId } } : null,
 *   {
 *     progress: (data) => setProgress(data.overall),
 *     done: () => setStep('complete'),
 *     error: (data) => setError(data.message),
 *   },
 *   [renderJobId]
 * );
 * ```
 */

function useStableJsonValue<T>(value: T): T {
  const signatureRef = useRef<string | undefined>(undefined);
  const valueRef = useRef(value);

  const signature = JSON.stringify(value ?? null);

  if (signatureRef.current !== signature) {
    signatureRef.current = signature;
    valueRef.current = value;
  }

  return valueRef.current;
}

export function useSseClient<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
>(
  clientFactory: () => SseClient<Path, RouteTypes>,
  params: {
    pathParams: RouteTypes['PathParamsType'];
    pathQuery?: RouteTypes['PathQueryType'];
  } | null,
  eventListeners: {
    [K in keyof RouteTypes['EventTypes']]?: (
      data: RouteTypes['EventTypes'][K],
    ) => void;
  },
  deps: React.DependencyList = [],
): void {
  // Store clientFactory in a ref to get the latest version without causing reconnections
  // This allows the factory to change without triggering a reconnect, but we always use the latest one
  const clientFactoryRef = useRef(clientFactory);
  clientFactoryRef.current = clientFactory;

  // Use a ref to store the latest event listeners so we always use the current ones
  // without causing reconnections when handlers change
  const eventListenersRef = useRef(eventListeners);
  eventListenersRef.current = eventListeners;

  const memoizedParams = useStableJsonValue(params);

  useEffect(() => {
    // Don't connect if params are null
    if (!memoizedParams) {
      return;
    }

    // Create client using the latest factory
    const sseClient = clientFactoryRef.current();

    // Set up all event listeners using the ref to get the latest handlers
    for (const [eventType, handler] of Object.entries(
      eventListenersRef.current,
    )) {
      if (handler) {
        sseClient.addEventListener(
          eventType as keyof RouteTypes['EventTypes'],
          handler as (
            data: RouteTypes['EventTypes'][keyof RouteTypes['EventTypes']],
          ) => void,
        );
      }
    }

    // Connect to the stream
    void sseClient.connect(memoizedParams);

    // Cleanup function - disconnect automatically removes all listeners
    return () => {
      sseClient.disconnect();
    };
  }, [memoizedParams, ...deps]);
}
