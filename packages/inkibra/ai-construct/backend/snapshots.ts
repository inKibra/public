import type { Logger } from '@inkibra/logger';
import type { Construct } from '../construct/construct';
import { formatPerceptionSummary } from '../construct/perception';
import { buildConstructToolAndDecisionLogs } from '../lab/lab-snapshot-builders';
import type {
  ConstructLabSnapshot,
  ConstructRuntimeScheduledResponseView,
  ConstructRuntimeSnapshot,
  ConstructRuntimeSourceFactView,
  ConstructRuntimeVfsNode,
  ConstructSnapshotNode,
  ConstructStudioSnapshot,
} from '../lab/types';
import { buildConstructSnapshot } from '../live/construct-snapshot';
import { buildLaneStageContextPressureDiagnostics } from '../vfs/context-pressure';
import { loadHeartbeatMeta } from '../vfs/heartbeat';
import {
  loadSourceFactState,
  type SourceFactRecord,
} from '../vfs/source-fact-state';
import {
  listStudioContextFiles,
  listStudioContextFilesFromSnapshotNodes,
  readStudioState,
} from '../vfs/studio-context';

const CONTEXT_MAX_TOKENS = 128_000;

async function buildRuntimeContextDiagnostics(construct: Construct) {
  const diagnostics = await buildLaneStageContextPressureDiagnostics(
    construct.getVfs(),
  );

  return {
    ...diagnostics,
    maxTokens: diagnostics.maxTokens || CONTEXT_MAX_TOKENS,
  };
}

export async function buildConstructStudioSnapshot(args: {
  construct: Construct;
  snapshotNodes?: ConstructSnapshotNode[];
}): Promise<ConstructStudioSnapshot> {
  const contextFiles = args.snapshotNodes
    ? listStudioContextFilesFromSnapshotNodes(args.snapshotNodes)
    : await listStudioContextFiles(args.construct);
  const studioState = await readStudioState(args.construct);

  return {
    contextFiles,
    activeContextFilePath:
      studioState.activeContextFilePath ?? contextFiles[0]?.path,
    lastSavedAt: studioState.lastSavedAt,
  };
}

export type ConstructSnapshotView = 'studio' | 'lab' | 'runtime';

export type ConstructCombinedSnapshot = {
  cursor?: string;
  studio?: ConstructStudioSnapshot;
  lab?: ConstructLabSnapshot;
  runtime?: ConstructRuntimeSnapshot;
};

export type BuildConstructLabSnapshotOptions = {
  snapshotNodes?: ConstructSnapshotNode[];
  loadRuntimeSourceFacts?: (
    constructId: string,
    construct: Construct,
  ) => Promise<Record<string, SourceFactRecord>>;
  loadIngressFrontier?: (constructId: string) => Promise<{
    processedCursor?: string;
    committedCursor?: string;
  }>;
  loadQueuedMailboxPreview?: (
    constructId: string,
    options?: { limit?: number },
  ) => Promise<
    Array<{
      factId: string;
      previewText: string;
      queuedAt: string;
      queueRef: string;
      opKind: string;
    }>
  >;
  logger?: Logger;
};

export async function buildConstructLabSnapshot(
  construct: Construct,
  options?: BuildConstructLabSnapshotOptions,
): Promise<ConstructLabSnapshot> {
  const _startMs = Date.now();
  const constructState = await construct.getState();
  const vfs = construct.getVfs();
  const sourceFacts = options?.loadRuntimeSourceFacts
    ? await options.loadRuntimeSourceFacts(constructState.id, construct)
    : await loadSourceFactState(vfs);

  const [mailboxPreview, frontier] = await Promise.all([
    options
      ?.loadQueuedMailboxPreview?.(constructState.id)
      .catch(() => undefined),
    options?.loadIngressFrontier?.(constructState.id).catch(() => undefined),
  ]);

  const { labDecisionLog, labToolLog } =
    await buildConstructToolAndDecisionLogs(construct, options?.snapshotNodes);

  const result = await buildConstructSnapshot({
    construct,
    sourceFacts,
    mailboxPreview,
    frontier,
    toolLog: labToolLog,
    decisionLog: labDecisionLog,
    transcriptLimit: 60,
  });
  options?.logger?.info('Snapshot built', {
    view: 'lab',
    constructId: constructState.id,
    elapsedMs: Date.now() - _startMs,
    transcriptRows: result.transcript.length,
    toolLogRows: labToolLog.length,
    decisionLogRows: labDecisionLog.length,
  });
  return result;
}

export type BuildConstructRuntimeSnapshotOptions = {
  snapshotNodes?: ConstructSnapshotNode[];
  constructResidency?: {
    awake: boolean;
    status?: 'starting' | 'active' | 'idle' | 'closing' | 'evicting' | 'dead';
    lastActiveAt?: string;
  };
  loadRuntimeSourceFacts?: (
    constructId: string,
    construct: Construct,
  ) => Promise<Record<string, SourceFactRecord>>;
  logger?: Logger;
};
export type BuildConstructCombinedSnapshotOptions = {
  view: ConstructSnapshotView;
  cursor?: string;
  snapshotNodes?: ConstructSnapshotNode[];
  constructResidency?: BuildConstructRuntimeSnapshotOptions['constructResidency'];
  loadRuntimeSourceFacts?: BuildConstructRuntimeSnapshotOptions['loadRuntimeSourceFacts'];
  loadIngressFrontier?: BuildConstructLabSnapshotOptions['loadIngressFrontier'];
  loadQueuedMailboxPreview?: BuildConstructLabSnapshotOptions['loadQueuedMailboxPreview'];
  logger?: Logger;
};

export async function buildConstructCombinedSnapshot(args: {
  construct: Construct;
  options: BuildConstructCombinedSnapshotOptions;
}): Promise<ConstructCombinedSnapshot> {
  const _startMs = Date.now();
  const result: ConstructCombinedSnapshot = {
    cursor: args.options.cursor,
  };

  if (args.options.view === 'studio' || args.options.view === 'lab') {
    result.studio = await buildConstructStudioSnapshot({
      construct: args.construct,
      snapshotNodes: args.options.snapshotNodes,
    });
  }

  if (args.options.view === 'lab') {
    result.lab = await buildConstructLabSnapshot(args.construct, {
      snapshotNodes: args.options.snapshotNodes,
      loadRuntimeSourceFacts: args.options.loadRuntimeSourceFacts,
      loadIngressFrontier: args.options.loadIngressFrontier,
      loadQueuedMailboxPreview: args.options.loadQueuedMailboxPreview,
      logger: args.options.logger,
    });
  }

  if (args.options.view === 'lab' || args.options.view === 'runtime') {
    result.runtime = await buildConstructRuntimeSnapshot(args.construct, {
      snapshotNodes: args.options.snapshotNodes,
      constructResidency: args.options.constructResidency,
      loadRuntimeSourceFacts: args.options.loadRuntimeSourceFacts,
      logger: args.options.logger,
    });
  }

  args.options.logger?.info('Snapshot built', {
    view: args.options.view,
    elapsedMs: Date.now() - _startMs,
  });
  return result;
}

export async function buildConstructRuntimeSnapshot(
  construct: Construct,
  options?: BuildConstructRuntimeSnapshotOptions,
): Promise<ConstructRuntimeSnapshot> {
  const _startMs = Date.now();
  const constructStatePromise = construct.getState();
  const sourceFactsPromise = (async () => {
    const constructState = await constructStatePromise;
    if (options?.loadRuntimeSourceFacts) {
      try {
        return await options.loadRuntimeSourceFacts(
          constructState.id,
          construct,
        );
      } catch {
        // Fall back to current VFS state.
      }
    }

    return loadSourceFactState(construct.getVfs());
  })();

  const [
    constructState,
    runtimeState,
    schedulerState,
    sourceFacts,
    contextDiagnostics,
  ] = await Promise.all([
    constructStatePromise,
    construct.getRuntimeState(),
    construct.getScheduler().getState(),
    sourceFactsPromise,
    buildRuntimeContextDiagnostics(construct),
  ]);

  const heartbeatMeta = await loadHeartbeatMeta(construct.getVfs());
  const runtimeLogsPromise = buildConstructToolAndDecisionLogs(
    construct,
    options?.snapshotNodes,
  );

  const nodes: ConstructRuntimeVfsNode[] = options?.snapshotNodes
    ? (() => {
        const fileNodes = options.snapshotNodes
          .filter((node) => node.path !== '/')
          .sort((left, right) => left.path.localeCompare(right.path))
          .slice(0, 250)
          .map((node) => ({
            path: node.path,
            type: node.kind,
            sizeBytes: node.kind === 'file' ? node.sizeBytes : undefined,
            modifiedAt: node.modified,
          }));
        // Synthesize directory entries from file paths so the tree has
        // folder nodes even when the DAL only stores file records.
        const dirSet = new Set<string>();
        for (const node of fileNodes) {
          const parts = node.path.split('/').filter(Boolean);
          for (
            let i = 1;
            i <= parts.length - (node.type === 'file' ? 1 : 0);
            i++
          ) {
            dirSet.add(`/${parts.slice(0, i).join('/')}`);
          }
        }
        const dirNodes: ConstructRuntimeVfsNode[] = [...dirSet]
          .filter((d) => !fileNodes.some((n) => n.path === d))
          .sort()
          .map((d) => ({
            path: d,
            type: 'directory' as const,
            modifiedAt: new Date().toISOString(),
          }));
        return [...dirNodes, ...fileNodes];
      })()
    : [];

  if (!options?.snapshotNodes) {
    const queue = ['/'];
    const visited = new Set<string>();
    const vfs = construct.getVfs();
    const shouldTraverseDirectory = (_path: string): boolean => {
      return true;
    };

    while (queue.length > 0 && nodes.length < 250) {
      const next = queue.shift();
      if (!next || visited.has(next)) {
        continue;
      }
      visited.add(next);

      let entries: Awaited<ReturnType<typeof vfs.list>>;
      try {
        entries = await vfs.list(next);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.type === 'directory') {
          nodes.push({
            path: entry.path,
            type: 'directory',
            modifiedAt: entry.modified ?? new Date().toISOString(),
          });
          if (shouldTraverseDirectory(entry.path)) {
            queue.push(entry.path);
          }
        } else {
          nodes.push({
            path: entry.path,
            type: 'file',
            sizeBytes: entry.size,
            modifiedAt: entry.modified ?? new Date().toISOString(),
          });
        }
        if (nodes.length >= 250) {
          break;
        }
      }
    }
  }

  const poolState = construct.getImpulsePool().getState();
  const impulses = poolState.active.map((impulse) => ({
    id: impulse.id,
    pool: impulse.pool,
    profile: impulse.profile,
    status: 'running' as const,
    summary: formatPerceptionSummary(impulse.triggeredBy),
    startedAt: impulse.startedAt.toISOString(),
  }));

  const { runtimeDecisionLog, runtimeToolLog } = await runtimeLogsPromise;
  const fallbackLastActiveAt =
    options?.constructResidency?.lastActiveAt ??
    heartbeatMeta.last_pulse_at ??
    heartbeatMeta.last_heartbeat_at;
  const fallbackResidencyRecent = (() => {
    if (!fallbackLastActiveAt) {
      return false;
    }
    const ts = Date.parse(fallbackLastActiveAt);
    return Number.isFinite(ts) ? Date.now() - ts < 60_000 : false;
  })();

  const effectiveResidency = {
    awake:
      options?.constructResidency?.awake ??
      (constructState.isRunning || fallbackResidencyRecent),
    status:
      options?.constructResidency?.status ??
      (constructState.isRunning || fallbackResidencyRecent
        ? 'active'
        : undefined),
    lastActiveAt: fallbackLastActiveAt,
  };

  if (!effectiveResidency.awake && fallbackResidencyRecent) {
    effectiveResidency.awake = true;
    effectiveResidency.status = effectiveResidency.status ?? 'active';
  }

  const runtimeResult = {
    constructState,
    runtimeState,
    residency: effectiveResidency,
    vfs: {
      nodes,
    },
    context: contextDiagnostics,
    impulses,
    scheduledResponses: schedulerState.scheduled.map(
      (response): ConstructRuntimeScheduledResponseView => ({
        id: response.id,
        scheduledBy: response.scheduledBy,
        intent: response.intent,
        urgency: response.urgency,
        waitForIdleTargets: response.waitForIdleTargets,
        scheduledAt: response.scheduledAt.toISOString(),
      }),
    ),
    sourceFacts: Object.values(sourceFacts)
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime() ||
          right.factId.localeCompare(left.factId),
      )
      .slice(0, 200)
      .map(
        (fact): ConstructRuntimeSourceFactView => ({
          factId: fact.factId,
          factType: fact.factType,
          lastPhase: fact.lastPhase,
          updatedAt: fact.updatedAt,
          previewText: fact.previewText,
          traceId: fact.traceId,
          journal: fact.journal,
          queueRef: fact.queueRef,
          queuedAt: fact.queuedAt,
          reflectedAt: fact.reflectedAt,
          spawnedAt: fact.spawnedAt,
          clearedAt: fact.clearedAt,
          deliveredAt: fact.deliveredAt,
          clearReason: fact.clearReason,
          responseIds: fact.responseIds ?? [],
          impulseIds: fact.impulseIds ?? [],
        }),
      ),
    decisions: runtimeDecisionLog,
    toolLog: runtimeToolLog,
  };
  options?.logger?.info('Snapshot built', {
    view: 'runtime',
    constructId: constructState.id,
    elapsedMs: Date.now() - _startMs,
    vfsNodes: nodes.length,
    sourceFacts: Object.keys(sourceFacts).length,
  });
  return runtimeResult;
}
