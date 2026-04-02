import type { OverlayFs } from '@inkibra/ai-flow';
import { parseExpression } from 'cron-parser';
import { resolveUserTimeZone } from '../utils/timezone';
import { type HeartbeatMeta, updateHeartbeatMeta } from '../vfs/heartbeat';
import { VFS_PATHS } from '../vfs/layout';
import {
  listReminders,
  loadReminder,
  type ReminderEntry,
  saveReminder,
} from '../vfs/reminders';
import type { HeartbeatShape } from './perception-scheduler';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HEARTBEAT_REMINDER_CONTENT =
  'Internal heartbeat wakeup. Managed by runtime.';

export const HEARTBEAT_REMINDER_PATH = `${VFS_PATHS.reminders.root}/heartbeat.md`;

export type DueReminderEntry = {
  path: string;
  reminder: ReminderEntry;
  dueDate: Date;
};

export type HeartbeatScheduleState = {
  rateMs: number | null;
  shouldFire: boolean;
  dueAt?: string;
  estimatedNextHeartbeatAt?: string;
};

export type PerceptionDueItem = {
  kind: 'reminder';
  dueAt: string;
  reminderId: string;
  path: string;
  reminder: ReminderEntry;
};

export type PerceptionScheduleState = {
  heartbeat: HeartbeatScheduleState;
  dueReminders: DueReminderEntry[];
  nextDue?: PerceptionDueItem;
};

async function listScheduledReminderEntries(
  vfs: OverlayFs,
): Promise<DueReminderEntry[]> {
  const reminderPaths = await listReminders(vfs);
  const reminders: DueReminderEntry[] = [];

  for (const path of reminderPaths) {
    const reminder = await loadReminder(vfs, path);
    if (!reminder) {
      continue;
    }

    const status = reminder.meta.status ?? 'pending';
    if (status !== 'pending') {
      continue;
    }

    const dueAt = reminder.meta.next_fire_at ?? reminder.meta.due_at;
    if (!dueAt) {
      continue;
    }

    const dueDate = new Date(dueAt);
    if (Number.isNaN(dueDate.getTime())) {
      continue;
    }

    reminders.push({
      path,
      reminder,
      dueDate,
    });
  }

  reminders.sort((a, b) => {
    const dueDelta = a.dueDate.getTime() - b.dueDate.getTime();
    if (dueDelta !== 0) {
      return dueDelta;
    }

    return a.path.localeCompare(b.path);
  });

  return reminders;
}

export async function listDueReminderEntries(
  vfs: OverlayFs,
  now: Date,
): Promise<DueReminderEntry[]> {
  const reminders = await listScheduledReminderEntries(vfs);
  return reminders.filter((entry) => now >= entry.dueDate);
}

export function evaluateHeartbeatSchedule(args: {
  now: Date;
  heartbeatMeta: HeartbeatMeta;
  minHeartbeatMs: number;
  maxHeartbeatMs: number;
  inactivityStopDays: number;
  heartbeatShape: HeartbeatShape;
}): HeartbeatScheduleState {
  const lastPulseAt = args.heartbeatMeta.last_pulse_at
    ? new Date(args.heartbeatMeta.last_pulse_at)
    : null;
  const lastHeartbeatAt = args.heartbeatMeta.last_heartbeat_at
    ? new Date(args.heartbeatMeta.last_heartbeat_at)
    : null;
  const rateMs = computeHeartbeatRate(
    args.now,
    lastPulseAt,
    args.minHeartbeatMs,
    args.maxHeartbeatMs,
    args.inactivityStopDays,
    args.heartbeatShape,
  );

  if (rateMs === null) {
    return {
      rateMs: null,
      shouldFire: false,
    };
  }

  const estimatedAt = args.heartbeatMeta.estimated_next_heartbeat_at
    ? Date.parse(args.heartbeatMeta.estimated_next_heartbeat_at)
    : Number.NaN;
  if (!Number.isNaN(estimatedAt) && args.now.getTime() >= estimatedAt) {
    return {
      rateMs,
      shouldFire: true,
      dueAt: args.heartbeatMeta.estimated_next_heartbeat_at,
      estimatedNextHeartbeatAt: new Date(
        args.now.getTime() + rateMs,
      ).toISOString(),
    };
  }

  const bootstrapAnchor =
    lastPulseAt instanceof Date && !Number.isNaN(lastPulseAt.getTime())
      ? lastPulseAt
      : undefined;

  if (!lastHeartbeatAt) {
    if (!bootstrapAnchor) {
      return {
        rateMs,
        shouldFire: false,
      };
    }

    const rawDueAtMs = bootstrapAnchor.getTime() + rateMs;
    const shouldFire = args.now.getTime() >= rawDueAtMs;
    const dueAt = new Date(
      shouldFire ? Math.min(rawDueAtMs, args.now.getTime()) : rawDueAtMs,
    ).toISOString();

    return {
      rateMs,
      shouldFire,
      dueAt,
      estimatedNextHeartbeatAt: shouldFire
        ? new Date(args.now.getTime() + rateMs).toISOString()
        : dueAt,
    };
  }

  const lastBeatMs = lastHeartbeatAt.getTime();
  const rawDueAtMs = lastBeatMs + rateMs;
  const shouldFire = args.now.getTime() - lastBeatMs >= rateMs;
  const dueAt = new Date(
    shouldFire ? Math.min(rawDueAtMs, args.now.getTime()) : rawDueAtMs,
  ).toISOString();
  const estimatedNextHeartbeatAt = new Date(
    shouldFire ? args.now.getTime() + rateMs : rawDueAtMs,
  ).toISOString();

  return {
    rateMs,
    shouldFire,
    dueAt,
    estimatedNextHeartbeatAt,
  };
}

export async function syncHeartbeatReminder(args: {
  vfs: OverlayFs;
  now: Date;
  heartbeatMeta: HeartbeatMeta;
  minHeartbeatMs: number;
  maxHeartbeatMs: number;
  inactivityStopDays: number;
  heartbeatShape: HeartbeatShape;
}): Promise<HeartbeatScheduleState> {
  const heartbeat = evaluateHeartbeatSchedule(args);
  const existingReminder = await loadReminder(
    args.vfs,
    HEARTBEAT_REMINDER_PATH,
  );

  if (heartbeat.rateMs === null || !heartbeat.dueAt) {
    if (existingReminder) {
      await saveReminder(args.vfs, {
        path: HEARTBEAT_REMINDER_PATH,
        content: existingReminder.content || HEARTBEAT_REMINDER_CONTENT,
        meta: {
          ...existingReminder.meta,
          type: 'heartbeat',
          source: 'runtime-heartbeat',
          status: 'done',
          due_at: '',
          next_fire_at: '',
        },
      });
    }
    await updateHeartbeatMeta(args.vfs, {
      heartbeat_rate_ms: heartbeat.rateMs ?? undefined,
      estimated_next_heartbeat_at: '',
    });
    return heartbeat;
  }

  const nextHeartbeatAt = heartbeat.estimatedNextHeartbeatAt ?? heartbeat.dueAt;

  await saveReminder(args.vfs, {
    path: HEARTBEAT_REMINDER_PATH,
    content: existingReminder?.content || HEARTBEAT_REMINDER_CONTENT,
    meta: {
      ...(existingReminder?.meta ?? {}),
      type: 'heartbeat',
      source: 'runtime-heartbeat',
      status: 'pending',
      priority: 'system',
      due_at: heartbeat.dueAt,
      next_fire_at: heartbeat.dueAt,
      estimated_next_heartbeat_at: nextHeartbeatAt,
      heartbeat_rate_ms: heartbeat.rateMs,
      last_user_message_at: args.heartbeatMeta.last_user_message_at,
      last_response_at: args.heartbeatMeta.last_response_at,
      lane: 'heartbeat',
    },
  });
  await updateHeartbeatMeta(args.vfs, {
    heartbeat_rate_ms: heartbeat.rateMs ?? undefined,
    estimated_next_heartbeat_at: nextHeartbeatAt,
  });
  return heartbeat;
}

export async function loadPerceptionScheduleState(args: {
  vfs: OverlayFs;
  now: Date;
  heartbeatMeta: HeartbeatMeta;
  minHeartbeatMs: number;
  maxHeartbeatMs: number;
  inactivityStopDays: number;
  heartbeatShape: HeartbeatShape;
}): Promise<PerceptionScheduleState> {
  const heartbeat = await syncHeartbeatReminder({
    vfs: args.vfs,
    now: args.now,
    heartbeatMeta: args.heartbeatMeta,
    minHeartbeatMs: args.minHeartbeatMs,
    maxHeartbeatMs: args.maxHeartbeatMs,
    inactivityStopDays: args.inactivityStopDays,
    heartbeatShape: args.heartbeatShape,
  });
  const scheduledReminders = await listScheduledReminderEntries(args.vfs);
  const dueReminders = scheduledReminders.filter(
    (entry) => args.now >= entry.dueDate,
  );

  const nextReminder = scheduledReminders[0];
  const nextDue = nextReminder
    ? {
        kind: 'reminder' as const,
        dueAt: nextReminder.dueDate.toISOString(),
        reminderId: nextReminder.path.split('/').pop() ?? nextReminder.path,
        path: nextReminder.path,
        reminder: nextReminder.reminder,
      }
    : undefined;

  return {
    heartbeat,
    dueReminders,
    nextDue,
  };
}

export async function computeNextReminderFireAt(args: {
  reminder: ReminderEntry;
  now: Date;
  vfs: OverlayFs;
}): Promise<Date | null> {
  const timezone =
    (args.reminder.meta.timezone as string | undefined) ??
    (await resolveUserTimeZone(args.vfs));
  return args.reminder.meta.cron
    ? computeNextCron(args.reminder.meta.cron as string, args.now, timezone)
    : null;
}

export function computeHeartbeatRate(
  now: Date,
  lastPulseAt: Date | null,
  minHeartbeatMs: number,
  maxHeartbeatMs: number,
  inactivityStopDays: number,
  heartbeatShape: HeartbeatShape,
): number | null {
  const stopAfterMs = Math.min(
    heartbeatShape.stopAfterMs,
    inactivityStopDays * DAY_MS,
  );

  if (!lastPulseAt) {
    return clamp(heartbeatShape.whenNoUserMs, minHeartbeatMs, maxHeartbeatMs);
  }

  const diffMs = now.getTime() - lastPulseAt.getTime();
  if (diffMs >= stopAfterMs) {
    return null;
  }

  const buckets = heartbeatShape.buckets
    .slice()
    .sort((a, b) => a.maxInactiveMs - b.maxInactiveMs);

  for (const bucket of buckets) {
    if (diffMs < bucket.maxInactiveMs) {
      return clamp(bucket.rateMs, minHeartbeatMs, maxHeartbeatMs);
    }
  }

  const fallback =
    buckets.length > 0
      ? buckets[buckets.length - 1]!.rateMs
      : heartbeatShape.whenNoUserMs;
  return clamp(fallback, minHeartbeatMs, maxHeartbeatMs);
}

export function normalizeHeartbeatShape(
  shape: HeartbeatShape,
  inactivityStopDays: number,
): HeartbeatShape {
  const stopAfterMs = Math.min(shape.stopAfterMs, inactivityStopDays * DAY_MS);
  const buckets = shape.buckets
    .slice()
    .filter((bucket) => bucket.maxInactiveMs > 0 && bucket.rateMs > 0)
    .sort((a, b) => a.maxInactiveMs - b.maxInactiveMs);

  return {
    whenNoUserMs: shape.whenNoUserMs > 0 ? shape.whenNoUserMs : 12 * HOUR_MS,
    stopAfterMs,
    buckets,
  };
}

function computeNextCron(
  cronExpression: string,
  now: Date,
  timezone?: string,
): Date | null {
  try {
    const expr = parseExpression(cronExpression, {
      currentDate: now,
      tz: timezone,
    });
    return expr.next().toDate();
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
