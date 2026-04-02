/**
 * Context Pressure
 *
 * Utilities for monitoring rendered pinned-context pressure and managing
 * ephemeral opened-file handles.
 */

import { estimateTokensFromBytes, type OverlayFs } from '@inkibra/ai-flow';
import { loadLanesConfig, traceStageContext } from './context-system';
import { VFS_PATHS } from './layout';
import type { OpenedFileEntry, OpenedFilesState } from './opened';
import {
  DEFAULT_HANDLE_SCORE,
  loadOpenedState,
  saveOpenedState,
} from './opened';

export type ContextPressureConfig = {
  maxContextTokens: number;
  warnThreshold: number;
  criticalThreshold: number;
  autoCloseTarget: number;
};

export const DEFAULT_CONTEXT_PRESSURE_CONFIG: ContextPressureConfig = {
  maxContextTokens: 128_000,
  warnThreshold: 0.75,
  criticalThreshold: 0.9,
  autoCloseTarget: 0.7,
};

export type ContextPressureStatus = 'ok' | 'warning' | 'critical';

export type ContextPressureState = {
  status: ContextPressureStatus;
  ratio: number;
  contextTokens: number;
  maxTokens: number;
  contextBytes: number;
};

export const CONTEXT_PRESSURE_STAGES = [
  'impulse',
  'response',
  'nap/analyze',
  'nap/propose',
] as const;

export type ContextPressureStage = (typeof CONTEXT_PRESSURE_STAGES)[number];

export type LaneStageContextPressureEntry = ContextPressureState & {
  lane: string;
  stage: ContextPressureStage;
  totalEntries: number;
  totalChars: number;
  pinnedPaths: string[];
};

export type LaneStageContextPressureDiagnostics = {
  maxTokens: number;
  pairs: LaneStageContextPressureEntry[];
  maxPair?: LaneStageContextPressureEntry;
};

function evaluatePressureCounts(args: {
  contextTokens: number;
  contextBytes: number;
  config: ContextPressureConfig;
}): ContextPressureState {
  const ratio = args.contextTokens / args.config.maxContextTokens;

  if (ratio >= args.config.criticalThreshold) {
    return {
      status: 'critical',
      ratio,
      contextTokens: args.contextTokens,
      maxTokens: args.config.maxContextTokens,
      contextBytes: args.contextBytes,
    };
  }

  if (ratio >= args.config.warnThreshold) {
    return {
      status: 'warning',
      ratio,
      contextTokens: args.contextTokens,
      maxTokens: args.config.maxContextTokens,
      contextBytes: args.contextBytes,
    };
  }

  return {
    status: 'ok',
    ratio,
    contextTokens: args.contextTokens,
    maxTokens: args.config.maxContextTokens,
    contextBytes: args.contextBytes,
  };
}

export function evaluateContextPressure(
  state: OpenedFilesState,
  config: ContextPressureConfig,
): ContextPressureState {
  const contextBytes = state.files.reduce((sum, f) => sum + f.size_bytes, 0);
  const contextTokens = state.files.reduce(
    (sum, f) =>
      sum +
      (typeof f.size_tokens === 'number'
        ? f.size_tokens
        : estimateTokensFromBytes(f.size_bytes)),
    0,
  );

  return evaluatePressureCounts({
    contextTokens,
    contextBytes,
    config,
  });
}

const CONTEXT_PRESSURE_STAGE_ORDER: Record<ContextPressureStage, number> = {
  impulse: 0,
  response: 1,
  'nap/analyze': 2,
  'nap/propose': 3,
};

function compareLaneStagePressureEntries(
  left: LaneStageContextPressureEntry,
  right: LaneStageContextPressureEntry,
): number {
  const stageDiff =
    CONTEXT_PRESSURE_STAGE_ORDER[left.stage] -
    CONTEXT_PRESSURE_STAGE_ORDER[right.stage];
  if (stageDiff !== 0) {
    return stageDiff;
  }
  return left.lane.localeCompare(right.lane);
}

export async function buildLaneStageContextPressureDiagnostics(
  vfs: OverlayFs,
  config: ContextPressureConfig = DEFAULT_CONTEXT_PRESSURE_CONFIG,
): Promise<LaneStageContextPressureDiagnostics> {
  const lanesConfig = await loadLanesConfig(vfs);
  const declaredLanes = Object.keys(lanesConfig).sort((left, right) =>
    left.localeCompare(right),
  );
  const lanes = declaredLanes.length > 0 ? declaredLanes : ['conversation'];
  const now = new Date();

  const maybePairs = await Promise.all(
    lanes.flatMap((lane) =>
      CONTEXT_PRESSURE_STAGES.map(async (stage) => {
        const trace = await traceStageContext(vfs, { stage, lane, now });
        if (trace.totalEntries === 0 && trace.totalChars === 0) {
          return null;
        }

        const pressure = evaluateRenderedContextPressure(
          trace.totalChars,
          config,
        );
        const pinnedPaths = [
          ...new Set(
            trace.sections
              .flatMap((section) => section.entries)
              .filter(
                (entry) =>
                  entry.source === 'pin' || entry.source === 'runtime-pinned',
              )
              .map((entry) => entry.path),
          ),
        ].sort((left, right) => left.localeCompare(right));

        return {
          ...pressure,
          lane,
          stage,
          totalEntries: trace.totalEntries,
          totalChars: trace.totalChars,
          pinnedPaths,
        } satisfies LaneStageContextPressureEntry;
      }),
    ),
  );

  const pairs = maybePairs
    .filter((entry): entry is LaneStageContextPressureEntry => entry !== null)
    .sort(compareLaneStagePressureEntries);

  const maxPair = pairs.reduce<LaneStageContextPressureEntry | undefined>(
    (currentMax, entry) => {
      if (!currentMax) {
        return entry;
      }
      if (entry.contextTokens > currentMax.contextTokens) {
        return entry;
      }
      return currentMax;
    },
    undefined,
  );

  return {
    maxTokens: config.maxContextTokens,
    pairs,
    maxPair,
  };
}

export type AutoCloseResult = {
  closed: OpenedFileEntry[];
  state: OpenedFilesState;
};

export function matchesPinnedPath(entryPath: string, pinPath: string): boolean {
  if (pinPath.endsWith('/**')) {
    const root = pinPath.slice(0, -3).replace(/\/$/, '');
    return entryPath.startsWith(`${root}/`);
  }

  if (pinPath.endsWith('/*')) {
    const root = pinPath.slice(0, -2).replace(/\/$/, '');
    if (!entryPath.startsWith(`${root}/`)) {
      return false;
    }
    const remainder = entryPath.slice(root.length + 1).replace(/\/$/, '');
    return remainder.length > 0 && !remainder.includes('/');
  }

  if (pinPath.endsWith('/')) {
    const normalized = pinPath.slice(0, -1);
    return entryPath === pinPath || entryPath === normalized;
  }

  return entryPath === pinPath;
}

function isPinnedByPolicyPath(
  entryPath: string,
  policyPaths: string[],
): boolean {
  for (const pinPath of policyPaths) {
    if (matchesPinnedPath(entryPath, pinPath)) {
      return true;
    }
  }
  return false;
}

function resolveExpirationMs(entry: OpenedFileEntry): number | null {
  if (entry.expires_at) {
    const expires = Date.parse(entry.expires_at);
    if (!Number.isNaN(expires)) return expires;
  }
  if (typeof entry.ttl_ms === 'number') {
    const base = Date.parse(entry.last_accessed_at ?? entry.opened_at);
    if (!Number.isNaN(base)) return base + entry.ttl_ms;
  }
  return null;
}

/**
 * Auto-close oldest non-pinned files until below target tokens.
 */
export async function autoCloseOldest(
  vfs: OverlayFs,
  targetTokens: number,
  pinnedPaths?: string[],
): Promise<AutoCloseResult> {
  const state = await loadOpenedState(vfs);
  const resolvedPinnedPaths = pinnedPaths ?? [];
  const nowMs = Date.now();

  const closable = state.files
    .filter((f) => !f.pin && !isPinnedByPolicyPath(f.path, resolvedPinnedPaths))
    .sort((a, b) => {
      const aExpire = resolveExpirationMs(a);
      const bExpire = resolveExpirationMs(b);
      const aExpired = aExpire !== null && aExpire <= nowMs;
      const bExpired = bExpire !== null && bExpire <= nowMs;
      if (aExpired !== bExpired) return aExpired ? -1 : 1;

      const aScore =
        typeof a.score === 'number' ? a.score : DEFAULT_HANDLE_SCORE;
      const bScore =
        typeof b.score === 'number' ? b.score : DEFAULT_HANDLE_SCORE;
      if (aScore !== bScore) return aScore - bScore;

      const aAccess = Date.parse(a.last_accessed_at ?? a.opened_at);
      const bAccess = Date.parse(b.last_accessed_at ?? b.opened_at);
      if (!Number.isNaN(aAccess) && !Number.isNaN(bAccess)) {
        return aAccess - bAccess;
      }

      return new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime();
    });

  const closed: OpenedFileEntry[] = [];

  for (const entry of closable) {
    if (state.context_tokens <= targetTokens) break;
    const index = state.files.findIndex((f) => f.path === entry.path);
    if (index >= 0) {
      const [removed] = state.files.splice(index, 1);
      if (removed) {
        closed.push(removed);
        state.context_bytes -= removed.size_bytes;
        state.context_tokens -=
          typeof removed.size_tokens === 'number'
            ? removed.size_tokens
            : estimateTokensFromBytes(removed.size_bytes);
      }
    }
  }

  state.context_bytes = state.files.reduce((sum, f) => sum + f.size_bytes, 0);
  state.context_tokens = state.files.reduce(
    (sum, f) =>
      sum +
      (typeof f.size_tokens === 'number'
        ? f.size_tokens
        : estimateTokensFromBytes(f.size_bytes)),
    0,
  );
  state.updated = new Date().toISOString();

  await saveOpenedState(vfs, state);

  return { closed, state };
}

const LOG_ROOT = VFS_PATHS.logs.root;
const DEFAULT_STALE_LOG_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

/**
 * Close log files opened in full mode that are older than `maxAgeMs`.
 * Pinned files are never closed. Non-log files are never closed.
 */
export async function closeStaleLogFiles(
  vfs: OverlayFs,
  maxAgeMs: number = DEFAULT_STALE_LOG_MAX_AGE_MS,
): Promise<AutoCloseResult> {
  const state = await loadOpenedState(vfs);
  const nowMs = Date.now();
  const closed: OpenedFileEntry[] = [];

  for (let i = state.files.length - 1; i >= 0; i--) {
    const entry = state.files[i];
    if (!entry) continue;
    // Only close log files
    if (!entry.path.startsWith(`${LOG_ROOT}/`)) continue;
    // Only close full-mode files (frontmatter entries are small)
    if (entry.mode === 'frontmatter') continue;
    // Never close pinned files
    if (entry.pin) continue;
    // Check age
    const openedMs = Date.parse(entry.opened_at);
    if (Number.isNaN(openedMs) || nowMs - openedMs < maxAgeMs) continue;

    closed.push(entry);
    state.files.splice(i, 1);
  }

  if (closed.length > 0) {
    state.context_bytes = state.files.reduce((sum, f) => sum + f.size_bytes, 0);
    state.context_tokens = state.files.reduce(
      (sum, f) =>
        sum +
        (typeof f.size_tokens === 'number'
          ? f.size_tokens
          : estimateTokensFromBytes(f.size_bytes)),
      0,
    );
    state.updated = new Date().toISOString();
    await saveOpenedState(vfs, state);
  }

  return { closed, state };
}

export function evaluateRenderedContextPressure(
  totalChars: number,
  config: ContextPressureConfig = DEFAULT_CONTEXT_PRESSURE_CONFIG,
): ContextPressureState {
  return evaluatePressureCounts({
    contextTokens: Math.ceil(totalChars / 4),
    contextBytes: totalChars,
    config,
  });
}
