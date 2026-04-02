/**
 * EventStream Hooks - React hooks for Server-Sent Event streams
 *
 * Two levels of hooks:
 * - useEventStream: Low-level hook with event handlers
 * - useEventStreamReducer: High-level hook with managed state via reducer + completion
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventStreamEventTypes } from '../constants/event-stream';
import type { EventStreamBus } from './event-stream-bus';
import type {
  EventStreamHandlerArguments,
  EventStreamRoute,
  EventStreamRouteNamedTypes,
} from './event-stream-route';
import type { Result } from './result';

// ============================================================================
// EventStream Handler Type
// ============================================================================

/**
 * EventStream handler - passed to components via props
 *
 * Contains everything needed to get a bus for a specific route.
 * Pre-bound to the route and base URL via FetchProvider.
 */
export type EventStreamHandler<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
> = {
  /** Route name */
  name: RouteTypes['Name'];
  /** Get a bus for the given args (creates connection or reuses existing) */
  getBus: (
    args: EventStreamHandlerArguments<Path, RouteTypes>,
    ctx?: Record<string, unknown>,
  ) => EventStreamBus<
    RouteTypes['EventTypes'],
    RouteTypes['CompletionData'],
    RouteTypes['CompletionError']
  >;
};

/**
 * Any EventStream handler (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic constraints
export type AnyEventStreamHandler = EventStreamHandler<string, any>;

// ============================================================================
// Types
// ============================================================================

/**
 * EventStream connection status
 */
export type EventStreamStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'completed'
  | 'error';

/**
 * EventStream error type
 */
export type EventStreamError = {
  type: 'connection' | 'parse' | 'server';
  message: string;
  cause?: unknown;
};

/**
 * Event handlers for EventStream
 */
export type EventStreamEventHandlers<
  TEventTypes extends EventStreamEventTypes,
> = {
  [K in keyof TEventTypes]?: (data: TEventTypes[K]) => void;
};

/**
 * Args for EventStream hooks
 * - Provided value: auto-connect with these args
 * - null: wait, don't connect yet
 * - undefined: imperative mode, must call connect()
 */
export type EventStreamArgsOption<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
> = EventStreamHandlerArguments<Path, RouteTypes> | null | undefined;

// ============================================================================
// useEventStream - Low-level EventStream Hook
// ============================================================================

/**
 * Return type for useEventStream
 */
export type UseEventStreamReturn<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
> = {
  /** Connection status */
  status: EventStreamStatus;
  /** Last error (if any) */
  error: EventStreamError | undefined;
  /** Completion result (if stream completed) */
  result:
    | Result<RouteTypes['CompletionData'], RouteTypes['CompletionError']>
    | undefined;
  /** Disconnect from stream */
  disconnect: () => void;
  /** Connect to stream (only available if args was undefined) */
  connect?: (args: EventStreamHandlerArguments<Path, RouteTypes>) => void;
};

/**
 * Options for useEventStream
 */
export type UseEventStreamOptions<TEventTypes extends EventStreamEventTypes> = {
  /** Event handlers */
  handlers: EventStreamEventHandlers<TEventTypes>;
  /** Base URL for EventStream endpoint */
  baseUrl: string;
  /** Authorization token (passed in query) */
  authorization?: string;
  /** Retry on disconnect */
  autoRetry?: boolean;
  /** Retry delay in ms */
  retryDelayMs?: number;
  /** Max retries before giving up */
  maxRetries?: number;
  /** Callback when stream completes */
  onComplete?: (result: Result<unknown, unknown>) => void;
};

/**
 * Low-level EventStream hook with event handlers
 *
 * Three modes based on args:
 * - args provided: auto-connect when args change
 * - args is null: wait state, don't connect
 * - args is undefined: imperative mode, must call connect()
 *
 * @example
 * ```tsx
 * // Auto-connect mode
 * const { status, error, result, disconnect } = useEventStream(
 *   renderStatusStream,
 *   { pathParams: { renderJobId: '123' }, pathQuery: {} },
 *   {
 *     baseUrl: 'https://api.example.com',
 *     handlers: {
 *       progress: (data) => setProgress(data.percent),
 *       delta: (data) => appendLog(data.text),
 *     },
 *     onComplete: (result) => {
 *       if (result.type === 'Ok') {
 *         handleSuccess(result.value);
 *       } else {
 *         handleError(result.error);
 *       }
 *     },
 *   },
 * );
 *
 * // Wait mode (pass null)
 * const { status } = useEventStream(
 *   renderStatusStream,
 *   renderJobId ? { pathParams: { renderJobId }, pathQuery: {} } : null,
 *   { ... },
 * );
 *
 * // Imperative mode (pass undefined)
 * const { status, connect } = useEventStream(
 *   renderStatusStream,
 *   undefined,
 *   { ... },
 * );
 * // Later: connect({ pathParams: { renderJobId: '123' }, pathQuery: {} });
 * ```
 */
export function useEventStream<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
>(
  route: EventStreamRoute<Path, RouteTypes>,
  args: EventStreamArgsOption<Path, RouteTypes>,
  options: UseEventStreamOptions<RouteTypes['EventTypes']>,
): UseEventStreamReturn<Path, RouteTypes> {
  const {
    handlers,
    baseUrl,
    authorization,
    autoRetry = true,
    retryDelayMs = 3000,
    maxRetries = 5,
    onComplete,
  } = options;

  const [status, setStatus] = useState<EventStreamStatus>('disconnected');
  const [error, setError] = useState<EventStreamError | undefined>(undefined);
  const [result, setResult] = useState<
    | Result<RouteTypes['CompletionData'], RouteTypes['CompletionError']>
    | undefined
  >(undefined);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const handlersRef = useRef(handlers);
  const onCompleteRef = useRef(onComplete);
  const isMountedRef = useRef(true);

  // Keep refs updated
  handlersRef.current = handlers;
  onCompleteRef.current = onComplete;

  // Close connection
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (isMountedRef.current) {
      setStatus('disconnected');
    }
  }, []);

  // Connect to EventStream
  const connectImpl = useCallback(
    (connectArgs: EventStreamHandlerArguments<Path, RouteTypes>) => {
      // Close existing connection
      disconnect();

      const path = route.constructPath({
        ...connectArgs,
        authorization,
      });
      const url = `${baseUrl}${path}`;

      if (isMountedRef.current) {
        setStatus('connecting');
        setError(undefined);
        setResult(undefined);
      }

      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (isMountedRef.current) {
          setStatus('connected');
          retriesRef.current = 0;
        }
      };

      eventSource.onerror = () => {
        if (!isMountedRef.current) return;

        setStatus('error');
        setError({
          type: 'connection',
          message: 'EventStream connection error',
        });

        eventSource.close();
        eventSourceRef.current = null;

        // Auto-retry logic
        if (autoRetry && retriesRef.current < maxRetries) {
          retriesRef.current++;
          setTimeout(() => {
            if (isMountedRef.current) {
              connectImpl(connectArgs);
            }
          }, retryDelayMs);
        }
      };

      // Set up event listeners for each handler
      for (const [eventType, handler] of Object.entries(handlersRef.current)) {
        if (handler) {
          eventSource.addEventListener(eventType, (event) => {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              (handler as (data: unknown) => void)(data);
            } catch (parseError) {
              if (isMountedRef.current) {
                setError({
                  type: 'parse',
                  message: `Failed to parse event: ${eventType}`,
                  cause: parseError,
                });
              }
            }
          });
        }
      }

      // Handle completion events
      eventSource.addEventListener('__complete', (event) => {
        try {
          const completionResult = JSON.parse((event as MessageEvent).data);
          if (isMountedRef.current) {
            setResult(completionResult);
            setStatus('completed');
            onCompleteRef.current?.(completionResult);
          }
          eventSource.close();
          eventSourceRef.current = null;
        } catch (parseError) {
          if (isMountedRef.current) {
            setError({
              type: 'parse',
              message: 'Failed to parse completion event',
              cause: parseError,
            });
          }
        }
      });

      eventSource.addEventListener('__error', (event) => {
        try {
          const completionResult = JSON.parse((event as MessageEvent).data);
          if (isMountedRef.current) {
            setResult(completionResult);
            setStatus('error');
            onCompleteRef.current?.(completionResult);
          }
          eventSource.close();
          eventSourceRef.current = null;
        } catch (parseError) {
          if (isMountedRef.current) {
            setError({
              type: 'parse',
              message: 'Failed to parse error event',
              cause: parseError,
            });
          }
        }
      });
    },
    [
      route,
      baseUrl,
      authorization,
      autoRetry,
      retryDelayMs,
      maxRetries,
      disconnect,
    ],
  );

  // Effect for auto-connect mode (when args is provided)
  useEffect(() => {
    isMountedRef.current = true;

    // If args is null (wait mode), don't connect
    if (args === null) {
      return;
    }

    // If args is undefined (imperative mode), don't auto-connect
    if (args === undefined) {
      return;
    }

    // Auto-connect with provided args
    connectImpl(args);

    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [args, connectImpl, disconnect]);

  // Return with or without connect function based on mode
  if (args === undefined) {
    // Imperative mode - include connect function
    return {
      status,
      error,
      result,
      disconnect,
      connect: connectImpl,
    };
  }

  // Auto-connect or wait mode - no connect function
  return {
    status,
    error,
    result,
    disconnect,
  };
}

// ============================================================================
// useEventStreamReducer - High-level EventStream Hook with State Management
// ============================================================================

/**
 * Reducer action for EventStream events
 */
export type EventStreamReducerAction<
  TEventTypes extends EventStreamEventTypes,
> = {
  [K in keyof TEventTypes]: {
    type: K;
    data: TEventTypes[K];
  };
}[keyof TEventTypes];

/**
 * Reducer function for EventStream state
 */
export type EventStreamReducerFn<
  TState,
  TEventTypes extends EventStreamEventTypes,
> = (state: TState, action: EventStreamReducerAction<TEventTypes>) => TState;

/**
 * Completion reducer function
 */
export type EventStreamCompletionReducerFn<
  TState,
  TCompletionData,
  TCompletionError,
> = (
  state: TState,
  result: Result<TCompletionData, TCompletionError>,
) => TState;

/**
 * Return type for useEventStreamReducer
 */
export type UseEventStreamReducerReturn<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
  TState,
> = {
  /** Current state */
  data: TState;
  /** Connection status */
  status: EventStreamStatus;
  /** Last error (if any) */
  error: EventStreamError | undefined;
  /** Disconnect from stream */
  disconnect: () => void;
  /** Reset state to initial value */
  resetState: () => void;
  /** Connect to stream (only available if args was undefined) */
  connect?: (args: EventStreamHandlerArguments<Path, RouteTypes>) => void;
};

/**
 * Reducer config for useEventStreamReducer
 */
export type EventStreamReducerConfig<
  TState,
  TEventTypes extends EventStreamEventTypes,
  TCompletionData,
  TCompletionError,
> = {
  /** Initial state */
  initialData: TState;
  /** Reducer for completion result */
  onComplete?: EventStreamCompletionReducerFn<
    TState,
    TCompletionData,
    TCompletionError
  >;
} & {
  /** Event reducers - one for each event type */
  [K in keyof TEventTypes]?: (state: TState, data: TEventTypes[K]) => TState;
};

/**
 * High-level EventStream hook with managed state via reducer
 *
 * @example
 * ```tsx
 * type RenderState = {
 *   progress: number;
 *   log: string;
 *   output: RenderOutput | null;
 *   error: string | null;
 * };
 *
 * const { data, status, disconnect } = useEventStreamReducer(
 *   renderStatusStream,
 *   {
 *     initialData: { progress: 0, log: '', output: null, error: null },
 *
 *     // Event reducers
 *     progress: (state, event) => ({ ...state, progress: event.overall }),
 *     delta: (state, event) => ({ ...state, log: state.log + event.text }),
 *
 *     // Completion reducer
 *     onComplete: (state, result) => {
 *       if (result.type === 'Ok') {
 *         return { ...state, output: result.value.output };
 *       } else {
 *         return { ...state, error: result.error.message };
 *       }
 *     },
 *   },
 *   renderJobId ? { pathParams: { renderJobId }, pathQuery: {} } : null,
 *   { baseUrl: 'https://api.example.com' },
 * );
 * ```
 */
export function useEventStreamReducer<
  Path extends string,
  RouteTypes extends EventStreamRouteNamedTypes<Path>,
  TState,
>(
  route: EventStreamRoute<Path, RouteTypes>,
  config: EventStreamReducerConfig<
    TState,
    RouteTypes['EventTypes'],
    RouteTypes['CompletionData'],
    RouteTypes['CompletionError']
  >,
  args: EventStreamArgsOption<Path, RouteTypes>,
  options: Omit<
    UseEventStreamOptions<RouteTypes['EventTypes']>,
    'handlers' | 'onComplete'
  >,
): UseEventStreamReducerReturn<Path, RouteTypes, TState> {
  const {
    initialData,
    onComplete: onCompleteReducer,
    ...eventReducers
  } = config;

  const [state, setState] = useState<TState>(initialData);
  const eventReducersRef = useRef(eventReducers);
  const onCompleteReducerRef = useRef(onCompleteReducer);

  // Keep refs updated
  eventReducersRef.current = eventReducers;
  onCompleteReducerRef.current = onCompleteReducer;

  // Create handlers for all event types
  const handleEvent = useCallback((eventType: string, data: unknown) => {
    setState((prev) => {
      const reducer =
        eventReducersRef.current[
          eventType as keyof typeof eventReducersRef.current
        ];
      if (reducer) {
        return (reducer as (state: TState, data: unknown) => TState)(
          prev,
          data,
        );
      }
      return prev;
    });
  }, []);

  // Handle completion
  const handleComplete = useCallback(
    (
      result: Result<
        RouteTypes['CompletionData'],
        RouteTypes['CompletionError']
      >,
    ) => {
      if (onCompleteReducerRef.current) {
        setState((prev) => onCompleteReducerRef.current!(prev, result));
      }
    },
    [],
  );

  // Use useEventStream with our reducer-based handlers
  const streamResult = useEventStream(route, args, {
    ...options,
    handlers: new Proxy(
      {} as EventStreamEventHandlers<RouteTypes['EventTypes']>,
      {
        get: (_target, prop) => {
          if (typeof prop === 'string') {
            return (data: unknown) => handleEvent(prop, data);
          }
          return undefined;
        },
      },
    ),
    onComplete: handleComplete,
  });

  // Reset state
  const resetState = useCallback(() => {
    setState(initialData);
  }, [initialData]);

  return {
    data: state,
    status: streamResult.status,
    error: streamResult.error,
    disconnect: streamResult.disconnect,
    resetState,
    connect: streamResult.connect,
  };
}

// ============================================================================
// useLive - Unified EventStream Hook with Live Data
// ============================================================================

/**
 * Serialize params/ctx to a stable key for dependency tracking.
 * Handles objects with consistent key ordering.
 */
function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  // Sort keys for consistent ordering
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(
    (key) =>
      `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`,
  );
  return `{${pairs.join(',')}}`;
}

/**
 * Reducer for useLive - maps event types to state transformers
 */
export type LiveReducer<TState, TEventTypes extends Record<string, unknown>> = {
  [K in keyof TEventTypes]?: (state: TState, data: TEventTypes[K]) => TState;
};

/**
 * Options for useLive
 */
export type UseLiveOptions = {
  /** Auto-retry on disconnect (default: true) */
  retry?: boolean;
  /** Delay between retries in ms (default: 3000) */
  retryDelay?: number;
  /** Max retry attempts before giving up (default: 5) */
  maxRetries?: number;
  /** Callback when an error occurs */
  onError?: (error: EventStreamError) => void;
  /** Callback when connected */
  onConnect?: () => void;
  /** Callback when disconnected */
  onDisconnect?: () => void;
};

/**
 * Return type for useLive
 */
export type UseLiveReturn<TState, TArgs> = {
  /** Current data state */
  data: TState;
  /** Connection status */
  status: EventStreamStatus;
  /** Last error (if any) */
  error: EventStreamError | undefined;
  /** Disconnect from stream */
  disconnect: () => void;
  /** Apply a local functional update without resetting live state */
  mutate: (updater: (current: TState) => TState) => void;
  /** Connect to stream (only available if params was undefined) */
  connect?: (params: TArgs, ctxOverride?: Record<string, unknown>) => void;
};

/**
 * Unified EventStream hook with live data management.
 *
 * Uses EventStreamHandler (from eventStreams props) which manages
 * connections via getBus internally.
 *
 * Two modes:
 * - Replace mode (no reducer): Latest event data replaces state
 * - Reduce mode (with reducer): Events accumulate via reducer functions
 *
 * Imperative mode (params = undefined): Call connect() manually
 *
 * @example Replace mode - latest event replaces data
 * ```tsx
 * const { data, status } = useLive(
 *   initialData,
 *   eventStreams.notifications,
 *   { pathParams: { userId }, pathQuery: {} },
 *   ctx,
 * );
 * ```
 *
 * @example Reduce mode - accumulate events
 * ```tsx
 * const { data: messages, status } = useLive(
 *   loaderData.messages,
 *   eventStreams.chatMessages,
 *   { pathParams: { channelId }, pathQuery: {} },
 *   ctx,
 *   {
 *     message_created: (msgs, event) => [...msgs, event.message],
 *     message_deleted: (msgs, event) => msgs.filter(m => m.id !== event.messageId),
 *   },
 * );
 * ```
 *
 * @example Imperative mode - manual connect
 * ```tsx
 * const { data, status, connect, disconnect } = useLive(
 *   null,
 *   eventStreams.liveUpdates,
 *   undefined,
 *   ctx,
 * );
 * // Later: connect({ pathParams: { id }, pathQuery: {} });
 * ```
 */
export function useLive<
  TState,
  TArgs extends {
    pathParams: Record<string, string>;
    pathQuery: Record<string, string>;
  },
  TEvents extends Record<string, unknown> = Record<string, unknown>,
>(
  initialData: TState,
  handler: AnyEventStreamHandler,
  params: TArgs | undefined,
  ctx: Record<string, unknown>,
  reducer?: LiveReducer<TState, TEvents>,
  options?: UseLiveOptions,
): UseLiveReturn<TState, TArgs> {
  const {
    retry = true,
    retryDelay = 3000,
    maxRetries = 5,
    onError,
    onConnect,
    onDisconnect,
  } = options ?? {};

  const [data, setData] = useState<TState>(initialData);
  const [status, setStatus] = useState<EventStreamStatus>('disconnected');
  const [error, setError] = useState<EventStreamError | undefined>(undefined);
  const appliedInitialDataKeyRef = useRef(stableSerialize(initialData));

  const unsubscribersRef = useRef<Array<() => void>>([]);
  const retriesRef = useRef(0);
  const isMountedRef = useRef(true);
  const reducerRef = useRef(reducer);
  const onErrorRef = useRef(onError);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);

  // Keep refs updated
  reducerRef.current = reducer;
  onErrorRef.current = onError;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  // Serialize params/ctx for stable dependency tracking
  const paramsKey = stableSerialize(params);
  const ctxKey = stableSerialize(ctx);
  const initialDataKey = stableSerialize(initialData);

  // Disconnect from stream
  const disconnect = useCallback(() => {
    // Unsubscribe all handlers
    for (const unsub of unsubscribersRef.current) {
      unsub();
    }
    unsubscribersRef.current = [];
    if (isMountedRef.current) {
      setStatus('disconnected');
      onDisconnectRef.current?.();
      console.debug('[useLive] disconnected', {
        handler: handler?.name ?? 'unknown',
      });
    }
  }, []);

  const mutate = useCallback((updater: (current: TState) => TState) => {
    if (!isMountedRef.current) {
      return;
    }
    setData((current) => updater(current));
  }, []);

  // Connect to stream
  const connectImpl = useCallback(
    (connectParams: TArgs, connectCtx: Record<string, unknown>) => {
      // Clean up existing subscriptions
      disconnect();

      if (isMountedRef.current) {
        setStatus('connecting');
        setError(undefined);
      }

      console.debug('[useLive] connectImpl invoked', {
        handler: handler?.name ?? 'unknown',
        params: connectParams,
      });

      try {
        // Get bus from handler - the bus manages the connection internally
        const bus = handler.getBus(connectParams, connectCtx);

        console.debug('[useLive] bus acquired', {
          handler: handler?.name ?? 'unknown',
          status: bus.status,
          refCount: bus.refCount,
        });

        // Track all unsubscribe functions
        const unsubs: Array<() => void> = [];

        // Subscribe to each event type in the reducer
        if (reducerRef.current) {
          for (const eventType of Object.keys(reducerRef.current)) {
            const eventReducer = reducerRef.current[eventType as keyof TEvents];
            if (eventReducer) {
              const unsub = bus.subscribe(
                eventType as keyof TEvents,
                (eventData) => {
                  console.debug('[useLive] event received', {
                    handler: handler?.name ?? 'unknown',
                    eventType,
                  });
                  if (isMountedRef.current) {
                    setData((prev) =>
                      (
                        eventReducer as (state: TState, data: unknown) => TState
                      )(prev, eventData),
                    );
                  }
                },
              );
              unsubs.push(unsub);

              console.debug('[useLive] subscribed to event', {
                handler: handler?.name ?? 'unknown',
                eventType,
                refCount: bus.refCount,
              });
            }
          }
        }

        // Subscribe to completion
        const unsubComplete = bus.onComplete((result) => {
          if (isMountedRef.current) {
            if (result.type === 'Ok') {
              setStatus('completed');
            } else {
              const err: EventStreamError = {
                type: 'server',
                message: 'Stream completed with error',
                cause: result.error,
              };
              setStatus('error');
              setError(err);
              onErrorRef.current?.(err);
            }
          }
        });
        unsubs.push(unsubComplete);

        // Store unsubscribers
        unsubscribersRef.current = unsubs;

        // Update status - the bus is now connected
        if (isMountedRef.current) {
          setStatus('connected');
          retriesRef.current = 0;
          onConnectRef.current?.();

          console.debug('[useLive] connection established', {
            handler: handler?.name ?? 'unknown',
          });
        }
      } catch (err) {
        if (!isMountedRef.current) return;

        const streamError: EventStreamError = {
          type: 'connection',
          message: 'Failed to connect to stream',
          cause: err,
        };
        setStatus('error');
        setError(streamError);
        onErrorRef.current?.(streamError);

        console.warn('[useLive] connection error', {
          handler: handler?.name ?? 'unknown',
          error: err,
        });

        // Auto-retry logic
        if (retry && retriesRef.current < maxRetries) {
          retriesRef.current++;
          setTimeout(() => {
            if (isMountedRef.current) {
              connectImpl(connectParams, connectCtx);
            }
          }, retryDelay);
        }
      }
    },
    [handler, disconnect, retry, retryDelay, maxRetries],
  );

  // Effect for auto-connect mode (when params is provided)
  useEffect(() => {
    isMountedRef.current = true;

    // If params is undefined (imperative mode), don't auto-connect
    if (params === undefined) {
      return;
    }

    // Auto-connect with provided params/context
    connectImpl(params, ctx);

    return () => {
      isMountedRef.current = false;
      disconnect();
    };
    // Use serialized key for stable dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, ctxKey, connectImpl, disconnect]);

  // Update data when initialData changes (e.g., from loader revalidation)
  useEffect(() => {
    if (appliedInitialDataKeyRef.current === initialDataKey) {
      return;
    }
    appliedInitialDataKeyRef.current = initialDataKey;
    setData(initialData);
  }, [initialData, initialDataKey]);

  // Return with or without connect function based on mode
  if (params === undefined) {
    // Imperative mode - include connect function
    return {
      data,
      status,
      error,
      disconnect,
      mutate,
      connect: (nextParams, nextCtx) => connectImpl(nextParams, nextCtx ?? ctx),
    };
  }

  // Auto-connect mode - no connect function
  return {
    data,
    status,
    error,
    disconnect,
    mutate,
  };
}
