/**
 * EventStream Bus - Client-side connection sharing
 *
 * The bus manages subscriptions to EventStream routes with connection ref counting.
 * Multiple subscribers to the same route+args share a single HTTP connection.
 *
 * First subscriber → opens HTTP connection
 * Last unsubscriber → closes HTTP connection
 */

import type { EventStreamEventTypes } from '../constants/event-stream';
import type { Result } from './result';

// ============================================================================
// Bus Types
// ============================================================================

/**
 * Connection status
 */
export type EventStreamBusStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'completed'
  | 'error';

/**
 * Event handler function
 */
export type EventHandler<T> = (data: T) => void;

/**
 * Completion handler function
 */
export type CompletionHandler<TData, TError> = (
  result: Result<TData, TError>,
) => void;

/**
 * EventStream Bus - manages subscriptions for a single route+args instance
 *
 * @template TEvents - Map of event names to event data types
 * @template TCompletionData - Completion success data type
 * @template TCompletionError - Completion error type
 */
export type EventStreamBus<
  TEvents extends EventStreamEventTypes,
  TCompletionData,
  TCompletionError,
> = {
  /**
   * Subscribe to a specific event type
   * Returns unsubscribe function
   */
  subscribe<K extends keyof TEvents>(
    event: K,
    handler: EventHandler<TEvents[K]>,
  ): () => void;

  /**
   * Subscribe to completion (success or error)
   * Returns unsubscribe function
   */
  onComplete(
    handler: CompletionHandler<TCompletionData, TCompletionError>,
  ): () => void;

  /**
   * Current connection status
   */
  readonly status: EventStreamBusStatus;

  /**
   * Completion result (set when stream ends)
   */
  readonly result: Result<TCompletionData, TCompletionError> | undefined;

  /**
   * Number of active subscriptions
   */
  readonly refCount: number;

  /**
   * Force disconnect (even if there are active subscriptions)
   */
  disconnect(): void;
};

/**
 * Internal bus implementation
 */
type BusInternal<
  TEvents extends EventStreamEventTypes,
  TCompletionData,
  TCompletionError,
> = EventStreamBus<TEvents, TCompletionData, TCompletionError> & {
  /**
   * Internal: Called when a new subscription is added
   */
  _onSubscribe(): void;

  /**
   * Internal: Called when a subscription is removed
   */
  _onUnsubscribe(): void;

  /**
   * Internal: Publish an event to all subscribers
   */
  _publish<K extends keyof TEvents>(event: K, data: TEvents[K]): void;

  /**
   * Internal: Set the completion result
   */
  _complete(result: Result<TCompletionData, TCompletionError>): void;

  /**
   * Internal: Set the status
   */
  _setStatus(status: EventStreamBusStatus): void;
};

// ============================================================================
// Bus Factory
// ============================================================================

/**
 * Create an EventStream bus instance
 *
 * This is typically managed by the FetchProvider, not created directly.
 *
 * @example
 * ```typescript
 * const bus = createEventStreamBus<MyEvents, SuccessData, ErrorData>({
 *   onConnect: () => {
 *     // Open HTTP connection
 *   },
 *   onDisconnect: () => {
 *     // Close HTTP connection
 *   },
 * });
 *
 * // Subscribe to events
 * const unsub = bus.subscribe('progress', (data) => {
 *   console.log('Progress:', data.percent);
 * });
 *
 * // Later
 * unsub();
 * ```
 */
export function createEventStreamBus<
  TEvents extends EventStreamEventTypes,
  TCompletionData,
  TCompletionError,
>(config: {
  onConnect: () => void;
  onDisconnect: () => void;
}): BusInternal<TEvents, TCompletionData, TCompletionError> {
  const eventSubscribers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();
  const completionSubscribers = new Set<
    CompletionHandler<TCompletionData, TCompletionError>
  >();

  let status: EventStreamBusStatus = 'disconnected';
  let result: Result<TCompletionData, TCompletionError> | undefined;
  let refCount = 0;

  const bus: BusInternal<TEvents, TCompletionData, TCompletionError> = {
    subscribe(event, handler) {
      if (!eventSubscribers.has(event)) {
        eventSubscribers.set(event, new Set());
      }
      eventSubscribers.get(event)!.add(handler as EventHandler<unknown>);
      bus._onSubscribe();

      return () => {
        eventSubscribers.get(event)?.delete(handler as EventHandler<unknown>);
        bus._onUnsubscribe();
      };
    },

    onComplete(handler) {
      completionSubscribers.add(handler);

      // If already completed, call immediately
      if (result !== undefined) {
        handler(result);
      }

      return () => {
        completionSubscribers.delete(handler);
      };
    },

    get status() {
      return status;
    },

    get result() {
      return result;
    },

    get refCount() {
      return refCount;
    },

    disconnect() {
      if (status !== 'disconnected') {
        status = 'disconnected';
        config.onDisconnect();
      }
    },

    _onSubscribe() {
      refCount++;
      if (refCount === 1 && status === 'disconnected') {
        status = 'connecting';
        config.onConnect();
      }
    },

    _onUnsubscribe() {
      refCount--;
      if (refCount === 0 && status !== 'completed' && status !== 'error') {
        status = 'disconnected';
        config.onDisconnect();
      }
    },

    _publish(event, data) {
      const handlers = eventSubscribers.get(event);
      if (handlers) {
        handlers.forEach((h) => h(data));
      }
    },

    _setStatus(newStatus) {
      status = newStatus;
    },

    _complete(completionResult) {
      result = completionResult;
      status = completionResult.type === 'Ok' ? 'completed' : 'error';
      completionSubscribers.forEach((h) => h(completionResult));
    },
  };

  return bus;
}

// ============================================================================
// Bus Manager
// ============================================================================

/**
 * Bus manager - manages multiple buses by route+args key
 *
 * Used by FetchProvider to manage shared connections.
 */
export type EventStreamBusManager = {
  /**
   * Get or create a bus for a specific route+args
   */
  getBus<
    TEvents extends EventStreamEventTypes,
    TCompletionData,
    TCompletionError,
  >(
    key: string,
    factory: () => BusInternal<TEvents, TCompletionData, TCompletionError>,
  ): BusInternal<TEvents, TCompletionData, TCompletionError>;

  /**
   * Remove a bus when it's no longer needed
   */
  removeBus(key: string): void;

  /**
   * Get the number of active buses
   */
  readonly busCount: number;
};

/**
 * Create a bus manager
 */
export function createEventStreamBusManager(): EventStreamBusManager {
  const buses = new Map<
    string,
    BusInternal<EventStreamEventTypes, unknown, unknown>
  >();

  return {
    getBus(key, factory) {
      if (!buses.has(key)) {
        const bus = factory();
        buses.set(
          key,
          bus as BusInternal<EventStreamEventTypes, unknown, unknown>,
        );
      }
      // biome-ignore lint/suspicious/noExplicitAny: Required for type inference
      return buses.get(key) as any;
    },

    removeBus(key) {
      buses.delete(key);
    },

    get busCount() {
      return buses.size;
    },
  };
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract events type from a bus
 */
export type BusEvents<T> = T extends EventStreamBus<infer E, unknown, unknown>
  ? E
  : never;

/**
 * Extract completion data type from a bus
 */
export type BusCompletionData<T> = T extends EventStreamBus<
  EventStreamEventTypes,
  infer D,
  unknown
>
  ? D
  : never;

/**
 * Extract completion error type from a bus
 */
export type BusCompletionError<T> = T extends EventStreamBus<
  EventStreamEventTypes,
  unknown,
  infer E
>
  ? E
  : never;
