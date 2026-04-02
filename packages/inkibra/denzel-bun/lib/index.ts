/**
 * @inkibra/denzel-bun - Library exports
 *
 * Bun-native HTTP server for @inkibra/router
 */

// Re-export RedisClient from bun for convenience
export type { RedisClient } from 'bun';
// ============================================================================
// API Route Handler Provider
// ============================================================================
export type {
  ApiHandlerFactory,
  ApiHandlerProviderResult,
  ProviderRoute,
} from './api-route-handler-provider';
export { createApiRouteHandlerProvider } from './api-route-handler-provider';
// ============================================================================
// Context Transport
// ============================================================================
export type { JwtConfig, ReadContextResult } from './context-transport';
export {
  deleteContext,
  readContextFromRequest,
  readContextsFromRequest,
  writeContextsToResponse,
  writeContextToResponse,
} from './context-transport';
// Note: For no-deps handlers, just call the provider with {}: myHandlerProvider({})
// ============================================================================
// Create Frontend (SSR Frontends)
// ============================================================================
export type {
  // Legacy names (deprecated)
  AppMountPoint,
  // Shared types
  AppMountPointContext,
  DomainAsset,
  DomainAssets,
  // New names
  Frontend,
  FrontendOptions,
  RenderFn,
  RenderResult,
} from './create-app-mount-point';
export {
  // Legacy (deprecated)
  createAppMountPoint,
  createFrontend,
} from './create-app-mount-point';
// ============================================================================
// Create Backend (Handler Collection)
// ============================================================================
export type {
  AnyBackend,
  Backend,
  BackendConfig,
  RegisteredEventStreamHandler,
} from './create-backend';
export { createBackend } from './create-backend';
// ============================================================================
// Create Router (NEW - Unified Entry Point)
// ============================================================================
export type {
  Router,
  RouterConfig,
  StaticDirConfig,
} from './create-router';
export { createRouter } from './create-router';
// ============================================================================
// EventStream Handler Provider
// ============================================================================
export type {
  EventStreamHandlerFactory,
  EventStreamHandlerProviderResult,
  EventStreamProviderRoute,
} from './event-stream-handler-provider';
export { createEventStreamHandlerProvider } from './event-stream-handler-provider';
// ============================================================================
// HMR (Hot Module Replacement) - Dev Server
// ============================================================================
export type {
  DevServer,
  DevServerOptions,
  HmrClientMessage,
  HmrServer,
  HmrServerMessage,
  HmrServerOptions,
  HmrUpdate,
} from './hmr';
export { createDevServer, createHmrOptions, createHmrServer } from './hmr';
// ============================================================================
// Redis Channel Factory
// ============================================================================
export type { RedisChannelFactoryDeps } from './redis-channel-factory';
export {
  completeChannel,
  createRedisChannelFactory,
  publishToChannel,
} from './redis-channel-factory';
// ============================================================================
// Request/Response Context
// ============================================================================
export type { RequestContext } from './request-context';
export {
  buildRequestContext,
  getCookie,
  getHeader,
  getPathParam,
  getQueryParam,
  getQueryParams,
} from './request-context';
// Note: createEventStreamHandler is in @inkibra/router (router-level, no HTTP)
// ============================================================================
// Request Transaction (per-request tx cycle via AsyncLocalStorage)
// ============================================================================
export { getRequestTransactionCycle } from './request-transaction';
export type {
  CookieEntry,
  CookieOptions,
  ResponseContext,
} from './response-context';
export {
  createErrorResponse,
  createNotFoundResponse,
  createRedirectResponse,
  createResponseContext,
} from './response-context';
// ============================================================================
// Server-Side Render (NEW)
// ============================================================================
export type {
  RunServerSideRenderConfig,
  RunServerSideRenderResult,
} from './run-server-side-render';
export { runServerSideRender } from './run-server-side-render';
