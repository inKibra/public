import type { Logger } from '@inkibra/logger';
import { formatSseEvent, type SseEventTypes } from '../constants/sse-event';

/**
 * Abstract interface for stream responses that can be used with EventStream
 */
export interface StreamResponse {
  init(): void;
  write(data: string): boolean;
  end(): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

// TODO: validate event types

/**
 * Implementation of EventStream for managing SSE connections
 */
export class EventStream<TEventTypes extends SseEventTypes = SseEventTypes> {
  private readonly response: StreamResponse;
  private readonly logger: Logger;
  private isStreamActive = true;
  private readonly closeCallbacks: (() => void)[] = [];

  private heartbeatInterval: ReturnType<typeof setInterval> | undefined =
    undefined;

  private HEARTBEAT_INTERVAL_TIME = 15_000;
  private DISCONNECT_DELAY = 200;

  constructor(
    response: StreamResponse,
    logger: Logger,
    options?: {
      heartbeatIntervalTime?: number;
      disconnectDelay?: number;
    },
  ) {
    this.response = response;
    this.logger = logger;

    // Set up SSE headers
    this.response.init();

    // Handle client disconnect
    this.response.on('close', () => {
      this.logger.trace('SSE Response Closed');
      this.handleClose();
    });

    this.response.on('error', (error) => {
      this.logger.error('SSE Response Error', error);
      this.handleClose();
    });

    // Send initial connection event
    const connectionEvent = formatSseEvent({
      type: 'connection',
      data: { status: 'connected' },
    });
    this.logger.trace('Sending initial connection event', {
      connectionEvent,
    });
    this.response.write(connectionEvent);

    if (options?.heartbeatIntervalTime) {
      this.HEARTBEAT_INTERVAL_TIME = options.heartbeatIntervalTime;
    }

    if (options?.disconnectDelay) {
      this.DISCONNECT_DELAY = options.disconnectDelay;
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.HEARTBEAT_INTERVAL_TIME);
  }

  public send<TEventName extends keyof TEventTypes>(
    eventType: TEventName,
    data: TEventTypes[TEventName],
    options?: {
      id?: string;
      retry?: number;
    },
  ): void {
    if (!this.isStreamActive) {
      this.logger.warn('Attempted to send event to closed stream', {
        eventType: eventType as string,
      });
      return;
    }

    try {
      const event = {
        type: eventType as string,
        data,
        ...options,
      };

      const formattedEvent = formatSseEvent(event);
      this.response.write(formattedEvent);

      this.logger.debug('SSE Event Sent', {
        eventType: eventType as string,
        hasData: data !== undefined,
        id: options?.id,
      });
    } catch (error) {
      this.logger.error('Error sending SSE event', {
        error,
        eventType: eventType as string,
      });
      this.handleClose();
    }
  }

  /**
   * Closes the SSE stream gracefully by sending a disconnect event first.
   * This is the default and recommended way to close SSE connections.
   */
  public close(reason?: string): void {
    if (!this.isStreamActive) {
      return;
    }

    this.logger.debug('Initiating graceful SSE stream close', { reason });

    clearInterval(this.heartbeatInterval);

    // Send disconnect signal to client
    this.send('disconnect', {
      reason: reason || 'Server initiated graceful shutdown',
      timestamp: Date.now(),
    });

    // Give client time to process the disconnect event and close gracefully
    setTimeout(() => {
      if (this.isStreamActive) {
        this.logger.debug(
          'Server closing SSE stream after disconnect signal (client did not close)',
        );
        this.forceClose();
      } else {
        this.logger.debug(
          'Client closed SSE stream gracefully after disconnect signal',
        );
      }
    }, this.DISCONNECT_DELAY); // 200ms delay to ensure client processes the disconnect event
  }

  /**
   * Immediately closes the SSE stream without sending a disconnect signal.
   * Use this only when the stream is broken or in error conditions.
   */
  public forceClose(): void {
    if (this.isStreamActive) {
      this.logger.debug('Force closing SSE stream immediately');
      this.handleClose();
    }
  }

  public isActive(): boolean {
    return this.isStreamActive;
  }

  public onClose(callback: () => void): void {
    this.closeCallbacks.push(callback);
  }

  private handleClose(): void {
    if (!this.isStreamActive) {
      return;
    }

    clearInterval(this.heartbeatInterval);

    this.isStreamActive = false;

    try {
      this.response.end();
    } catch (error) {
      // Response may already be ended
      this.logger.debug('Response already ended', error);
    }

    // Execute close callbacks
    this.closeCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        this.logger.error('Error executing SSE close callback', error);
      }
    });

    this.logger.debug('SSE stream closed');
  }

  /**
   * Send a heartbeat/keep-alive event
   */
  public sendHeartbeat(): void {
    if (this.isStreamActive) {
      this.send('heartbeat', { timestamp: Date.now() });
    }
  }
}
