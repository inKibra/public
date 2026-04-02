/**
 * SSE stream relay for the dev server.
 *
 * Wires relayConstructRuntimeEventsFromStreams to the dev-server's
 * event stream key pattern.
 */

import type { Logger } from '@inkibra/logger';
import type { StreamsClient } from '@inkibra/streams';
import { relayConstructRuntimeEventsFromStreams } from '../backend/stream-relay';
import { devEventStreamKey } from './runtime';

export function createDevStreamRuntimeEvents(
  streams: StreamsClient,
  logger?: Logger,
) {
  return async function* streamRuntimeEvents(args: {
    constructId: string;
    cursor?: string;
  }) {
    return yield* relayConstructRuntimeEventsFromStreams({
      streams,
      streamKey: devEventStreamKey(args.constructId),
      initialCursor: args.cursor ?? '0',
      logger,
    });
  };
}
