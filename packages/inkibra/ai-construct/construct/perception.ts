import { IMPULSE_POOL_NAME } from '../impulse/keys';
import type { ConstructPulseSource, Perception } from './types';

export type ReflectedPerceptionMessage = {
  timestamp: Date;
  role: 'user' | 'system';
  content: string;
};

export function truncatePerceptionContent(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

export function formatPerceptionSummary(perception: Perception): string {
  switch (perception.source) {
    case 'user_message':
      return perception.content.trim()
        ? truncatePerceptionContent(perception.content, 80)
        : 'user message';
    case 'system_event':
      return (
        perception.event ?? truncatePerceptionContent(perception.content, 80)
      );
    case 'self_reminder':
      return `reminder: ${truncatePerceptionContent(perception.content, 80)}`;
    case 'time_passed':
      return perception.elapsed?.trim()
        ? `${perception.elapsed} passed`
        : truncatePerceptionContent(perception.content, 80);
  }
}

export function getPerceptionDisplayContent(perception: Perception): string {
  if (perception.source === 'time_passed' && perception.elapsed?.trim()) {
    return `${perception.elapsed} passed`;
  }
  return perception.content;
}

export function buildReflectedPerceptionMessages(
  perception: Perception,
): ReflectedPerceptionMessage[] {
  return [
    {
      timestamp: perception.occurredAt,
      role: perception.role,
      content: getPerceptionDisplayContent(perception),
    },
  ];
}

export function getPerceptionDefaultPool(perception: Perception): string {
  return perception.role === 'user'
    ? IMPULSE_POOL_NAME.CONVERSATION
    : IMPULSE_POOL_NAME.BACKGROUND;
}

export function getPerceptionPulseSource(
  perception: Perception,
): ConstructPulseSource {
  return perception.role === 'user' ? 'user' : 'runtime';
}

export function getPerceptionOrigin(
  perception: Perception,
): string | undefined {
  return formatOriginSuffix(
    perception.metadata,
    perception.role === 'user' ? 'user' : undefined,
  );
}

export function formatPerceptionMetadata(
  meta: Record<string, unknown> | undefined,
): string {
  if (!meta) return '';
  const lines: string[] = [];
  for (const key of Object.keys(meta).sort()) {
    const value = meta[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') {
      lines.push(`- ${key}: ${value}`);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`- ${key}: ${String(value)}`);
      continue;
    }
    lines.push(`- ${key}: ${JSON.stringify(value)}`);
  }

  return lines.join('\n');
}

export function formatOriginSuffix(
  meta: Record<string, unknown> | undefined,
  defaultChannel?: string,
): string | undefined {
  if (!meta && !defaultChannel) return undefined;
  const parts: string[] = [];

  const speaker = meta
    ? (getMetaString(meta, 'speaker') ?? getMetaString(meta, 'from'))
    : undefined;
  const recipient = meta
    ? (getMetaString(meta, 'recipient') ?? getMetaString(meta, 'to'))
    : undefined;
  const channel = meta
    ? (getMetaString(meta, 'channel') ?? defaultChannel)
    : defaultChannel;
  const source = meta ? getMetaString(meta, 'source') : undefined;

  if (speaker) parts.push(`speaker: ${speaker}`);
  if (recipient) parts.push(`recipient: ${recipient}`);
  if (channel) parts.push(`channel: ${channel}`);
  if (source) parts.push(`source: ${source}`);

  return parts.length > 0 ? parts.join(', ') : undefined;
}

export function appendPerceptionOrigin(
  base: string,
  perception: Perception,
): string {
  const origin = getPerceptionOrigin(perception);
  return origin ? `${base} (${origin})` : base;
}

export function getMetaString(
  meta: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = meta[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

export function isSystemEventPerception<
  TLaneName extends string,
  TSystemEventName extends string,
>(
  perception: Perception<TLaneName, TSystemEventName>,
): perception is Perception<TLaneName, TSystemEventName> & {
  source: 'system_event';
  event: TSystemEventName;
} {
  return (
    perception.source === 'system_event' &&
    typeof perception.event === 'string' &&
    perception.event.trim().length > 0
  );
}
