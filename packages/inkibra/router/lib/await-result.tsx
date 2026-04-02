/**
 * AwaitResult - Component for handling async data with loading/error states
 *
 * Three modes:
 * 1. Basic: loading + error props
 * 2. Initial/Ongoing: separate props for first load vs revalidation
 * 3. Full state: render prop with (data, state) for full control
 */

import * as React from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * Query state phases
 */
export type QueryPhase =
  | 'loading'
  | 'error'
  | 'success'
  | 'revalidating'
  | 'revalidationError'
  | 'optimistic';

/**
 * State object passed to render prop
 */
export interface QueryState {
  phase: QueryPhase;
  isInitial: boolean;
  error?: Error;
  last?: unknown;
}

/**
 * Props for AwaitResult component
 */
export interface AwaitResultProps<T> {
  /** Promise to resolve */
  resolve: Promise<T>;
  /**
   * Optional optimistic VALUE (not a promise).
   * Returned synchronously from runQuery when cache has data.
   */
  optimisticValue?: T;

  // Mode 1: Basic props
  /** Loading indicator (initial and ongoing) */
  loading?: React.ReactNode;
  /** Error handler (initial and ongoing) */
  error?: (error: Error) => React.ReactNode;

  // Mode 2: Initial vs Ongoing props
  /** Loading indicator for first load only */
  initialLoading?: React.ReactNode;
  /** Error handler for first load only */
  initialError?: (error: Error) => React.ReactNode;
  /** Loading indicator during revalidation (receives current data) */
  ongoingLoading?: (data: T) => React.ReactNode;
  /** Error handler during revalidation (receives error and current data) */
  ongoingError?: (error: Error, data: T) => React.ReactNode;

  // Mode 3: Full state control via children render prop
  /** Render function with data and state */
  children: ((data: T, state: QueryState) => React.ReactNode) | React.ReactNode;
}

// ============================================================================
// Internal State
// ============================================================================

interface InternalState<T> {
  data: T | undefined;
  error: Error | undefined;
  phase: QueryPhase;
  isInitial: boolean;
  promiseId: number;
  last?: T;
}

// ============================================================================
// Component
// ============================================================================

let promiseCounter = 0;

/**
 * AwaitResult component
 *
 * @example With runQuery (recommended)
 * ```tsx
 * const [promise, optimisticValue] = runQuery(boardsQuery, { status: 'active' });
 *
 * <AwaitResult resolve={promise} optimisticValue={optimisticValue} loading={<Skeleton />}>
 *   {(data) => <BoardList boards={data} />}
 * </AwaitResult>
 * ```
 *
 * @example Basic mode
 * ```tsx
 * <AwaitResult resolve={promise} loading={<Skeleton />} error={(e) => <Error e={e} />}>
 *   {(data) => <Content data={data} />}
 * </AwaitResult>
 * ```
 *
 * @example Initial/Ongoing mode
 * ```tsx
 * <AwaitResult
 *   resolve={promise}
 *   initialLoading={<Skeleton />}
 *   initialError={(e) => <FullError e={e} />}
 *   ongoingLoading={(data) => <Content data={data} isRefreshing />}
 *   ongoingError={(e, data) => <Content data={data} error={e} />}
 * >
 *   {(data) => <Content data={data} />}
 * </AwaitResult>
 * ```
 *
 * @example Full state control
 * ```tsx
 * <AwaitResult resolve={promise}>
 *   {(data, state) => {
 *     if (state.isInitial && state.phase === 'loading') return <Skeleton />;
 *     if (state.isInitial && state.phase === 'error') return <Error e={state.error} />;
 *     return <Content data={data} phase={state.phase} />;
 *   }}
 * </AwaitResult>
 * ```
 */
export function AwaitResult<T>({
  resolve,
  optimisticValue,
  loading,
  error,
  initialLoading,
  initialError,
  ongoingLoading,
  ongoingError,
  children,
}: AwaitResultProps<T>): React.ReactNode {
  // Initialize with optimisticValue if provided (synchronous)
  const [state, setState] = React.useState<InternalState<T>>(() => ({
    data: optimisticValue,
    error: undefined,
    phase: optimisticValue !== undefined ? 'optimistic' : 'loading',
    isInitial: optimisticValue === undefined,
    promiseId: ++promiseCounter,
    last: undefined,
  }));

  // Handle optimisticValue changes (synchronous)
  React.useEffect(() => {
    if (optimisticValue !== undefined) {
      setState((prev) => ({
        ...prev,
        data: optimisticValue,
        last: prev.data,
        phase: 'optimistic',
        isInitial: false,
      }));
    }
  }, [optimisticValue]);

  React.useEffect(() => {
    const currentPromiseId = ++promiseCounter;

    // Track if this is a revalidation (we already have data)
    setState((prev) => {
      const isRevalidation = prev.data !== undefined;
      return {
        ...prev,
        phase: isRevalidation ? 'revalidating' : 'loading',
        isInitial: !isRevalidation,
        promiseId: currentPromiseId,
      };
    });

    resolve
      .then((data) => {
        setState((prev) => {
          // Ignore if a newer promise was started
          if (prev.promiseId !== currentPromiseId) return prev;
          return {
            data,
            last:
              prev.phase === 'optimistic'
                ? (prev.last ?? prev.data)
                : prev.data,
            error: undefined,
            phase: 'success',
            isInitial: false,
            promiseId: currentPromiseId,
          };
        });
      })
      .catch((err) => {
        setState((prev) => {
          // Ignore if a newer promise was started
          if (prev.promiseId !== currentPromiseId) return prev;
          const error = err instanceof Error ? err : new Error(String(err));
          const isRevalidation = prev.data !== undefined;
          return {
            ...prev,
            error,
            phase: isRevalidation ? 'revalidationError' : 'error',
            promiseId: currentPromiseId,
          };
        });
      });
  }, [resolve]);

  // Build the state object for render prop
  const queryState: QueryState = {
    phase: state.phase,
    isInitial: state.isInitial,
    error: state.error,
    last: state.last,
  };

  // Render based on phase
  const { phase, isInitial, data, error: stateError } = state;

  // Initial loading
  if (isInitial && phase === 'loading') {
    if (initialLoading !== undefined) return initialLoading;
    if (loading !== undefined) return loading;
    // Fall through to render prop if provided
    if (typeof children === 'function') {
      return children(data as T, queryState);
    }
    return null;
  }

  // Initial error
  if (isInitial && phase === 'error' && stateError) {
    if (initialError !== undefined) return initialError(stateError);
    if (error !== undefined) return error(stateError);
    // Fall through to render prop if provided
    if (typeof children === 'function') {
      return children(data as T, queryState);
    }
    throw stateError; // Re-throw if no handler
  }

  // Ongoing loading (revalidating)
  if (!isInitial && phase === 'revalidating' && data !== undefined) {
    if (ongoingLoading !== undefined) return ongoingLoading(data);
    if (loading !== undefined) return loading;
    // Fall through to success with data
  }

  // Ongoing error (revalidation error)
  if (
    !isInitial &&
    phase === 'revalidationError' &&
    stateError &&
    data !== undefined
  ) {
    if (ongoingError !== undefined) return ongoingError(stateError, data);
    if (error !== undefined) return error(stateError);
    // Fall through to success with stale data
  }

  // Success or optimistic - render children
  if (data !== undefined) {
    if (typeof children === 'function') {
      return children(data, queryState);
    }
    return children;
  }

  // Fallback
  return null;
}

// ============================================================================
// Export
// ============================================================================

export default AwaitResult;
