export type RelativeTimeFormatOptions = {
  now?: Date;
  timeZone?: string;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(
  date: Date,
  options: RelativeTimeFormatOptions = {},
): string {
  const now = options.now ?? new Date();
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const absMs = Math.abs(diffMs);

  if (absMs < MINUTE_MS) {
    return future ? 'in a moment' : 'just now';
  }

  if (absMs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(absMs / MINUTE_MS));
    return future ? `in ${minutes}m` : `${minutes}m ago`;
  }

  if (absMs < DAY_MS) {
    const hours = Math.max(1, Math.floor(absMs / HOUR_MS));
    return future ? `in ${hours}h` : `${hours}h ago`;
  }

  const days = Math.max(1, Math.floor(absMs / DAY_MS));
  const monthDay = formatMonthDay(date, options.timeZone);

  if (days < 7) {
    return future
      ? `in ${days} days (${monthDay})`
      : `${days} days ago (${monthDay})`;
  }

  if (days < 30) {
    const weeks = Math.max(1, Math.floor(days / 7));
    if (weeks <= 1) {
      return future ? `next week (${monthDay})` : `last week (${monthDay})`;
    }
    return future
      ? `in ${weeks} weeks (${monthDay})`
      : `${weeks} weeks ago (${monthDay})`;
  }

  if (days < 365) {
    return formatMonthDay(date, options.timeZone);
  }

  return formatMonthDay(date, options.timeZone, true);
}

export function formatTimestampWithRelative(
  date: Date,
  options: RelativeTimeFormatOptions = {},
): string {
  return `${date.toISOString()} (${formatRelativeTime(date, options)})`;
}

export function formatMonthDay(
  date: Date,
  timeZone?: string,
  includeYear = false,
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined,
  });
  const parts = formatter.formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const dayRaw = parts.find((part) => part.type === 'day')?.value ?? '';
  const year = parts.find((part) => part.type === 'year')?.value;
  const dayNum = Number.parseInt(dayRaw, 10);
  const day = Number.isNaN(dayNum) ? dayRaw : `${dayNum}${ordinal(dayNum)}`;

  if (includeYear && year) {
    return `${month} ${day}, ${year}`;
  }
  return `${month} ${day}`.trim();
}

export function replaceIsoTimestamps(
  input: string,
  now: Date,
  timeZone?: string,
): string {
  return input.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g,
    (iso: string) => {
      const parsed = new Date(iso);
      if (Number.isNaN(parsed.getTime())) return iso;
      return formatRelativeTime(parsed, { now, timeZone });
    },
  );
}

export function getUtcIsoWeek(date: Date = new Date()): {
  year: number;
  week: number;
} {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const year = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const diffDays =
    Math.floor((utcDate.getTime() - yearStart.getTime()) / DAY_MS) + 1;
  const week = Math.ceil(diffDays / 7);

  return { year, week };
}

function ordinal(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'st';
  if (mod10 === 2 && mod100 !== 12) return 'nd';
  if (mod10 === 3 && mod100 !== 13) return 'rd';
  return 'th';
}
