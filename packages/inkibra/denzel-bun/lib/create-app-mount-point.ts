/**
 * createFrontend - SSR Frontend Definition
 *
 * Creates a frontend configuration for SSR rendering with:
 * - Domain routing (which hosts can access this frontend)
 * - Domain assets (favicons, manifests, etc.)
 * - Context codecs for reading/writing context
 * - Render function that returns { html, contextChanges }
 *
 * Note: Mount path is now defined on the app via createApp({ mountPath: '/app' })
 * and extracted from the preparedApp in the render function.
 *
 * Context is grouped by scope for easy access and meta tag serialization:
 * - `ctx.session.{codecName}` for session-scoped contexts
 * - `ctx.device.{codecName}` for device-scoped contexts
 *
 * Usage:
 * ```typescript
 * export const ExampleFrontend = createFrontend({
 *   name: 'ExampleFrontend',
 *   allowedDomains: ['localhost'],
 *   contextCodecs: { session: SessionCodec },  // Key must match SessionCodec.name
 *   render: async (request, ctx) => {
 *     // Access via ctx.session.session (scope.codecName)
 *     const session = ctx.session.session;
 *
 *     const { html, contextChanges } = await runServerSideRender({
 *       preparedApp: prepare(ExampleApp),
 *       context: ctx,
 *       // ...
 *     }, <AppShell>...</AppShell>);
 *     return { html, contextChanges };
 *   },
 * });
 * ```
 */

import { Logger } from '@inkibra/logger';
import type {
  AnyContextCodec,
  AssertValidCodecMap,
  ContextCodecMap,
  ContextCodecMapDataTypes,
} from '@inkibra/router';
import {
  type JwtConfig,
  readContextsFromRequest,
  writeContextsToResponse,
} from './context-transport';
import { buildRequestContext } from './request-context';
import { createResponseContext } from './response-context';

// ============================================================================
// Types
// ============================================================================

/**
 * Filter codec map keys by scope
 */
type FilterKeysByScope<
  TCodecs extends ContextCodecMap,
  TScope extends string,
> = {
  [K in keyof TCodecs]: TCodecs[K]['scope'] extends TScope ? K : never;
}[keyof TCodecs];

/**
 * Context values grouped by scope
 *
 * @example
 * ```typescript
 * // Given codecs:
 * contextCodecs: {
 *   session: SessionCodec,      // scope: 'session'
 *   'user-prefs': PrefsCodec,   // scope: 'device'
 * }
 *
 * // Results in:
 * ContextByScope<TCodecs> = {
 *   session: { session: SessionData | undefined };
 *   device: { 'user-prefs': PrefsData | undefined };
 * }
 * ```
 */
export type ContextByScope<TCodecs extends ContextCodecMap> = {
  session: {
    [K in FilterKeysByScope<TCodecs, 'session'> & keyof TCodecs]:
      | TCodecs[K]['_dataType']
      | undefined;
  };
  device: {
    [K in FilterKeysByScope<TCodecs, 'device'> & keyof TCodecs]:
      | TCodecs[K]['_dataType']
      | undefined;
  };
};

/**
 * Result from render function
 */
export type RenderResult = {
  /** Complete HTML string (should include <!DOCTYPE html>) */
  html: string;
  /** Context changes to write to response (grouped by scope) */
  contextChanges: Record<string, unknown>;
};

/**
 * Render function type - receives contexts grouped by scope
 */
export type RenderFn<TCodecs extends ContextCodecMap> = (
  request: Request,
  ctx: ContextByScope<TCodecs>,
) => RenderResult | Promise<RenderResult>;

/**
 * Domain asset - either a static file path or a dynamic handler
 */
export type DomainAsset =
  | string // Static asset path
  | ((
      request: Request,
      ctx: AppMountPointContext,
    ) => Response | Promise<Response>);

/**
 * Domain assets map
 */
export type DomainAssets = Record<string, DomainAsset>;

/**
 * Options for createFrontend
 *
 * Context codec keys MUST match the codec's `name` property.
 * This is enforced at compile time via AssertValidCodecMap.
 */
export type FrontendOptions<
  TCodecs extends ContextCodecMap = Record<string, never>,
> = {
  /** Frontend name (for debugging/logging) */
  name: string;

  /** URL mount path (e.g., '/app') - use ExampleApp.mountPath to reference from app */
  mountPath: string;

  /** Allowed domains that can access this frontend */
  allowedDomains: string[];

  /** Domain-level assets (favicon, manifests, etc.) */
  domainAssets?: DomainAssets;

  /** Context codecs to read/write (keys must match codec name) */
  contextCodecs?: TCodecs;

  /** JWT config used by secure: 'signed' context codecs */
  jwtConfig?: JwtConfig;

  /** SSR render function - receives contexts, returns { html, contextChanges } */
  render: RenderFn<TCodecs>;
} & AssertValidCodecMap<TCodecs>;

/**
 * Legacy context type (for backwards compatibility)
 */
export type AppMountPointContext = {
  /** Request hostname */
  hostname: string;
  /** Decoded context values */
  [key: string]: unknown;
};

/**
 * Created frontend (used by createRouter)
 */
export type Frontend = {
  /** Frontend name */
  readonly name: string;

  /** URL mount path */
  readonly mountPath: string;

  /** Allowed domains */
  readonly allowedDomains: string[];

  /** Domain assets */
  readonly domainAssets: DomainAssets | undefined;

  /** Context codecs */
  readonly contextCodecs: ContextCodecMap | undefined;

  /** Internal render function - returns Response (wraps user's render) */
  readonly render: (
    request: Request,
    ctx: AppMountPointContext,
  ) => Promise<Response>;
};

/**
 * @deprecated Use Frontend instead
 */
export type AppMountPoint = Frontend;

// ============================================================================
// createAppMountPoint
// ============================================================================

/**
 * Create an SSR frontend.
 *
 * Context codecs define what context to read from the request and write to the response.
 * The render function receives context values grouped by scope (session/device).
 *
 * @example
 * ```typescript
 * import { createFrontend } from '@inkibra/denzel-bun';
 * import { SessionCodec } from '../api/routes/auth';
 * import { ExampleApp } from './index';
 *
 * export const ExampleFrontend = createFrontend({
 *   name: 'ExampleFrontend',
 *   mountPath: ExampleApp.mountPath,  // Reference from app definition
 *   allowedDomains: ['localhost', '127.0.0.1'],
 *   contextCodecs: { session: SessionCodec },
 *
 *   domainAssets: {
 *     'favicon.ico': './assets/favicon.ico',
 *   },
 *
 *   render: async (request, ctx) => {
 *     const { html, contextChanges } = await runServerSideRender(
 *       {
 *         preparedApp: prepare(ExampleApp),
 *         context: ctx,
 *         // ...
 *       },
 *       <AppShell>...</AppShell>
 *     );
 *     return { html, contextChanges };
 *   },
 * });
 * ```
 */
export function createFrontend<
  TCodecs extends ContextCodecMap = Record<string, never>,
>(options: FrontendOptions<TCodecs>): Frontend {
  const {
    name,
    mountPath,
    allowedDomains,
    domainAssets,
    contextCodecs,
    jwtConfig,
    render: userRender,
  } = options;

  // Normalize mount path (ensure it starts with / and doesn't end with /)
  // Special case: "/" stays as "/" (root mount), "" becomes "/"
  const normalizedMountPath =
    mountPath === '' || mountPath === '/'
      ? '/'
      : mountPath.startsWith('/')
        ? mountPath.endsWith('/')
          ? mountPath.slice(0, -1)
          : mountPath
        : `/${mountPath}`;

  const logger = Logger.createLogger(
    name,
    {
      component: 'denzel-bun-frontend',
      mountPath: normalizedMountPath,
      allowedDomains,
      domainAssetKeys: domainAssets ? Object.keys(domainAssets) : undefined,
      contextCodecKeys: contextCodecs ? Object.keys(contextCodecs) : undefined,
    },
    'warn',
  );

  // Wrap user's render function to handle context read/write
  const wrappedRender = async (
    request: Request,
    _ctx: AppMountPointContext,
  ): Promise<Response> => {
    // 1. Read contexts from request
    const requestContext = buildRequestContext(request);
    const { values: flatContexts, errors: contextErrors } = contextCodecs
      ? await readContextsFromRequest(requestContext, contextCodecs, jwtConfig)
      : { values: {} as Record<string, unknown>, errors: [] };

    // 2. Group contexts by scope
    const contextByScope: ContextByScope<TCodecs> = {
      session: {} as ContextByScope<TCodecs>['session'],
      device: {} as ContextByScope<TCodecs>['device'],
    };

    if (contextCodecs) {
      for (const [key, codec] of Object.entries(contextCodecs) as [
        string,
        AnyContextCodec,
      ][]) {
        const value = flatContexts[key];
        if (codec.scope === 'session') {
          (contextByScope.session as Record<string, unknown>)[key] = value;
        } else {
          (contextByScope.device as Record<string, unknown>)[key] = value;
        }
      }
    }

    // 3. Call user's render function with grouped contexts
    // (values already include defaults for invalid contexts - SSR gracefully degrades)
    let html: string;
    let contextChanges: Record<string, unknown>;
    try {
      const result = await userRender(request, contextByScope);
      html = result.html;
      contextChanges = result.contextChanges;
    } catch (err) {
      logger.error('Render error', {
        requestUrl: request.url,
        requestId: request.headers.get('X-Request-ID') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
        err,
      });
      throw err;
    }

    // 4. Build response with html
    const responseContext = createResponseContext();
    responseContext.setHeader('Content-Type', 'text/html; charset=utf-8');

    // 5. If there were validation errors, write defaultValues to response (reset state)
    if (contextCodecs && contextErrors.length > 0) {
      // Log malformed context values for debugging/observability
      for (const error of contextErrors) {
        logger.warn('Malformed context value', {
          codec: error.codec,
          error: error.error,
          message: 'message' in error ? error.message : undefined,
          requestUrl: request.url,
          requestId: request.headers.get('X-Request-ID') ?? undefined,
          userAgent: request.headers.get('user-agent') ?? undefined,
        });
      }

      // Reset invalid contexts to their defaults in the response
      const resetValues: Record<string, unknown> = {};
      for (const error of contextErrors) {
        // Find the codec by name and get its defaultValue
        const codecEntry = Object.entries(contextCodecs).find(
          ([, c]) => c.name === error.codec,
        );
        if (codecEntry) {
          const [key, codec] = codecEntry;
          resetValues[key] = codec.defaultValue;
        }
      }
      await writeContextsToResponse(
        responseContext,
        contextCodecs,
        resetValues as Partial<ContextCodecMapDataTypes<TCodecs>>,
        jwtConfig,
      );
    }

    // 6. Write context changes to response (from render function)
    if (contextCodecs && contextChanges) {
      await writeContextsToResponse(
        responseContext,
        contextCodecs,
        contextChanges as Partial<ContextCodecMapDataTypes<TCodecs>>,
        jwtConfig,
      );
    }

    // 7. Return final response
    return responseContext.toResponse(html);
  };

  return {
    name,
    mountPath: normalizedMountPath,
    allowedDomains,
    domainAssets,
    contextCodecs,
    render: wrappedRender,
  };
}

/**
 * @deprecated Use createFrontend instead
 */
export const createAppMountPoint = createFrontend;
