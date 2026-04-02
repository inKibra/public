/**
 * EventStream (SSE) Event Types and Utilities
 */

/**
 * Represents an EventStream event with typed data
 */
export type EventStreamEvent<T = unknown> = {
  /** Event type identifier */
  type: string;
  /** Event data payload */
  data: T;
  /** Optional event ID for client tracking */
  id?: string;
  /** Optional retry interval in milliseconds */
  retry?: number;
};

/**
 * Base EventStream event types that all implementations should include
 */
export type BaseEventStreamEventTypes = {
  /** Sent when a connection is established */
  connection: { status: 'connected'; timestamp?: number };
  /** Sent when a connection is about to close */
  disconnect: { reason?: string; timestamp?: number };
  /** Sent periodically to keep the connection alive */
  heartbeat: { timestamp: number };
  /** Sent when a server-side error occurs */
  error: { message: string; code?: string; details?: unknown };
};

/**
 * Reserved system event types for stream control
 */
export type SystemEventStreamEventTypes = {
  /** Stream completed successfully */
  __complete: { type: 'Ok'; value: unknown };
  /** Stream completed with error */
  __error: { type: 'Err'; error: unknown };
};

/**
 * Base type for EventStream event type definitions
 * All EventStream event types should extend this to get base events
 */
export type EventStreamEventTypes = BaseEventStreamEventTypes &
  Record<string, unknown>;

/**
 * Utility type to extract event data type from event types definition
 */
export type EventDataType<
  TEventTypes extends EventStreamEventTypes,
  TEventName extends keyof TEventTypes,
> = TEventTypes[TEventName];

/**
 * Creates a typed EventStream event
 */
export function createEventStreamEvent<
  TEventTypes extends EventStreamEventTypes,
  TEventName extends keyof TEventTypes,
>(
  type: TEventName,
  data: EventDataType<TEventTypes, TEventName>,
  options?: {
    id?: string;
    retry?: number;
  },
): EventStreamEvent<EventDataType<TEventTypes, TEventName>> {
  return {
    type: type as string,
    data,
    ...options,
  };
}

/**
 * Formats an EventStream event for transmission over HTTP (SSE format)
 */
export function formatEventStreamEvent(event: EventStreamEvent): string {
  let formatted = '';

  if (event.id !== undefined) {
    formatted += `id: ${event.id}\n`;
  }

  if (event.retry !== undefined) {
    formatted += `retry: ${event.retry}\n`;
  }

  formatted += `event: ${event.type}\n`;
  formatted += `data: ${JSON.stringify(event.data)}\n\n`;

  return formatted;
}

/**
 * Parse an EventStream event from SSE format
 */
export function parseEventStreamEvent(
  eventStr: string,
): EventStreamEvent | null {
  const lines = eventStr.split('\n');
  const event: Partial<EventStreamEvent> = {};

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event.type = line.slice(7);
    } else if (line.startsWith('data: ')) {
      try {
        event.data = JSON.parse(line.slice(6));
      } catch {
        event.data = line.slice(6);
      }
    } else if (line.startsWith('id: ')) {
      event.id = line.slice(4);
    } else if (line.startsWith('retry: ')) {
      event.retry = parseInt(line.slice(7), 10);
    }
  }

  if (event.type && event.data !== undefined) {
    return event as EventStreamEvent;
  }

  return null;
}
