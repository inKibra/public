import { describe, expect, test } from 'bun:test';
import {
  buildHeartbeatSystemEventOp,
  buildSelfReminderOp,
  createHeartbeatSystemEventOpId,
  createResponseDeliveredOpId,
  createSelfReminderOpId,
  mapConstructOpToAction,
} from './ops';

describe('construct op mapper', () => {
  test('maps user message to USER_MESSAGE perception', () => {
    const action = mapConstructOpToAction({
      opId: 'op-1',
      kind: 'user_message',
      payload: {
        content: 'hello',
      },
      createdAt: '2026-02-10T10:00:00.000Z',
      traceId: 'trace-1',
    });

    expect(action.type).toBe('perception');
    if (action.type !== 'perception') return;
    expect(action.perception).toMatchObject({
      lane: 'conversation',
      role: 'user',
      source: 'user_message',
      content: 'hello',
    });
  });

  test('maps drain_only to control action', () => {
    const action = mapConstructOpToAction({
      opId: 'op-2',
      kind: 'drain_only',
      createdAt: '2026-02-10T10:00:00.000Z',
    });

    expect(action).toEqual({
      type: 'control',
      action: 'drain_only',
    });
  });

  test('maps mailbox_idle to SYSTEM_EVENT perception', () => {
    const action = mapConstructOpToAction({
      opId: 'op-3',
      kind: 'mailbox_idle',
      payload: {
        markerCursor: 'v1.test',
        quietPeriodMs: 600000,
      },
      createdAt: '2026-02-10T10:00:00.000Z',
    });

    expect(action.type).toBe('perception');
    if (action.type !== 'perception') return;
    expect(action.perception).toMatchObject({
      lane: 'conversation',
      role: 'system',
      source: 'system_event',
      event: 'mailbox_idle',
      content: 'mailbox_idle',
    });
  });

  test('maps next_nap_imprint to runtime action', () => {
    const action = mapConstructOpToAction({
      opId: 'op-imprint',
      kind: 'next_nap_imprint',
      payload: { text: 'Integrate last feedback into principles.' },
      createdAt: '2026-02-10T10:00:00.000Z',
      traceId: 'trace-imprint',
    });

    expect(action).toEqual({
      type: 'runtime',
      action: 'next_nap_imprint',
      payload: {
        text: 'Integrate last feedback into principles.',
        op_id: 'op-imprint',
        trace_id: 'trace-imprint',
      },
    });
  });

  test('maps custom impulse op to SYSTEM_EVENT with profile metadata', () => {
    const action = mapConstructOpToAction({
      opId: 'op-4',
      kind: 'impulse',
      payload: {
        profile: 'trainer.upcoming_workout_reminder',
        pool: 'reminders',
        payload: { foo: 'bar' },
      },
      createdAt: '2026-02-10T10:00:00.000Z',
      traceId: 'trace-custom',
    });

    expect(action.type).toBe('perception');
    if (action.type !== 'perception') return;
    expect(action.perception).toMatchObject({
      lane: 'heartbeat',
      role: 'system',
      source: 'system_event',
      event: undefined,
      content: 'trainer.upcoming_workout_reminder',
      profile: 'trainer.upcoming_workout_reminder',
      pool: 'reminders',
    });
  });

  test('maps response_delivered to runtime semantic action', () => {
    const opId = createResponseDeliveredOpId({
      constructId: 'construct-1',
      responseId: 'response-42',
    });

    const action = mapConstructOpToAction({
      opId,
      kind: 'response_delivered',
      payload: {
        responseId: 'response-42',
        deliveredAt: '2026-03-02T10:00:00.000Z',
      },
      createdAt: '2026-03-02T10:00:00.000Z',
      traceId: 'trace-response-delivered',
    });

    expect(action).toEqual({
      type: 'runtime',
      action: 'response_delivered',
      payload: {
        responseId: 'response-42',
        deliveredAt: '2026-03-02T10:00:00.000Z',
        op_id: opId,
        trace_id: 'trace-response-delivered',
      },
    });
  });

  test('builds direct heartbeat system_event ops with stable ids', () => {
    const op = buildHeartbeatSystemEventOp({
      constructId: 'construct-1',
      dueAt: '2026-03-04T12:00:00.000Z',
      payload: {
        heartbeat_rate_ms: 300000,
      },
    });

    expect(op).toEqual({
      opId: createHeartbeatSystemEventOpId({
        constructId: 'construct-1',
        dueAt: '2026-03-04T12:00:00.000Z',
      }),
      kind: 'system_event',
      payload: {
        event: 'heartbeat',
        payload: {
          heartbeat_rate_ms: 300000,
        },
        occurredAt: '2026-03-04T12:00:00.000Z',
      },
      createdAt: '2026-03-04T12:00:00.000Z',
      traceId: undefined,
    });
  });

  test('builds direct self_reminder ops with stable ids', () => {
    const op = buildSelfReminderOp({
      reminderId: 'reminder-a',
      message: 'Check in',
      dueAt: '2026-03-04T12:00:00.000Z',
      context: {
        source: 'workflow',
      },
    });

    expect(op).toEqual({
      opId: createSelfReminderOpId({
        reminderId: 'reminder-a',
        dueAt: '2026-03-04T12:00:00.000Z',
      }),
      kind: 'self_reminder',
      payload: {
        memo: 'Check in',
        scheduledAt: '2026-03-04T12:00:00.000Z',
        context: {
          reminder_id: 'reminder-a',
          source: 'workflow',
        },
      },
      createdAt: '2026-03-04T12:00:00.000Z',
      traceId: undefined,
    });
  });
});
