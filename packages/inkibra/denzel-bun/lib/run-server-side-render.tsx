/** @jsxImportSource react */
/**
 * Server-Side Render Function
 *
 * Renders a Router with its shell, running loaders and injecting
 * the rendered content into the mount point using HTMLRewriter.
 *
 * Usage:
 * ```typescript
 * const { html, contextChanges } = await runServerSideRender(
 *   {
 *     appConfig,
 *     source,
 *     apiImplementations,
 *     context: ctx,  // ContextByScope<TCodecs>
 *     appName,
 *     mountPointId,
 *     routes,
 *   },
 *   <AppShell lang="en" clientScript={clientScript}>
 *     <AppShell.Head>...</AppShell.Head>
 *     <AppShell.Body>
 *       <AppShell.MountPoint />
 *     </AppShell.Body>
 *   </AppShell>
 * );
 * ```
 */

import type { AppRouteNode } from '@inkibra/router';
import {
  Err,
  isStaticComponent,
  isStrategyComponent,
  Ok,
  preloadComponent,
  type Result,
  type StorageScope,
} from '@inkibra/router';
import {
  type EventStreamImplementations,
  type LocationSource,
  type PreparedAppConfig,
  type RequiredApiImplementations,
  type RequiredContextByScope,
  type RouteEntry,
  Router,
  RouterProvider,
  runServerLoaders,
} from '@inkibra/router/react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { RenderContextProvider } from '../react/app-shell';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for server-side rendering
 *
 * Routes are extracted from preparedApp.app.routes
 * App ID is extracted from preparedApp.app.appId
 */
export type RunServerSideRenderConfig<
  TConfig = Record<string, unknown>,
  TTree extends AppRouteNode<any, any, any> = AppRouteNode<any, any, any>,
> = {
  preparedApp: PreparedAppConfig<TConfig, TTree>;
  source: LocationSource;
  /** Flat route entries for Router/runServerLoaders (NOT the route tree). */
  routes: RouteEntry[];
  apiImplementations: RequiredApiImplementations<RouteEntry[]>;
  eventStreamImplementations: EventStreamImplementations;
  context: RequiredContextByScope<RouteEntry[]>;
  mountPointId: string;
  basePath?: string;
};

/**
 * Result of server-side rendering
 */
export type RunServerSideRenderResult = {
  /** Complete HTML string (includes <!DOCTYPE html>) */
  html: string;
  /** Context changes from loaders (empty for now - future enhancement) */
  contextChanges: Record<string, unknown>;
};

// ============================================================================
// runServerSideRender
// ============================================================================

/**
 * Server-side render function
 *
 * 1. Runs server loaders with pre-deserialized context
 * 2. Renders Router wrapped in RouterProvider
 * 3. Renders AppShell wrapped in RenderContextProvider
 * 4. Uses HTMLRewriter to inject Router HTML into MountPoint
 * 5. Returns complete HTML string with DOCTYPE
 *
 * @param config - Server-side render configuration
 * @param shellElement - The AppShell element with Head/Body/MountPoint
 * @returns { html, contextChanges } - Complete HTML and any context changes
 *
 * @example
 * ```typescript
 * const { html, contextChanges } = await runServerSideRender(
 *   {
 *     preparedApp: prepare(ExampleApp, { config: { version: '1.0.0' } }),
 *     source: createSegmentSource(request.url),
 *     apiImplementations: { ...handlers },
 *     eventStreamImplementations: {},
 *     context: ctx,  // ContextByScope<TCodecs>
 *     mountPointId: 'app-root',
 *   },
 *   <AppShell lang="en" clientScript={await getClientAssetTags()}>
 *     <AppShell.Head>...</AppShell.Head>
 *     <AppShell.Body>
 *       <AppShell.MountPoint />
 *     </AppShell.Body>
 *   </AppShell>
 * );
 *
 * return { html, contextChanges };
 * ```
 */
export async function runServerSideRender<
  TConfig = Record<string, unknown>,
  TTree extends AppRouteNode<any, any, any> = AppRouteNode<any, any, any>,
>(
  config: RunServerSideRenderConfig<TConfig, TTree>,
  shellElement: ReactElement,
): Promise<RunServerSideRenderResult> {
  const {
    preparedApp,
    source,
    routes,
    apiImplementations,
    eventStreamImplementations,
    context,
    mountPointId,
    basePath = '',
  } = config;

  // Extract app definition from preparedApp
  const { app } = preparedApp;
  const appId = app.appId;

  // 1. Extract codec registry from routes
  // TODO: Routes currently only store codec names, not scopes. To properly support
  // device-scoped codecs, __contextCodecScopes needs to be added to AppRouteNode type
  // and populated during route creation. For now, default to 'session' scope.
  const codecNames = app.routes.__contextCodecNames ?? [];
  const codecRegistry = Object.fromEntries(
    codecNames.map((name: string) => [
      name,
      { scope: 'session' as StorageScope },
    ]),
  );

  // 2. Context is now grouped by scope { session: {...}, device: {...} }
  const ctx = context ?? { session: {}, device: {} };

  // 3. Create flat context for loaders (they access by codec name)
  const flatContext: Record<string, unknown> = {
    ...ctx.session,
    ...ctx.device,
  };

  // 4. Create readContext function that looks up by scope and name
  // RouterProvider still needs this interface for client-side hydration compatibility
  const readContext = (
    scope: StorageScope,
    _appName: string,
    codecName: string,
  ): Result<unknown, { type: string }> => {
    const scopeData = (ctx as Record<string, Record<string, unknown>>)[scope];
    const value = scopeData?.[codecName];
    if (value !== undefined) {
      return Ok(value);
    }
    return Err({ type: 'NotFound' });
  };

  // 5. Preload any strategy components (sync/lazy/static) before running loaders
  // This ensures they're available when matchPath calls resolveComponent
  const strategyComponents = routes
    .map((entry) => entry.component)
    .filter(isStrategyComponent);

  if (strategyComponents.length > 0) {
    await Promise.all(strategyComponents.map(preloadComponent));
  }

  // 6. Run server loaders with flat context (loaders access by codec name)
  const { loaderData } = await runServerLoaders({
    routes,
    url: source.getPath(),
    apiImplementations,
    ctx: flatContext,
  });

  // 7. Filter loader data for meta tags - skip static routes
  // Static routes preserve their SSR HTML on the client (dangerouslySetInnerHTML),
  // so they don't need loader data transferred to the client.
  // We still use the full loaderData for SSR rendering (RouterProvider.initialLoaderData)
  // but only serialize non-static route data to meta tags.
  const staticRouteNames = new Set(
    routes
      .filter((entry) => isStaticComponent(entry.component))
      .map((entry) => entry.appRoute.name),
  );

  const loaderDataForMetaTags = Object.fromEntries(
    Object.entries(loaderData).filter(
      ([routeName]) => !staticRouteNames.has(routeName),
    ),
  );

  // 8. Render Router wrapped in providers (uses full loaderData for SSR rendering)
  const routerHtml = renderToString(
    <RouterProvider
      source={source}
      apiImplementations={apiImplementations}
      eventStreamImplementations={eventStreamImplementations}
      readContext={readContext}
      appName={appId}
      codecRegistry={codecRegistry}
      initialLoaderData={loaderData}
      basePath={basePath}
    >
      <Router routes={routes} />
    </RouterProvider>,
  );

  // 9. Render Shell wrapped in RenderContextProvider
  // RenderContext provides preparedApp, mountPointId, loaderData (filtered), and context by scope
  // ctx.session and ctx.device are serialized as meta tags for client hydration
  // Note: loaderDataForMetaTags excludes static routes (they don't need client data)
  const shellHtml = renderToString(
    <RenderContextProvider
      value={{
        appConfig: preparedApp,
        mountPointId,
        loaderData: loaderDataForMetaTags,
        sessionContext: ctx.session,
        deviceContext: ctx.device,
      }}
    >
      {shellElement}
    </RenderContextProvider>,
  );

  // 10. Use HTMLRewriter to inject Router HTML into MountPoint
  const rewriter = new HTMLRewriter().on(`#${mountPointId}`, {
    element(el) {
      el.setInnerContent(routerHtml, { html: true });
    },
  });

  const html = rewriter.transform(shellHtml);

  // 11. Return complete HTML with DOCTYPE and empty contextChanges (future enhancement)
  return {
    html: `<!DOCTYPE html>${html}`,
    contextChanges: {},
  };
}
