import type {
  ConstructLiveImpulseView,
  ConstructLiveResponseStatus,
} from './projection';
import type { ConstructLiveResponseDecision } from './selectors';

export type ConstructIngressLifecycleStatus =
  | 'accepted'
  | 'committed'
  | 'stalled';

export type ConstructIngressLifecycleView = {
  ref: string;
  opId: string;
  opKind: string;
  status: ConstructIngressLifecycleStatus;
  attempts: number;
  updatedAt: string;
  error?: string;
};

export type ConstructLiveDecisionEntry = ConstructLiveResponseDecision;

export function appendConstructLiveDelta(
  current: string,
  delta: string,
): string {
  const next = `${current}${delta}`;
  const maxLength = 4000;
  if (next.length <= maxLength) {
    return next;
  }
  return next.slice(next.length - maxLength);
}

export function appendConstructLiveImpulseDelta(
  current: Record<string, string>,
  impulseId: string,
  delta: string,
): Record<string, string> {
  const prior = current[impulseId] ?? '';
  return {
    ...current,
    [impulseId]: appendConstructLiveDelta(prior, delta),
  };
}

export function pruneConstructLiveDecisionEntries(
  entries: ConstructLiveDecisionEntry[],
  _nowIso: string,
): ConstructLiveDecisionEntry[] {
  return entries.filter((entry) => entry.state === 'live');
}

export function pruneConstructLiveImpulses(
  impulses: Record<string, ConstructLiveImpulseView>,
  _nowIso: string,
): Record<string, ConstructLiveImpulseView> {
  return Object.fromEntries(
    Object.entries(impulses).filter(
      ([, impulse]) => impulse.status === 'running',
    ),
  );
}

export function pruneConstructLiveImpulseThinking(
  thinkingById: Record<string, string>,
  impulses: Record<string, ConstructLiveImpulseView>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(thinkingById).filter(([impulseId]) => impulses[impulseId]),
  );
}

export function formatConstructPerceptionSummary(perception: unknown): string {
  const maybePerception =
    perception && typeof perception === 'object'
      ? (perception as Record<string, unknown>)
      : undefined;
  if (!maybePerception) {
    return 'processing perception';
  }

  const content =
    typeof maybePerception.content === 'string'
      ? maybePerception.content.trim()
      : '';
  if (content) {
    const compact = content.replace(/\s+/g, ' ');
    return compact.length > 96 ? `${compact.slice(0, 96)}...` : compact;
  }

  const source =
    typeof maybePerception.source === 'string'
      ? maybePerception.source
      : 'unknown';
  return source.replace(/_/g, ' ');
}

export function mergeConstructLiveResponseStatuses(
  current: Record<string, ConstructLiveResponseStatus>,
  responseId: string,
  patch: ConstructLiveResponseStatus,
): Record<string, ConstructLiveResponseStatus> {
  return {
    ...current,
    [responseId]: {
      ...current[responseId],
      ...patch,
    },
  };
}
