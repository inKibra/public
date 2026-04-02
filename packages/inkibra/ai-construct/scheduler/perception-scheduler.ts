import type { OverlayFs } from '@inkibra/ai-flow';
import type { Construct } from '../construct/construct';
import type { ConstructState } from '../construct/types';
import { CONSTRUCT_SYSTEM_EVENT_NAME } from '../impulse/keys';
import { loadHeartbeatMeta, updateHeartbeatMeta } from '../vfs/heartbeat';
import { saveReminder } from '../vfs/reminders';
import {
  computeNextReminderFireAt,
  listDueReminderEntries,
  normalizeHeartbeatShape,
  syncHeartbeatReminder,
} from './perception-schedule';

export type PerceptionSchedulerConfig = {
  intervalMs?: number;
  minHeartbeatMs?: number;
  maxHeartbeatMs?: number;
  inactivityStopDays?: number;
  heartbeatShape?: HeartbeatShape;
  maxActiveReminders?: number;
  shouldPause?: () => boolean | Promise<boolean>;
};

export type HeartbeatBucket = {
  maxInactiveMs: number;
  rateMs: number;
};

export type HeartbeatShape = {
  whenNoUserMs: number;
  stopAfterMs: number;
  buckets: HeartbeatBucket[];
};

export type PerceptionScheduler = {
  stop: () => void;
};

type PerceptionSchedulerConstruct = {
  ingest: Construct['ingest'];
  getState: () => Promise<Pick<ConstructState, 'activeImpulses'>>;
  getImpulsePool: () => Pick<
    ReturnType<Construct['getImpulsePool']>,
    'getActive'
  >;
};

type SchedulerTickInternalArgs = {
  construct: PerceptionSchedulerConstruct;
  vfs: OverlayFs;
  now: Date;
  minHeartbeatMs: number;
  maxHeartbeatMs: number;
  inactivityStopDays: number;
  heartbeatShape: HeartbeatShape;
  maxActiveReminders: number;
  shouldPause?: () => boolean | Promise<boolean>;
};

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_MIN_HEARTBEAT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_INACTIVITY_STOP_DAYS = 30;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_HEARTBEAT_SHAPE: HeartbeatShape = {
  whenNoUserMs: 12 * HOUR_MS,
  stopAfterMs: 30 * DAY_MS,
  buckets: [
    { maxInactiveMs: 5 * MINUTE_MS, rateMs: 5 * MINUTE_MS },
    { maxInactiveMs: 15 * MINUTE_MS, rateMs: 15 * MINUTE_MS },
    { maxInactiveMs: 30 * MINUTE_MS, rateMs: 30 * MINUTE_MS },
    { maxInactiveMs: 60 * MINUTE_MS, rateMs: 60 * MINUTE_MS },
    { maxInactiveMs: 3 * HOUR_MS, rateMs: 3 * HOUR_MS },
    { maxInactiveMs: 6 * HOUR_MS, rateMs: 6 * HOUR_MS },
    { maxInactiveMs: 12 * HOUR_MS, rateMs: 12 * HOUR_MS },
    { maxInactiveMs: 30 * DAY_MS, rateMs: 1 * DAY_MS },
  ],
};

export function startPerceptionScheduler(
  construct: PerceptionSchedulerConstruct,
  vfs: OverlayFs,
  config: PerceptionSchedulerConfig = {},
): PerceptionScheduler {
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  const minHeartbeatMs = config.minHeartbeatMs ?? DEFAULT_MIN_HEARTBEAT_MS;
  const maxHeartbeatMs = config.maxHeartbeatMs ?? DEFAULT_MAX_HEARTBEAT_MS;
  const inactivityStopDays =
    config.inactivityStopDays ?? DEFAULT_INACTIVITY_STOP_DAYS;
  const heartbeatShape = normalizeHeartbeatShape(
    config.heartbeatShape ?? DEFAULT_HEARTBEAT_SHAPE,
    inactivityStopDays,
  );
  const maxActiveReminders = Math.max(1, config.maxActiveReminders ?? 1);

  let stopped = false;
  let tickInFlight = false;

  const tick = async () => {
    if (stopped || tickInFlight) return;
    tickInFlight = true;
    const now = new Date();
    try {
      await runPerceptionSchedulerTickInternal({
        construct,
        vfs,
        now,
        minHeartbeatMs,
        maxHeartbeatMs,
        inactivityStopDays,
        heartbeatShape,
        maxActiveReminders,
        shouldPause: config.shouldPause,
      });
    } finally {
      tickInFlight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export async function runPerceptionSchedulerTick(
  construct: PerceptionSchedulerConstruct,
  vfs: OverlayFs,
  config: PerceptionSchedulerConfig = {},
  now: Date = new Date(),
): Promise<void> {
  const minHeartbeatMs = config.minHeartbeatMs ?? DEFAULT_MIN_HEARTBEAT_MS;
  const maxHeartbeatMs = config.maxHeartbeatMs ?? DEFAULT_MAX_HEARTBEAT_MS;
  const inactivityStopDays =
    config.inactivityStopDays ?? DEFAULT_INACTIVITY_STOP_DAYS;
  const heartbeatShape = normalizeHeartbeatShape(
    config.heartbeatShape ?? DEFAULT_HEARTBEAT_SHAPE,
    inactivityStopDays,
  );
  const maxActiveReminders = Math.max(1, config.maxActiveReminders ?? 1);

  await runPerceptionSchedulerTickInternal({
    construct,
    vfs,
    now,
    minHeartbeatMs,
    maxHeartbeatMs,
    inactivityStopDays,
    heartbeatShape,
    maxActiveReminders,
    shouldPause: config.shouldPause,
  });
}

async function maybeFireReminders(
  construct: PerceptionSchedulerConstruct,
  vfs: OverlayFs,
  now: Date,
  maxActiveReminders: number,
): Promise<void> {
  const activeImpulses = construct.getImpulsePool().getActive();
  const activeReminderCount = activeImpulses.filter(
    (impulse) => impulse.triggeredBy.source === 'self_reminder',
  ).length;
  const availableSlots = Math.max(0, maxActiveReminders - activeReminderCount);
  const dueReminders = await listDueReminderEntries(vfs, now);
  let dispatchedStandardReminders = 0;

  for (const { path, reminder } of dueReminders) {
    const isHeartbeatReminder = reminder.meta.type === 'heartbeat';
    if (!isHeartbeatReminder && dispatchedStandardReminders >= availableSlots) {
      break;
    }

    if (isHeartbeatReminder) {
      const state = await construct.getState();
      const activeHeartbeatCount = activeImpulses.filter(
        (impulse) =>
          impulse.triggeredBy.source === 'system_event' &&
          impulse.triggeredBy.event === CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
      ).length;
      if (state.activeImpulses > 0 || activeHeartbeatCount > 0) {
        continue;
      }

      const heartbeatRateMs =
        typeof reminder.meta.heartbeat_rate_ms === 'number'
          ? reminder.meta.heartbeat_rate_ms
          : undefined;
      await construct.ingest({
        lane: 'heartbeat',
        role: 'system',
        source: 'system_event',
        event: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        content: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        occurredAt: now,
        metadata: {
          heartbeat_rate_ms: heartbeatRateMs,
          last_user_message_at:
            typeof reminder.meta.last_user_message_at === 'string'
              ? reminder.meta.last_user_message_at
              : undefined,
          last_response_at:
            typeof reminder.meta.last_response_at === 'string'
              ? reminder.meta.last_response_at
              : undefined,
        },
      });

      const nextHeartbeatAt =
        (typeof reminder.meta.estimated_next_heartbeat_at === 'string' &&
        reminder.meta.estimated_next_heartbeat_at.length > 0
          ? reminder.meta.estimated_next_heartbeat_at
          : heartbeatRateMs
            ? new Date(now.getTime() + heartbeatRateMs).toISOString()
            : '') || undefined;

      await updateHeartbeatMeta(vfs, {
        heartbeat_rate_ms: heartbeatRateMs,
        last_heartbeat_at: now.toISOString(),
        estimated_next_heartbeat_at: nextHeartbeatAt ?? '',
      });
      reminder.meta.last_fired_at = now.toISOString();
      reminder.meta.status = nextHeartbeatAt ? 'pending' : 'done';
      reminder.meta.next_fire_at = nextHeartbeatAt ?? '';
      reminder.meta.due_at = nextHeartbeatAt ?? '';
      reminder.meta.estimated_next_heartbeat_at = nextHeartbeatAt ?? '';
      await saveReminder(vfs, reminder);
      await vfs.flush();
      continue;
    }

    await construct.ingest({
      lane: 'heartbeat',
      role: 'system',
      source: 'self_reminder',
      content: reminder.content.trim() || 'Reminder',
      occurredAt: now,
      createdAt: now,
      metadata: {
        reminder_id: path.split('/').pop() ?? path,
        cron: reminder.meta.cron,
        next_fire_at: reminder.meta.next_fire_at,
        last_fired_at: reminder.meta.last_fired_at,
        source: reminder.meta.source,
        tags: reminder.meta.tags,
        ...reminder.meta,
      },
    });

    const next = await computeNextReminderFireAt({ reminder, now, vfs });

    reminder.meta.last_fired_at = now.toISOString();
    if (next) {
      reminder.meta.next_fire_at = next.toISOString();
    } else {
      reminder.meta.status = 'done';
    }

    await saveReminder(vfs, reminder);
    await vfs.flush();
    dispatchedStandardReminders += 1;
  }
}

async function runPerceptionSchedulerTickInternal(
  args: SchedulerTickInternalArgs,
): Promise<void> {
  if (args.shouldPause) {
    const paused = await args.shouldPause();
    if (paused) {
      return;
    }
  }

  await syncHeartbeatReminder({
    vfs: args.vfs,
    now: args.now,
    heartbeatMeta: await loadHeartbeatMeta(args.vfs),
    minHeartbeatMs: args.minHeartbeatMs,
    maxHeartbeatMs: args.maxHeartbeatMs,
    inactivityStopDays: args.inactivityStopDays,
    heartbeatShape: args.heartbeatShape,
  });

  await maybeFireReminders(
    args.construct,
    args.vfs,
    args.now,
    args.maxActiveReminders,
  );
}
