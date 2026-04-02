/**
 * useApiHook - React hook for making API calls
 *
 * Features:
 * - Result type return (not separate data/error)
 * - isLoading shows what's loading (false | TArgs)
 * - Concurrency control
 * - Optimistic updates
 * - Callbacks (onSuccess, onError)
 */

import { useCallback, useRef, useState } from 'react';
import { HttpMethod } from '../constants/http-method';
import type { HandlerArguments, RouteNamedTypes } from './api-route';
import { Err, type Result } from './result';
import type { TransportLevelError } from './transport';

// ============================================================================
// API Route Handler Type
// ============================================================================

/**
 * API route handler - passed to components via props
 *
 * Contains the handler function AND metadata (name, method) so hooks
 * can access everything they need from a single object.
 */
export type ApiRouteHandler<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
> = {
  /** Route name */
  name: RouteTypes['Name'];
  /** HTTP method (used for concurrency default) */
  method: HttpMethod;
  /** The handler function */
  fn: (
    args: HandlerArguments<Path, RouteTypes>,
  ) => Promise<Result<RouteTypes['ResponseType'], TransportLevelError>>;
};

// ============================================================================
// Types
// ============================================================================

/**
 * Concurrency modes for API hooks
 */
export type ConcurrencyMode =
  | 'cancel-previous' // Cancel previous request, latest wins (default for GET)
  | 'block' // Block subsequent calls while one is in-flight (default for mutations)
  | 'queue' // Queue up calls, execute sequentially
  | 'debounce' // Wait N ms of inactivity before executing
  | 'throttle'; // Max one call per N ms

/**
 * Options for useApiHook
 */
export type UseApiHookOptions<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TOptimistic,
> = {
  /** Concurrency mode (auto-detected from HTTP method if not specified) */
  concurrency?: ConcurrencyMode;
  /** Debounce delay in ms (only for 'debounce' mode) */
  debounceMs?: number;
  /** Throttle interval in ms (only for 'throttle' mode) */
  throttleMs?: number;
  /** Compute optimistic value while request is in-flight */
  getOptimisticValue?: (
    args: HandlerArguments<Path, RouteTypes>,
  ) => TOptimistic;
  /** Called on successful response */
  onSuccess?: (
    result: RouteTypes['ResponseType'],
    args: HandlerArguments<Path, RouteTypes>,
  ) => void;
  /** Called on error */
  onError?: (
    error: TransportLevelError,
    args: HandlerArguments<Path, RouteTypes>,
  ) => void;
};

/**
 * Return type for useApiHook
 */
export type UseApiHookReturn<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TOptimistic,
> = {
  /** Execute the API call */
  execute: (
    args: HandlerArguments<Path, RouteTypes>,
  ) => Promise<Result<RouteTypes['ResponseType'], TransportLevelError>>;
  /** Loading state: false or the args being loaded */
  isLoading: false | HandlerArguments<Path, RouteTypes>;
  /** Latest result (success or error) */
  result: Result<RouteTypes['ResponseType'], TransportLevelError> | undefined;
  /** Optimistic value (if loading and getOptimisticValue provided) */
  optimisticValue: TOptimistic | undefined;
  /** Whether currently showing optimistic data */
  isOptimistic: boolean;
  /** Reset state to initial values */
  reset: () => void;
};

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Determine default concurrency mode from HTTP method
 */
function getDefaultConcurrency(method: HttpMethod): ConcurrencyMode {
  switch (method) {
    case HttpMethod.GET:
      return 'cancel-previous';
    case HttpMethod.POST:
    case HttpMethod.PUT:
    case HttpMethod.PATCH:
    case HttpMethod.DELETE:
      return 'block';
    default:
      return 'block';
  }
}

/**
 * Hook for making API calls with concurrency control and proper React patterns
 *
 * @example
 * ```tsx
 * // Basic usage - pass the route handler from props
 * const { execute, isLoading, result } = useApiHook(apiRoutes.getProfile);
 *
 * // Handle result with type narrowing
 * if (result?.type === 'Ok') {
 *   console.log(result.value);
 * } else if (result?.type === 'Err') {
 *   console.error(result.error);
 * }
 *
 * // With optimistic updates
 * const { execute, result, optimisticValue, isOptimistic } = useApiHook(
 *   apiRoutes.updateProfile,
 *   {
 *     getOptimisticValue: (args) => ({ ...currentProfile, ...args.body }),
 *     onSuccess: () => toast('Profile updated!'),
 *   },
 * );
 * ```
 */
export function useApiHook<
  Path extends string,
  RouteTypes extends RouteNamedTypes<Path>,
  TOptimistic = undefined,
>(
  routeHandler: ApiRouteHandler<Path, RouteTypes>,
  options?: UseApiHookOptions<Path, RouteTypes, TOptimistic>,
): UseApiHookReturn<Path, RouteTypes, TOptimistic> {
  const {
    concurrency = getDefaultConcurrency(routeHandler.method),
    debounceMs = 300,
    throttleMs = 300,
    getOptimisticValue,
    onSuccess,
    onError,
  } = options ?? {};

  // Extract the handler function
  const handler = routeHandler.fn;

  // State
  const [isLoading, setIsLoading] = useState<
    false | HandlerArguments<Path, RouteTypes>
  >(false);
  const [result, setResult] = useState<
    Result<RouteTypes['ResponseType'], TransportLevelError> | undefined
  >(undefined);
  const [optimisticValue, setOptimisticValue] = useState<
    TOptimistic | undefined
  >(undefined);

  // Refs for concurrency control
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isBlockedRef = useRef(false);
  const queueRef = useRef<
    Array<{
      args: HandlerArguments<Path, RouteTypes>;
      resolve: (
        value: Result<RouteTypes['ResponseType'], TransportLevelError>,
      ) => void;
      reject: (error: unknown) => void;
    }>
  >([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastThrottleTimeRef = useRef(0);
  const handlerRef = useRef(handler);

  // Keep handler ref updated
  handlerRef.current = handler;

  // Keep callback refs updated to avoid stale closures
  const getOptimisticValueRef = useRef(getOptimisticValue);
  getOptimisticValueRef.current = getOptimisticValue;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Process queue for 'queue' mode
  const processQueue = useCallback(async () => {
    if (queueRef.current.length === 0 || isBlockedRef.current) return;

    const next = queueRef.current.shift();
    if (!next) return;

    isBlockedRef.current = true;

    try {
      const response = await handlerRef.current(next.args);
      next.resolve(response);
    } catch (err) {
      next.reject(err);
    } finally {
      isBlockedRef.current = false;
      processQueue().catch(() => {
        // Queue processing errors are handled per-item
      });
    }
  }, []);

  // Reset function
  const reset = useCallback(() => {
    setIsLoading(false);
    setResult(undefined);
    setOptimisticValue(undefined);
    requestIdRef.current = 0;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isBlockedRef.current = false;
    queueRef.current = [];
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Core execution logic
  const executeCore = useCallback(
    async (
      args: HandlerArguments<Path, RouteTypes>,
      requestId: number,
    ): Promise<Result<RouteTypes['ResponseType'], TransportLevelError>> => {
      // Set loading state with args
      setIsLoading(args);

      // Set optimistic value if provided (using ref to avoid stale closure)
      if (getOptimisticValueRef.current) {
        setOptimisticValue(getOptimisticValueRef.current(args));
      }

      try {
        const response = await handlerRef.current(args);

        // Check if this is still the latest request
        if (
          requestId !== requestIdRef.current &&
          concurrency === 'cancel-previous'
        ) {
          return response;
        }

        setResult(response);

        if (response.type === 'Ok') {
          onSuccessRef.current?.(response.value, args);
        } else {
          onErrorRef.current?.(response.error, args);
        }

        return response;
      } catch (err) {
        // Check if this is still the latest request
        if (
          requestId !== requestIdRef.current &&
          concurrency === 'cancel-previous'
        ) {
          throw err;
        }

        const errorResult = Err({
          type: 'NetworkError' as const,
          message: err instanceof Error ? err.message : 'Unknown error',
          cause: err,
        });
        setResult(errorResult);
        onErrorRef.current?.(errorResult.error, args);
        return errorResult;
      } finally {
        // Only update loading state if this is the latest request
        if (
          requestId === requestIdRef.current ||
          concurrency !== 'cancel-previous'
        ) {
          setIsLoading(false);
          setOptimisticValue(undefined);

          if (concurrency === 'block') {
            isBlockedRef.current = false;
          }
        }
      }
    },
    [concurrency],
  );

  // Main execute function
  const execute = useCallback(
    async (
      args: HandlerArguments<Path, RouteTypes>,
    ): Promise<Result<RouteTypes['ResponseType'], TransportLevelError>> => {
      const currentRequestId = ++requestIdRef.current;

      // Handle different concurrency modes
      switch (concurrency) {
        case 'cancel-previous': {
          abortControllerRef.current?.abort();
          abortControllerRef.current = new AbortController();
          break;
        }
        case 'block': {
          if (isBlockedRef.current) {
            return Err({
              type: 'NetworkError' as const,
              message: 'Request blocked: another request is in-flight',
            });
          }
          isBlockedRef.current = true;
          break;
        }
        case 'queue': {
          return new Promise((resolve, reject) => {
            queueRef.current.push({ args, resolve, reject });
            processQueue();
          });
        }
        case 'debounce': {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          return new Promise((resolve, reject) => {
            debounceTimerRef.current = setTimeout(async () => {
              try {
                const result = await executeCore(args, currentRequestId);
                resolve(result);
              } catch (err) {
                reject(err);
              }
            }, debounceMs);
          });
        }
        case 'throttle': {
          const now = Date.now();
          const timeSinceLastCall = now - lastThrottleTimeRef.current;
          if (timeSinceLastCall < throttleMs) {
            return Err({
              type: 'NetworkError' as const,
              message: 'Request throttled',
            });
          }
          lastThrottleTimeRef.current = now;
          break;
        }
      }

      return executeCore(args, currentRequestId);
    },
    [concurrency, debounceMs, throttleMs, executeCore, processQueue],
  );

  // Computed values
  const isOptimistic = isLoading !== false && optimisticValue !== undefined;

  return {
    execute,
    isLoading,
    result,
    optimisticValue,
    isOptimistic,
    reset,
  };
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Any API route handler (for generic constraints)
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic route constraints
export type AnyApiRouteHandler = ApiRouteHandler<string, any>;
