/**
 * @inkibra/ai-construct
 *
 * A cognitive architecture for building AI agents with persistent memory,
 * impulse-driven processing, and natural conversational cadence.
 *
 * Uses a virtual filesystem (VFS) for context management and persistent memory.
 *
 * @example
 * ```typescript
 * import { createConstruct } from '@inkibra/ai-construct';
 *
 * // Create a construct
 * const construct = await createConstruct({
 *   id: 'my-agent',
 *   storage: createFileStorage('~/.ai-construct/my-agent'),
 * });
 *
 * // Set up response handler
 * construct.onResponse((response) => {
 *   console.log('Construct says:', response.content);
 * });
 *
 * // Start the scheduler
 * construct.start();
 *
 * // Ingest perceptions
 * await construct.ingest({
 *   type: 'USER_MESSAGE',
 *   messages: [{ content: 'Hello!', timestamp: new Date() }],
 *   receivedAt: new Date(),
 * });
 * ```
 */

// Backend — typed impulses and facade
export type {
  AuthPlugin,
  BuildConstructCombinedSnapshotOptions,
  BuildConstructLabSnapshotOptions,
  BuildConstructRuntimeSnapshotOptions,
  BuiltinImpulseKey,
  BuiltinImpulseOverrides,
  BuiltinImpulsePayloadMap,
  ConstructBackend,
  ConstructBackendRouteErrors,
  ConstructBackendRoutes,
  ConstructBackendStreamRoutes,
  ConstructBackendSubmitArgs,
  ConstructBackendSubmitWait,
  ConstructCombinedSnapshot,
  ConstructImpulsePayload,
  ConstructImpulseRegistry,
  ConstructInitializationPlan,
  ConstructSnapshotView,
  CreateConstructBackendApiHandlersOptions,
  CreateConstructBackendOptions,
  CreateConstructBackendRoutesOptions,
  CreateConstructBackendStreamHandlersOptions,
  CreateConstructBackendStreamRoutesOptions,
  CustomImpulseDefinition,
  CustomImpulsePayload,
  CustomImpulseRoute,
  ImpulsePayloadSchema,
  ImpulseToolingConfig,
  InitializeConstruct,
  MaybePromise,
  StreamConstructRuntimeEvents,
} from './backend';
export {
  buildConstructCombinedSnapshot,
  buildConstructLabSnapshot,
  buildConstructRuntimeSnapshot,
  buildConstructStudioSnapshot,
  createConstructBackend,
  createConstructBackendApiHandlers,
  createConstructBackendRoutes,
  createConstructBackendStreamHandlers,
  createConstructBackendStreamRoutes,
  defineConstructImpulses,
  defineImpulse,
  defineImpulsePayload,
  relayConstructRuntimeEventsFromStreams,
} from './backend';
// Browser UI
export type {
  ConstructContextPanelProps,
  ConstructControlSurfaceProps,
  ConstructFileTreeItem,
  ConstructFileTreeProps,
  ConstructImpulsePanelProps,
  ConstructInputBarProps,
  ConstructNapOverlayProps,
  ConstructThinkingPanelProps,
  ConstructTranscriptPanelProps,
} from './browser-ui';
export {
  ConstructContextPanel,
  ConstructControlSurface,
  ConstructFileTree,
  ConstructImpulsePanel,
  ConstructInputBar,
  ConstructNapOverlay,
  ConstructThinkingPanel,
  ConstructTranscriptPanel,
  chipStyle,
  constructUiVars,
  getVisibleImpulseActivity,
  isTranscriptTimestampDurable,
  panelHeaderStyle,
  panelStyle,
  panelTitleStyle,
  scrollBodyStyle,
  summarizeImpulseActivity,
} from './browser-ui';
export type { StorageConstructView } from './construct/construct';
// Construct
// NOTE: CLI exports (launchDemoTui, startRepl, etc.) are intentionally omitted from
// this barrel to prevent @opentui/core (bun:ffi) from leaking into browser bundles.
// Import directly from '@inkibra/ai-construct/cli/demo' etc. if needed.
export {
  Construct,
  createConstruct,
  createDefaultConstruct,
  createStorageConstruct,
  toReadonlyView,
} from './construct/construct';
export { createDalStorage, createFileStorage } from './construct/storage';
export type {
  ConcreteLaneName,
  ConstructConfig,
  ConstructEvent,
  ConstructResponse,
  ConstructRuntimeState,
  ConstructState,
  ConstructStorage,
  DefaultConstructLaneName,
  EventCallback,
  LaneDefinition,
  LaneDefinitions,
  Perception,
  PerceptionRole,
  PerceptionSource,
  ReadonlyConstructView,
  ResponseCallback,
  ResponseThinkingStage,
  StageAiSettings,
  StageConfig,
  WebSearchSettings,
} from './construct/types';
export { DEFAULT_CONSTRUCT_LANES } from './construct/types';
export type {
  ConstructSystemEventName,
  CoreImpulsePoolName,
  CoreImpulseProfileName,
  SystemEventImpulseProfileName,
  SystemEventNameFromProfile,
} from './impulse/keys';
export {
  CONSTRUCT_SYSTEM_EVENT_NAME,
  CORE_IMPULSE_PROFILE_NAME,
  DEFAULT_IMPULSE_PROFILES,
  IMPULSE_POOL_NAME,
  IMPULSE_PROFILE_PREFIX,
  systemEventImpulseProfile,
} from './impulse/keys';
// Impulse
export {
  createImpulsePool,
  generateImpulseId,
  getDefaultImpulseProfile,
  getImpulseType,
  ImpulsePool,
} from './impulse/pool';
export type { ImpulseRunnerConfig, OnThinkingChunk } from './impulse/runner';
export { DEFAULT_IMPULSE_RUNNER_CONFIG, runImpulse } from './impulse/runner';
export type {
  Impulse,
  ImpulseAction,
  ImpulseId,
  ImpulseLogEntry,
  ImpulsePoolConfig,
  ImpulseProfileConfig,
  ImpulseProfileMap,
  ImpulseResult,
  ImpulseStatus,
  ImpulseType,
  ImpulseUrgency,
  WaitForIdleTarget,
} from './impulse/types';
export {
  DEFAULT_IMPULSE_POOL_CONFIG,
  defineImpulseProfiles,
} from './impulse/types';
// Lab — action → op
export {
  buildConstructLabActionOp,
  normalizeContextPath,
} from './lab/lab-action-ops';
// Lab — command lock
export type {
  ConstructLabCommandAction,
  ConstructLabCommandLockEntry,
  ConstructLabCommandLockManager,
  ConstructLabCommandValidationResult,
} from './lab/lab-command-lock';
export {
  createConstructLabCommandLockManager,
  isConstructLabExclusiveCommand,
  isConstructLabPerceptionAction,
  toConstructLabCommandAction,
  validateConstructLabExclusiveCommand,
} from './lab/lab-command-lock';
// Lab — edit mode
export type {
  ConstructEditModeSnapshot,
  ConstructEditModeState,
  ConstructFileListResult,
  ConstructFileReadResult,
} from './lab/lab-edit-mode';
export {
  applyConstructStudioAction,
  buildEditModeSnapshot,
} from './lab/lab-edit-mode';
// Lab — optimistic overlay
export type {
  ConstructLabOptimisticOverlay,
  OptimisticSendingChat,
} from './lab/lab-optimistic';
export { overlayOptimisticSendingChat } from './lab/lab-optimistic';
// Lab — snapshot builders
export type { ConstructToolAndDecisionLogs } from './lab/lab-snapshot-builders';
export {
  buildConstructToolAndDecisionLogs,
  buildConstructToolAndDecisionLogsFromNodes,
  listRecentConstructLogNodes,
} from './lab/lab-snapshot-builders';
export type {
  ConstructEventStreamConstructEvent,
  ConstructEventStreamEventTypes,
  ConstructEventStreamSourceFactLifecycle,
  ConstructLabAction,
  ConstructLabActionAccepted,
  ConstructLabActionName,
  ConstructLabActionRejected,
  ConstructLabCommandRejectionReason,
  ConstructLabDecisionEvent,
  ConstructLabHypnoState,
  ConstructLabSnapshot,
  ConstructLabToolEvent,
  ConstructLabTranscriptMessage,
  ConstructRuntimeAction,
  ConstructRuntimeDecisionView as ConstructLabRuntimeDecisionView,
  ConstructRuntimeImpulseView as ConstructLabRuntimeImpulseView,
  ConstructRuntimeResidencyView as ConstructLabRuntimeResidencyView,
  ConstructRuntimeScheduledResponseView as ConstructLabRuntimeScheduledResponseView,
  ConstructRuntimeSnapshot as ConstructRuntimeFullSnapshot,
  ConstructRuntimeSourceFactView as ConstructLabRuntimeSourceFactView,
  ConstructRuntimeToolEventView as ConstructLabRuntimeToolEventView,
  ConstructRuntimeVfsNode,
  ConstructSnapshotNode,
  ConstructStudioAction,
  ConstructStudioContextFile,
  ConstructStudioSnapshot,
} from './lab/types';
// Lab — useConstructLab hook
export type {
  ConstructLabActionResult,
  ConstructLabCallbacks,
  ConstructLabFileCrud,
  ConstructLabSnapshotBundle,
  ConstructLabView,
  UseConstructLabOptions,
} from './lab/use-construct-lab';
export { useConstructLab } from './lab/use-construct-lab';
export type {
  ConstructLiveConnectionState,
  ConstructLiveConnectionStatus,
} from './live/connection';
export {
  buildConstructLivePathQuery,
  createConstructLiveConnectionState,
  isConstructLiveReconnectStatus,
  observeConstructLiveCursor,
  syncConstructLiveConnectCursor,
} from './live/connection';
export { buildConstructSnapshot } from './live/construct-snapshot';
export {
  buildConstructHypnoSnapshot,
  mapConstructHypnoStage,
} from './live/hypno-snapshot';
export type {
  ConstructInFlightItem,
  ConstructInFlightStage,
} from './live/in-flight';
export { buildConstructInFlightItems } from './live/in-flight';
export type {
  ConstructLiveImpulseView,
  ConstructLiveResponseStatus,
  ConstructLiveSourceFactView,
  ConstructPendingChatMessage,
  ConstructRuntimeImpulseView,
  ConstructRuntimeLiveOverlay,
  ConstructRuntimeResidencyView,
  ConstructRuntimeSnapshotView,
  ConstructTranscriptEntry,
} from './live/projection';
export {
  appendConstructPreviewSourceFactsToTranscript,
  applyConstructSourceFactLifecycleReceipt,
  applyConstructSourceFactsToTranscript,
  buildConstructTranscriptForView,
  hasRecentConstructRuntimeActivity,
  mergeConstructRuntimeSnapshot,
  mergeConstructSourceFacts,
  mergeConstructSourceFactView,
  sortConstructSourceFacts,
  sortConstructTranscript,
  transcriptHasPendingChat,
} from './live/projection';
export type {
  ConstructIngressLifecycleStatus,
  ConstructIngressLifecycleView,
  ConstructLiveDecisionEntry,
} from './live/runtime-state';
export {
  appendConstructLiveDelta,
  appendConstructLiveImpulseDelta,
  formatConstructPerceptionSummary,
  mergeConstructLiveResponseStatuses,
  pruneConstructLiveDecisionEntries,
  pruneConstructLiveImpulses,
  pruneConstructLiveImpulseThinking,
} from './live/runtime-state';
export type {
  ConstructLiveResponseAttempt,
  ConstructLiveResponseDecision,
  ConstructLiveResponseDecisionStatus,
  ConstructLiveResponseHistory,
  ParsedConstructDraftMessage,
} from './live/selectors';
export {
  buildConstructLiveResponseHistory,
  getLatestConstructLiveResponseAttempt,
  isVisibleConstructLiveResponseHistory,
  parseConstructDraftMessages,
  pruneConstructLiveResponseHistories,
  sortConstructViewsByStartedAtDesc,
  upsertConstructLiveResponseAttempt,
} from './live/selectors';
export type {
  BuildConstructSnapshotOptions,
  ConstructDecisionLogEvent,
  ConstructDeliveryState,
  ConstructHypnoSnapshot,
  ConstructIngressFrontier,
  ConstructQueuedMailboxPreviewEntry,
  ConstructQueuedNextNapImprint,
  ConstructQueuedNextNapPin,
  ConstructSnapshot,
  ConstructSnapshotTranscriptMessage,
  ConstructToolLogEvent,
} from './live/snapshot-types';
export {
  attachConstructTranscriptIdentity,
  buildConstructSnapshotTranscript,
  deriveConstructTranscriptDeliveryState,
  listRecentConstructLogPaths,
  mergeQueuedMailboxPreviewIntoSourceFacts,
  parseConstructTranscriptEntries,
  sortConstructSnapshotTranscript,
} from './live/transcript-snapshot';
export * from './live/view-machine';
export type {
  HypnoCallbacks,
  HypnoResult,
  HypnoReviewState,
  HypnoSession,
} from './nap/flow';
export { runHypnoFlow } from './nap/flow';
export type {
  ResponseLifecycleDropReason,
  ResponseLifecyclePhase,
  ResponseLifecycleReceipt,
} from './response-lifecycle';
export {
  getResponseLifecyclePhaseRank,
  isResponseLifecyclePhaseAtLeast,
} from './response-lifecycle';
export type {
  // NOTE: CreateActorRuntimeOptions, CreateDurableConstructRuntimeOptions, and
  // DurableConstructRuntime are omitted from this barrel to prevent @inkibra/actor
  // (bullmq/ioredis) from leaking into browser bundles.
  // Import directly from '@inkibra/ai-construct/runtime' if needed.
  ConstructActivityConfig,
  ConstructActivityEvent,
  ConstructActivitySink,
  ConstructActivityType,
  ConstructIngressLifecycleEvent,
  ConstructIngressWaitReason,
  ConstructIngressWaitResult,
  ConstructResponseLifecycleConfig,
  ConstructResponseLifecycleSink,
  ConstructRuntime,
  ConstructRuntimeManager,
  ConstructRuntimeManagerConfig,
  ConstructRuntimeOptions,
  ConstructSourceFactConfig,
  ConstructSourceFactSink,
  LocalConstructRuntime,
  LocalConstructRuntimeOptions,
} from './runtime';
export {
  createConstructResponseLifecycleTracker,
  // NOTE: createActorRuntime and createDurableConstructRuntime are omitted from this
  // barrel to prevent @inkibra/actor (bullmq/ioredis) from leaking into browser bundles.
  // Import directly from '@inkibra/ai-construct/runtime' if needed.
  createConstructRuntime,
  createConstructRuntimeManager,
  createConstructSourceFactTracker,
  createLocalConstructIngress,
  createLocalConstructRuntime,
  createNoopConstructResponseLifecycleSink,
  createNoopConstructSourceFactSink,
  createScopedConstructMailboxKeyStrategy,
  defaultConstructMailboxKeyStrategy,
  drainScheduledResponses,
  isQuiescentState,
  processMailboxMessages,
  publishQueuedSourceFact,
} from './runtime';
export type { ConstructOp, ConstructOpAction } from './runtime/ops';
export {
  buildHeartbeatSystemEventOp,
  buildImpulseOp,
  buildResponseDeliveredOp,
  buildSelfReminderOp,
  buildSystemEventOp,
  buildUserMessageOp,
  createHeartbeatSystemEventOpId,
  createResponseDeliveredOpId,
  createSelfReminderOpId,
  mapConstructOpToAction,
} from './runtime/ops';
// Runtime — snapshot sync (VFS copy/list/clear across constructs and DAL)
export type {
  ConstructVfsNode,
  DalConstructFile,
} from './runtime/snapshot-sync';
export {
  clearConstructFiles,
  constructSnapshotExistsInDal,
  copyConstructSnapshot,
  copyConstructSnapshotByDalIds,
  copyConstructSnapshotByStorage,
  listConstructFilePaths,
  listConstructFilesFromDal,
  listConstructSnapshotNodesFromDal,
} from './runtime/snapshot-sync';
export type {
  DueReminderEntry,
  HeartbeatScheduleState,
  PerceptionDueItem,
  PerceptionScheduleState,
} from './scheduler/perception-schedule';
export {
  computeHeartbeatRate,
  computeNextReminderFireAt,
  evaluateHeartbeatSchedule,
  listDueReminderEntries,
  normalizeHeartbeatShape,
} from './scheduler/perception-schedule';
export {
  DEFAULT_HEARTBEAT_SHAPE,
  type HeartbeatBucket,
  type HeartbeatShape,
  type PerceptionScheduler,
  type PerceptionSchedulerConfig,
  startPerceptionScheduler,
} from './scheduler/perception-scheduler';
export type {
  ExecuteBatchCallback,
  ExecuteResponseCallback,
  SchedulerEventCallback,
} from './scheduler/scheduler';
// NOTE: createConstructSchedulerWorkflow and related exports are omitted from this barrel
// to prevent @inkibra/workflow (bullmq/ioredis) from leaking into browser bundles.
// Import directly from '@inkibra/ai-construct/scheduler/workflow' if needed.
// Scheduler
export {
  createResponseScheduler,
  ResponseScheduler,
} from './scheduler/scheduler';
export type {
  BatchResponseExecutionResult,
  ResponseExecutionResult,
  ScheduledResponse,
  SchedulerConfig,
  SchedulerConsideration,
  SchedulerDecision,
  SchedulerDecisionMetrics,
  SchedulerState,
  SchedulerWaitCondition,
} from './scheduler/types';
export { DEFAULT_SCHEDULER_CONFIG } from './scheduler/types';
export type {
  SourceFactClearReason,
  SourceFactJournal,
  SourceFactLifecyclePhase,
  SourceFactLifecycleReceipt,
  SourceFactMetadata,
  SourceFactProcessingStrategy,
  SourceFactReflectedEvent,
  SourceFactType,
} from './source-facts';
export {
  classifyConstructOpAsSourceFact,
  classifyConstructOpKindAsSourceFact,
  getSourceFactMetadataFromPerception,
  getSourceFactPhaseRank,
  isSourceFactPhaseAtLeast,
} from './source-facts';
export type {
  DalContextPersistence,
  DalPersistenceOptions,
} from './vfs/context-persistence';
export {
  CONTEXT_ROOT,
  constructVfsCollectionSchema,
  constructVfsRuntimeCollection,
  constructVfsRuntimeTable,
  contextIdToPath,
  contextPathToId,
  createDalContextManager,
  createDalContextPersistence,
  createVfsContextManager,
  createVfsContextPersistence,
  DEFAULT_DAL_COLLECTION,
  loadDalVfsSnapshot,
} from './vfs/context-persistence';
export { matchesPinnedPath } from './vfs/context-pressure';
// VFS — Context pressure
// VFS — Context system
export type {
  ContextTrace,
  ContextTraceEntry,
  ContextTraceSection,
} from './vfs/context-system';
export type {
  FeedbackEntry,
  FeedbackRating,
  SteeringEntry,
} from './vfs/feedback';
export {
  getLatestConstructResponse,
  parseFeedbackLog,
  parseSteeringLog,
} from './vfs/feedback';
export { loadHeartbeatMeta, updateHeartbeatMeta } from './vfs/heartbeat';
// VFS
export type {
  ContextPinConfig,
  HomeContextStageConfig,
  InitialHomeContextConfig,
  InitialLogsContextConfig,
  LogsContextStageConfig,
} from './vfs/layout';
export {
  getInitialHomeContextConfig,
  getInitialLogsContextConfig,
  getInitialVfsStructure,
  getLogDir,
  getLogPath,
  LOG_LOAD_ORDER,
  VFS_PATHS,
} from './vfs/layout';

export type {
  AccumulatedContext,
  LogVisibility,
  OpenedFileContent,
  OpenedFilesContext,
  OpenedFilesState,
} from './vfs/loader';
export {
  getCombinedLogContent,
  loadAccumulatedContext,
  parseLogFile,
  renderOpenedLogTimeline,
  renderOpenedNonLogFilesContext,
  renderOpenFilesContext,
  renderOpenLogTimeline,
  renderRecentLogTimeline,
} from './vfs/loader';
export type {
  NextNapImprintEntry,
  NextNapPinEntry,
} from './vfs/nap-instructions';
export {
  applyNextNapPins,
  consumeNextNapImprints,
  consumeNextNapPins,
  enqueueNextNapImprint,
  enqueueNextNapPin,
  loadPendingNextNapImprints,
  loadPendingNextNapPins,
} from './vfs/nap-instructions';
export type { AIPinRule, HandleScoreUpdate } from './vfs/opened';
export {
  applyHandleScoreUpdates,
  ensureBootstrapOpenFile,
  inferPinKind,
  loadOpenedState,
  saveOpenedState,
} from './vfs/opened';
// VFS — Pinned runtime state
export type {
  PinnedEntry,
  PinnedEntryKind,
  PinnedEntryMode,
  PinnedEntryScope,
  PinnedEntrySource,
} from './vfs/pinned';
export {
  inferPinnedKind,
  loadPinnedState,
  queryPinnedEntries,
  removePinnedEntry,
  savePinnedState,
  upsertPinnedEntry,
} from './vfs/pinned';
export type { ReminderEntry, ReminderMeta } from './vfs/reminders';
export { listReminders, loadReminder, saveReminder } from './vfs/reminders';
export type { ResponseLifecycleRecord } from './vfs/response-lifecycle-state';
export {
  loadResponseLifecycleState,
  mergeResponseLifecycleReceipts,
  recordResponseLifecycleReceipt,
} from './vfs/response-lifecycle-state';
export type {
  ParsedSourceEventEntry,
  SourceEventEntry,
} from './vfs/source-events';
export {
  formatSourceEventEntry,
  parseSourceEventLog,
  writeSourceEventEntry,
} from './vfs/source-events';
export type { SourceFactRecord } from './vfs/source-fact-state';
export {
  loadSourceFactState,
  mergeSourceFactReceipts,
  recordSourceFactReceipt,
} from './vfs/source-fact-state';
// VFS — Studio context
export type { StudioState } from './vfs/studio-context';
export {
  getFallbackContextFileTitle,
  listStudioContextFiles,
  listStudioContextFilesFromSnapshotNodes,
  readStudioState,
  STUDIO_STATE_PATH,
  writeStudioState,
} from './vfs/studio-context';
