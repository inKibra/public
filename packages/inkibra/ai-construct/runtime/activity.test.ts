import { describe, expect, test } from 'bun:test';
import type { ConstructEvent } from '../construct/types';
import {
  createNoopConstructActivitySink,
  emitMappedConstructActivity,
  mapConstructEventToActivity,
} from './activity';

describe('construct runtime activity mapping', () => {
  test('maps construct events to coarse activity events', () => {
    const event: ConstructEvent = {
      type: 'response:executing',
      responseId: 'resp-1',
    };

    const mapped = mapConstructEventToActivity({
      constructId: 'construct-1',
      event,
      now: '2026-02-10T10:00:00.000Z',
    });

    expect(mapped).toEqual({
      constructId: 'construct-1',
      activityType: 'response_generating',
      timestamp: '2026-02-10T10:00:00.000Z',
      responseId: 'resp-1',
    });
  });

  test('publishes mapped event through sink', async () => {
    const published: string[] = [];
    const sink = {
      publish: async (activity: { activityType: string }) => {
        published.push(activity.activityType);
      },
    };

    await emitMappedConstructActivity({
      sink,
      constructId: 'construct-1',
      event: {
        type: 'impulse:started',
        impulseId: 'impulse-1',
        perception: {
          lane: 'heartbeat',
          role: 'system',
          source: 'system_event',
          event: 'unit-test',
          content: 'unit-test',
          occurredAt: new Date(),
          metadata: {},
        },
      },
    });

    expect(published).toEqual(['impulse_active']);
  });

  test('no-op sink accepts activity events', async () => {
    const sink = createNoopConstructActivitySink();

    await expect(
      sink.publish({
        constructId: 'construct-1',
        activityType: 'idle',
        timestamp: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});
