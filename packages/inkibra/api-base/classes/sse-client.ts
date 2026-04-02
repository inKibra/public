import type { Logger } from '@inkibra/logger';
import type { SseEventTypes } from '../constants/sse-event';
import type { SseEventBus } from './sse-event-bus';
import type { SseRoute, SseRouteNamedTypes } from './sse-route';

/**
 * Type-safe SSE event listener
 */
export type SseEventListener<
  TEventTypes extends SseEventTypes,
  TEventName extends keyof TEventTypes,
> = (data: TEventTypes[TEventName], event: MessageEvent) => void;

/**
 * SSE connection options
 */
export type SseClientOptions = {
  /**
   * Authentication query parameter
   */
  authorization?: string | (() => Promise<string | undefined>);

  /**
   * EventSource initialization options
   */
  eventSourceOptions?: EventSourceInit;

  /**
   * Logger instance for debugging and error reporting
   */
  logger?: Logger;

  /**
   * Base URL for the SSE endpoint
   */
  baseUrl?: string;

  /**
   * Skip connecting to EventSource (use only event bus)
   */
  skipEventSourceConnection?: boolean;
};

// TODO: validate event types

/**
 * Type-safe Server-Sent Events client
 */
export class SseClient<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
> {
  private eventSource: EventSource | undefined;
  private readonly route: SseRoute<Path, RouteTypes>;
  private readonly options: Required<
    Omit<
      SseClientOptions,
      'logger' | 'baseUrl' | 'authorization' | 'skipEventSourceConnection'
    >
  > & {
    logger?: SseClientOptions['logger'];
    baseUrl?: SseClientOptions['baseUrl'];
    authorization?: SseClientOptions['authorization'];
    skipEventSourceConnection: boolean;
  };
  private readonly eventBus?: SseEventBus;
  private readonly eventListeners = new Map<
    keyof RouteTypes['EventTypes'],
    Set<
      SseEventListener<RouteTypes['EventTypes'], keyof RouteTypes['EventTypes']>
    >
  >();
  private readonly wrappedHandlers = new WeakMap<
    SseEventListener<RouteTypes['EventTypes'], keyof RouteTypes['EventTypes']>,
    (event: MessageEvent) => void
  >();
  private isManuallyDisconnected = false;
  private errorHandler?: (error: Event) => void;
  private unsubscribeFromEventBus?: () => void;

  constructor(
    route: SseRoute<Path, RouteTypes>,
    options: SseClientOptions = {},
    eventBus?: SseEventBus,
  ) {
    this.route = route;
    this.eventBus = eventBus;
    this.options = {
      eventSourceOptions: {},
      baseUrl: '',
      skipEventSourceConnection: false,
      ...options,
    };
  }

  /**
   * Connect to the SSE endpoint
   */
  public async connect(params: {
    pathParams: RouteTypes['PathParamsType'];
    pathQuery?: RouteTypes['PathQueryType'];
  }): Promise<void> {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return; // Already connected
    }

    // Always subscribe to event bus if present
    if (this.eventBus && !this.unsubscribeFromEventBus) {
      this.subscribeToEventBus();
    }

    // Connect to EventSource unless explicitly skipped
    if (!this.options.skipEventSourceConnection) {
      const authorization =
        typeof this.options.authorization === 'function'
          ? await this.options.authorization()
          : this.options.authorization;

      this.isManuallyDisconnected = false;
      const url = this.buildUrl(params, authorization);

      try {
        this.eventSource = new EventSource(
          url,
          this.options.eventSourceOptions,
        );
        this.setupEventHandlers();
      } catch (error) {
        this.options.logger?.error('Failed to create EventSource', { error });
      }
    }
  }

  /**
   * Disconnect from the SSE endpoint
   */
  public disconnect(): void {
    this.isManuallyDisconnected = true;

    if (this.eventSource) {
      // First set a flag to indicate we're closing intentionally
      const es = this.eventSource;
      this.eventSource = undefined; // Clear reference first

      // Remove all event handlers
      this.removeEventHandlers(es);

      // Now close the EventSource
      es.close();
    }

    // Unsubscribe from event bus
    if (this.unsubscribeFromEventBus) {
      this.performUnsubscribeFromEventBus();
    }
  }

  /**
   * Add a typed event listener
   */
  public addEventListener<TEventName extends keyof RouteTypes['EventTypes']>(
    eventType: TEventName,
    listener: SseEventListener<RouteTypes['EventTypes'], TEventName>,
  ): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }

    const typedListener = listener as SseEventListener<
      RouteTypes['EventTypes'],
      keyof RouteTypes['EventTypes']
    >;

    this.eventListeners.get(eventType)?.add(typedListener);

    // Create and store the wrapped handler
    const wrappedHandler = this.createEventHandler(listener);
    this.wrappedHandlers.set(typedListener, wrappedHandler);

    // Add listener to EventSource if connected
    if (this.eventSource) {
      this.eventSource.addEventListener(eventType as string, wrappedHandler);
    }
  }

  /**
   * Remove a typed event listener
   */
  public removeEventListener<TEventName extends keyof RouteTypes['EventTypes']>(
    eventType: TEventName,
    listener: SseEventListener<RouteTypes['EventTypes'], TEventName>,
  ): void {
    const typedListener = listener as SseEventListener<
      RouteTypes['EventTypes'],
      keyof RouteTypes['EventTypes']
    >;

    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(typedListener);
      if (listeners.size === 0) {
        this.eventListeners.delete(eventType);
      }
    }

    // Remove from EventSource if connected using the stored wrapped handler
    if (this.eventSource) {
      const wrappedHandler = this.wrappedHandlers.get(typedListener);
      if (wrappedHandler) {
        this.eventSource.removeEventListener(
          eventType as string,
          wrappedHandler,
        );
        this.wrappedHandlers.delete(typedListener);
      }
    }
  }

  /**
   * Get the current connection state
   */
  public getReadyState(): number {
    return this.eventSource?.readyState ?? EventSource.CLOSED;
  }

  /**
   * Check if the client is connected
   */
  public isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  /**
   * Add connection state listeners
   */
  public onOpen(callback: (event: Event) => void): void {
    if (this.eventSource) {
      this.eventSource.addEventListener('open', callback);
    }
  }

  public onError(callback: (event: Event) => void): void {
    this.errorHandler = callback;
    if (this.eventSource) {
      this.eventSource.addEventListener('error', callback);
    }
  }

  /**
   * Subscribe to event bus for receiving events
   */
  private subscribeToEventBus(): void {
    if (!this.eventBus) return;

    // Subscribe with a handler function and store the unsubscribe function
    this.unsubscribeFromEventBus = this.eventBus.subscribeClient(
      this.route,
      (eventType, data) => this.handleEventBusEvent(eventType, data),
    );

    this.options.logger?.debug('Subscribed to event bus', {
      routeName: this.route.name,
    });
  }

  /**
   * Unsubscribe from event bus
   */
  private performUnsubscribeFromEventBus(): void {
    if (this.unsubscribeFromEventBus) {
      this.unsubscribeFromEventBus();
      this.unsubscribeFromEventBus = undefined;
      this.options.logger?.debug('Unsubscribed from event bus', {});
    }
  }

  /**
   * Handle events from the event bus (called by the event bus)
   */
  private handleEventBusEvent<
    TEventName extends keyof RouteTypes['EventTypes'],
  >(eventType: TEventName, data: RouteTypes['EventTypes'][TEventName]): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      // Create a mock MessageEvent for consistency
      const mockEvent = new MessageEvent(eventType as string, {
        data: JSON.stringify(data),
      });

      listeners.forEach((listener) => {
        try {
          listener(data, mockEvent);
        } catch (error) {
          this.options.logger?.error('Error in event bus event listener', {
            error,
            eventType,
            data,
          });
        }
      });
    }
  }

  private buildUrl(
    params: {
      pathParams: RouteTypes['PathParamsType'];
      pathQuery?: RouteTypes['PathQueryType'];
    },
    authorization: string | undefined,
  ): string {
    const { pathParams, pathQuery } = params;
    const relativePath = this.route.constructPath({
      pathParams,
      pathQuery: pathQuery ?? ({} as RouteTypes['PathQueryType']),
      authorization,
    });
    // Use baseUrl from options if provided, otherwise use the parameter
    const baseUrl = this.options.baseUrl || '';
    return `${baseUrl}${relativePath}`;
  }

  private setupEventHandlers(): void {
    if (!this.eventSource) return;

    this.eventSource.onopen = (_) => {
      this.options.logger?.info('SSE connection opened');
    };

    this.eventSource.onerror = (event) => {
      // EventSource fires an error event when closing, even for normal disconnects
      // Only log real connection errors (when we're trying to connect but failing)
      const isRealError =
        this.eventSource?.readyState === EventSource.CONNECTING &&
        !this.isManuallyDisconnected;

      if (isRealError) {
        this.options.logger?.error('SSE connection error', { event });
      }

      // Call the user-provided error handler if one exists
      if (this.errorHandler) {
        this.errorHandler(event);
      }
    };

    // Set up automatic disconnect handling for graceful close
    this.eventSource.addEventListener('disconnect', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        this.options.logger?.debug(
          'Received disconnect signal from server',
          data,
        );

        // Forward the disconnect event to user-provided listeners first
        const listeners = this.eventListeners.get('disconnect');
        if (listeners) {
          listeners.forEach((listener) => {
            try {
              listener(data, event);
            } catch (error) {
              this.options.logger?.error('Error in disconnect event listener', {
                error,
              });
            }
          });
        }

        // Then automatically disconnect gracefully when server sends disconnect signal
        this.disconnect();
      } catch (error) {
        this.options.logger?.error('Failed to parse disconnect event data', {
          error,
        });
        // Still disconnect even if we can't parse the data
        this.disconnect();
      }
    });

    // Register all current event listeners using stored wrapped handlers
    this.eventListeners.forEach((listeners, eventType) => {
      listeners.forEach((listener) => {
        const wrappedHandler = this.wrappedHandlers.get(listener);
        if (wrappedHandler) {
          this.eventSource?.addEventListener(
            eventType as string,
            wrappedHandler,
          );
        }
      });
    });
  }

  private createEventHandler<TEventName extends keyof RouteTypes['EventTypes']>(
    listener: SseEventListener<RouteTypes['EventTypes'], TEventName>,
  ): (event: MessageEvent) => void {
    return (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        listener(data, event);
      } catch (error) {
        this.options.logger?.error('Failed to parse SSE event data', {
          error,
          rawData: event.data,
        });
      }
    };
  }

  private removeEventHandlers(eventSource?: EventSource): void {
    const es = eventSource || this.eventSource;
    if (!es) return;

    // Remove the built-in handlers first
    es.onopen = null;
    es.onerror = null;

    // Remove the user-provided error handler if it exists
    if (this.errorHandler) {
      es.removeEventListener('error', this.errorHandler);
    }

    // Remove all custom event listeners
    this.eventListeners.forEach((listeners, eventType) => {
      listeners.forEach((listener) => {
        const wrappedHandler = this.wrappedHandlers.get(listener);
        if (wrappedHandler) {
          es.removeEventListener(eventType as string, wrappedHandler);
        }
      });
    });
  }
}

/**
 * Factory function to create a type-safe SSE client
 */
export function createSseClient<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
>(
  route: SseRoute<Path, RouteTypes>,
  options?: SseClientOptions,
  eventBus?: SseEventBus,
): SseClient<Path, RouteTypes> {
  return new SseClient(route, options, eventBus);
}
