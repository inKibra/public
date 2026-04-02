import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { loadHeartbeatMeta, updateHeartbeatMeta } from '../vfs/heartbeat';
import { loadReminder, saveReminder } from '../vfs/reminders';
import {
  evaluateHeartbeatSchedule,
  HEARTBEAT_REMINDER_PATH,
  listDueReminderEntries,
  loadPerceptionScheduleState,
  syncHeartbeatReminder,
} from './perception-schedule';
import {
  DEFAULT_HEARTBEAT_SHAPE,
  runPerceptionSchedulerTick,
} from './perception-scheduler';

describe('perception scheduler reminder policy', () => {
  test('default heartbeat shape adds 3h/6h buckets and stops after 30 days', () => {
    expect(DEFAULT_HEARTBEAT_SHAPE.stopAfterMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(DEFAULT_HEARTBEAT_SHAPE.buckets).toEqual([
      { maxInactiveMs: 5 * 60 * 1000, rateMs: 5 * 60 * 1000 },
      { maxInactiveMs: 15 * 60 * 1000, rateMs: 15 * 60 * 1000 },
      { maxInactiveMs: 30 * 60 * 1000, rateMs: 30 * 60 * 1000 },
      { maxInactiveMs: 60 * 60 * 1000, rateMs: 60 * 60 * 1000 },
      { maxInactiveMs: 3 * 60 * 60 * 1000, rateMs: 3 * 60 * 60 * 1000 },
      { maxInactiveMs: 6 * 60 * 60 * 1000, rateMs: 6 * 60 * 60 * 1000 },
      { maxInactiveMs: 12 * 60 * 60 * 1000, rateMs: 12 * 60 * 60 * 1000 },
      { maxInactiveMs: 30 * 24 * 60 * 60 * 1000, rateMs: 24 * 60 * 60 * 1000 },
    ]);
  });

  test('fires due reminders oldest-first and respects cap', async () => {
    const ingested: Array<{ source: string; content?: string }> = [];
    const vfs = createOverlayFs();

    const construct = {
      ingest: async (perception: { source: string; content?: string }) => {
        ingested.push(perception);
      },
      getState: async () => ({
        activeImpulses: 0,
      }),
      getImpulsePool: () => ({
        getActive: () => [],
      }),
    };

    const now = new Date('2026-01-01T12:00:00.000Z');

    await saveReminder(vfs, {
      path: '/runtime/cron/z-oldest.md',
      content: 'oldest reminder',
      meta: {
        status: 'pending',
        next_fire_at: '2026-01-01T10:00:00.000Z',
      },
    });
    await saveReminder(vfs, {
      path: '/runtime/cron/a-newer.md',
      content: 'newer reminder',
      meta: {
        status: 'pending',
        next_fire_at: '2026-01-01T11:00:00.000Z',
      },
    });

    await runPerceptionSchedulerTick(
      construct,
      vfs,
      {
        maxActiveReminders: 1,
      },
      now,
    );

    const reminders = ingested.filter(
      (perception) => perception.source === 'self_reminder',
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.content).toBe('oldest reminder');

    const oldest = await loadReminder(vfs, '/runtime/cron/z-oldest.md');
    const newer = await loadReminder(vfs, '/runtime/cron/a-newer.md');

    expect(oldest?.meta.status).toBe('done');
    expect(oldest?.meta.last_fired_at).toBe(now.toISOString());
    expect(newer?.meta.status ?? 'pending').toBe('pending');
    expect(newer?.meta.last_fired_at).toBeUndefined();
  });

  test('uses path tie-break when due times are equal', async () => {
    const ingested: Array<{ source: string; content?: string }> = [];
    const vfs = createOverlayFs();

    const construct = {
      ingest: async (perception: { source: string; content?: string }) => {
        ingested.push(perception);
      },
      getState: async () => ({
        activeImpulses: 0,
      }),
      getImpulsePool: () => ({
        getActive: () => [],
      }),
    };

    const now = new Date('2026-01-01T12:00:00.000Z');
    const sharedDueAt = '2026-01-01T11:30:00.000Z';

    await saveReminder(vfs, {
      path: '/runtime/cron/b-second.md',
      content: 'second by path',
      meta: {
        status: 'pending',
        next_fire_at: sharedDueAt,
      },
    });
    await saveReminder(vfs, {
      path: '/runtime/cron/a-first.md',
      content: 'first by path',
      meta: {
        status: 'pending',
        next_fire_at: sharedDueAt,
      },
    });

    await runPerceptionSchedulerTick(
      construct,
      vfs,
      {
        maxActiveReminders: 1,
      },
      now,
    );

    const reminders = ingested.filter(
      (perception) => perception.source === 'self_reminder',
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.content).toBe('first by path');
  });

  test('lists due reminders oldest-first as reusable schedule state', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-01-01T12:00:00.000Z');

    await saveReminder(vfs, {
      path: '/runtime/cron/z-oldest.md',
      content: 'oldest reminder',
      meta: {
        status: 'pending',
        next_fire_at: '2026-01-01T10:00:00.000Z',
      },
    });
    await saveReminder(vfs, {
      path: '/runtime/cron/a-newer.md',
      content: 'newer reminder',
      meta: {
        status: 'pending',
        next_fire_at: '2026-01-01T11:00:00.000Z',
      },
    });

    const due = await listDueReminderEntries(vfs, now);

    expect(due.map((entry) => entry.path)).toEqual([
      '/runtime/cron/z-oldest.md',
      '/runtime/cron/a-newer.md',
    ]);
  });

  test('evaluates heartbeat schedule as reusable due state', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-01-01T12:00:00.000Z');

    await updateHeartbeatMeta(vfs, {
      last_pulse_at: '2026-01-01T11:54:00.000Z',
      last_heartbeat_at: '2026-01-01T11:55:00.000Z',
    });

    const schedule = evaluateHeartbeatSchedule({
      now,
      heartbeatMeta: await loadHeartbeatMeta(vfs),
      minHeartbeatMs: 60_000,
      maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
      inactivityStopDays: 90,
      heartbeatShape: {
        whenNoUserMs: 12 * 60 * 60 * 1000,
        stopAfterMs: 90 * 24 * 60 * 60 * 1000,
        buckets: [{ maxInactiveMs: 5 * 60 * 1000, rateMs: 5 * 60 * 1000 }],
      },
    });

    expect(schedule).toMatchObject({
      rateMs: 5 * 60 * 1000,
      shouldFire: true,
      dueAt: '2026-01-01T12:00:00.000Z',
      estimatedNextHeartbeatAt: '2026-01-01T12:05:00.000Z',
    });
  });

  test('loads canonical next due item from reminders and heartbeat state', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-01-01T12:00:00.000Z');

    await saveReminder(vfs, {
      path: '/runtime/cron/reminder-a.md',
      content: 'reminder payload',
      meta: {
        status: 'pending',
        next_fire_at: '2026-01-01T12:02:00.000Z',
      },
    });
    await updateHeartbeatMeta(vfs, {
      last_pulse_at: '2026-01-01T11:59:00.000Z',
      last_heartbeat_at: '2026-01-01T11:56:00.000Z',
    });

    const state = await loadPerceptionScheduleState({
      vfs: vfs,
      now,
      heartbeatMeta: await loadHeartbeatMeta(vfs),
      minHeartbeatMs: 60_000,
      maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
      inactivityStopDays: 90,
      heartbeatShape: {
        whenNoUserMs: 12 * 60 * 60 * 1000,
        stopAfterMs: 90 * 24 * 60 * 60 * 1000,
        buckets: [{ maxInactiveMs: 5 * 60 * 1000, rateMs: 5 * 60 * 1000 }],
      },
    });

    expect(state.nextDue).toMatchObject({
      kind: 'reminder',
      path: HEARTBEAT_REMINDER_PATH,
      dueAt: '2026-01-01T12:01:00.000Z',
      reminder: { meta: { type: 'heartbeat' } },
    });
  });

  test('does not fire first heartbeat immediately after recent user activity', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');

    const schedule = evaluateHeartbeatSchedule({
      now,
      heartbeatMeta: {
        last_pulse_at: '2026-01-01T11:59:00.000Z',
      },
      minHeartbeatMs: 60_000,
      maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
      inactivityStopDays: 90,
      heartbeatShape: {
        whenNoUserMs: 12 * 60 * 60 * 1000,
        stopAfterMs: 90 * 24 * 60 * 60 * 1000,
        buckets: [{ maxInactiveMs: 5 * 60 * 1000, rateMs: 5 * 60 * 1000 }],
      },
    });

    expect(schedule).toMatchObject({
      rateMs: 5 * 60 * 1000,
      shouldFire: false,
      dueAt: '2026-01-01T12:04:00.000Z',
      estimatedNextHeartbeatAt: '2026-01-01T12:04:00.000Z',
    });
  });

  test('uses 5 minute cadence for recent activity by default', async () => {
    const now = new Date('2026-01-01T12:03:00.000Z');

    const schedule = evaluateHeartbeatSchedule({
      now,
      heartbeatMeta: {
        last_pulse_at: '2026-01-01T12:00:00.000Z',
      },
      minHeartbeatMs: 5 * 60 * 1000,
      maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
      inactivityStopDays: 90,
      heartbeatShape: {
        whenNoUserMs: 12 * 60 * 60 * 1000,
        stopAfterMs: 90 * 24 * 60 * 60 * 1000,
        buckets: [{ maxInactiveMs: 5 * 60 * 1000, rateMs: 5 * 60 * 1000 }],
      },
    });

    expect(schedule).toMatchObject({
      rateMs: 5 * 60 * 1000,
      shouldFire: false,
      dueAt: '2026-01-01T12:05:00.000Z',
    });
  });

  test('anchors first heartbeat to the latest pulse time', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');

    const schedule = evaluateHeartbeatSchedule({
      now,
      heartbeatMeta: {
        last_pulse_at: '2026-01-01T11:58:00.000Z',
      },
      minHeartbeatMs: 60_000,
      maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
      inactivityStopDays: 90,
      heartbeatShape: {
        whenNoUserMs: 12 * 60 * 60 * 1000,
        stopAfterMs: 90 * 24 * 60 * 60 * 1000,
        buckets: [
          { maxInactiveMs: 5 * 60 * 1000, rateMs: 5 * 60 * 1000 },
          { maxInactiveMs: 60 * 60 * 1000, rateMs: 20 * 60 * 1000 },
        ],
      },
    });

    expect(schedule).toMatchObject({
      rateMs: 5 * 60 * 1000,
      shouldFire: false,
      dueAt: '2026-01-01T12:03:00.000Z',
      estimatedNextHeartbeatAt: '2026-01-01T12:03:00.000Z',
    });
  });
});

describe('heartbeat rate bucket drift (Bug 6)', () => {
  /**
   * When a heartbeat was estimated at 06:59:59 and the scheduler wakes at
   * 07:00:02 (3s late), the rate bucket changes from 5min to 15min because
   * user inactivity crossed the 5min boundary. The recalculated dueAt jumps
   * to 07:09:59 and the 5-min heartbeat is silently skipped.
   *
   * Fix: honor `estimated_next_heartbeat_at` as the canonical due time.
   */
  test('honors estimated_next_heartbeat_at even when pulse bucket changes', () => {
    const now = new Date('2026-01-01T12:00:02.000Z');

    const schedule = evaluateHeartbeatSchedule({
      now,
      heartbeatMeta: {
        last_pulse_at: '2026-01-01T11:54:59.000Z',
        estimated_next_heartbeat_at: '2026-01-01T11:59:59.000Z',
      },
      minHeartbeatMs: 5 * 60 * 1000,
      maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
      inactivityStopDays: 30,
      heartbeatShape: DEFAULT_HEARTBEAT_SHAPE,
    });

    // The heartbeat should fire because estimated_next_heartbeat_at is in the past
    expect(schedule.shouldFire).toBe(true);
    expect(schedule.dueAt).toBe('2026-01-01T11:59:59.000Z');
  });

  test('does not fire if estimated_next_heartbeat_at is in the future', () => {
    const now = new Date('2026-01-01T11:58:00.000Z');

    const schedule = evaluateHeartbeatSchedule({
      now,
      heartbeatMeta: {
        last_pulse_at: '2026-01-01T11:54:59.000Z',
        estimated_next_heartbeat_at: '2026-01-01T11:59:59.000Z',
      },
      minHeartbeatMs: 5 * 60 * 1000,
      maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
      inactivityStopDays: 30,
      heartbeatShape: DEFAULT_HEARTBEAT_SHAPE,
    });

    expect(schedule.shouldFire).toBe(false);
    expect(schedule.dueAt).toBe('2026-01-01T11:59:59.000Z');
  });
});

test('advances heartbeat reminders after firing instead of leaving them immediately due', async () => {
  const vfs = createOverlayFs();
  const dueAt = '2026-01-01T12:00:00.000Z';
  const nextHeartbeatAt = '2026-01-01T12:05:00.000Z';
  const ingested: string[] = [];

  await saveReminder(vfs, {
    path: HEARTBEAT_REMINDER_PATH,
    content: 'Internal heartbeat wakeup. Managed by runtime.',
    meta: {
      type: 'heartbeat',
      status: 'pending',
      due_at: dueAt,
      next_fire_at: dueAt,
      estimated_next_heartbeat_at: nextHeartbeatAt,
      heartbeat_rate_ms: 5 * 60 * 1000,
    },
  });
  await updateHeartbeatMeta(vfs, {
    heartbeat_rate_ms: 5 * 60 * 1000,
    last_pulse_at: '2026-01-01T11:59:00.000Z',
    last_heartbeat_at: '2026-01-01T11:55:00.000Z',
    estimated_next_heartbeat_at: dueAt,
  });

  const construct = {
    ingest: async (perception: { source: string; event?: string }) => {
      ingested.push(
        perception.source === 'system_event'
          ? (perception.event ?? 'system')
          : perception.source,
      );
    },
    getState: async () => ({ activeImpulses: 0 }),
    getImpulsePool: () => ({ getActive: () => [] }),
  };

  await runPerceptionSchedulerTick(
    construct,
    vfs,
    { maxActiveReminders: 1 },
    new Date(dueAt),
  );

  expect(ingested).toContain('heartbeat');

  const heartbeatMeta = await loadHeartbeatMeta(vfs);
  expect(heartbeatMeta.last_heartbeat_at).toBe(dueAt);
  expect(heartbeatMeta.estimated_next_heartbeat_at).toBe(nextHeartbeatAt);

  const reminder = await loadReminder(vfs, HEARTBEAT_REMINDER_PATH);
  expect(reminder?.meta.status).toBe('pending');
  expect(reminder?.meta.next_fire_at).toBe(nextHeartbeatAt);
  expect(reminder?.meta.due_at).toBe(nextHeartbeatAt);

  const dueReminders = await listDueReminderEntries(vfs, new Date(dueAt));
  expect(dueReminders).toEqual([]);
});

test('clears stale estimated_next_heartbeat_at when heartbeat scheduling stops', async () => {
  const vfs = createOverlayFs();
  const now = new Date('2026-02-10T12:00:00.000Z');

  await updateHeartbeatMeta(vfs, {
    heartbeat_rate_ms: 5 * 60 * 1000,
    estimated_next_heartbeat_at: '2026-02-10T12:05:00.000Z',
    last_pulse_at: '2025-12-01T00:00:00.000Z',
  });
  await saveReminder(vfs, {
    path: HEARTBEAT_REMINDER_PATH,
    content: 'Internal heartbeat wakeup. Managed by runtime.',
    meta: {
      type: 'heartbeat',
      status: 'pending',
      due_at: '2026-02-10T12:05:00.000Z',
      next_fire_at: '2026-02-10T12:05:00.000Z',
    },
  });

  const heartbeat = await syncHeartbeatReminder({
    vfs,
    now,
    heartbeatMeta: await loadHeartbeatMeta(vfs),
    minHeartbeatMs: 60_000,
    maxHeartbeatMs: 30 * 24 * 60 * 60 * 1000,
    inactivityStopDays: 30,
    heartbeatShape: DEFAULT_HEARTBEAT_SHAPE,
  });

  expect(heartbeat.rateMs).toBeNull();
  expect(
    (await loadHeartbeatMeta(vfs)).estimated_next_heartbeat_at,
  ).toBeUndefined();
  expect((await loadReminder(vfs, HEARTBEAT_REMINDER_PATH))?.meta.status).toBe(
    'done',
  );
});
