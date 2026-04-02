/**
 * Core library exports (no React dependency)
 */

// ============================================================================
// Query DSL (re-exported from @inkibra/query-cache)
// ============================================================================
export type {
  FilterExpression,
  FilterOperator,
  QueryParams,
  SerializedQueryParams,
  SortDirection,
} from '@inkibra/query-cache';
export {
  fromURLSearchParams,
  matchesFilter,
  matchesFilters,
  parseFilter,
  parseQueryParams,
  serializeFilter,
  serializeQueryParams,
  toURLSearchParams,
} from '@inkibra/query-cache';
// ============================================================================
// API Route
// ============================================================================
export type {
  AnyApiRoute,
  AnyApiRouteSchema,
  ApiHandlerResult,
  ApiRouteConfig,
  ApiRouteHandlerFn,
  ApiRouteSchema,
  CreatedApiRoute,
  FileInputDescription,
  HandlerArguments,
  HandlerFunction,
  HandlerObject,
  HandlerResult,
  InferredRouteTypes,
  MultipleFilesInput,
  RouteContextCodecMap,
  RouteContextErrors,
  RouteContextType,
  RouteCreatesContextCodecMap,
  RouteHandlerArgs,
  RouteNamedTypes,
  RouteResponse,
  RouteSchemaContract,
  RouteTypes,
  SingleFileInput,
  TBaseResponse,
  ValidatedType,
} from './api-route';
export { ApiRoute, createAPIRoute, defineRouteSchema } from './api-route';
// ============================================================================
// API Route Handler
// ============================================================================
export type {
  AnyApiRouteHandler,
  ApiHandlerContext,
  ApiHandlerResultEnvelope,
  ApiHandlerRoute,
  ApiRouteHandler,
  ApiRouteHandlerConfig,
  ApiRouteHandlerFunction,
} from './api-route-handler';
export {
  createApiRouteHandler,
  hasApiHandlerResultEnvelope,
  splitApiHandlerResult,
  unwrapApiHandlerResult,
} from './api-route-handler';
// ============================================================================
// App Route
// ============================================================================
export type {
  AnyAppPath,
  AnyAppRoute,
  AnyLoaderSchema,
  AnyPathTreeNode,
  ApiRouteImplementations,
  ApiRouteMap,
  AppPath,
  AppPathConfig,
  AppRouteCollection,
  AppRouteConfig,
  AppRouteOptions,
  CombinedLoaderContext,
  EventStreamImplementations,
  EventStreamRouteMap,
  GetOutletFn,
  InheritedContextCodecsFromApiRoutes,
  IsomorphicLoaderFn,
  LoaderArgs,
  LoaderConfig,
  LoaderSchema,
  LoaderSchemaData,
  LoaderSchemaError,
  OutletComponent,
  OutletConfig,
  OutletDefinitionMap,
  OutletProps,
  PathCapabilities,
  PathParams,
  PathParamsSchema,
  PathQuery,
  PathTreeCapabilities,
  PathTreeConfig,
  PathTreeNode,
  PathTreeOutlets,
  PathTreeParams,
  PathTreeTargetOutlet,
  PathVirtualOutlets,
  PendingTransitionWithoutSkeleton,
  PendingTransitionWithSkeleton,
  ReactComponent,
  RouteAdditionalContextCodecs,
  RouteApiRoutes,
  RouteCapabilities,
  RouteContextFromCodecs,
  RouteContextNew,
  RouteEventStreams,
  RouteHasSkeleton,
  RouteLoaderData,
  RouteLoaderError,
  RouteLoaderResult,
  RouteLoaderSchema,
  RouteParams,
  RouteQueryParams,
  RouteVirtualOutlets,
  SegmentConfig,
  UnwrappedContextData,
  VirtualOutletConfig,
  VirtualOutletMap,
} from './app-route';
export {
  createAppPath,
  createAppRoute,
  createPathTree,
  defineLoaderSchema,
  definePathParamsSchema,
  generateOutletId,
  matchRouteInCollection,
} from './app-route';
// ============================================================================
// App Routes (Fluent Builder API)
// ============================================================================
export type {
  AccCtx,
  ApiRoutesFromTree,
  AppRouteNode,
  EmptyCtx,
  EventStreamsFromTree,
  LeafNode,
  MutationFn,
  NavigateFn,
  OutletNode,
  OutletsMap,
  PageConfig,
  PageRef,
  PagesFromOutlets,
  PagesFromSegments,
  PathLeaf,
  PathSegment,
  QuerySchema,
  RoutePageProps,
  RunQueryFn,
  SegmentNode,
} from './app-routes';
export {
  createAppRouteTree,
  PARENT,
  parseNamespacedQuery,
  serializeNamespacedQuery,
} from './app-routes';
// App Shell (SSR/Hydration)
export type { InitialLoaderData, RenderContextValue } from './app-shell';
export {
  AppShell,
  collectSyncChunkUrls,
  hydrate,
  RenderContextProvider,
  runServerSideRender,
  useRenderContext,
} from './app-shell';
// ============================================================================
// AwaitResult Component
// ============================================================================
export type {
  AwaitResultProps,
  QueryPhase,
  QueryState,
} from './await-result';
export { AwaitResult } from './await-result';
// ============================================================================
// Capability System
// ============================================================================
export type {
  CapabilityConfig,
  CapabilityDefinition,
  CapabilityDefinitionMap,
  CapabilityImplementation,
  CapabilityImplementationMap,
  CapabilityNames,
  CapabilityParams,
  CapabilityReturn,
  CapabilitySchema,
  RequestedCapabilitiesMap,
  UseCapabilityImplementation,
  Validator,
} from './capability';
export {
  createCapability,
  createCapabilityDefinition,
  createCapabilityImplementation,
  defineCapabilitySchema,
  isCapabilityDefinition,
} from './capability';
// ============================================================================
// Context Codec
// ============================================================================
export type {
  AnyContextCodec,
  AssertValidCodecMap,
  ContextCodec,
  ContextCodecConfig,
  ContextCodecDataType,
  ContextCodecErrorType,
  ContextCodecMap,
  ContextCodecMapDataTypes,
  ContextCodecMapErrorTypes,
  ContextCodecMapResultTypes,
  ContextCodecMapWarningTypes,
  ContextCodecName,
  ContextDecodeWarning,
  ContextDecodeWarningsByCodec,
  ContextEnforceDecision,
  ContextEnforcer,
  ContextResult,
  ContextSecurityMode,
  ValidatedContextCodecMap,
} from './context-codec';
export {
  CONTEXT_DECODE_WARNINGS_SYMBOL,
  createContextCodec,
  enforce,
  resolveContextResult,
} from './context-codec';
// ============================================================================
// Context Schema
// ============================================================================
export type {
  ContextSchema,
  ContextSchemaDataType,
  ContextSchemaErrorType,
  ContextSchemaWarningType,
} from './context-schema';
export { defineContextSchema } from './context-schema';
export type {
  AppDefinition,
  PreparedAppConfig,
  PrepareOptions,
} from './create-app';
export { createApp, prepare } from './create-app';
// ============================================================================
// Define App (Canonical - Fluent Builder)
// ============================================================================
export type {
  AppConfigSchema,
  AppConfigSchemaType,
  BaseAppConfigSchema,
  InferConfig,
  InferRoutes,
  LoaderDataMap,
} from './create-app-shared';
export { defineAppSchema, getMetaProperties } from './create-app-shared';
export type {
  AnyMutation,
  Mutation,
  MutationArgs,
  MutationContext,
  MutationDefinition,
  MutationMapping,
  MutationResult,
  OptimisticUpdateFn,
} from './create-mutation';
export { createMutation } from './create-mutation';
// ============================================================================
// Query System
// ============================================================================
export type {
  AnyQuery,
  ListSelection,
  Query,
  QueryArgs,
  QueryConfig,
  QueryContext,
  QueryDefinition,
  QueryResult,
  RouteMapping,
  Selection,
  SingleSelection,
} from './create-query';
export { createQuery } from './create-query';
// ============================================================================
// EventStream Bus (NEW - Client-side)
// ============================================================================
export type {
  BusCompletionData,
  BusCompletionError,
  BusEvents,
  CompletionHandler,
  EventHandler,
  EventStreamBus,
  EventStreamBusManager,
  EventStreamBusStatus,
} from './event-stream-bus';
export {
  createEventStreamBus,
  createEventStreamBusManager,
} from './event-stream-bus';
// ============================================================================
// EventStream Channel (NEW)
// ============================================================================
export type {
  ChannelCompletion,
  ChannelCompletionType,
  ChannelEvents,
  ChannelMessage,
  EventStreamChannel,
  EventStreamChannelFactory,
} from './event-stream-channel';
export {
  createInMemoryChannelFactory,
  stableStringify,
} from './event-stream-channel';
// ============================================================================
// EventStream Handler (NEW)
// ============================================================================
export type {
  AnyEventStreamHandler,
  EventStreamHandler,
  EventStreamHandlerConfig,
  EventStreamHandlerFunction,
  HandlerContext,
  HandlerRoute,
} from './event-stream-handler';
export { createEventStreamHandler } from './event-stream-handler';
// ============================================================================
// EventStream Route
// ============================================================================
export type {
  AnyEventStreamRoute,
  AnyEventStreamRouteSchema,
  CreatedEventStreamRoute,
  EventStreamCompletion,
  EventStreamHandlerArguments,
  EventStreamHandlerGeneratorFunction,
  EventStreamHandlerObject,
  EventStreamRouteArgs,
  EventStreamRouteCompletion,
  EventStreamRouteConfig,
  EventStreamRouteEventTypes,
  EventStreamRouteNamedTypes,
  EventStreamRouteSchema,
  EventStreamRouteTypes,
  EventStreamYieldedEvent,
  InferredEventStreamRouteTypes,
} from './event-stream-route';
export {
  createEventStreamRoute,
  defineEventStreamSchema,
  EventStreamRoute,
} from './event-stream-route';
// ============================================================================
// Fetch Provider
// ============================================================================
export type {
  FetchProviderConfig,
  FetchTransport,
  FetchTransportConfig,
  InitialStorageData,
  StorageAdapter,
} from './fetch-provider';
export {
  createFetchTransport,
  createLocalStorageAdapter,
  createMemoryStorageAdapter,
  createSessionStorageAdapter,
  FetchProvider,
  implementApiRoutes,
  implementEventStreamRoutes,
} from './fetch-provider';
// ============================================================================
// HMR Client (Hot Module Replacement - Dev Only)
// ============================================================================
export {
  connectHmr,
  disconnectHmr,
  getHmrConnectionState,
  isHmrConnected,
} from './hmr-client';
// ============================================================================
// Loaders
// ============================================================================
export type {
  AnyIsomorphicLoader,
  AnyLoader,
  AnyServerLoader,
  IsomorphicLoaderConfig,
  IsomorphicLoaderResult,
  ServerLoaderConfig,
  ServerLoaderResult,
} from './loaders';
export {
  defineIsomorphicLoader,
  defineServerLoader,
  executeLoaderOnClient,
  executeLoaderOnServer,
  extractOkValue,
  isIsomorphicLoader,
  isServerLoader,
  updateCacheWithResult,
} from './loaders';
// ============================================================================
// Location Sources
// ============================================================================
export type { LocationSource } from './location-source';
export {
  buildCheckpointUrl,
  createSegmentSource,
  createVirtualSource,
} from './location-source';
export { buildQueryKey, QueryClient } from './query-client';
// ============================================================================
// Query Runtime
// ============================================================================
export type {
  ApiImplementationsMap,
  BoundMutation,
  CanRunMutation,
  CanRunQuery,
  HasRequiredRoutes,
  MutationBindOptions,
  MutationRunOptions,
  QueryResultTuple,
  QueryRuntimeContext,
  RunQueryOptions,
  WithQueryRuntime,
} from './query-runtime';
export { createQueryRuntime, QUERY_RUNTIME, useQuery } from './query-runtime';
// ============================================================================
// Result Types
// ============================================================================
export type {
  Err as ErrType,
  Ok as OkType,
  Result as ResultType,
  SerializableErrResult,
  SerializableOkResult,
  SerializableResult as SerializableResultType,
} from './result';
export {
  andThen,
  Err,
  isErr,
  isOk,
  isSerializableResultErr,
  isSerializableResultOk,
  map,
  mapErr,
  match,
  Ok,
  Result,
  SerializableResult,
  unwrap,
  unwrapErr,
  unwrapOr,
} from './result';
// ============================================================================
// Router Components
// ============================================================================
export * from './router';
// ============================================================================
// Storage Driver
// ============================================================================
export type { StorageDriver } from './storage-driver';
export {
  createInMemoryStorageDriver,
  webStorageDriver,
} from './storage-driver';
// ============================================================================
// Strategy (Component Loading Strategies)
// ============================================================================
export type {
  LazyComponentRef,
  RouteComponent,
  StaticComponentRef,
  StrategyComponentRef,
  SyncComponentRef,
} from './strategy';
export {
  // HMR utilities
  clearAllCaches,
  getImportPath,
  getPreloadedComponent,
  getRegisteredPaths,
  invalidateByPath,
  isLazyComponent,
  isPlainComponent,
  isStaticComponent,
  isStrategyComponent,
  isSyncStrategyComponent,
  LAZY_SYMBOL,
  preloadComponent,
  resolveComponent,
  STATIC_SYMBOL,
  SYNC_SYMBOL,
  strategy,
} from './strategy';
// ============================================================================
// Transaction Cycle
// ============================================================================
export type {
  EffectContext,
  EffectIntent,
  EffectPreview,
  TransactionCycle,
  TransactionCycleMode,
  TransactionRuntime,
} from './transaction-cycle';
export {
  createInMemoryTransactionRuntime,
  createNoopEffectContext,
} from './transaction-cycle';
// ============================================================================
// Transport Layer
// ============================================================================
export type {
  ContextLevelError,
  NetworkError,
  ParseError,
  RouteResult,
  ServerError,
  StorageScope,
  TimeoutError,
  TransportCallbacks,
  TransportLevelError,
  ValidationError,
} from './transport';
export {
  createContextError,
  TransportError,
} from './transport';
// ============================================================================
// EventStream Hooks
// ============================================================================
export type {
  EventStreamError,
  EventStreamStatus,
  LiveReducer,
  UseLiveOptions,
  UseLiveReturn,
} from './use-event-stream-hooks';
export { useLive } from './use-event-stream-hooks';
