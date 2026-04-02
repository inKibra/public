import { MimeType } from '@inkibra/api-base';
import type { StreamResponse } from '@inkibra/api-base/classes/event-stream';
import type { Response } from 'express';

/**
 * Adapter to make Express Response objects compatible with StreamResponse interface
 */
export class StreamResponseAdapter implements StreamResponse {
  constructor(private readonly expressResponse: Response) {}

  init(): void {
    this.expressResponse.setHeader('Content-Type', MimeType.TEXT_EVENT_STREAM);
    this.expressResponse.setHeader('Cache-Control', 'no-cache');
    this.expressResponse.setHeader('Connection', 'keep-alive');
    this.expressResponse.setHeader('Access-Control-Allow-Origin', '*');
    this.expressResponse.setHeader(
      'Access-Control-Allow-Headers',
      'Cache-Control',
    );
    this.expressResponse.flushHeaders();
  }

  write(data: string): boolean {
    this.expressResponse.write(data);
    // flush() is not available in all environments (e.g., test environments)
    if (typeof this.expressResponse.flush === 'function') {
      this.expressResponse.flush();
    }
    return true;
  }

  end(): void {
    this.expressResponse.end();
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.expressResponse.on(event, callback);
  }
}
