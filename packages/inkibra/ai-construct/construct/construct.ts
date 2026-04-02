/**
 * Construct Runtime
 *
 * The main entry point for creating and interacting with an ai-construct construct.
 */

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type ContextPersistence,
  createFilePersistence,
  createOverlayFs,
  type OverlayFs,
} from '@inkibra/ai-flow';
import type { Logger } from '@inkibra/logger';
import { DEFAULT_IMPULSE_PROFILES, IMPULSE_POOL_NAME } from '../impulse/keys';
import {
  createImpulsePool,
  getDefaultImpulseProfile,
  type ImpulsePool,
  parseImpulseIdCounter,
} from '../impulse/pool';
import { type OnThinkingChunk, runImpulse } from '../impulse/runner';
import type {
  Impulse,
  ImpulseProfileConfig,
  ImpulseResult,
} from '../impulse/types';
import {
  type HypnoReviewState,
  type HypnoSession,
  runHypnoFlow,
  runNapFlow,
} from '../nap/flow';
import {
  createResponseScheduler,
  type ResponseScheduler,
} from '../scheduler/scheduler';
import {
  getSourceFactMetadataFromPerception,
  isPerceptionSourceFactAlreadyReflected,
} from '../source-facts';
import { writeActiveImpulses } from '../vfs/active-impulses';
import {
  contextPathToId,
  createDalContextPersistence,
  createVfsContextManager,
  type DalContextPersistence,
  loadDalVfsSnapshot,
} from '../vfs/context-persistence';
import {
  buildLaneStageContextPressureDiagnostics,
  type ContextPressureConfig,
  closeStaleLogFiles,
  DEFAULT_CONTEXT_PRESSURE_CONFIG,
} from '../vfs/context-pressure';
import {
  autoOpenConversationContext,
  updateConversationIndex,
} from '../vfs/conversation-index';
import {
  type FeedbackRating,
  getLatestConstructResponse,
} from '../vfs/feedback';
import { updateHeartbeatMeta } from '../vfs/heartbeat';
import { writeLaneLogEntry } from '../vfs/lane-logs';
import {
  getInitialVfsStructure,
  pruneOldDiagLogs,
  VFS_PATHS,
} from '../vfs/layout';
import { updateNapIndex } from '../vfs/nap-index';
import {
  enqueueNextNapImprint,
  enqueueNextNapPin,
  type NextNapImprintEntry,
  type NextNapPinEntry,
} from '../vfs/nap-instructions';
import { loadResponseLifecycleState } from '../vfs/response-lifecycle-state';
import { writeSourceEventEntry } from '../vfs/source-events';
import {
  loadSourceFactState,
  type SourceFactRecord,
} from '../vfs/source-fact-state';
import {
  buildResponsePlanLanePolicy,
  laneExists,
} from './lane-response-policy';
import {
  buildReflectedPerceptionMessages,
  getPerceptionDefaultPool,
  getPerceptionPulseSource,
  isSystemEventPerception,
} from './perception';
import { createFileStorage, describeConstructStorage } from './storage';
import type {
  ConcreteLaneName,
  ConstructConfig,
  ConstructEvent,
  ConstructPulseSource,
  ConstructRuntimeState,
  ConstructState,
  ConstructStorage,
  EventCallback,
  LaneDefinitions,
  Perception,
  ReadonlyConstructView,
  ResponseCallback,
  StageAiSettings,
} from './types';
import { DEFAULT_CONSTRUCT_LANES } from './types';

function normalizeShellPath(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

type RuntimeLaneName<TDeclaredLanePattern extends string> =
  ConcreteLaneName<TDeclaredLanePattern>;

type ConstructPerception<
  TImpulseProfileName extends string,
  TImpulsePoolName extends string,
  TDeclaredLanePattern extends string,
  TSystemEventName extends string,
> = Perception<
  RuntimeLaneName<TDeclaredLanePattern>,
  TSystemEventName,
  TImpulseProfileName,
  TImpulsePoolName
>;

function resolveStageSettings(
  stageSettings: StageAiSettings | undefined,
  fallbackModel: string | undefined,
): StageAiSettings {
  return {
    ...stageSettings,
    model: stageSettings?.model ?? fallbackModel ?? 'moonshotai/kimi-k2.5',
  };
}

function createNamespacedPersistence(
  base: ContextPersistence,
  namespace: string,
): ContextPersistence {
  // Use absolute prefix (starts with /) so contextIdToPath recognises these
  // as non-context paths and doesn't prepend /agent/home/.
  const prefix = `/${namespace.replace(/^\/+|\/+$/g, '')}/`;

  const withPrefix = (id: string): string => {
    const normalized = id.replace(/^\/+/, '');
    return `${prefix}${normalized}`;
  };

  const withoutPrefix = (id: string): string | null => {
    if (id.startsWith(prefix)) return id.slice(prefix.length);
    // Also check without leading slash for backward compat
    const normalized = id.replace(/^\/+/, '');
    const bare = prefix.slice(1); // e.g. 'runtime/handles/'
    if (!normalized.startsWith(bare)) return null;
    return normalized.slice(bare.length);
  };

  return {
    async load(id) {
      return base.load(withPrefix(id));
    },

    async list(filter) {
      const listed = await base.list(filter);
      return listed
        .map((meta) => {
          const stripped = withoutPrefix(meta.id);
          if (!stripped) return null;
          return {
            ...meta,
            id: stripped,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    },

    async write(ctx) {
      const id = withPrefix(ctx.id);
      await base.write({
        ...ctx,
        id,
        meta: {
          ...ctx.meta,
          id,
        },
      });
    },

    async remove(id) {
      await base.remove(withPrefix(id));
    },

    async writeAll(contexts) {
      if (!base.writeAll) {
        await Promise.all(
          contexts.map((ctx) => {
            const id = withPrefix(ctx.id);
            return base.write({
              ...ctx,
              id,
              meta: {
                ...ctx.meta,
                id,
              },
            });
          }),
        );
        return;
      }
      await base.writeAll(
        contexts.map((ctx) => {
          const id = withPrefix(ctx.id);
          return {
            ...ctx,
            id,
            meta: {
              ...ctx.meta,
              id,
            },
          };
        }),
      );
    },

    async search(query, filter) {
      if (!base.search) {
        return { results: [], total: 0 };
      }
      const res = await base.search(query, filter);
      const results = res.results
        .map((meta) => {
          const stripped = withoutPrefix(meta.id);
          if (!stripped) return null;
          return {
            ...meta,
            id: stripped,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return { results, total: results.length };
    },
  };
}

function countContextActionTouches(
  logEntry: ImpulseResult['logEntry'],
): number {
  let count = 0;

  for (const action of logEntry.actions) {
    if (action.type === 'open_file') {
      count += 1;
    } else if (action.type === 'write_file') {
      count += 1;
    } else if (action.type === 'close_file') {
      count += 1;
    }
  }

  for (const tool of logEntry.toolHistory ?? []) {
    const trimmed = tool.command.trim();
    if (trimmed.startsWith('open ')) {
      const normalized = normalizeShellPath(trimmed.slice(5));
      if (normalized.length > 0) {
        count += 1;
      }
    } else if (trimmed.startsWith('close ')) {
      const normalized = normalizeShellPath(trimmed.slice(6));
      if (normalized.length > 0) {
        count += 1;
      }
    }
  }

  return count;
}

/**
 * Expand ~ in paths to home directory.
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export type StorageConstructView = {
  id: string;
  getVfs: () => OverlayFs;
  flush: () => Promise<void>;
  stop: () => void;
};

async function prepareConstructVfs(options: {
  id: string;
  storage: ConstructStorage;
  logger: Logger;
  intents?: Array<{ intent: string; hint: string; command: string }>;
  lanes?: Record<string, { can_respond_to?: string[] }>;
  modules?: ConstructConfig['computerConfig']['modules'];
}): Promise<{
  vfs: OverlayFs;
  hasSession: boolean;
  totalMs: number;
  persistenceMs: number;
  preloadMs: number;
  vfsMs: number;
  contextMs: number;
}> {
  const createConstructStartMs = Date.now();
  let contextPersistence:
    | ReturnType<typeof createFilePersistence>
    | DalContextPersistence;

  if (options.storage.kind === 'file') {
    const baseDir = expandPath(options.storage.baseDir);
    await mkdir(baseDir, { recursive: true });
    contextPersistence = createFilePersistence({ baseDir });
  } else {
    const isTestEnv = process.env.NODE_ENV === 'test';
    contextPersistence = createDalContextPersistence({
      driver: options.storage.driver,
      logger: options.storage.logger ?? options.logger,
      constructId: options.id,
      collection: options.storage.collection,
      ensureCollectionOptions: isTestEnv
        ? {
            createIfNotExists: true,
            strict: true,
          }
        : undefined,
    });
  }
  const persistenceCreatedMs = Date.now();

  const preloadMount =
    options.storage.kind === 'dal' && 'preloadAll' in contextPersistence
      ? await loadDalVfsSnapshot(contextPersistence as DalContextPersistence)
      : {};
  const preloadDoneMs = Date.now();

  const initial = getInitialVfsStructure({
    lanes: options.lanes,
    modules: options.modules,
  });

  if (options.intents && options.intents.length > 0) {
    const { serializeIntentRegistry } = await import('../impulse/intent-hints');
    initial['/developer/intents/registry.toml'] = serializeIntentRegistry(
      options.intents,
    );
  }

  const sessionId = contextPathToId(VFS_PATHS.core.session);
  const hasSession = (await contextPersistence.load(sessionId)) !== null;

  const handlesPersistence = createNamespacedPersistence(
    contextPersistence,
    'runtime/handles',
  );
  const queuePersistence = createNamespacedPersistence(
    contextPersistence,
    'runtime/queue',
  );
  const statePersistence = createNamespacedPersistence(
    contextPersistence,
    'runtime/state',
  );
  const diagPersistence = createNamespacedPersistence(
    contextPersistence,
    'runtime/diag',
  );
  const logsPersistence = createNamespacedPersistence(
    contextPersistence,
    'logs',
  );

  const developerPersistence = createNamespacedPersistence(
    contextPersistence,
    'developer',
  );
  const systemPersistence = createNamespacedPersistence(
    contextPersistence,
    'system',
  );

  const rawVfs = createOverlayFs({
    persistent: [
      { prefix: '/agent/home/', backend: contextPersistence },
      { prefix: '/developer/', backend: developerPersistence },
      { prefix: '/system/', backend: systemPersistence },
      { prefix: '/runtime/state/', backend: statePersistence },
      { prefix: '/runtime/handles/', backend: handlesPersistence },
      { prefix: '/runtime/queue/', backend: queuePersistence },
      { prefix: '/runtime/diag/', backend: diagPersistence },
      { prefix: '/logs/', backend: logsPersistence },
    ],
    mount: { ...initial, ...preloadMount },
    logger: options.logger.child({ component: 'overlay-fs' }),
  });

  const { createHookedVfs, createContextManifestHook } = await import(
    '../vfs/vfs-hooks'
  );
  const vfs = createHookedVfs(rawVfs, createContextManifestHook(rawVfs));

  if (!hasSession) {
    for (const [path, content] of Object.entries(initial)) {
      await vfs.write(path, content);
    }
    await vfs.flush();
  }
  const vfsCreatedMs = Date.now();

  await updateNapIndex(vfs);
  const contextDoneMs = Date.now();

  return {
    vfs,
    hasSession,
    totalMs: Date.now() - createConstructStartMs,
    persistenceMs: persistenceCreatedMs - createConstructStartMs,
    preloadMs: preloadDoneMs - persistenceCreatedMs,
    vfsMs: vfsCreatedMs - preloadDoneMs,
    contextMs: contextDoneMs - vfsCreatedMs,
  };
}

/**
 * The Construct class represents a running ai-construct instance.
 */
export class Construct<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends string = string,
> {
  readonly id: string;
  readonly storage: string;

  private vfs: OverlayFs;
  private impulsePool: ImpulsePool;
  private scheduler: ResponseScheduler;
  private config: ConstructConfig<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName
  >;
  private readonly lanes: LaneDefinitions<TLaneName>;
  private contextPressureConfig: ContextPressureConfig;

  private responseCallback?: ResponseCallback;
  private responseStreamCallback?: (chunk: string) => void;
  private eventCallbacks: EventCallback[] = [];
  private thinkingCallback?: OnThinkingChunk;

  private isRunning = false;
  private hypnoSession: HypnoSession | null = null;
  private hypnoAcceptPending = false;
  private recentNapToolLog: Array<{
    id: string;
    tool: string;
    command: string;
    output: string;
    createdAt: string;
  }> = [];
  private reflectedSourceFactIds = new Set<string>();
  private reflectedSourceFactStateLoaded = false;
  private committedCursor: string | undefined;

  // ---------------------------------------------------------------------------
  // Per-cycle timing accumulator — reset on each ingest, populated by impulse
  // and scheduler phases, logged on response:delivered.
  // ---------------------------------------------------------------------------
  private _cycleTiming: {
    ingestAtMs: number;
    impulseId?: string;
    llmImpulseMs: number;
    impulseNonAiMs: number;
    schedulerGateMs: number;
    schedulerAiMs: number;
    responseGenerateMs: number;
  } = {
    ingestAtMs: 0,
    llmImpulseMs: 0,
    impulseNonAiMs: 0,
    schedulerGateMs: 0,
    schedulerAiMs: 0,
    responseGenerateMs: 0,
  };

  constructor(
    config: ConstructConfig<TImpulseProfileName, TImpulsePoolName, TLaneName>,
    vfs: OverlayFs,
  ) {
    this.id = config.id;
    this.storage = describeConstructStorage(config.storage);
    this.config = config;
    this.vfs = vfs;
    this.lanes = config.lanes;
    this.contextPressureConfig = {
      ...DEFAULT_CONTEXT_PRESSURE_CONFIG,
      ...config.contextPressure,
    };

    // Create impulse pool
    this.impulsePool = createImpulsePool(config.impulsePool);

    // Create scheduler
    this.scheduler = createResponseScheduler(vfs, this.impulsePool, {
      decisionDeps: config.deps,
      defaultModel: config.model,
      decisionStage: config.stageConfig?.['scheduler/decide'],
    });

    // Wire up scheduler to craft + deliver responses from committed plan_response proposals.
    // Lane permissions are enforced by preview validation and runtime response crafting.
    this.scheduler.onCommit(
      async (impulseId, responsePlans, sourceLane, _targetLanes) => {
        const runtimeSourceLane = this.requireLane(
          sourceLane,
          'response plan source',
        );

        const { craftLaneResponses } = await import('./craft-response');
        const model =
          config.stageConfig?.['response/generate']?.model ?? config.model;
        const results = await craftLaneResponses(this.vfs, config.deps, {
          impulseId,
          sourceLane: runtimeSourceLane,
          responsePlans,
          model,
        });
        for (const { lane, text } of results) {
          if (text) {
            await this.deliverResponsePlan({
              impulseId,
              text,
              sourceLane: runtimeSourceLane,
              targetLane: this.requireLane(lane, 'response delivery'),
            });
          }
        }
      },
    );
    // Forward scheduler decision events to construct event system
    this.scheduler.onEvent((event) => {
      if (event.type === 'scheduler:considered' && event.consideration) {
        this.emit({
          type: 'scheduler:considered',
          consideration: event.consideration,
        });
      }
      if (event.type === 'scheduler:decided' && event.decision) {
        // Accumulate scheduler timing into cycle
        if (event.metrics) {
          this._cycleTiming.schedulerGateMs = event.metrics.gateDelayMs;
          this._cycleTiming.schedulerAiMs = event.metrics.aiDecisionMs;
        }
        this.emit({
          type: 'scheduler:decided',
          decision: event.decision,
          metrics: event.metrics,
        });
      }
    });
  }

  /**
   * Set callback for response delivery.
   */
  onResponse(callback: ResponseCallback<RuntimeLaneName<TLaneName>>): this {
    this.responseCallback = callback as ResponseCallback;
    return this;
  }

  /**
   * Set callback for construct events (debugging/monitoring).
   */
  onEvent(
    callback: EventCallback<RuntimeLaneName<TLaneName>, TSystemEventName>,
  ): this {
    this.eventCallbacks.push(callback as EventCallback);
    return this;
  }

  /**
   * Set callback for streaming impulse thinking.
   */
  onThinking(callback: OnThinkingChunk): this {
    this.thinkingCallback = callback;
    return this;
  }

  /**
   * Set callback for streaming response output.
   */
  onResponseStream(callback: (chunk: string) => void): this {
    this.responseStreamCallback = callback;
    return this;
  }

  /**
   * Emit a construct event.
   */
  private emit(
    event: ConstructEvent<RuntimeLaneName<TLaneName>, TSystemEventName>,
  ): void {
    for (const callback of this.eventCallbacks) {
      callback(event);
    }
  }

  private async ensureReflectedSourceFactStateLoaded(): Promise<void> {
    if (this.reflectedSourceFactStateLoaded) {
      return;
    }
    const factsById = await loadSourceFactState(this.vfs);
    for (const fact of Object.values(factsById)) {
      if (
        fact.reflectedAt ||
        fact.spawnedAt ||
        fact.clearedAt ||
        fact.deliveredAt
      ) {
        this.reflectedSourceFactIds.add(fact.factId);
      }
    }
    this.reflectedSourceFactStateLoaded = true;
  }

  private async isSourceFactAlreadyReflected(
    factId?: string,
  ): Promise<boolean> {
    if (!factId) {
      return false;
    }
    await this.ensureReflectedSourceFactStateLoaded();
    return this.reflectedSourceFactIds.has(factId);
  }

  private markSourceFactReflected(factId?: string): void {
    if (!factId) {
      return;
    }
    this.reflectedSourceFactIds.add(factId);
    this.reflectedSourceFactStateLoaded = true;
  }

  private async findSourceFactByImpulseId(
    impulseId: string,
  ): Promise<SourceFactRecord | undefined> {
    const factsById = await loadSourceFactState(this.vfs);
    return Object.values(factsById).find((fact) =>
      fact.impulseIds?.includes(impulseId),
    );
  }

  /**
   * Record an explicit external pulse for heartbeat/activity falloff.
   */
  async pulse(
    input: { source?: ConstructPulseSource; at?: Date } = {},
  ): Promise<void> {
    const timestamp = input.at ?? new Date();
    await updateHeartbeatMeta(this.vfs, {
      last_pulse_at: timestamp.toISOString(),
      last_pulse_source: input.source ?? 'runtime',
    });
    await this.flushCurrent();
  }

  /**
   * Start the construct's scheduler.
   */
  start(): this {
    if (this.isRunning) {
      this.config.deps.logger.warn('Construct start skipped: already running', {
        constructId: this.id,
      });
      return this;
    }

    this.isRunning = true;
    const autoStart = this.config.scheduler?.autoStartPolling !== false;
    this.config.deps.logger.info('Construct started', {
      constructId: this.id,
      autoStartPolling: autoStart,
    });
    if (autoStart) {
      this.scheduler.start();
    }

    return this;
  }

  /**
   * Stop the construct's scheduler.
   */
  stop(): this {
    this.isRunning = false;
    if (this.config.scheduler?.autoStartPolling !== false) {
      this.scheduler.stop();
    }
    return this;
  }

  /**
   * Ingest a perception into the construct.
   */
  async ingest(
    perception: ConstructPerception<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
  ): Promise<void> {
    await this.ingestInternal(perception, false, true);
  }

  /**
   * Ingest a perception and return once the impulse has started.
   * This is used by runtime shells that want to drain ingress quickly while
   * letting the hot construct continue processing in the background.
   */
  async ingestDetached(
    perception: ConstructPerception<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
  ): Promise<void> {
    await this.ingestInternal(perception, false, false);
  }

  async reflectPerceptionSourceFact(
    perception: ConstructPerception<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
  ): Promise<void> {
    await this.reflectPerceptionSourceFactInternal(perception);
  }

  /**
   * Internal ingest with optional context-pressure checks.
   */
  private async ingestInternal(
    perception: ConstructPerception<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
    skipPressureCheck: boolean,
    waitForCompletion: boolean,
  ): Promise<void> {
    this.config.deps.logger.info('Ingesting perception', {
      constructId: this.id,
      perceptionSource: perception.source,
      lane: perception.lane,
      waitForCompletion,
    });
    // Reset cycle timing accumulator for each new user-role perception ingest
    if (perception.role === 'user') {
      this._cycleTiming = {
        ingestAtMs: Date.now(),
        llmImpulseMs: 0,
        impulseNonAiMs: 0,
        schedulerGateMs: 0,
        schedulerAiMs: 0,
        responseGenerateMs: 0,
      };
    }
    await this.pulse({
      source: getPerceptionPulseSource(perception),
    });
    this.emit({ type: 'perception:queued', perception });
    await this.reflectPerceptionSourceFactInternal(perception);

    if (!skipPressureCheck) {
      await this.handleNapTriggers();
    }

    // Acquire an impulse slot
    const routing = this.resolveImpulseRouting(perception);
    if (this.shouldDropConcurrentHeartbeat(perception, routing.profile)) {
      this.config.deps.logger.warn('Dropping concurrent heartbeat', {
        constructId: this.id,
        profile: routing.profile,
      });
      return;
    }
    this.config.deps.logger.info('Acquiring impulse slot', {
      constructId: this.id,
      pool: routing.pool,
      profile: routing.profile,
      lane: routing.lane,
    });
    const impulse = await this.impulsePool.acquire(perception, {
      poolName: routing.pool,
      profileName: routing.profile,
      profileConfig: routing.profileConfig,
      lane: routing.lane,
    });

    if (impulse.status === 'abandoned') {
      this.config.deps.logger.warn('Impulse abandoned', {
        constructId: this.id,
        impulseId: impulse.id,
      });
      // Dropped due to overflow policy
      return;
    }

    this.config.deps.logger.info('Impulse acquired', {
      constructId: this.id,
      impulseId: impulse.id,
      status: impulse.status,
    });

    const runningImpulse = this.runImpulseWithEvents(
      impulse as Impulse<TImpulseProfileName, TImpulsePoolName>,
    );
    if (waitForCompletion) {
      await runningImpulse;
      this.config.deps.logger.info('Impulse completed', {
        constructId: this.id,
        impulseId: impulse.id,
        completionMode: 'sync',
      });
      return;
    }

    void runningImpulse
      .then(() => {
        this.config.deps.logger.info('Impulse completed', {
          constructId: this.id,
          impulseId: impulse.id,
          completionMode: 'detached',
        });
      })
      .catch((error) => {
        this.config.deps.logger.error('Detached construct impulse failed', {
          constructId: this.id,
          impulseId: impulse.id,
          message: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      });
  }

  private async reflectPerceptionSourceFactInternal(
    perception: ConstructPerception<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
  ): Promise<void> {
    if (isPerceptionSourceFactAlreadyReflected(perception)) {
      return;
    }

    const sourceFact = getSourceFactMetadataFromPerception(perception);
    if (await this.isSourceFactAlreadyReflected(sourceFact?.factId)) {
      return;
    }

    const routing = this.resolveImpulseRouting(perception);
    const reflectedMessages = buildReflectedPerceptionMessages(perception);
    for (const message of reflectedMessages) {
      await writeLaneLogEntry(this.vfs, routing.lane, {
        kind: 'reflected_impulse',
        timestamp: message.timestamp,
        role: message.role,
        sourceLane: routing.lane,
        factId: sourceFact?.factId,
        content: message.content,
      });
    }

    if (perception.role === 'user') {
      this.emit({
        type: 'transcript:entry',
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: perception.content,
        createdAt: perception.occurredAt.toISOString(),
        factId: sourceFact?.factId,
        kind: 'chat',
        lane: perception.lane,
      });
      await updateHeartbeatMeta(this.vfs, {
        last_user_message_at: perception.occurredAt.toISOString(),
      });
      if (sourceFact) {
        const reflectedAt = new Date().toISOString();
        this.markSourceFactReflected(sourceFact.factId);
        this.emit({
          type: 'source-fact:reflected',
          factId: sourceFact.factId,
          factType: sourceFact.factType,
          traceId: sourceFact.traceId,
          journal: 'lane-log',
          reflectedAt,
          processingStrategy: sourceFact.processingStrategy,
        });
      }
      return;
    }

    if (
      sourceFact &&
      sourceFact.factType !== 'user_message' &&
      sourceFact.factType !== 'rate_response' &&
      sourceFact.factType !== 'steer_directive'
    ) {
      const reflectedAt = new Date().toISOString();
      await writeSourceEventEntry(this.vfs, {
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        traceId: sourceFact.traceId,
        timestamp: new Date(reflectedAt),
        payload: serializePerceptionSourcePayload(perception),
      });
      this.markSourceFactReflected(sourceFact.factId);
      this.emit({
        type: 'source-fact:reflected',
        factId: sourceFact.factId,
        factType: sourceFact.factType,
        traceId: sourceFact.traceId,
        journal: 'lane-log',
        reflectedAt,
        processingStrategy: sourceFact.processingStrategy,
      });
    }
  }

  /**
   * Run an impulse with event emissions.
   */
  private async runImpulseWithEvents(
    impulse: Impulse<TImpulseProfileName, TImpulsePoolName>,
  ): Promise<void> {
    const impulseWallStart = Date.now();
    const logImpulseDiag = (
      label: string,
      extra: Record<string, unknown> = {},
    ) => {
      this.config.deps.logger.info('Impulse diagnostic', {
        constructId: this.id,
        impulseId: impulse.id,
        label,
        elapsedMs: Date.now() - impulseWallStart,
        ...extra,
      });
    };
    this.emit({
      type: 'impulse:started',
      impulseId: impulse.id,
      perception: impulse.triggeredBy as ConstructPerception<
        TImpulseProfileName,
        TImpulsePoolName,
        TLaneName,
        TSystemEventName
      >,
    });
    // Notify scheduler for sibling-impulse detection
    this.scheduler.notifyImpulseStarted(impulse.id);

    try {
      await writeActiveImpulses(this.vfs, this.impulsePool.getActive());
    } catch (error) {
      this.config.deps.logger.warn(
        'Failed to persist active impulses on start',
        {
          constructId: this.id,
          impulseId: impulse.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const startTime = Date.now();
    const preImpulseOverheadMs = startTime - impulseWallStart;
    const shouldKickScheduler = impulse.pool === IMPULSE_POOL_NAME.CONVERSATION;

    try {
      const autoOpenStart = Date.now();
      if (impulse.triggeredBy.role === 'user') {
        await autoOpenConversationContext(this.vfs);
      }
      logImpulseDiag('autoOpenConversationContext', {
        durationMs: Date.now() - autoOpenStart,
      });

      // Always run impulses through the command-computer path.
      const impulseConfig: Parameters<typeof runImpulse>[2] = {
        computerConfig: this.config.computerConfig,
      };
      const stageConfig = this.config.stageConfig;
      if (stageConfig?.['impulse/think'] || stageConfig?.['impulse/schedule']) {
        impulseConfig.stages = {
          think:
            stageConfig?.['impulse/think'] ?? stageConfig?.['impulse/schedule'],
          schedule: stageConfig?.['impulse/schedule'],
        };
      }
      if (this.config.systemPrompt)
        impulseConfig.systemPrompt = this.config.systemPrompt;
      const profileConfig = this.config.impulseProfiles?.[impulse.profile];
      if (profileConfig?.thinkPrompt) {
        impulseConfig.thinkPrompt = profileConfig.thinkPrompt;
      }
      if (profileConfig?.schedulePrompt) {
        impulseConfig.schedulePrompt = profileConfig.schedulePrompt;
      }
      if (profileConfig?.waitForIdleTargets) {
        impulseConfig.defaultWaitForIdleTargets =
          profileConfig.waitForIdleTargets;
      }
      this.config.deps.logger.info('Impulse run configured with computer', {
        constructId: this.id,
        hasComputerConfig: true,
        configKeys: Object.keys(this.config),
      });
      impulseConfig.computerConfig = this.config.computerConfig;
      impulseConfig.responsePlanPolicy = buildResponsePlanLanePolicy(
        this.lanes,
        impulse.lane,
      );

      const result = await runImpulse(
        impulse,
        this.vfs,
        impulseConfig,
        (chunk) => {
          if (this.thinkingCallback) {
            this.thinkingCallback(chunk);
          }
          this.emit({
            type: 'impulse:thinking',
            impulseId: impulse.id,
            delta: chunk,
          });
        },
        (tool) => {
          this.emit({
            type: 'impulse:tool',
            impulseId: impulse.id,
            tool: tool.tool,
            command: tool.command,
            output: tool.output,
          });
        },
        this.config.deps,
      );

      const runImpulseElapsedMs = Date.now() - startTime;
      this.config.deps.logger.info('Impulse run with computer result', {
        constructId: this.id,
        impulseId: impulse.id,
        computerResult: true,
        runImpulseMs: runImpulseElapsedMs,
        preImpulseOverheadMs,
      });

      // Command computer path: submit to scheduler for commit (spec §20)
      const preview = result.computerResult.selectedPreview;
      // Extract target lanes from response plans
      const targetLanes = [
        ...new Set(
          result.computerResult.responsePlans
            .map((rp) => rp.lane)
            .filter((l): l is string => !!l),
        ),
      ];

      await this.scheduler.submitImpulse({
        impulseId: impulse.id,
        lane: impulse.lane,
        targetLanes: targetLanes.length > 0 ? targetLanes : [impulse.lane],
        thinking: result.computerResult.thinking,
        urgency: result.computerResult.urgency,
        submittedAt: new Date(),
        selectedPreview: preview
          ? {
              execId: preview.execId,
              stdout: preview.stdout ?? '',
              responsePlans: result.computerResult.responsePlans,
              filesWritten: [], // TODO: extract from preview
              hasError: !!preview.error,
            }
          : null,
      });

      const contextActionTouches = countContextActionTouches(result.logEntry);
      if (contextActionTouches > 0) {
        logImpulseDiag('contextActionTouches', {
          count: contextActionTouches,
        });
      }
      const totalImpulseMs = Date.now() - impulseWallStart;
      const postImpulseOverheadMs =
        totalImpulseMs - runImpulseElapsedMs - preImpulseOverheadMs;
      this.config.deps.logger.info('Impulse completed', {
        constructId: this.id,
        impulseId: impulse.id,
        totalMs: totalImpulseMs,
        preImpulseOverheadMs,
        openaiMs: runImpulseElapsedMs,
        postImpulseOverheadMs,
      });
      // Accumulate into cycle timing
      const impulseLlmMs = result.timing?.llmMs ?? runImpulseElapsedMs;
      const impulseNonAiMs =
        preImpulseOverheadMs +
        (result.timing?.otherMs ?? 0) +
        postImpulseOverheadMs;
      this._cycleTiming.impulseId = impulse.id;
      this._cycleTiming.llmImpulseMs = impulseLlmMs;
      this._cycleTiming.impulseNonAiMs = impulseNonAiMs;

      // Structured AI vs non-AI breakdown for the impulse phase
      this.config.deps.logger.info('Impulse timing breakdown', {
        constructId: this.id,
        impulseId: impulse.id,
        totalMs: totalImpulseMs,
        ai: {
          llmImpulseMs: impulseLlmMs,
        },
        nonAi: {
          preOverheadMs: preImpulseOverheadMs,
          runnerOtherMs: result.timing?.otherMs ?? 0,
          postOverheadMs: postImpulseOverheadMs,
        },
        aiTotalMs: impulseLlmMs,
        nonAiTotalMs: impulseNonAiMs,
        aiPct:
          totalImpulseMs > 0
            ? Math.round((impulseLlmMs / totalImpulseMs) * 100)
            : 0,
      });
      this.emit({
        type: 'impulse:completed',
        impulseId: impulse.id,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      this.config.deps.logger.error('Construct impulse execution failed', {
        constructId: this.id,
        impulseId: impulse.id,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      this.emit({
        type: 'impulse:error',
        impulseId: impulse.id,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    } finally {
      // Release the pool slot
      this.impulsePool.release(
        impulse.id,
        impulse.status === 'abandoned' ? 'abandoned' : 'completed',
      );

      try {
        const persistActiveOnReleaseStart = Date.now();
        await writeActiveImpulses(this.vfs, this.impulsePool.getActive());
        logImpulseDiag('writeActiveImpulses.release', {
          durationMs: Date.now() - persistActiveOnReleaseStart,
        });
      } catch (error) {
        this.config.deps.logger.warn(
          'Failed to persist active impulses on release',
          {
            constructId: this.id,
            impulseId: impulse.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      // Notify scheduler that this impulse is done (triggers waitUntil resolution)
      this.scheduler.notifyImpulseCompleted(impulse.id);

      if (
        shouldKickScheduler &&
        this.config.scheduler?.autoStartPolling !== false
      ) {
        const schedulerPollStart = Date.now();
        await this.scheduler.poll();
        logImpulseDiag('scheduler.poll.afterImpulse', {
          durationMs: Date.now() - schedulerPollStart,
        });
      } else {
        // No scheduler kick — schedule background flush now
        this.scheduleIdleFlush('impulse-no-scheduler');
      }
    }
  }

  private resolveImpulseRouting(
    perception: ConstructPerception<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
  ): {
    profile: TImpulseProfileName;
    pool: string;
    lane: RuntimeLaneName<TLaneName>;
    profileConfig?: ImpulseProfileConfig<TImpulsePoolName, TImpulseProfileName>;
  } {
    const explicitProfile =
      typeof perception.profile === 'string' &&
      perception.profile.trim().length > 0
        ? perception.profile.trim()
        : undefined;

    const profileName = explicitProfile ?? getDefaultImpulseProfile(perception);

    const profileMap = this.config.impulseProfiles;
    if (profileMap && !Object.hasOwn(profileMap, profileName)) {
      throw new Error(
        `Unregistered impulse profile "${profileName}" for construct "${this.id}"`,
      );
    }

    const profile = profileName as TImpulseProfileName;
    const profileConfig = profileMap?.[profile];

    const explicitPool =
      typeof perception.pool === 'string' && perception.pool.trim().length > 0
        ? perception.pool.trim()
        : undefined;

    const pool =
      explicitPool ??
      profileConfig?.pool ??
      getPerceptionDefaultPool(perception);
    return {
      profile,
      pool,
      lane: this.requireLane(perception.lane, 'impulse routing'),
      profileConfig,
    };
  }

  private shouldDropConcurrentHeartbeat(
    perception: ConstructPerception<
      TImpulseProfileName,
      TImpulsePoolName,
      TLaneName,
      TSystemEventName
    >,
    profile: TImpulseProfileName,
  ): boolean {
    if (
      !isSystemEventPerception(perception) ||
      perception.event !== 'heartbeat'
    ) {
      return false;
    }

    return this.impulsePool
      .getActive()
      .some((impulse) => impulse.profile === profile);
  }

  /**
   * Handle nap triggers (time-based, context pressure).
   */
  private async handleNapTriggers(): Promise<void> {
    if (await this.shouldNapByTime()) {
      await this.nap();
    }

    // Proactively close stale log files (>2 days old, not pinned)
    // to prevent log-browsing state from accumulating indefinitely.
    const { closed: staleClosed } = await closeStaleLogFiles(this.vfs);
    if (staleClosed.length > 0) {
      this.config.deps.logger.warn('Closed stale log files', {
        constructId: this.id,
        count: staleClosed.length,
        paths: staleClosed.map((c) => c.path),
      });
    }

    const diagnostics = await buildLaneStageContextPressureDiagnostics(
      this.vfs,
      this.contextPressureConfig,
    );
    const pressure = diagnostics.maxPair;
    if (!pressure) {
      return;
    }

    if (pressure.status === 'ok') {
      this.config.deps.logger.info('Context pressure status', {
        constructId: this.id,
        lane: pressure.lane,
        stage: pressure.stage,
        status: pressure.status,
        ratio: Number(pressure.ratio.toFixed(3)),
        contextTokens: pressure.contextTokens,
        maxTokens: pressure.maxTokens,
        contextBytes: pressure.contextBytes,
        pinnedPaths: pressure.pinnedPaths,
      });
    } else {
      this.config.deps.logger.warn('Context pressure warning', {
        constructId: this.id,
        lane: pressure.lane,
        stage: pressure.stage,
        status: pressure.status,
        ratio: Number(pressure.ratio.toFixed(3)),
        contextTokens: pressure.contextTokens,
        maxTokens: pressure.maxTokens,
        contextBytes: pressure.contextBytes,
        pinnedPaths: pressure.pinnedPaths,
      });
    }

    if (pressure.status !== 'ok') {
      await this.nap();
    }
  }

  /**
   * Check if time-based nap should run.
   */
  private async shouldNapByTime(): Promise<boolean> {
    const meta = await this.readSessionMeta();
    const last =
      (meta.last_compaction_at as string) ||
      (meta.started_at as string) ||
      null;

    if (!last) return false;

    const lastDate = new Date(last).toDateString();
    const nowDate = new Date().toDateString();

    return lastDate !== nowDate;
  }

  /**
   * Read session metadata.
   */
  private async readSessionMeta(): Promise<Record<string, unknown>> {
    const manager = createVfsContextManager(this.vfs);
    const loaded = await manager.load(contextPathToId(VFS_PATHS.core.session));
    if (!loaded) {
      return {};
    }

    return loaded.meta;
  }

  /**
   * Update session metadata.
   */
  private async updateSessionMeta(
    patch: Record<string, unknown>,
  ): Promise<void> {
    const manager = createVfsContextManager(this.vfs);
    const id = contextPathToId(VFS_PATHS.core.session);
    const loaded = await manager.load(id);
    const now = new Date().toISOString();
    const base = {
      id: 'session',
      tags: [],
      created: now,
      updated: now,
      started_at: now,
      impulse_counter: 0,
    } as Record<string, unknown>;

    const existing = loaded?.meta ?? {};
    const merged = { ...base, ...existing, ...patch, updated: now };

    await manager.stage({
      id,
      tags: loaded?.meta.tags,
      meta: merged,
      content: loaded?.content ?? '',
    });
    await manager.commit(id);
  }

  /**
   * Get the current construct state for inspection.
   */
  async getState(): Promise<ConstructState> {
    const schedulerState = await this.scheduler.getState();
    const poolState = this.impulsePool.getState();

    return {
      id: this.id,
      storage: this.storage,
      isRunning: this.isRunning,
      activeImpulses: poolState.counts.total,
      queuedPerceptions: poolState.queuedCount,
      scheduledResponses: schedulerState.scheduled.length,
    };
  }

  async getRuntimeState(): Promise<ConstructRuntimeState> {
    const schedulerState = await this.scheduler.getState();
    const poolState = this.impulsePool.getState();
    const nowMs = Date.now();
    const activeImpulseIds = poolState.active.map((impulse) => impulse.id);
    const oldestActiveImpulseAgeMs =
      poolState.active.length > 0
        ? Math.max(
            0,
            ...poolState.active.map((impulse) =>
              Math.max(0, nowMs - impulse.startedAt.getTime()),
            ),
          )
        : undefined;

    const schedulerPolling =
      schedulerState.polling ?? schedulerState.schedulerBusy;
    return {
      activeImpulses: poolState.counts.total,
      scheduledResponses: schedulerState.scheduled.length,
      activeResponses: schedulerState.activeResponses.length,
      schedulerPolling,
      schedulerBusy: schedulerState.schedulerBusy,
      activeImpulseIds,
      oldestActiveImpulseAgeMs,
    };
  }

  /**
   * Get the VFS for direct inspection/manipulation.
   */
  getVfs(): OverlayFs {
    return this.vfs;
  }

  /**
   * Update the committed (durable) cursor from the actor runtime.
   * Source-fact pruning uses this to evict records past the frontier.
   */
  setCommittedCursor(cursor: string | undefined): void {
    this.committedCursor = cursor;
  }

  getCommittedCursor(): string | undefined {
    return this.committedCursor;
  }

  /**
   * Schedule a background flush after a short debounce.
   *
   * Flushes fire only when the construct appears idle — no active impulses
   * and no active responses — to avoid unnecessary intermediate writes.
   * Multiple calls within the debounce window collapse to one flush.
   */
  private idleFlushTimer?: ReturnType<typeof setTimeout>;
  private idleFlushFireAt = 0;
  private lastDiagPruneAt = 0;

  private scheduleIdleFlush(reason: string, delayMs = 300): void {
    const now = Date.now();
    const newFireAt = now + delayMs;

    // If a flush is already pending and would fire sooner than this request,
    // skip — the pending timer will cover it. Otherwise, replace the timer
    // with the sooner deadline so shorter delays aren't dropped.
    if (this.idleFlushFireAt > 0 && this.idleFlushFireAt <= newFireAt) {
      return;
    }

    clearTimeout(this.idleFlushTimer);
    this.idleFlushFireAt = newFireAt;
    this.idleFlushTimer = setTimeout(() => {
      this.idleFlushFireAt = 0;
      void this.runIdleFlush(reason);
    }, delayMs);
  }

  private async runIdleFlush(reason: string): Promise<void> {
    if (!this.vfs.isDirty()) return;

    // Only flush when truly idle: no active impulses, no active responses,
    // and no queued scheduled responses waiting to run.
    const state = await this.getRuntimeState();
    const isIdle =
      state.activeImpulses === 0 &&
      state.activeResponses === 0 &&
      state.scheduledResponses === 0;

    if (!isIdle) {
      // Still busy — reschedule for a bit later
      this.scheduleIdleFlush(reason, 500);
      return;
    }

    const flushStart = Date.now();
    try {
      await this.vfs.flush();
      const flushMs = Date.now() - flushStart;
      this.config.deps.logger.info('Idle flush complete', {
        constructId: this.id,
        reason,
        dirty: this.vfs.isDirty(),
        flushMs,
      });

      // Prune old diag logs at most once per hour
      const now = Date.now();
      if (now - this.lastDiagPruneAt > 60 * 60 * 1000) {
        this.lastDiagPruneAt = now;
        void Promise.all([
          pruneOldDiagLogs(this.vfs, VFS_PATHS.diag.sourceFactLogs),
          pruneOldDiagLogs(this.vfs, VFS_PATHS.diag.responseLifecycleLogs),
        ]).catch(() => {});
      }
    } catch (error) {
      this.config.deps.logger.warn('Idle flush failed', {
        constructId: this.id,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      // Retry on failure
      this.scheduleIdleFlush(reason, 2000);
    }
  }

  /**
   * Wait for construct to be idle and flush all dirty VFS state.
   * Used by the actor-runtime mailbox drain before committing the cursor.
   */
  async waitForIdleAndFlush(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const state = await this.getRuntimeState();
      const isIdle =
        state.activeImpulses === 0 &&
        state.activeResponses === 0 &&
        state.scheduledResponses === 0;

      if (isIdle) {
        if (this.vfs.isDirty()) {
          const flushStart = Date.now();
          await this.vfs.flush();
          this.config.deps.logger.info('waitForIdleAndFlush complete', {
            constructId: this.id,
            flushMs: Date.now() - flushStart,
          });
        }
        return;
      }

      await new Promise<void>((r) => setTimeout(r, 100));
    }

    // Timed out — flush what we have
    if (this.vfs.isDirty()) {
      this.config.deps.logger.warn(
        'waitForIdleAndFlush timed out, flushing anyway',
        {
          constructId: this.id,
        },
      );
      await this.vfs.flush();
    }
  }

  /**
   * Queue a file path to be pinned in context on the next nap run.
   */
  async queueNextNapPin(input: {
    path: string;
    id?: string;
  }): Promise<NextNapPinEntry> {
    const entry = await enqueueNextNapPin(
      this.vfs,
      input,
      this.config.nextNapPinQueuePath,
    );
    await this.vfs.flush();
    return entry;
  }

  /**
   * Queue a host imprint directive to be applied on the next nap run.
   */
  async queueNextNapImprint(input: {
    text: string;
    id?: string;
  }): Promise<NextNapImprintEntry> {
    const entry = await enqueueNextNapImprint(
      this.vfs,
      input,
      this.config.nextNapImprintQueuePath,
    );
    await this.vfs.flush();
    return entry;
  }

  /**
   * Get the impulse pool for inspection.
   */
  getImpulsePool(): ImpulsePool {
    return this.impulsePool;
  }

  /**
   * Get the scheduler for inspection.
   */
  getScheduler(): ResponseScheduler {
    return this.scheduler;
  }

  /**
   * Deliver a crafted response from the response stage.
  /**
   * Deliver a crafted response from the response stage into lane logs and live transcript projections.
   */
  private async deliverResponsePlan(args: {
    impulseId: string;
    text: string;
    sourceLane: RuntimeLaneName<TLaneName>;
    targetLane: RuntimeLaneName<TLaneName>;
  }): Promise<void> {
    const now = new Date();
    const constructResponse = {
      id: `draft-${args.impulseId}-${Date.now()}`,
      constructId: this.id,
      content: args.text,
      generatedAt: now,
      scheduledBy: args.impulseId,
      sourceLane: args.sourceLane,
      targetLane: args.targetLane,
    };

    if (this.responseStreamCallback) {
      this.responseStreamCallback(args.text);
    }
    if (this.responseCallback) {
      await this.responseCallback(constructResponse);
    }

    const sourceFact = await this.findSourceFactByImpulseId(args.impulseId);
    await writeLaneLogEntry(this.vfs, args.sourceLane, {
      kind: 'response',
      timestamp: now,
      role: 'construct',
      sourceLane: args.sourceLane,
      targetLane:
        args.targetLane !== args.sourceLane ? args.targetLane : undefined,
      impulseId: args.impulseId,
      responseId: constructResponse.id,
      factId: sourceFact?.factId,
      content: args.text,
    });

    this.emit({
      type: 'transcript:entry',
      id: `${constructResponse.id}:source`,
      role: 'assistant',
      content: args.text,
      createdAt: now.toISOString(),
      factId: sourceFact?.factId,
      kind: 'chat',
      lane: args.sourceLane,
    });

    const activeImpulse = this.impulsePool
      .getActive()
      .find((impulse) => impulse.id === args.impulseId);
    if (args.targetLane !== args.sourceLane) {
      const reflectedMessages = activeImpulse
        ? buildReflectedPerceptionMessages(activeImpulse.triggeredBy)
        : sourceFact?.previewText
          ? [
              {
                timestamp: new Date(sourceFact.queuedAt ?? now.toISOString()),
                role: 'user' as const,
                content: sourceFact.previewText,
              },
            ]
          : [];

      for (const message of reflectedMessages) {
        await writeLaneLogEntry(this.vfs, args.targetLane, {
          kind: 'reflected_impulse',
          timestamp: message.timestamp,
          role: message.role,
          sourceLane: args.sourceLane,
          targetLane: args.targetLane,
          impulseId: args.impulseId,
          factId: sourceFact?.factId,
          content: message.content,
        });
        this.emit({
          type: 'transcript:entry',
          id: `reflected-${constructResponse.id}-${message.timestamp.getTime()}`,
          role: message.role,
          content: message.content,
          createdAt: message.timestamp.toISOString(),
          factId: sourceFact?.factId,
          kind: message.role === 'user' ? 'chat' : 'decision',
          lane: args.targetLane,
        });
      }

      await writeLaneLogEntry(this.vfs, args.targetLane, {
        kind: 'response',
        timestamp: now,
        role: 'construct',
        sourceLane: args.sourceLane,
        targetLane: args.targetLane,
        impulseId: args.impulseId,
        responseId: constructResponse.id,
        factId: sourceFact?.factId,
        content: args.text,
      });
      this.emit({
        type: 'transcript:entry',
        id: `${constructResponse.id}:target`,
        role: 'assistant',
        content: args.text,
        createdAt: now.toISOString(),
        factId: sourceFact?.factId,
        kind: 'chat',
        lane: args.targetLane,
      });
    }

    await updateHeartbeatMeta(this.vfs, {
      last_response_at: now.toISOString(),
    });

    this.emit({
      type: 'response:delivered',
      responseId: constructResponse.id,
      draftText: args.text,
    });
  }

  /**
   * Flush VFS changes to persistent storage.
   */
  async flush(): Promise<void> {
    await this.vfs.flush();
  }

  /**
   * Flush only the writes that are currently dirty.
   * New writes that arrive while flushing remain dirty for a later cycle.
   */
  async flushCurrent(): Promise<void> {
    if (typeof this.vfs.flushCurrent === 'function') {
      await this.vfs.flushCurrent();
      return;
    }
    await this.vfs.flush();
  }

  /**
   * Restore the impulse counter from persisted response lifecycle state.
   * This prevents impulse ID collisions across server restarts where
   * the module-level counter resets to 0 but the VFS still has records
   * keyed by old impulse IDs (e.g. "response:...:impulse-1").
   */
  async restoreImpulseCounter(): Promise<void> {
    const lifecycle = await loadResponseLifecycleState(this.vfs);
    let maxCounter = 0;
    for (const record of Object.values(lifecycle)) {
      const scheduledBy = record.scheduledBy;
      if (scheduledBy) {
        const parsed = parseImpulseIdCounter(scheduledBy);
        if (parsed > maxCounter) {
          maxCounter = parsed;
        }
      }
    }
    if (maxCounter > 0) {
      this.impulsePool.ensureCounterAtLeast(maxCounter);
      this.config.deps.logger.info('Restored impulse counter from VFS', {
        constructId: this.id,
        restoredCounter: maxCounter,
      });
    }
  }

  /**
   * Rate the most recent construct response in a lane.
   * Feedback becomes a first-class lane-log event so the lane narrative keeps
   * its operator evaluation alongside impulses and responses.
   */
  async rate(options: {
    rating: FeedbackRating;
    annotation?: string;
    source?: string;
    lane: string;
    id?: string;
    traceId?: string;
    skipReflection?: boolean;
  }): Promise<void> {
    if (options.skipReflection) {
      return;
    }

    if (await this.isSourceFactAlreadyReflected(options.id)) {
      return;
    }

    const lane = this.requireLane(options.lane, 'rate_response');
    const now = new Date();
    const latest = await getLatestConstructResponse(this.vfs, lane);

    await writeLaneLogEntry(this.vfs, lane, {
      kind: 'feedback',
      timestamp: now,
      role: 'system',
      sourceLane: lane,
      factId: options.id,
      responseId: latest?.responseId,
      rating: options.rating,
      source: options.source,
      content: options.annotation ?? '',
      annotation: options.annotation,
      responseContent: latest?.responseContent,
      precedingUserMessage: latest?.precedingUserMessage,
    });

    this.emit({
      type: 'feedback:rated',
      rating: options.rating,
      annotation: options.annotation,
      opId: options.id,
      traceId: options.traceId,
    });

    if (options.id) {
      this.markSourceFactReflected(options.id);
      this.emit({
        type: 'source-fact:reflected',
        factId: options.id,
        factType: 'rate_response',
        traceId: options.traceId,
        journal: 'lane-log',
        reflectedAt: now.toISOString(),
        processingStrategy: 'none',
      });
    }
  }

  private requireLane(lane: string, label: string): RuntimeLaneName<TLaneName> {
    const normalizedLane = lane.trim();
    if (normalizedLane.length === 0) {
      throw new Error(`${label} requires a non-empty lane.`);
    }

    if (!laneExists(this.lanes, normalizedLane)) {
      throw new Error(
        `${label} lane "${normalizedLane}" is not declared on this construct.`,
      );
    }

    return normalizedLane as RuntimeLaneName<TLaneName>;
  }

  /**
   * Inject a steering directive into a lane and process it immediately in that
   * same lane.
   */
  async steer(options: {
    directive: string;
    source?: string;
    lane: string;
    id?: string;
    traceId?: string;
    skipReflection?: boolean;
  }): Promise<void> {
    const lane = this.requireLane(options.lane, 'steer_directive');
    const now = new Date();
    const skipReflection =
      options.skipReflection ||
      (await this.isSourceFactAlreadyReflected(options.id));

    if (!skipReflection) {
      await this.reflectSteeringDirective({
        directive: options.directive,
        source: options.source,
        lane,
        id: options.id,
        traceId: options.traceId,
        timestamp: now,
      });
    }

    const perception = this.createSteeringDirectivePerception({
      directive: options.directive,
      source: options.source,
      lane,
      id: options.id,
      traceId: options.traceId,
      occurredAt: now,
      sourceFactReflected: true,
    });

    await this.ingest(perception);
  }

  async reflectSteeringDirective(options: {
    directive: string;
    source?: string;
    lane: string;
    id?: string;
    traceId?: string;
    timestamp?: Date;
  }): Promise<void> {
    if (await this.isSourceFactAlreadyReflected(options.id)) {
      return;
    }

    const lane = this.requireLane(options.lane, 'steer_directive');
    const now = options.timestamp ?? new Date();

    await writeLaneLogEntry(this.vfs, lane, {
      kind: 'steering',
      timestamp: now,
      role: 'system',
      sourceLane: lane,
      factId: options.id,
      source: options.source,
      content: options.directive,
    });

    this.emit({
      type: 'steering:directive',
      directive: options.directive,
      opId: options.id,
      traceId: options.traceId,
    });

    if (options.id) {
      this.markSourceFactReflected(options.id);
      this.emit({
        type: 'source-fact:reflected',
        factId: options.id,
        factType: 'steer_directive',
        traceId: options.traceId,
        journal: 'lane-log',
        reflectedAt: now.toISOString(),
        processingStrategy: 'impulse',
      });
    }
  }

  private createSteeringDirectivePerception(options: {
    directive: string;
    source?: string;
    lane: RuntimeLaneName<TLaneName>;
    id?: string;
    traceId?: string;
    occurredAt?: Date;
    sourceFactReflected?: boolean;
  }): ConstructPerception<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  > {
    return {
      lane: options.lane,
      role: 'system',
      source: 'system_event',
      event: 'steering_directive' as TSystemEventName,
      content: options.directive,
      occurredAt: options.occurredAt ?? new Date(),
      metadata: {
        directive: options.directive,
        source: options.source,
        op_id: options.id,
        trace_id: options.traceId,
        ...(options.sourceFactReflected ? { source_fact_reflected: true } : {}),
      },
    };
  }

  /**
   * Whether a hypno session is currently active.
   */
  isHypnoActive(): boolean {
    return this.hypnoSession !== null;
  }

  /**
   * Get the current hypno session stage.
   */
  getHypnoStage(): string | null {
    return this.hypnoSession?.stage ?? null;
  }

  /**
   * Get the current hypno draft.
   */
  getHypnoDraft(): string {
    return this.hypnoSession?.draft ?? '';
  }

  getRecentNapToolLog(): Array<{
    id: string;
    tool: string;
    command: string;
    output: string;
    createdAt: string;
  }> {
    return [...this.recentNapToolLog];
  }

  private clearRecentNapToolLog(): void {
    this.recentNapToolLog = [];
  }

  private recordRecentNapToolLog(tool: {
    command: string;
    output: string;
    tool?: string;
    timestamp?: Date;
  }): void {
    const createdAt = tool.timestamp?.toISOString() ?? new Date().toISOString();
    this.recentNapToolLog = [
      {
        id: `nap:${createdAt}:${this.recentNapToolLog.length}`,
        tool: tool.tool ?? 'nap',
        command: tool.command,
        output: tool.output,
        createdAt,
      },
      ...this.recentNapToolLog,
    ].slice(0, 40);
  }

  /**
   * Start a hypno (human-gated) nap session.
   * Returns the HypnoSession controller.
   */
  async startHypno(): Promise<HypnoSession> {
    if (this.hypnoSession) {
      throw new Error('Hypno session already active');
    }

    this.clearRecentNapToolLog();
    this.emit({ type: 'hypno:started' });
    this.emit({ type: 'nap:started' });
    const startTime = Date.now();

    const stageConfig = this.config.stageConfig;
    const session = await runHypnoFlow(
      this.vfs,
      this.config.deps,
      {
        onDraftChunk: (stage, text, delta) => {
          this.emit({ type: 'hypno:draft-chunk', stage, text, delta });
        },
        onDraftReady: (stage, draft) => {
          this.emit({ type: 'hypno:draft-ready', stage, draft });
        },
        onAnalysis: (content) => {
          this.emit({ type: 'nap:analysis', content });
        },
        onProposal: (_content) => {
          // proposal finalized
        },
        onTool: (tool) => {
          this.recordRecentNapToolLog(tool);
          this.emit({
            type: 'nap:tool',
            command: tool.command,
            output: tool.output,
          });
        },
        onStageChange: (stage) => {
          this.hypnoAcceptPending = false;
          this.emit({ type: 'hypno:stage-change', stage });
        },
        onReviewChunk: (stage, text, delta) => {
          this.emit({ type: 'hypno:review-chunk', stage, text, delta });
        },
        onReviewReply: (stage, reply, plan) => {
          this.emit({ type: 'hypno:review-reply', stage, reply, plan });
        },
        onPlanUpdated: (stage, plan) => {
          this.emit({ type: 'hypno:plan-updated', stage, plan });
        },
      },
      {
        nextNapPinQueuePath: this.config.nextNapPinQueuePath,
        nextNapImprintQueuePath: this.config.nextNapImprintQueuePath,
        contextPressureConfig: this.contextPressureConfig,
        computerConfig: this.config.computerConfig,
        stages:
          stageConfig?.['nap/analyze'] ||
          stageConfig?.['nap/propose'] ||
          stageConfig?.['nap/commit']
            ? {
                analyze: resolveStageSettings(
                  stageConfig?.['nap/analyze'],
                  this.config.model,
                ),
                propose: resolveStageSettings(
                  stageConfig?.['nap/propose'],
                  this.config.model,
                ),
                commit: resolveStageSettings(
                  stageConfig?.['nap/commit'],
                  this.config.model,
                ),
              }
            : undefined,
      },
    );

    this.hypnoSession = session;

    // Clean up when done
    session.done
      .then(async (result) => {
        this.hypnoSession = null;
        try {
          await updateConversationIndex(this.vfs);
          await updateNapIndex(this.vfs);
          await this.updateSessionMeta({
            last_compaction_at: new Date().toISOString(),
          });
          await this.vfs.flush();
        } catch {
          // best-effort
        }
        if (result.status === 'completed') {
          this.emit({
            type: 'hypno:completed',
            durationMs: Date.now() - startTime,
          });
          this.emit({
            type: 'nap:completed',
            durationMs: Date.now() - startTime,
          });
        } else {
          this.emit({ type: 'hypno:cancelled' });
        }
      })
      .catch((error) => {
        this.hypnoSession = null;
        this.emit({
          type: 'hypno:error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
        this.emit({
          type: 'nap:error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return session;
  }

  /**
   * Accept the current hypno review stage.
   * Returns a warning string if there are unapplied plan changes (double-accept to confirm).
   * Returns null on actual acceptance.
   */
  acceptHypno(): { warning?: string } {
    if (!this.hypnoSession) {
      throw new Error('No hypno session active');
    }

    const review = this.hypnoSession.reviewState;
    if (review.hasPendingPlan && !this.hypnoAcceptPending) {
      this.hypnoAcceptPending = true;
      const msg =
        'Unapplied plan changes exist. Run :accept again to proceed without applying, or :update first.';
      this.emit({ type: 'hypno:accept-warning', message: msg });
      return { warning: msg };
    }

    this.hypnoAcceptPending = false;
    this.hypnoSession.accept();
    return {};
  }

  /**
   * Send feedback to the current hypno review stage (rerun with guidance).
   */
  feedbackHypno(text: string): void {
    if (!this.hypnoSession) {
      throw new Error('No hypno session active');
    }
    this.hypnoSession.feedback(text);
  }

  /**
   * Chat with the review evaluator about the current draft.
   * Does NOT modify the draft — just discussion. Returns the AI reply.
   */
  async chatHypnoReview(text: string): Promise<string> {
    if (!this.hypnoSession) {
      throw new Error('No hypno session active');
    }
    // Any new chat resets the accept-pending flag
    this.hypnoAcceptPending = false;
    return this.hypnoSession.chat(text);
  }

  /**
   * Apply the current update plan to the draft.
   * Triggers a stage rerun with the plan as structured feedback.
   */
  updateHypno(): void {
    if (!this.hypnoSession) {
      throw new Error('No hypno session active');
    }
    // Applying the plan resets accept-pending
    this.hypnoAcceptPending = false;
    this.hypnoSession.applyPlan();
  }

  /**
   * Get the current hypno review state (chat transcript, plan, revisions).
   */
  getHypnoReviewState(): HypnoReviewState | null {
    return this.hypnoSession?.reviewState ?? null;
  }

  /**
   * Cancel the current hypno session.
   */
  cancelHypno(): void {
    if (!this.hypnoSession) return;
    this.hypnoAcceptPending = false;
    this.hypnoSession.cancel();
  }

  /**
   * Trigger nap — fully automatic, no human gating.
   */
  async nap(): Promise<void> {
    if (this.hypnoSession) {
      // Don't run auto nap while hypno is active
      return;
    }
    this.clearRecentNapToolLog();
    this.emit({ type: 'hypno:started' });
    this.emit({ type: 'compaction:started' });
    this.emit({ type: 'nap:started' });
    const startTime = Date.now();

    // Wait for active impulses to complete
    // (In production, would have timeout and graceful handling)

    let napSucceeded = false;
    try {
      const stageConfig = this.config.stageConfig;
      await runNapFlow(
        this.vfs,
        this.config.deps,
        {
          onStageChange: (stage) => {
            this.emit({ type: 'hypno:stage-change', stage });
          },
          onAnalysis: (content) => {
            this.emit({ type: 'nap:analysis', content });
          },
          onTool: (tool) => {
            this.recordRecentNapToolLog(tool);
            this.emit({
              type: 'nap:tool',
              command: tool.command,
              output: tool.output,
            });
          },
        },
        {
          nextNapPinQueuePath: this.config.nextNapPinQueuePath,
          nextNapImprintQueuePath: this.config.nextNapImprintQueuePath,
          contextPressureConfig: this.contextPressureConfig,
          computerConfig: this.config.computerConfig,
          stages:
            stageConfig?.['nap/analyze'] ||
            stageConfig?.['nap/propose'] ||
            stageConfig?.['nap/commit']
              ? {
                  analyze: resolveStageSettings(
                    stageConfig?.['nap/analyze'],
                    this.config.model,
                  ),
                  propose: resolveStageSettings(
                    stageConfig?.['nap/propose'],
                    this.config.model,
                  ),
                  commit: resolveStageSettings(
                    stageConfig?.['nap/commit'],
                    this.config.model,
                  ),
                }
              : undefined,
        },
      );
      napSucceeded = true;
    } catch (error) {
      this.emit({
        type: 'hypno:error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      this.emit({
        type: 'nap:error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }

    try {
      await updateConversationIndex(this.vfs);
      await updateNapIndex(this.vfs);
    } catch {
      // best-effort
    }

    // Update session compaction timestamp
    await this.updateSessionMeta({
      last_compaction_at: new Date().toISOString(),
    });

    // Flush changes
    await this.vfs.flush();

    if (napSucceeded) {
      this.emit({
        type: 'hypno:completed',
        durationMs: Date.now() - startTime,
      });
      this.emit({
        type: 'compaction:completed',
        durationMs: Date.now() - startTime,
      });
      this.emit({
        type: 'nap:completed',
        durationMs: Date.now() - startTime,
      });
    } else {
      this.emit({
        type: 'compaction:completed',
        durationMs: Date.now() - startTime,
      });
    }
  }
}

// Response error classification helpers — currently unused after batch
// refactor but kept for future error-handling refinement.
export function isNonRetryableResponseExecutionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('context window') ||
    message.includes('maximum context length') ||
    message.includes('too many tokens') ||
    message.includes('input exceeds the context window')
  );
}

export function isRetryableResponseExecutionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('i/o timeout') ||
    message.includes('timeout') ||
    message.includes('error reading stream') ||
    message.includes('connection reset') ||
    message.includes('temporarily unavailable') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('eai_again')
  );
}

function serializePerceptionSourcePayload(
  perception: Perception,
): Record<string, unknown> {
  return {
    lane: perception.lane,
    role: perception.role,
    source: perception.source,
    content: perception.content,
    occurredAt: perception.occurredAt.toISOString(),
    metadata: perception.metadata,
    event: perception.event,
    receivedAt: perception.receivedAt?.toISOString(),
    createdAt: perception.createdAt?.toISOString(),
    elapsed: perception.elapsed,
    profile: perception.profile,
    pool: perception.pool,
  };
}

/**
 * Create a new construct instance.
 */
export async function createConstruct<
  const TLanes extends LaneDefinitions<string>,
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TSystemEventName extends string = string,
>(
  config: ConstructConfig<
    TImpulseProfileName,
    TImpulsePoolName,
    Extract<keyof TLanes, string>
  > & { lanes: TLanes },
): Promise<
  Construct<
    TImpulseProfileName,
    TImpulsePoolName,
    Extract<keyof TLanes, string>,
    TSystemEventName
  >
>;
export async function createConstruct<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends string = string,
>(
  config: ConstructConfig<TImpulseProfileName, TImpulsePoolName, TLaneName>,
): Promise<
  Construct<TImpulseProfileName, TImpulsePoolName, TLaneName, TSystemEventName>
>;
export async function createConstruct<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TLaneName extends string = string,
  TSystemEventName extends string = string,
>(
  config: ConstructConfig<TImpulseProfileName, TImpulsePoolName, TLaneName>,
): Promise<
  Construct<TImpulseProfileName, TImpulsePoolName, TLaneName, TSystemEventName>
> {
  const prepared = await prepareConstructVfs({
    id: config.id,
    storage: config.storage,
    logger: config.deps.logger,
    intents: config.intents,
    lanes: config.lanes,
    modules: config.computerConfig.modules,
  });

  const construct = new Construct<
    TImpulseProfileName,
    TImpulsePoolName,
    TLaneName,
    TSystemEventName
  >(config, prepared.vfs);
  const restoreStartMs = Date.now();
  await construct.restoreImpulseCounter();

  const restoreMs = Date.now() - restoreStartMs;
  config.deps.logger.info('Construct created', {
    constructId: config.id,
    totalMs: prepared.totalMs + restoreMs,
    persistenceMs: prepared.persistenceMs,
    preloadMs: prepared.preloadMs,
    vfsMs: prepared.vfsMs,
    contextMs: prepared.contextMs,
    restoreMs,
    hasSession: prepared.hasSession,
  });
  return construct;
}

export async function createStorageConstruct(options: {
  id: string;
  storage: ConstructStorage;
  logger: Logger;
  intents?: Array<{ intent: string; hint: string; command: string }>;
}): Promise<StorageConstructView> {
  const prepared = await prepareConstructVfs(options);

  options.logger.info('Storage construct created', {
    constructId: options.id,
    totalMs: prepared.totalMs,
    persistenceMs: prepared.persistenceMs,
    preloadMs: prepared.preloadMs,
    vfsMs: prepared.vfsMs,
    contextMs: prepared.contextMs,
    hasSession: prepared.hasSession,
  });

  return {
    id: options.id,
    getVfs: () => prepared.vfs,
    flush: async () => {
      await prepared.vfs.flush();
    },
    stop: () => {},
  };
}

/**
 * Create a construct with default configuration.
 * Requires deps to be provided since AIDeps contains the OpenAI client.
 */
export async function createDefaultConstruct(
  deps: ConstructConfig['deps'],
  id = 'default',
): Promise<Construct> {
  return createConstruct({
    id,
    storage: createFileStorage(`~/.ai-construct/${id}`),
    deps,
    impulseProfiles: DEFAULT_IMPULSE_PROFILES,
    lanes: DEFAULT_CONSTRUCT_LANES,
    computerConfig: {},
  });
}

/**
 * Creates a read-only view wrapper around a Construct instance.
 * The returned object only exposes state-inspection methods,
 * preventing accidental mutations by snapshot/read-only code paths.
 */
export function toReadonlyView(construct: Construct): ReadonlyConstructView {
  return {
    id: construct.id,
    getState: () => construct.getState(),
    getRuntimeState: () => construct.getRuntimeState(),
    getVfs: () => construct.getVfs(),
    getImpulsePool: () => construct.getImpulsePool(),
    isHypnoActive: () => construct.isHypnoActive(),
    getHypnoStage: () => construct.getHypnoStage(),
    getHypnoReviewState: () => construct.getHypnoReviewState(),
  };
}
