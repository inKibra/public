import type { Logger } from '@inkibra/logger';
import { Ok } from '@inkibra/router/lib/result';
import type { StreamsClient } from '@inkibra/streams';
import type { ConstructEventStreamEventTypes } from '../lab/types';

// Construct event types worth logging relay lag for (skip noisy deltas)
const DIAG_RELAY_CONSTRUCT_EVENT_TYPES = new Set([
  'impulse:started',
  'impulse:completed',
  'response:scheduled',
  'response:selected',
  'response:executing',
  'response:delivered',
  'response:dropped',
  'response:batch_started',
  'response:batch_completed',
  'scheduler:decided',
  'source-fact:reflected',
  'source-fact:cleared',
]);

const RELAYABLE_CONSTRUCT_STREAM_EVENTS = new Set<
  keyof ConstructEventStreamEventTypes
>([
  'constructEvent',
  'thinkingDelta',
  'responseThinkingDelta',
  'responseDelta',
  'sourceFactLifecycle',
  'frontierAdvanced',
  'ingressAccepted',
  'ingressCommitted',
  'ingressStalled',
  'streamCursor',
]);

export async function* relayConstructRuntimeEventsFromStreams<
  TEventTypes extends ConstructEventStreamEventTypes,
>(options: {
  streams: StreamsClient;
  streamKey: string;
  initialCursor: string;
  onConnect?: () => void | Promise<void>;
  logger?: Logger;
}): AsyncGenerator<
  {
    [K in keyof TEventTypes]: { event: K; data: TEventTypes[K] };
  }[keyof TEventTypes],
  ReturnType<typeof Ok<{ reason: 'disconnected' }>>,
  unknown
> {
  let latestCursorStatus: TEventTypes['streamCursor'] = {
    cursor: options.initialCursor,
    phase: 'live',
    source: 'redis',
  } as TEventTypes['streamCursor'];

  // Track first responseDelta per response for relay lag logging
  const firstDeltaRelayed = new Set<string>();

  await options.onConnect?.();

  for await (const item of options.streams.stream<TEventTypes>({
    streamKey: options.streamKey,
    cursor: options.initialCursor,
    readMode: 'redis_with_pg_fallback',
  })) {
    if (item.type === 'cursor') {
      latestCursorStatus = item.status as TEventTypes['streamCursor'];
      yield {
        event: 'streamCursor' as keyof TEventTypes,
        data: item.status as TEventTypes[keyof TEventTypes],
      };
      continue;
    }

    const eventName = item.item.event as keyof TEventTypes & string;
    if (
      !RELAYABLE_CONSTRUCT_STREAM_EVENTS.has(
        eventName as keyof ConstructEventStreamEventTypes,
      )
    ) {
      continue;
    }

    // Relay lag diagnostics — measure time from server publish (event.ts) to relay read
    const relayNowMs = Date.now();
    const itemData = item.item.data as Record<string, unknown>;
    const eventTs = typeof itemData?.ts === 'string' ? itemData.ts : undefined;
    if (eventTs) {
      const serverMs = Date.parse(eventTs);
      if (Number.isFinite(serverMs)) {
        const relayLagMs = relayNowMs - serverMs;

        // Log lifecycle constructEvents
        if (eventName === 'constructEvent') {
          const constructEventType =
            typeof (itemData?.event as Record<string, unknown>)?.type ===
            'string'
              ? ((itemData.event as Record<string, unknown>).type as string)
              : undefined;
          if (
            constructEventType &&
            DIAG_RELAY_CONSTRUCT_EVENT_TYPES.has(constructEventType)
          ) {
            options.logger?.warn('Relay diagnostics', {
              event: 'constructEvent',
              type: constructEventType,
              relayLagMs,
              ts: eventTs,
            });
          }
        }

        // Log first responseDelta per response
        if (eventName === 'responseDelta') {
          const responseId =
            typeof itemData?.responseId === 'string'
              ? itemData.responseId
              : undefined;
          if (responseId && !firstDeltaRelayed.has(responseId)) {
            firstDeltaRelayed.add(responseId);
            options.logger?.warn('Relay diagnostics', {
              event: 'responseDelta:first',
              responseId,
              relayLagMs,
              ts: eventTs,
            });
          }
        }

        // Log frontierAdvanced
        if (eventName === 'frontierAdvanced') {
          options.logger?.warn('Relay diagnostics', {
            event: 'frontierAdvanced',
            relayLagMs,
            ts: eventTs,
          });
        }
      }
    }

    yield {
      event: eventName,
      data: item.item.data,
    } as {
      [K in keyof TEventTypes]: { event: K; data: TEventTypes[K] };
    }[keyof TEventTypes];

    if (eventName !== 'streamCursor') {
      yield {
        event: 'streamCursor' as keyof TEventTypes,
        data: {
          ...latestCursorStatus,
          cursor: item.item.cursor,
        } as TEventTypes[keyof TEventTypes],
      };
    }
  }

  return Ok({ reason: 'disconnected' as const });
}
