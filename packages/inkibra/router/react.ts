/**
 * @inkibra/router - React integration
 *
 * React components and hooks for routing.
 *
 * Page components receive everything via props from Router:
 * - loaderData, apiRoutes, eventStreams
 * - navigate, revalidate, checkpoint
 * - params, query, pendingTransition
 *
 * Only use hooks for special cases (e.g., useOutlet in layouts).
 */

// ============================================================================
// App Route Definitions
// ============================================================================
export type {
  AnyAppRoute,
  AppPathConfig,
  GetOutletFn,
  OutletComponent,
  OutletProps,
  PendingTransitionWithoutSkeleton,
  PendingTransitionWithSkeleton,
  RouteContextNew,
  VirtualOutletConfig,
  VirtualOutletMap,
} from './lib/app-route';
export { createAppPath, createAppRoute } from './lib/app-route';
// App Shell (SSR/Hydration)
export type { InitialLoaderData, RenderContextValue } from './lib/app-shell';
export {
  AppShell,
  hydrate,
  RenderContextProvider,
  runServerSideRender,
  useRenderContext,
} from './lib/app-shell';
// ============================================================================
// Capability System
// ============================================================================
export type {
  CapabilityDefinition,
  CapabilityDefinitionMap,
  CapabilityImplementation,
  CapabilityImplementationMap,
  CapabilityNames,
  CapabilityParams,
  CapabilityReturn,
  RequestedCapabilitiesMap,
  UseCapabilityImplementation,
} from './lib/capability';
export {
  createCapabilityDefinition,
  createCapabilityImplementation,
  isCapabilityDefinition,
} from './lib/capability';
// Canonical App Definition (Fluent Builder API)
export type {
  AppDefinition,
  PreparedAppConfig,
  PrepareOptions,
} from './lib/create-app';
export { createApp, prepare } from './lib/create-app';
// ============================================================================
// Define App (Isomorphic Config)
// ============================================================================
export type {
  AppConfigSchema,
  AppConfigSchemaType,
  BaseAppConfigSchema,
  InferConfig,
  InferRoutes,
  LoaderDataMap,
} from './lib/create-app-shared';
export {
  defineAppSchema,
  getMetaProperties,
} from './lib/create-app-shared';
// ============================================================================
// Fetch Transport (Client-side)
// ============================================================================
export {
  createFetchTransport,
  createLocalStorageAdapter,
  createMemoryStorageAdapter,
  createSessionStorageAdapter,
  type FetchTransport,
  type FetchTransportConfig,
  type InitialStorageData,
  type StorageAdapter,
} from './lib/fetch-provider';
// ============================================================================
// Hydrate (Client-side)
// ============================================================================
// Hydrate (deprecated v1 removed)
// ============================================================================
// Location Sources
// ============================================================================
export type { LocationSource } from './lib/location-source';
export {
  buildCheckpointUrl,
  createSegmentSource,
  createVirtualSource,
} from './lib/location-source';
// ============================================================================
// Query & Mutation Hooks
// ============================================================================
export {
  QueryClient,
  type QueryKey,
  type QueryObserver,
  type QueryOptions,
  type QueryState,
} from './lib/query-client';
// ============================================================================
// Result Types
// ============================================================================
export type { Result } from './lib/result';
export { Err, isErr, isOk, match, Ok } from './lib/result';
// ============================================================================
// Router - Main routing system
// ============================================================================
export {
  // Types
  type AllApiRoutesUnion,
  type ApiImplementations,
  type CheckpointFn,
  type CodecRegistry,
  type EventStreamImplementations,
  type ExtractAllApiRoutes,
  type ExtractAllContextCodecs,
  // Components
  Link,
  type LinkProps,
  type MergedApiRoutes,
  type MergedContextCodecs,
  type NavigateFn,
  type NavigateOptions,
  Outlet,
  type ReadContextFn,
  Redirect,
  type RedirectProps,
  type RequiredApiImplementations,
  type RequiredContext,
  type RequiredContextByScope,
  type RouteEntry,
  type RouteMatch,
  Router,
  type RouterConfig,
  // Provider (used by runServerSideRender and hydrate)
  RouterProvider,
  type RouterProviderConfig,
  type RunServerLoadersConfig,
  // Server-side
  runServerLoaders,
  type ServerLoaderResults,
  // Hooks (for layouts and special cases only)
  useCurrentParams,
  useCurrentPath,
  useMountPath,
  useOutlet,
} from './lib/router';
// ============================================================================
// API Hook - For mutations in components
// ============================================================================
export {
  type AnyApiRouteHandler,
  type ApiRouteHandler as ApiRouteHandlerType,
  type ConcurrencyMode,
  type UseApiHookOptions,
  type UseApiHookReturn,
  useApiHook,
} from './lib/use-api-hook';
// ============================================================================
// EventStream Hooks - For real-time in components
// ============================================================================
export {
  type AnyEventStreamHandler,
  type EventStreamArgsOption,
  type EventStreamCompletionReducerFn,
  type EventStreamError,
  type EventStreamEventHandlers,
  type EventStreamHandler,
  type EventStreamReducerAction,
  type EventStreamReducerConfig,
  type EventStreamReducerFn,
  type EventStreamStatus,
  type UseEventStreamOptions,
  type UseEventStreamReducerReturn,
  type UseEventStreamReturn,
  useEventStream,
  useEventStreamReducer,
} from './lib/use-event-stream-hooks';
