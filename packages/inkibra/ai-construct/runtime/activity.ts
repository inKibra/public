import type { ConstructEvent } from '../construct/types';
import type {
  ConstructActivityEvent,
  ConstructActivitySink,
  ConstructEventToActivityMapper,
} from './types';

export const mapConstructEventToActivity: ConstructEventToActivityMapper = ({
  constructId,
  event,
  now,
}) => {
  switch (event.type) {
    case 'impulse:started':
      return {
        constructId,
        activityType: 'impulse_active',
        timestamp: now,
        impulseId: event.impulseId,
      };

    case 'response:schedule_requested':
    case 'response:scheduled':
      return {
        constructId,
        activityType: 'response_deciding',
        timestamp: now,
        responseId:
          event.type === 'response:scheduled' ? event.responseId : undefined,
      };

    case 'response:executing':
      return {
        constructId,
        activityType: 'response_generating',
        timestamp: now,
        responseId: event.responseId,
      };

    case 'response:batch_started':
      return {
        constructId,
        activityType: 'response_generating',
        timestamp: now,
        responseId: event.respondTo[0],
      };

    case 'response:delivered':
      return {
        constructId,
        activityType: 'response_delivered',
        timestamp: now,
        responseId: event.responseId,
      };

    case 'response:batch_completed':
      return {
        constructId,
        activityType:
          event.disposition === 'executed' ? 'response_delivered' : 'idle',
        timestamp: now,
        responseId: event.respondTo[0],
      };

    case 'nap:started':
    case 'compaction:started':
      return {
        constructId,
        activityType: 'nap_running',
        timestamp: now,
      };

    case 'nap:error':
      return {
        constructId,
        activityType: 'nap_error',
        timestamp: now,
        details: {
          message: event.error.message,
        },
      };

    default:
      return null;
  }
};

export function createNoopConstructActivitySink(): ConstructActivitySink {
  return {
    publish: async () => {},
  };
}

export async function emitIdleActivity(
  sink: ConstructActivitySink | undefined,
  constructId: string,
): Promise<void> {
  if (!sink) {
    return;
  }

  await sink.publish({
    constructId,
    activityType: 'idle',
    timestamp: new Date().toISOString(),
  });
}

export async function emitMappedConstructActivity(args: {
  sink: ConstructActivitySink | undefined;
  constructId: string;
  event: ConstructEvent;
}): Promise<ConstructActivityEvent | null> {
  if (!args.sink) {
    return null;
  }

  const mapped = mapConstructEventToActivity({
    constructId: args.constructId,
    event: args.event,
    now: new Date().toISOString(),
  });

  if (!mapped) {
    return null;
  }

  await args.sink.publish(mapped);
  return mapped;
}
