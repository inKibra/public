import type { Logger } from '@inkibra/logger';
import type { SseRoute, SseRouteNamedTypes } from './sse-route';

/**
 * Event handler function type for SSE events
 */
export type SseEventHandler<
  Path extends string,
  RouteTypes extends SseRouteNamedTypes<Path>,
  TEventName extends keyof RouteTypes['EventTypes'],
> = (eventType: TEventName, data: RouteTypes['EventTypes'][TEventName]) => void;

/**
 * General-purpose SSE event bus that can handle any route
 */
export class SseEventBus {
  private readonly routeSubscribers = new Map<
    SseRoute<any, any>,
    Set<SseEventHandler<any, any, any>>
  >();
  private readonly logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /**
   * Subscribe to events for a specific route
   * @returns An unsubscribe function
   */
  public subscribeClient<
    Path extends string,
    RouteTypes extends SseRouteNamedTypes<Path>,
  >(
    route: SseRoute<Path, RouteTypes>,
    handler: SseEventHandler<Path, RouteTypes, keyof RouteTypes['EventTypes']>,
  ): () => void {
    let subscribers = this.routeSubscribers.get(route);
    if (!subscribers) {
      subscribers = new Set();
      this.routeSubscribers.set(route, subscribers);
    }

    subscribers.add(handler);

    this.logger?.debug('Client subscribed to event bus', {
      routeName: route.name,
      totalSubscribersForRoute: subscribers.size,
    });

    // Return unsubscribe function
    return () => {
      const currentSubscribers = this.routeSubscribers.get(route);
      if (currentSubscribers) {
        const wasRemoved = currentSubscribers.delete(handler);

        if (wasRemoved) {
          this.logger?.debug('Client unsubscribed from event bus', {
            routeName: route.name,
            remainingSubscribersForRoute: currentSubscribers.size,
          });

          // Clean up empty route entries
          if (currentSubscribers.size === 0) {
            this.routeSubscribers.delete(route);
            this.logger?.debug('Removed empty route from event bus', {
              routeName: route.name,
            });
          }
        } else {
          this.logger?.warn('Attempted to unsubscribe non-existent handler', {
            routeName: route.name,
          });
        }
      }
    };
  }

  /**
   * Publish an event to all subscribers of the given route
   */
  public publish<
    Path extends string,
    RouteTypes extends SseRouteNamedTypes<Path>,
    TEventName extends keyof RouteTypes['EventTypes'],
  >(
    route: SseRoute<Path, RouteTypes>,
    eventType: TEventName,
    data: RouteTypes['EventTypes'][TEventName],
  ): void {
    this.logger?.debug('Publishing event to event bus', {
      routeName: route.name,
      eventType,
      data,
    });

    const subscribers = this.routeSubscribers.get(route);
    if (!subscribers || subscribers.size === 0) {
      this.logger?.warn('No subscribers for route', {
        routeName: route.name,
        eventType,
      });
      return;
    }

    // Send the event to all subscribed handlers
    subscribers.forEach((handler) => {
      try {
        handler(eventType, data);
        this.logger?.debug('Event sent to subscriber', {
          routeName: route.name,
          eventType,
        });
      } catch (error) {
        this.logger?.error('Failed to send event to subscriber', {
          routeName: route.name,
          eventType,
          error,
        });
      }
    });
  }

  /**
   * Get the number of subscribers for a specific route
   */
  public getSubscriberCountForRoute<
    Path extends string,
    RouteTypes extends SseRouteNamedTypes<Path>,
  >(route: SseRoute<Path, RouteTypes>): number {
    const subscribers = this.routeSubscribers.get(route);
    return subscribers?.size ?? 0;
  }

  /**
   * Get the total number of routes with active subscriptions
   */
  public getRouteCount(): number {
    return this.routeSubscribers.size;
  }

  /**
   * Clear all subscriptions for a specific route
   */
  public clearRoute<
    Path extends string,
    RouteTypes extends SseRouteNamedTypes<Path>,
  >(route: SseRoute<Path, RouteTypes>): void {
    const subscribers = this.routeSubscribers.get(route);
    if (subscribers) {
      const count = subscribers.size;
      this.routeSubscribers.delete(route);
      this.logger?.debug('Cleared all subscriptions for route', {
        routeName: route.name,
        count,
      });
    }
  }

  /**
   * Clear all subscriptions across all routes
   */
  public clear(): void {
    const routeCount = this.routeSubscribers.size;
    this.routeSubscribers.clear();
    this.logger?.debug('Cleared all event bus subscriptions', {
      routeCount,
    });
  }
}

/**
 * Factory function to create an SSE event bus
 */
export function createSseEventBus(logger?: Logger): SseEventBus {
  return new SseEventBus(logger);
}
