/**
 * Represents a Server-Sent Event with typed data
 */
export type SseEvent<T = unknown> = {
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
 * Base SSE event types that all implementations should include
 */
export interface BaseSseEventTypes {
  /** Sent when a connection is established */
  connection: { status: 'connected'; timestamp?: number };
  /** Sent when a connection is about to close */
  disconnect: { reason?: string; timestamp?: number };
  /** Sent periodically to keep the connection alive */
  heartbeat: { timestamp: number };
  /** Sent when a server-side error occurs */
  error: { message: string; code?: string; details?: unknown };
}

/**
 * Base type for SSE event type definitions
 * All SSE event interfaces should extend this to get base events
 */
export interface SseEventTypes extends BaseSseEventTypes {}

/**
 * Utility type to extract event data type from event types definition
 */
export type EventDataType<
  TEventTypes extends SseEventTypes,
  TEventName extends keyof TEventTypes,
> = TEventTypes[TEventName];

/**
 * Creates a typed SSE event
 */
export function createSseEvent<
  TEventTypes extends SseEventTypes,
  TEventName extends keyof TEventTypes,
>(
  type: TEventName,
  data: EventDataType<TEventTypes, TEventName>,
  options?: {
    id?: string;
    retry?: number;
  },
): SseEvent<EventDataType<TEventTypes, TEventName>> {
  return {
    type: type as string,
    data,
    ...options,
  };
}

/**
 * Formats an SSE event for transmission over HTTP
 */
export function formatSseEvent(event: SseEvent): string {
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
